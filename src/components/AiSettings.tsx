import { useState } from 'react'
import type { AiConfig } from '../lib/ai'
import { AI_PRESETS, chat, listModels } from '../lib/ai'
import { Settings, X, CheckCircle2, AlertCircle, Loader2, ShieldCheck, Zap, RefreshCw, ExternalLink } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  open: boolean
  config: AiConfig
  onSave: (c: AiConfig) => void
  onClose: () => void
}

export default function AiSettings({ open, config, onSave, onClose }: Props) {
  const [form, setForm] = useState<AiConfig>(config)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelList, setModelList] = useState<string[] | null>(null)
  const [modelsError, setModelsError] = useState<string | null>(null)

  // 当前 baseUrl 对应的预设（用于显示"访问控制台"链接）
  const matchedPreset = AI_PRESETS.find((p) => p.baseUrl && p.baseUrl === form.baseUrl)

  // 弹窗打开时同步外部 config
  if (open && form !== config && !testing) {
    // 不强制重置，保留用户正在编辑的内容
  }

  const applyPreset = (label: string) => {
    const p = AI_PRESETS.find((x) => x.label === label)
    if (p) setForm({ ...form, baseUrl: p.baseUrl, model: p.model, visionModel: p.visionModel })
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      // 用表单当前值测试，不读 localStorage（避免"未保存就测不到"的问题）
      const testConfig = {
        ...form,
        enabled: Boolean(form.apiKey && form.baseUrl && form.model),
      }
      const reply = await chat('回复"连接成功"三个字即可。', '你是连接测试助手。', testConfig)
      setTestResult({ ok: true, msg: `连接成功：${reply.slice(0, 20)}` })
    } catch (e: any) {
      setTestResult({ ok: false, msg: e.message ?? '连接失败' })
    } finally {
      setTesting(false)
    }
  }

  const save = () => {
    onSave({ ...form, enabled: Boolean(form.apiKey && form.baseUrl && form.model) })
    onClose()
  }

  const fetchModels = async () => {
    setModelsLoading(true)
    setModelsError(null)
    setModelList(null)
    try {
      const list = await listModels(form)
      setModelList(list)
    } catch (e: any) {
      setModelsError(e.message ?? '获取失败')
    } finally {
      setModelsLoading(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm"
          />
          {/* 面板 */}
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-x-4 top-[8vh] sm:inset-x-0 sm:mx-auto sm:max-w-lg z-50 glass rounded-2xl p-6 max-h-[84vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold tracking-tight flex items-center gap-2">
                <Settings className="h-5 w-5 text-cyan-glow" /> AI 服务配置
              </h3>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="关闭">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-5">
              配置后，截图识别、生僻单位换算、推荐文案润色将由 AI 处理；不配置则全部用本地规则保底。
            </p>

            {/* 预设服务商 */}
            <div className="mb-4">
              <span className="text-sm text-slate-500 mb-1.5 block">服务商（选择后自动填地址与模型）</span>
              <div className="flex flex-wrap gap-1.5">
                {AI_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(p.label)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                      form.baseUrl === p.baseUrl && p.baseUrl
                        ? 'bg-cyan-glow/15 text-cyan-glow border-cyan-glow/50'
                        : 'text-slate-500 border-edge hover:text-slate-700 hover:border-slate-400'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-sm text-slate-500 mb-1 flex items-center gap-1.5">
                  接口地址 Base URL
                  {matchedPreset?.consoleUrl && (
                    <a
                      href={matchedPreset.consoleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-cyan-glow hover:underline text-xs"
                      title={`${matchedPreset.label} 控制台 · 获取 API Key`}
                    >
                      获取 API Key <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </span>
                <input
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  placeholder="https://api.deepseek.com/v1"
                  className="field text-xs font-mono"
                />
              </label>
              <label className="block">
                <span className="text-sm text-slate-500 mb-1 block">API Key</span>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="field text-xs font-mono"
                />
              </label>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-slate-500">模型 Model</span>
                  <button
                    onClick={fetchModels}
                    disabled={modelsLoading || !form.apiKey || !form.baseUrl}
                    className="inline-flex items-center gap-1 text-xs text-cyan-glow hover:underline disabled:opacity-40 disabled:no-underline"
                    title="从服务商拉取可用模型列表"
                  >
                    {modelsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    获取可用模型
                  </button>
                </div>
                <input
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="deepseek-chat"
                  className="field text-xs font-mono"
                />
                {/* 模型列表 */}
                {modelList && modelList.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1 max-h-28 overflow-y-auto p-1.5 rounded-lg border border-edge bg-brand-soft/30">
                    {modelList.map((m) => (
                      <button
                        key={m}
                        onClick={() => setForm({ ...form, model: m })}
                        className={`px-2 py-0.5 rounded text-xs font-mono transition-all ${
                          form.model === m
                            ? 'bg-cyan-glow/20 text-cyan-glow font-semibold'
                            : 'text-slate-500 hover:bg-brand-soft/60 hover:text-brand-deep'
                        }`}
                        title={`点击选用 ${m}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
                {modelsError && (
                  <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" /> {modelsError}
                  </p>
                )}
              </div>
              <label className="block">
                <span className="text-sm text-slate-500 mb-1 block flex items-center gap-1">
                  视觉模型 Vision Model
                  <span className="text-sm text-slate-400">（用于截图识别，留空则用上面的 Model）</span>
                </span>
                <input
                  value={form.visionModel ?? ''}
                  onChange={(e) => setForm({ ...form, visionModel: e.target.value })}
                  placeholder="qwen-vl-plus / glm-4v-flash / gpt-4o-mini"
                  className="field text-xs font-mono"
                />
                {/* 视觉模型也支持从已拉取的列表选 */}
                {modelList && modelList.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                    {modelList
                      .filter((m) => /v[il]?[so]?n?|vl|4o|vision|image/i.test(m))
                      .map((m) => (
                        <button
                          key={m}
                          onClick={() => setForm({ ...form, visionModel: m })}
                          className={`px-2 py-0.5 rounded text-xs font-mono transition-all ${
                            form.visionModel === m
                              ? 'bg-cyan-glow/20 text-cyan-glow font-semibold'
                              : 'text-slate-500 hover:bg-brand-soft/60 hover:text-brand-deep'
                          }`}
                          title={`点击选用 ${m}`}
                        >
                          {m}
                        </button>
                      ))}
                  </div>
                )}
                <span className="text-sm text-slate-400 mt-1 block">
                  注意：DeepSeek 不支持视觉。请配通义 qwen-vl-plus / 智谱 glm-4v-flash / OpenAI gpt-4o-mini 等多模态模型。
                </span>
              </label>
            </div>

            {/* 测试连接 */}
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={test}
                disabled={testing || !form.apiKey || !form.baseUrl || !form.model}
                className="px-4 py-2 rounded-lg border border-edge text-xs font-medium text-slate-600 hover:border-cyan-glow/50 hover:text-cyan-glow disabled:opacity-40 transition-all flex items-center gap-1.5"
              >
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                测试连接
              </button>
              {testResult && (
                <span className={`text-xs flex items-center gap-1.5 ${testResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                  {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                  {testResult.msg}
                </span>
              )}
            </div>

            {/* 隐私说明 */}
            <div className="mt-5 rounded-xl bg-brand-soft/60 border border-edge p-3 flex gap-2">
              <ShieldCheck className="h-4 w-4 text-cyan-glow shrink-0 mt-0.5" />
              <p className="text-sm text-slate-500 leading-relaxed">
                密钥仅保存在你的浏览器 localStorage，直接由浏览器发往你配置的服务商，不经过任何第三方服务器。
                清除浏览器数据会一并删除。
              </p>
            </div>

            {/* 操作 */}
            <div className="mt-5 flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl border border-edge text-sm text-slate-600 hover:border-slate-400 transition-all"
              >
                取消
              </button>
              <button
                onClick={save}
                className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand to-emerald-600 text-white font-bold text-sm hover:shadow-glow active:scale-[0.98] transition-all"
              >
                保存配置
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
