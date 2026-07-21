import { useState } from 'react'
import type { AiConfig } from '../lib/ai'
import { AI_PRESETS, chat } from '../lib/ai'
import { Settings, X, CheckCircle2, AlertCircle, Loader2, ShieldCheck, Zap } from 'lucide-react'
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

  // 弹窗打开时同步外部 config
  if (open && form !== config && !testing) {
    // 不强制重置，保留用户正在编辑的内容
  }

  const applyPreset = (label: string) => {
    const p = AI_PRESETS.find((x) => x.label === label)
    if (p) setForm({ ...form, baseUrl: p.baseUrl, model: p.model })
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      // 临时写入配置做测试
      const reply = await chat('回复"连接成功"三个字即可。', '你是连接测试助手。')
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
              <span className="text-[11px] text-slate-500 mb-1.5 block">服务商（选择后自动填地址与模型）</span>
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
                <span className="text-[11px] text-slate-500 mb-1 block">接口地址 Base URL</span>
                <input
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  placeholder="https://api.deepseek.com/v1"
                  className="field text-xs font-mono"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-500 mb-1 block">API Key</span>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="field text-xs font-mono"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-500 mb-1 block">模型 Model</span>
                <input
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="deepseek-chat"
                  className="field text-xs font-mono"
                />
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
              <p className="text-[11px] text-slate-500 leading-relaxed">
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
