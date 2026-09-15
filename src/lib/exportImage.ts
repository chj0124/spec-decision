/**
 * 报告导出 PNG
 *
 * 把报告整体栅格化成一张图片，方便直接甩进聊天工具（比截图整齐、比 PDF 轻）。
 * 实现在 html-to-image：内部把 DOM 序列化成 SVG <foreignObject>，再画到 canvas 上。
 *
 * 两处刻意的处理：
 *  - 依赖动态 import：只有真点了「导出 PNG」才把这个库拉下来，不进首屏包。
 *  - 导出期间给 <html> 挂 EXPORT_CLASS：报告里的 .glass 是半透明玻璃面板，
 *    栅格化时 backdrop-filter 没有可模糊的底层，必须临时压成不透明底色（见 index.css）。
 */

/** 导出期间挂在 <html> 上的标记类：把玻璃拟态压平成实心面板 */
export const EXPORT_CLASS = 'export-capture'

/** 画布底色：浅色取暖纸、暗色取墨黑（与 index.css 的页面底保持一致） */
export const EXPORT_BG = { light: '#f6f5f0', dark: '#16161b' } as const

export interface PngExportOptions {
  /** 文件名（含扩展名） */
  fileName: string
  /** 画布底色：面板半透明，需要垫一层底色，否则 PNG 背景是透明的 */
  background: string
  /** 缩放倍率，默认 2（二倍图，文字更锐利） */
  pixelRatio?: number
}

/**
 * 生成导出文件名（不含扩展名）。
 * 类别里可能有 `A/B`、`500g 装` 这类字符，直接当文件名会踩 Windows 的非法字符，
 * 统一替换成分隔符；日期用本地时区，跟用户看到的一致。
 */
export function buildReportFileName(category: string | undefined, now = new Date()): string {
  const d =
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, '0')}` +
    `${String(now.getDate()).padStart(2, '0')}`
  const safe = (category ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return `规格决策${safe ? `-${safe}` : ''}-${d}`
}

/** 触发浏览器下载（objectURL 在部分浏览器里 revoke 太早会中断下载，故延后释放） */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 等两帧：让临时挂上的 EXPORT_CLASS 完成重排，避免截到压平前的中间态 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/** 把 DOM 节点导出成 PNG 并下载 */
export async function exportNodeToPng(node: HTMLElement, opts: PngExportOptions): Promise<void> {
  const { fileName, background, pixelRatio = 2 } = opts
  const { toBlob, toPng } = await import('html-to-image')

  // 类型从 toBlob 的签名里取：Options 只在 lib/types.d.ts 里，主入口没有 re-export，
  // 直接深路径 import 太脆；这样跟随库的类型定义，升级也不会漂移。
  const options: Parameters<typeof toBlob>[1] = {
    backgroundColor: background,
    pixelRatio,
    // 工具条（打印 / 复制摘要 / 本按钮）都带 .no-print，导出图片里不该出现。
    // 注意：库会把 childNodes 里的文本节点也交给 filter，Text 上没有 classList，
    // 故用可选链兜底——非元素节点一律保留。
    filter: (el) => !el?.classList?.contains('no-print'),
  }

  const root = document.documentElement
  root.classList.add(EXPORT_CLASS)
  try {
    await nextFrame()
    // toBlob 走 canvas.toBlob，超大画布偶发返回 null；此时退回 dataURL 再转 Blob
    let blob = await toBlob(node, options)
    if (!blob) {
      const dataUrl = await toPng(node, options)
      blob = await (await fetch(dataUrl)).blob()
    }
    downloadBlob(blob, fileName)
  } finally {
    root.classList.remove(EXPORT_CLASS)
  }
}
