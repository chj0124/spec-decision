/** 图例里的小标记：淡黄行底 + 粗黄差值段 + 右缘括线，与图上的三合一标注一致 */
export function WarnLegendMark({ color }: { color: string }) {
  return (
    <svg width="26" height="12" viewBox="0 0 26 12" className="inline-block align-middle">
      {/* 行高亮 */}
      <rect x="0" y="0" width="20" height="12" rx="2" fill={color} opacity={0.16} />
      {/* 差值段 */}
      <rect x="11" y="4.5" width="9" height="3" rx="1.5" fill={color} />
      {/* 右缘括线 */}
      <path d="M21 2 H24 V10 H21" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
