import { useEffect, useMemo, useState } from 'react'
import type { Sku, Theme, DecisionConfig, Preference } from './lib/types'
import { decide } from './lib/engine'
import {
  loadSkus, saveSkus, loadTheme, saveTheme,
  loadConfig, saveConfig, migrateV1ToV2, sampleScene,
} from './lib/store'
import { loadAiConfig, saveAiConfig, isAiReady, isVisionReady } from './lib/ai'
import type { AiConfig } from './lib/ai'
import { useUnitNormalize } from './lib/useUnitNormalize'
import { unitMixWarning } from './lib/engine'
import Workbench from './components/Workbench'
import Report from './components/Report'
import AiSettings from './components/AiSettings'
import { Sun, Moon, LineChart, PencilLine, Settings } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

type Page = 'workbench' | 'report'

export default function App() {
  // 启动时先做 v1 → v2 一次性迁移（旧 bonus 字段 → params + dims）
  const [boot] = useState(() => migrateV1ToV2())
  const [page, setPage] = useState<Page>('workbench')
  const [skus, setSkus] = useState<Sku[]>(() => boot.skus)
  const [config, setConfig] = useState<DecisionConfig>(() => boot.config)
  const [theme, setTheme] = useState<Theme>(() => loadTheme())
  const [aiConfig, setAiConfig] = useState<AiConfig>(() => loadAiConfig())
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => saveSkus(skus), [skus])
  useEffect(() => saveConfig(config), [config])

  useEffect(() => {
    saveTheme(theme)
    const root = document.documentElement
    root.classList.toggle('light', theme === 'light')
    root.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const handleSaveAi = (c: AiConfig) => {
    saveAiConfig(c)
    setAiConfig(c)
  }

  // 生僻单位先经 AI 归一化（本地表已知则直接用，不耗 AI）
  const normalizedSkus = useUnitNormalize(skus)
  const result = useMemo(
    () => decide(normalizedSkus, config),
    [normalizedSkus, config],
  )
  const aiReady = isAiReady()
  const visionReady = isVisionReady()

  // 加载示例场景时同步覆盖 skus + config
  const handleLoadScene = (scene: 'snack' | 'phone') => {
    const s = sampleScene(scene)
    setSkus(s.skus)
    setConfig(s.config)
  }

  // 切换偏好（报告页 segmented control 触发）
  const handlePreferenceChange = (p: Preference) => {
    setConfig((c) => ({ ...c, preference: p }))
  }
  const handleBudgetChange = (budget: number | undefined) => {
    setConfig((c) => ({ ...c, budget }))
  }

  return (
    <div className="min-h-[100dvh] grid-texture">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-40 glass border-x-0 border-t-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-brand to-emerald-600 grid place-items-center shadow-glow shrink-0">
              <LineChart className="h-5 w-5 text-white" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-base sm:text-lg tracking-tight truncate">
                规格决策台
              </h1>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                多 SKU 比价 · 找出最划算的那一个
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 页面切换 */}
            <nav className="flex rounded-lg border border-edge overflow-hidden">
              <button
                onClick={() => setPage('workbench')}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-colors ${
                  page === 'workbench'
                    ? 'bg-cyan-glow/15 text-cyan-glow'
                    : 'text-slate-400 hover:text-brand-deep'
                }`}
              >
                <PencilLine className="h-4 w-4" />
                <span className="hidden sm:inline">工作台</span>
              </button>
              <button
                onClick={() => setPage('report')}
                disabled={result.items.length === 0}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40 ${
                  page === 'report'
                    ? 'bg-cyan-glow/15 text-cyan-glow'
                    : 'text-slate-400 hover:text-brand-deep'
                }`}
              >
                <LineChart className="h-4 w-4" />
                <span className="hidden sm:inline">报告</span>
              </button>
            </nav>

            {/* AI 设置 */}
            <button
              onClick={() => setSettingsOpen(true)}
              className="h-9 px-2.5 rounded-lg border border-edge flex items-center gap-1.5 text-slate-600 hover:text-cyan-glow hover:border-cyan-glow/50 transition-all"
              aria-label="AI 设置"
              title={`AI 服务配置${aiReady ? '（文本已就绪' : '（未配置'}${aiReady && visionReady ? ' + 视觉已就绪' : aiReady ? '，视觉未配置' : ''}）`}
            >
              <Settings className="h-4 w-4" />
              <span className={`h-1.5 w-1.5 rounded-full ${visionReady ? 'bg-emerald-500' : aiReady ? 'bg-amber-400' : 'bg-slate-300'}`} />
            </button>

            {/* 主题切换 */}
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="h-9 w-9 rounded-lg border border-edge grid place-items-center text-slate-600 hover:text-cyan-glow hover:border-cyan-glow/50 transition-all"
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            {page === 'workbench' ? (
              <Workbench
                skus={skus}
                onChange={setSkus}
                onGenerate={() => setPage('report')}
                config={config}
                onConfigChange={setConfig}
                onLoadScene={handleLoadScene}
              />
            ) : (
              <Report
                result={result}
                config={config}
                unitWarning={unitMixWarning(normalizedSkus)}
                onBack={() => setPage('workbench')}
                onPreferenceChange={handlePreferenceChange}
                onBudgetChange={handleBudgetChange}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="max-w-7xl mx-auto px-6 pb-8 text-center text-xs text-slate-500">
        数据仅保存在你的浏览器本地 · 纯前端工具 · 不上传任何信息
      </footer>
    </div>
  )
}
