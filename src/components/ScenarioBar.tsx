import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Plus, Pencil, Trash2, Check, X, AlertTriangle, Download, Upload } from 'lucide-react'
import { fmt } from '../lib/engine'

export interface ScenarioSummary {
  id: string
  name: string
  count: number
  /** 最后一次改动该清单的时间（新建 / 改名 / 改数据都会刷新），用于提示"多久没动了" */
  updatedAt: number
}

interface Props {
  scenarios: ScenarioSummary[]
  activeId: string
  onSwitch: (id: string) => void
  onCreate: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onExport: () => void
  onImport: (file: File) => void
}

/**
 * 清单条：在多份互相独立的清单之间切换 / 新建 / 重命名 / 删除。
 * 每份清单自带 SKU 与决策配置，便于把「不同商品、不同场景」的比价分开管理。
 * 尾部提供整份工作区的备份导出 / 还原导入，便于跨设备搬运与防清缓存丢失。
 */
export default function ScenarioBar({
  scenarios, activeId, onSwitch, onCreate, onRename, onDelete, onExport, onImport,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId || creating) inputRef.current?.focus()
  }, [editingId, creating])

  const startRename = (id: string, name: string) => {
    setConfirmId(null)
    setEditingId(id)
    setDraft(name)
  }

  const commitRename = () => {
    if (editingId && draft.trim()) onRename(editingId, draft.trim())
    setEditingId(null)
  }

  const commitCreate = () => {
    if (draft.trim()) onCreate(draft.trim())
    setCreating(false)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setCreating(false)
  }

  const editing = editingId !== null || creating

  return (
    <div className="glass rounded-lg px-2.5 py-2 flex items-center gap-2 overflow-hidden">
      <span className="shrink-0 inline-flex items-center gap-1.5 pl-1 panel-sub">
        <FolderOpen className="h-3.5 w-3.5 text-brand" />
        <span className="hidden sm:inline">清单 SCENARIOS</span>
      </span>

      <div className="flex items-center gap-1.5 overflow-x-auto flex-1 py-0.5">
        {scenarios.map((s) => {
          const isActive = s.id === activeId

          if (editingId === s.id) {
            return (
              <span key={s.id} className="flex items-center gap-1 shrink-0">
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') cancelEdit()
                  }}
                  className="field py-1 text-xs w-32"
                  maxLength={24}
                />
                <button onClick={commitRename} className="text-emerald-500 hover:text-emerald-400 p-1" aria-label="确认重命名">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-500 p-1" aria-label="取消重命名">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            )
          }

          if (confirmId === s.id) {
            return (
              <span
                key={s.id}
                className="flex items-center gap-1.5 shrink-0 rounded-lg border border-red-400/40 bg-red-500/5 px-2 py-1 text-xs"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                <span className="text-red-400 whitespace-nowrap">删除「{s.name}」？</span>
                <button
                  onClick={() => { onDelete(s.id); setConfirmId(null) }}
                  className="text-red-400 hover:text-red-500 font-medium"
                >
                  确认
                </button>
                <button onClick={() => setConfirmId(null)} className="text-slate-400 hover:text-slate-500">
                  取消
                </button>
              </span>
            )
          }

          return (
            <span
              key={s.id}
              className={`group shrink-0 flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all ${
                isActive
                  ? 'border-brand bg-brand text-white dark:text-ink shadow-glow'
                  : 'border-edge text-lo hover:border-brand/50 hover:text-brand-deep'
              }`}
            >
              <button
                onClick={() => onSwitch(s.id)}
                className="max-w-[9rem] truncate font-medium"
                title={`${s.name} · ${s.count} 个规格 · 更新于 ${new Date(s.updatedAt).toLocaleString('zh-CN')}`}
              >
                {s.name}
              </button>
              <span className={`tabular text-[10px] ${isActive ? 'text-white/70 dark:text-ink/70' : 'text-lo'}`}>
                {s.count}
              </span>
              {/* 只在激活项上露出"多久没动过"：非激活项空间太挤，精确时间放在 hover 的 title 里 */}
              {isActive && (
                <span className="tabular text-[10px] text-white/60 dark:text-ink/60 whitespace-nowrap">
                  {fmt.ago(s.updatedAt)}
                </span>
              )}
              {isActive && (
                <>
                  <button
                    onClick={() => startRename(s.id, s.name)}
                    className="text-white/70 dark:text-ink/70 hover:text-white dark:hover:text-ink transition-colors"
                    aria-label="重命名清单"
                    title="重命名"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  {scenarios.length > 1 && (
                    <button
                      onClick={() => setConfirmId(s.id)}
                      className="text-white/70 dark:text-ink/70 hover:text-white dark:hover:text-ink transition-colors"
                      aria-label="删除清单"
                      title="删除该清单"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </>
              )}
            </span>
          )
        })}

        {creating ? (
          <span className="flex items-center gap-1 shrink-0">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCreate()
                if (e.key === 'Escape') cancelEdit()
              }}
              placeholder="新清单名称"
              className="field py-1 text-xs w-32"
              maxLength={24}
            />
            <button onClick={commitCreate} className="text-emerald-500 hover:text-emerald-400 p-1" aria-label="确认新建">
              <Check className="h-3.5 w-3.5" />
            </button>
            <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-500 p-1" aria-label="取消新建">
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : (
          <button
            onClick={() => { setEditingId(null); setConfirmId(null); setDraft(''); setCreating(true) }}
            disabled={editing}
            className="shrink-0 flex items-center gap-1 rounded-lg border border-dashed border-edge px-2.5 py-1 text-xs text-slate-400 hover:text-brand hover:border-brand/50 transition-all disabled:opacity-40 disabled:pointer-events-none"
            title="新建一份空白清单"
          >
            <Plus className="h-3.5 w-3.5" /> 新建
          </button>
        )}
      </div>

      <span className="shrink-0 flex items-center gap-0.5 pl-2 border-l border-edge">
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImport(f)
            e.target.value = ''
          }}
        />
        <button
          onClick={onExport}
          className="p-1.5 rounded-lg text-slate-400 hover:text-brand hover:bg-brand-soft/50 transition-colors"
          aria-label="导出工作区备份"
          title="导出备份（JSON，含全部清单）"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="p-1.5 rounded-lg text-slate-400 hover:text-brand hover:bg-brand-soft/50 transition-colors"
          aria-label="导入工作区备份"
          title="从备份还原（覆盖当前清单）"
        >
          <Upload className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  )
}
