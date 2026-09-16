import { useEffect, useState } from 'react'

/* ============ 预算输入框：字符串草稿 + 数字解析，专治「输到一半被打断」 ============ */
export function BudgetInput({
  value,
  onChange,
  className,
}: {
  value?: number
  onChange: (v: number | undefined) => void
  className?: string
}) {
  // 不把数字直接回写进 input.value：受控的 type="number" 每次回写都会把光标打到开头，
  // 后续按键被插到最前面（实测输 19.9 会变成 919）；而 "" / "19." 这类中间态还会被
  // 浏览器直接清空。改成 text + inputMode="decimal" 并存字符串草稿，按键就原样留在框里。
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  const [focused, setFocused] = useState(false)
  // 外部改动（切偏好 / 分享导入 / 换工作区）时同步；正在输入时不打扰
  useEffect(() => {
    if (!focused) setDraft(value === undefined ? '' : String(value))
  }, [value, focused])
  const apply = (raw: string) => {
    const t = raw.trim()
    if (t === '') {
      onChange(undefined)
      return
    }
    const n = Number(t)
    // 只认非负有限数：NaN / 负号 / 多个小数点都按「没填预算」处理，避免把 NaN 传下去
    onChange(Number.isFinite(n) && n >= 0 ? n : undefined)
  }
  // 改成 text 后字母也进得来，这里挡掉：只留数字与小数点，且最多一个小数点。
  // 这样用户按错键时框里不会留一个解析不了的 "12abc"，也不用等失焦才清理。
  const sanitize = (raw: string) => {
    const cleaned = raw.replace(/[^\d.]/g, '')
    const dot = cleaned.indexOf('.')
    return dot === -1 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '')
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label="预算"
      value={draft}
      onFocus={() => setFocused(true)}
      // 失焦即收尾：按已提交的值回显，清掉 "12." 这类没收尾的残留
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const next = sanitize(e.target.value)
        setDraft(next)
        apply(next)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      placeholder="¥"
      className={className}
    />
  )
}
