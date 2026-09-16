import { useCallback, useEffect, useRef, useState } from 'react'
import type { InputHTMLAttributes } from 'react'

/**
 * 根据内容自动调整宽度的 input。
 * 用一个隐藏的 span（复制 input 的 className 保证字体/padding 一致）测量文本宽度，
 * 把 input 的 width 设为测量值 + 余量。这样维度名、单位、levels 输入框能随内容伸缩，
 * 短文字不浪费空间，长文字不会被截断。
 */
export function AutoWidthInput({
  value,
  minWidth = 60,
  extra = 12,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { minWidth?: number; extra?: number }) {
  const spanRef = useRef<HTMLSpanElement>(null)
  const [w, setW] = useState(minWidth)
  const measure = useCallback(() => {
    const el = spanRef.current
    if (!el) return
    // 用 getBoundingClientRect 取小数宽度再向上取整：offsetWidth 会向下取整，
    // 对 "ml" 这种刚好卡在边界上的短文本会把宽度算少 1~2px，导致末位被裁掉。
    const raw = el.getBoundingClientRect().width
    setW(Math.max(minWidth, Math.ceil(raw) + extra))
  }, [minWidth, extra])
  useEffect(() => {
    measure()
  }, [measure, value, props.placeholder, className])
  // 字体（web font）加载完成前测量会偏小；加载后重测一次，避免首屏宽度不足被截断。
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    if (!fonts?.ready) return
    let alive = true
    fonts.ready.then(() => {
      if (alive) measure()
    })
    return () => {
      alive = false
    }
  }, [measure, value, props.placeholder, className])
  return (
    <>
      {/* 测量用隐藏 span：复制 input 的 className（含字体/padding）保证测量准确。
         用 inline style width:auto 强制覆盖 .field 的 w-full，否则 span 撑满父宽度测不准。
         class 级的 w-auto 无法覆盖 @apply w-full（CSS 层级问题），只能靠 inline style。 */}
      <span
        ref={spanRef}
        aria-hidden
        className={`${className} invisible absolute whitespace-pre pointer-events-none inline-block border border-transparent`}
        style={{ width: 'auto', maxWidth: 'none' }}
      >
        {String(value ?? '') || props.placeholder || ''}
      </span>
      <input {...props} value={value} className={className} style={{ width: w }} />
    </>
  )
}
