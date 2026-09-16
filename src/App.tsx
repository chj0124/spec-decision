import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Sku, Theme, DecisionConfig, Preference } from './lib/types'
import { decide } from './lib/engine'
import {
  loadTheme, saveTheme, migrateV1ToV2,
  loadWorkspace, newScenario,
  exportWorkspace, importWorkspace,
  commitWorkspace, readStoredRev, subscribeWorkspaceChange,
  onPersistIssue, getPersistIssue, clearPersistIssues,
  createDraftScheduler, loadRecoverableDraft, clearDraft, sameWorkspace,
} from './lib/store'
import type { Scenario, Workspace, PersistIssue, DraftRecord, DraftScheduler } from './lib/store'
import { encodeShare, decodeShare, buildShareUrl, readShareToken, clearShareHash } from './lib/share'
import type { ShareData } from './lib/share'
import { loadAiConfig, saveAiConfig, isAiReady, isVisionReady } from './lib/ai'
import type { AiConfig } from './lib/ai'
import {
  UNDO_TTL_MS, captureDelete, captureImport, removeScenario, applyUndo,
  emptyHistory, pushHistory, undoHistory, redoHistory,
} from './lib/undo'
import type { UndoSlot, History } from './lib/undo'
import { useUnitNormalize } from './lib/useUnitNormalize'
import { unitMixWarning } from './lib/engine'
import Workbench from './components/Workbench'
import AiSettings from './components/AiSettings'
import ScenarioBar from './components/ScenarioBar'
import { Sun, Moon, LineChart, PencilLine, Settings, Download, Upload, Eye, X, Undo2 } from 'lucide-react'

// 报告页依赖 recharts（体积较大）且首屏不可见，按需加载以避免拖慢工作台首屏
const Report = lazy(() => import('./components/Report'))

type Page = 'workbench' | 'report'

/** 把改动写回当前激活清单 */
function patchActive(w: Workspace, patch: Partial<Scenario>): Workspace {
  return {
    ...w,
    scenarios: w.scenarios.map((s) =>
      s.id === w.activeId ? { ...s, ...patch, updatedAt: Date.now() } : s,
    ),
  }
}

