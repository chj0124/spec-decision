import { useEffect, useState } from 'react'
import { animate } from 'framer-motion'

/** 数字滚动递增：冠军卡核心指标挂载时从 0 滚动到目标值（尊重"减少动态效果"系统偏好） */
export function CountUp({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const [text, setText] = useState(() => format(value))
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setText(format(value))
      return
    }
    const controls = animate(0, value, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setText(format(v)),
    })
    return () => controls.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return <span className={className}>{text}</span>
}