export default function App() {
  // 启动时先做 v1 → v2 一次性迁移（旧 bonus 字段 → params + dims），再加载多清单工作区
  const [boot] = useState(() => {
    migrateV1ToV2()
    return loadWorkspace()
  })
  const [page, setPage] = useState<Page>('workbench')
  const [workspace, setWorkspace] = useState<Workspace>(boot)
  const [theme, setTheme] = useState<Theme>(() => loadTheme())
  const [aiConfig, setAiConfig] = useState<AiConfig>(() => loadAiConfig())
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 非空表示正在查看通过链接打开的报告（只读分享视图，不写入本地清单） */
  const [shared, setShared] = useState<ShareData | null>(null)
  const [shareError, setShareError] = useState(false)
  /** 已解析但待用户确认覆盖的备份；非空时显示导入确认条 */
  const [pendingImport, setPendingImport] = useState<Workspace | null>(null)
  const [backupError, setBackupError] = useState(false)
  /** 非空表示本地写入失败（配额超限 / 存储被禁用），提示用户改动可能丢，需导出备份 */
  const [persistIssue, setPersistIssue] = useState<PersistIssue | null>(() => getPersistIssue())
  /** 最近一次破坏性操作（删除清单 / 覆盖导入）的可回退槽；非空时显示撤销提示条 */
  const [undo, setUndo] = useState<UndoSlot | null>(null)
  /** 非空表示其他标签页写过更新版本，本页可能是旧数据；提示用户是否载入 */
  const [externalChange, setExternalChange] = useState(false)
  /**
   * 非空表示重开时发现"上次没同步上的草稿"（崩溃 / 关页 / 提交被判过期）。
   * 启动时读一次即刻固化到内存：此后即使用户继续编辑冲掉了草稿键，提示条依然有效。
   */
  const [draft, setDraft] = useState<DraftRecord | null>(() => loadRecoverableDraft())
  /**
   * 常规编辑的撤销 / 重做历史（F4）。与上面的"撤销槽"是两套：
   * 槽负责破坏性操作的限时提示条，这里负责 Ctrl/Cmd+Z 逐级回退任意改动。
   * 栈是本标签页私有的：快照只反映本页演化，不跨标签页共享。
   */
  const [history, setHistory] = useState<History>(emptyHistory)

  const active = workspace.scenarios.find((s) => s.id === workspace.activeId) ?? workspace.scenarios[0]
  const skus = shared ? shared.skus : active.skus
  const config = shared ? shared.config : active.config

  // 订阅本地写入异常。必须声明在下面那个保存副作用之前：effect 按声明顺序执行，
  // 这样挂载当次的写入失败才不会被漏掉。
  useEffect(() => onPersistIssue(setPersistIssue), [])

  // 其他标签页改了工作区（storage 事件 / BroadcastChannel）：只提示，不静默覆盖本页
  useEffect(() => subscribeWorkspaceChange(() => setExternalChange(true)), [])

  // 草稿节流器（F6）：提前建好 —— 下面的落盘副作用要在"提交成功"时用它可以丢掉落盘后
  // 已无意义的待写草稿。
  const draftSchedulerRef = useRef<DraftScheduler | null>(null)
  if (!draftSchedulerRef.current) draftSchedulerRef.current = createDraftScheduler()
  const draftScheduler = draftSchedulerRef.current
  /** 已交给节流器的最后一版；初始为启动态，免得刚打开就为"没改过的工作区"写草稿 */
  const lastDrafted = useRef<Workspace>(boot)

  // 落盘走带版本号守卫的提交：若已落后于其他标签页则拒绝覆盖并提示，
  // 而不是把对方整份改动盖掉（风险卡 D3）。提交成功后把本页 rev 对齐到落盘值，
  // 内容未变的下一次提交会被跳过，因此不会自激成环。
  useEffect(() => {
    let cancelled = false
    commitWorkspace(workspace).then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setExternalChange(true)
        return
      }
      // 落盘成功：这份内容已经进了共享数据，为它排的待写草稿再无存在价值，必须主动丢弃。
      // 节流窗口尾沿的"补写"会晚一步执行：若留着它，就会把别的标签页"真没同步上"的
      // 草稿冲掉 —— 草稿键是全标签页共用的，之后重开的那页便会误判为"有未同步改动"，
      // 无端弹出恢复条（这正是"数据已同步后重开不再打扰"间歇失败的根因）。
      // 只在节流器手上最后一版就是这份刚落盘内容时才丢；用户若又改了更新的内容，保留它。
      if (sameWorkspace(lastDrafted.current, res.workspace)) draftScheduler.cancel()
      // 提交会把工作区规范化后落盘，这里把内存态对齐到规范化形态：
      // 既让 rev 跟上落盘值，也确保"读回来的形态 === 内存形态"，避免同一份内容
      // 因清洗补全（如 priceHistory 播种）被反复判定为"已变"而无谓写入。
      setWorkspace((w) =>
        w.rev === res.workspace.rev &&
        JSON.stringify(w.scenarios) === JSON.stringify(res.workspace.scenarios)
          ? w
          : res.workspace,
      )
    })
    return () => { cancelled = true }
  }, [workspace, draftScheduler])

  /* ---------- 自动草稿（F6）：崩溃 / 关页的恢复安全网 ----------
   * 编辑中把工作区节流写进本页私有的草稿键（不进 rev 竞争、不写主数据键）：
   *  - 落盘是异步提交，关页 / 崩溃可能赶在它之前，最后几次编辑就只留在内存里；
   *  - 提交被判"过期"时本页改动根本进不了共享数据，关页即永久丢失（风险卡 D3）。
   * 草稿是这两条缝的兜底：内容与落盘一致时重开会静默清掉，不打扰用户。
   */
  useEffect(() => {
    // 待恢复草稿还没处理时不动草稿键：否则刚打开就把上一条未处理的草稿冲掉
    if (shared || draft) return
    // 内容与"已交给节流器的最后一版"一致时不必再写。提交成功会把内存态对齐到
    // 规范化形态（新引用、同内容），若只比引用就会为这份"其实已落盘"的副本再排一次补写；
    // 草稿键是全标签页共用的，那次迟到的补写会把别页仍未同步的草稿冲掉 ——
    // 这正是"数据已同步后重开不再打扰"时好时坏的根因。
    if (sameWorkspace(lastDrafted.current, workspace)) return
    lastDrafted.current = workspace
    draftScheduler.schedule(workspace, workspace.rev)
  }, [workspace, shared, draft, draftScheduler])

  // 关页 / 切到后台时把待写的最后一次编辑补上，别让它卡在节流窗口里丢掉
  useEffect(() => {
    const flush = () => draftScheduler.flush()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [draftScheduler])

  useEffect(() => {
    saveTheme(theme)
    const root = document.documentElement
    root.classList.toggle('light', theme === 'light')
    root.classList.toggle('dark', theme === 'dark')
    // 让移动端状态栏配色跟随应用内主题（而非系统偏好），与页面底色一致
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#16161b' : '#f6f5f0')
  }, [theme])

  // 打开带 #r= 的分享链接时，解码后进入只读报告视图
  useEffect(() => {
    const token = readShareToken()
    if (!token) return
    let cancelled = false
    decodeShare(token).then((data) => {
      if (cancelled) return
      if (data) {
        setShared(data)
        setPage('report')
      } else {
        setShareError(true)
        clearShareHash()
      }
    })
    return () => { cancelled = true }
  }, [])

  // 撤销槽自动过期：留一个明确的时限，避免"看起来还能撤销"却早已被后续操作顶掉
  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), UNDO_TTL_MS)
    return () => clearTimeout(timer)
  }, [undo])

  /* ---------- 撤销 / 重做历史（F4）----------
   * Ctrl/Cmd+Z 逐级回退，Ctrl/Cmd+Shift+Z 逐级重做。回退得到的是"改动前"的整份快照，
   * 因此编辑字段、增删清单、覆盖导入都能回退；删除清单 / 覆盖导入另外还留着限时撤销条，
   * 两套入口指向同一次改动，互不冲突。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 只读分享视图不接管快捷键，交还浏览器原生行为
      if (shared) return
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return
      // 拦下原生的输入框撤销，统一走工作区级历史，保证"撤的是整份改动"而不是某个字符
      e.preventDefault()
      const res = e.shiftKey
        ? redoHistory(history, workspace)
        : undoHistory(history, workspace)
      if (!res) return
      setHistory(res.history)
      // 回退的是整份旧快照，rev 要重新对齐当前落盘值，否则会被"过期"守卫误判为陈旧写入
      setWorkspace({ ...res.workspace, rev: readStoredRev() })
      // 键盘回退会整份换掉工作区：限时撤销条不再指向同一次改动，收起它免得两套入口打架
      setUndo(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shared, history, workspace])

  const handleSaveAi = (c: AiConfig) => {
    saveAiConfig(c)
    setAiConfig(c)
  }

  /* ---------- 清单（场景）管理 ---------- */

  /**
   * 在任何一次改动前把"当前工作区"压入撤销栈（F4）。
   * 读的是渲染闭包里的 workspace，因此同一次用户动作里连着的多笔改动
   * （如"生成示例数据"会同时改 SKU 与配置）拿到的是同一个引用，只记一步。
   */
  const recordHistory = () => setHistory((h) => pushHistory(h, workspace))

  const setSkus = (next: Sku[]) => {
    if (shared) {
      setShared((s) => (s ? { ...s, skus: next } : s))
      return
    }
    recordHistory()
    setWorkspace((w) => patchActive(w, { skus: next }))
  }

  const setConfig = (next: DecisionConfig) => {
    if (shared) {
      setShared((s) => (s ? { ...s, config: next } : s))
      return
    }
    recordHistory()
    setWorkspace((w) => patchActive(w, { config: next }))
  }

  const switchScenario = (id: string) => {
    if (id === workspace.activeId) return
    recordHistory()
    setWorkspace((w) => ({ ...w, activeId: id }))
  }

  const createScenario = (name: string) => {
    recordHistory()
    setWorkspace((w) => {
      const sc = newScenario(name)
      return { scenarios: [...w.scenarios, sc], activeId: sc.id, rev: w.rev }
    })
  }

  // 改名也是一次改动，同样刷新 updatedAt，否则清单条上的"多久没动过"会失真
  const renameScenario = (id: string, name: string) => {
    recordHistory()
    setWorkspace((w) => ({
      ...w,
      scenarios: w.scenarios.map((s) => (s.id === id ? { ...s, name, updatedAt: Date.now() } : s)),
    }))
  }

  const deleteScenario = (id: string) => {
    // 先留撤销槽再删：captureDelete 要拿原位置与被删清单的内容，删完就取不到了
    const slot = captureDelete(workspace, id)
    if (!slot) return
    // 删除既压撤销栈（Ctrl/Cmd+Z 可整份回退），也留限时撤销条（外科式放回原位置）——
    // 两套入口指向同一次删除，合并而非替换
    recordHistory()
    setUndo(slot)
    setWorkspace((w) => removeScenario(w, id))
  }

  /** 撤销最近一次破坏性操作（删除清单 / 覆盖导入） */
  const undoDestructive = () => {
    if (!undo) return
    // 撤销条本身也是一次改动：记一步，于是 Ctrl/Cmd+Shift+Z 还能重做掉这次删除
    recordHistory()
    setWorkspace((w) => applyUndo(w, undo))
    setUndo(null)
  }

  /** 载入其他标签页写入的最新版本：本页未同步的改动会被丢弃，撤销槽/待确认导入随之作废 */
  const loadExternal = () => {
    // 本页未同步的改动要一起丢掉：否则节流器补写出的草稿会把它"复活"，
    // 下次重开又弹一条已经决定不要了的恢复提示
    draftScheduler.cancel()
    clearDraft()
    setWorkspace(loadWorkspace())
    setUndo(null)
    setPendingImport(null)
    setExternalChange(false)
  }

  /** 恢复上次没同步上的草稿：改动回到编辑器；版本号对齐落盘值，免得被"过期"守卫误伤 */
  const restoreDraft = () => {
    if (!draft) return
    // 恢复会整份换掉当前内容，先记一步：按错"恢复"还能 Ctrl/Cmd+Z 退回
    recordHistory()
    setWorkspace({ ...draft.workspace, rev: readStoredRev() })
    clearDraft()
    setDraft(null)
    setExternalChange(false)
    setPage('workbench')
  }

  /** 丢弃草稿：用户确认这批改动不需要了 */
  const discardDraft = () => {
    clearDraft()
    setDraft(null)
  }

  /* ---------- 工作区备份 / 还原 ---------- */

  const exportBackup = () => {
    const json = exportWorkspace(workspace)
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `规格决策台-备份-${stamp}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = async (file: File) => {
    const ws = importWorkspace(await file.text())
    if (!ws) {
      setBackupError(true)
      return
    }
    setBackupError(false)
    setPendingImport(ws)
  }

  const confirmImport = () => {
    if (!pendingImport) return
    // 覆盖导入会整份换掉工作区，先把它压进撤销栈，再把旧的收进撤销槽
    recordHistory()
    setUndo(captureImport(workspace, pendingImport))
    // 覆盖导入是用户显式动作：版本号对齐到当前落盘值，避免被"过期"守卫误伤
    setWorkspace({ ...pendingImport, rev: readStoredRev() })
    setPendingImport(null)
  }

  /* ---------- 分享 ---------- */

  const getShareUrl = useCallback(async () => {
    const token = await encodeShare({ skus, config })
    return buildShareUrl(token)
  }, [skus, config])

  const exitShared = () => {
    setShared(null)
    clearShareHash()
  }

  const importShared = () => {
    if (!shared) return
    const d = new Date()
    const name = `分享导入 ${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const sc = newScenario(name, shared.skus, shared.config)
    recordHistory()
    setWorkspace((w) => ({ scenarios: [...w.scenarios, sc], activeId: sc.id, rev: w.rev }))
    exitShared()
    setPage('workbench')
  }

  const handleBack = () => {
    if (shared) exitShared()
    setPage('workbench')
  }

  // 生僻单位先经 AI 归一化（本地表已知则直接用，不耗 AI）
  const normalizedSkus = useUnitNormalize(skus)
  const result = useMemo(
    () => decide(normalizedSkus, config),
    [normalizedSkus, config],
  )
  const aiReady = isAiReady()
  const visionReady = isVisionReady()

  // 切换偏好（报告页 segmented control 触发）
  const handlePreferenceChange = (p: Preference) => setConfig({ ...config, preference: p })
  const handleBudgetChange = (budget: number | undefined) => setConfig({ ...config, budget })

  return (
    <div className="min-h-[100dvh] grid-texture">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-40 glass border-x-0 border-t-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-brand to-violet-500 grid place-items-center shadow-glow shrink-0">
              <LineChart className="h-5 w-5 text-white" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-base sm:text-lg tracking-tight truncate">
                规格决策台
              </h1>
              <p className="text-xs text-slate-500 hidden sm:block truncate">
                {shared ? '只读分享报告' : `${active.name} · 多 SKU 比价`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 页面切换：分段控件，激活项实心填充 */}
            <nav className="flex rounded-xl border border-edge bg-panel/70 p-1 gap-1">
              <button
                onClick={() => setPage('workbench')}
                disabled={Boolean(shared)}
                aria-label="工作台"
                className={`px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium rounded-lg flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:pointer-events-none ${
                  page === 'workbench'
                    ? 'bg-brand text-white shadow-glow'
                    : 'text-slate-500 hover:text-brand-deep hover:bg-brand-soft/60'
                }`}
              >
                <PencilLine className="h-4 w-4" />
                <span className="hidden sm:inline">工作台</span>
              </button>
              <button
                onClick={() => setPage('report')}
                // 预算把全部规格过滤掉时 items 为空，但报告页此时有专门的空态可看
                // （可就地放宽预算 / 换偏好），所以这里不能一并禁用，否则会变成回不去的死胡同
                disabled={result.items.length === 0 && result.budgetExcludedItems.length === 0}
                aria-label="报告"
                className={`px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium rounded-lg flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:pointer-events-none ${
                  page === 'report'
                    ? 'bg-brand text-white shadow-glow'
                    : 'text-slate-500 hover:text-brand-deep hover:bg-brand-soft/60'
                }`}
              >
                <LineChart className="h-4 w-4" />
                <span className="hidden sm:inline">报告</span>
              </button>
            </nav>

            {/* AI 设置 */}
            <button
              onClick={() => setSettingsOpen(true)}
              className="h-9 px-2.5 rounded-xl border border-edge bg-panel/70 flex items-center gap-1.5 text-slate-500 hover:text-brand hover:border-brand/50 transition-all"
              aria-label="AI 设置"
              title={`AI 服务配置${aiReady ? '（文本已就绪' : '（未配置'}${aiReady && visionReady ? ' + 视觉已就绪' : aiReady ? '，视觉未配置' : ''}）`}
            >
              <Settings className="h-4 w-4" />
              <span className={`h-1.5 w-1.5 rounded-full ${visionReady ? 'bg-emerald-500' : aiReady ? 'bg-amber-400' : 'bg-slate-300'}`} />
            </button>

            {/* 主题切换 */}
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="h-9 w-9 rounded-xl border border-edge bg-panel/70 grid place-items-center text-slate-500 hover:text-brand hover:border-brand/50 transition-all"
              aria-label="切换主题"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* AI 设置弹窗 */}
      <AiSettings
        open={settingsOpen}
        config={aiConfig}
        onSave={handleSaveAi}
        onClose={() => setSettingsOpen(false)}
      />

      {/* 主内容 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-5 sm:space-y-6">
        {/* 清单条：多份清单互相独立；分享视图下隐藏 */}
        {!shared && (
          <ScenarioBar
            scenarios={workspace.scenarios.map((s) => ({ id: s.id, name: s.name, count: s.skus.length, updatedAt: s.updatedAt }))}
            activeId={workspace.activeId}
            onSwitch={switchScenario}
            onCreate={createScenario}
            onRename={renameScenario}
            onDelete={deleteScenario}
            onExport={exportBackup}
            onImport={handleImportFile}
          />
        )}

        {/* 撤销槽：删除清单 / 覆盖导入都不可逆，给一个有时限的回退口子 */}
        {undo && (
          <div
            role="status"
            className="glass rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 border-amber-400/40"
          >
            <div className="flex items-center gap-2 text-xs text-slate-500 flex-1">
              <Undo2 className="h-4 w-4 text-amber-500 shrink-0" />
              <span>
                {undo.label}，可在 {UNDO_TTL_MS / 1000} 秒内撤销。
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={undoDestructive}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:opacity-90 transition-opacity"
              >
                撤销
              </button>
              <button
                onClick={() => setUndo(null)}
                className="p-1.5 rounded-lg border border-edge text-slate-500 hover:text-amber-500 hover:border-amber-400/50 transition-all"
                aria-label="关闭撤销提示"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* 上次会话有没同步上的改动（崩溃 / 关页 / 提交被判过期）：提示恢复而不是静默丢掉 */}
        {draft && !shared && (
          <div
            role="status"
            className="glass rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 border-brand/30"
          >
            <div className="flex items-center gap-2 text-xs text-slate-500 flex-1">
              <Undo2 className="h-4 w-4 text-brand shrink-0" />
              <span>
                检测到上次<strong className="text-brand-deep dark:text-brand">未保存</strong>的改动（
                {draft.workspace.scenarios.length} 份清单、
                {draft.workspace.scenarios.reduce((n, s) => n + s.skus.length, 0)} 个规格），是否恢复？
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={restoreDraft}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-brand text-white hover:opacity-90 transition-opacity"
              >
                恢复
              </button>
              <button
                onClick={discardDraft}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-edge text-slate-500 hover:text-brand hover:border-brand/50 transition-all"
              >
                丢弃
              </button>
            </div>
          </div>
        )}

        {/* 其他标签页改过工作区：本页可能是旧版本，让用户选择载入而不是静默覆盖 */}
        {externalChange && (
          <div
            role="status"
            className="glass rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 border-amber-400/40"
          >
            <div className="flex items-center gap-2 text-xs text-slate-500 flex-1">
              <AlertIcon />
              <span>另一标签页已修改，载入？载入会丢弃本页尚未同步的改动。</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={loadExternal}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:opacity-90 transition-opacity"
              >
                载入
              </button>
              <button
                onClick={() => setExternalChange(false)}
                className="p-1.5 rounded-lg border border-edge text-slate-500 hover:text-amber-500 hover:border-amber-400/50 transition-all"
                aria-label="关闭外部修改提示"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* 本地写入失败：数据可能存不下来，必须让用户知道并引导导出备份 */}
        {persistIssue && (
          <div
            role="alert"
            className="glass rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 border-rose-400/40"
          >
            <div className="flex items-start sm:items-center gap-2 text-xs text-rose-500 flex-1">
              <AlertIcon />
              <span>
                <strong>本地保存失败</strong>
                {persistIssue.reason === 'quota'
                  ? '：浏览器存储空间已满'
                  : persistIssue.reason === 'blocked'
                    ? '：浏览器已禁用本地存储（如隐私模式）'
                    : '：浏览器拒绝了本地存储写入'}
                ，当前改动<strong>可能无法持久化</strong>。请先导出备份，或清理浏览器空间后重试。
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={exportBackup}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-rose-500 text-white hover:opacity-90 transition-opacity"
              >
                导出备份
              </button>
              <button
                onClick={clearPersistIssues}
                className="p-1.5 rounded-lg border border-edge text-slate-500 hover:text-rose-500 hover:border-rose-400/50 transition-all"
                aria-label="关闭保存失败提示"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* 分享链接无法解析时的提示 */}
        {shareError && (
          <div className="glass rounded-2xl px-4 py-3 flex items-center gap-2 text-xs text-amber-500 border-amber-400/40">
            <AlertIcon />
            <span className="flex-1">分享链接已损坏或格式不被支持，已返回本地清单。</span>
            <button onClick={() => setShareError(false)} className="hover:text-amber-400" aria-label="关闭提示">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* 备份文件无法识别时的提示 */}
        {backupError && (
          <div className="glass rounded-2xl px-4 py-3 flex items-center gap-2 text-xs text-amber-500 border-amber-400/40">
            <AlertIcon />
            <span className="flex-1">备份文件无法识别：不是本应用导出的 JSON，或内容已损坏。</span>
            <button onClick={() => setBackupError(false)} className="hover:text-amber-400" aria-label="关闭提示">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* 导入备份前的覆盖确认（导入会整体替换当前清单） */}
        {pendingImport && (
          <div className="glass rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 border-brand/30">
            <div className="flex items-center gap-2 text-xs text-slate-500 flex-1">
              <Upload className="h-4 w-4 text-brand shrink-0" />
              <span>
                备份含<strong className="text-brand-deep dark:text-brand">{pendingImport.scenarios.length}</strong> 份清单、
                {pendingImport.scenarios.reduce((n, s) => n + s.skus.length, 0)} 个规格
                · 导入将<strong>覆盖</strong>当前 {workspace.scenarios.length} 份清单
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={confirmImport}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-brand text-white hover:opacity-90 transition-opacity"
              >
                覆盖导入
              </button>
              <button
                onClick={() => setPendingImport(null)}
                className="text-xs px-3 py-1.5 rounded-lg border border-edge text-slate-500 hover:text-brand-deep hover:border-brand/50 transition-all"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 只读分享视图提示条 */}
        {shared && (
          <div className="glass rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 border-brand/30">
            <div className="flex items-center gap-2 text-xs text-slate-500 flex-1">
              <Eye className="h-4 w-4 text-brand shrink-0" />
              <span>
                正在查看<strong className="text-brand-deep dark:text-brand">他人分享的报告</strong>
                （只读）· 共 {shared.skus.length} 个规格 · 本页改动不会保存到你的浏览器
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={importShared}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-brand text-white hover:opacity-90 transition-opacity inline-flex items-center gap-1.5"
              >
                <Download className="h-3.5 w-3.5" /> 导入到我的清单
              </button>
              <button
                onClick={exitShared}
                className="text-xs px-3 py-1.5 rounded-lg border border-edge text-slate-500 hover:text-brand-deep hover:border-brand/50 transition-all"
              >
                退出分享
              </button>
            </div>
          </div>
        )}

        <div key={`${page}-${shared ? 'shared' : workspace.activeId}`} className="animate-[pageIn_0.25s_ease-out]">
          {page === 'workbench' ? (
            <Workbench
              skus={skus}
              onChange={setSkus}
              onGenerate={() => setPage('report')}
              config={config}
              onConfigChange={setConfig}
            />
          ) : (
            <Suspense fallback={<ReportFallback />}>
              <Report
                result={result}
                config={config}
                unitWarning={unitMixWarning(normalizedSkus)}
                onBack={handleBack}
                onPreferenceChange={handlePreferenceChange}
                onBudgetChange={handleBudgetChange}
                getShareUrl={shared ? undefined : getShareUrl}
              />
            </Suspense>
          )}
        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-6 pb-8 text-center text-xs text-slate-500">
        数据仅保存在你的浏览器本地 · 纯前端工具 · 不上传任何信息
        {/* 版本号来自 package.json，构建期注入；单独一行以免打断上面这句 e2e 断言依赖的文案 */}
        <span className="mt-1 block font-mono text-[11px] text-slate-400">v{__APP_VERSION__}</span>
      </footer>
    </div>
  )
}

/** 报告页懒加载占位骨架，避免切换瞬间白屏 */
function ReportFallback() {
  return (
    <div className="space-y-5 sm:space-y-6" aria-busy="true" aria-label="报告加载中">
      <div className="glass rounded-2xl h-28 animate-pulse" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="glass rounded-2xl h-80 animate-pulse" />
        <div className="glass rounded-2xl h-80 animate-pulse" />
      </div>
      <div className="glass rounded-2xl h-56 animate-pulse" />
    </div>
  )
}

/** 提示条左侧图标（避免为单个图标额外引入命名冲突） */
function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
