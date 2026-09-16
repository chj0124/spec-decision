import { useEffect, useRef, useState } from 'react'
import { parseClipboardTable } from '../../lib/parseTable'
import type { RecognizeResult } from '../../lib/recognize'

export type ReviewWithImages = RecognizeResult & { images: string[] }

/**
 * 全局拖入 / 粘贴监听。
 * 拖入或粘贴图片时交给 pickImage；粘贴文本时尝试解析表格（Excel/电商页面/Markdown），
 * 解析结果通过 setReview 交给识别确认弹窗复用。
 */
export function useGlobalDropPaste(
  pickImage: (files: FileList | null) => void,
  setReview: (r: ReviewWithImages | null) => void,
): boolean {
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  // 全局监听器只在挂载时注册一次；用 ref 持有最新的 pickImage（内部依赖 skus / 分组等最新状态），
  // 这样输入数据变化时不会反复卸载重挂 window 事件，也不会因闭包过期而拿到旧 skus。
  const pickImageRef = useRef(pickImage)
  const setReviewRef = useRef(setReview)
  useEffect(() => {
    pickImageRef.current = pickImage
    setReviewRef.current = setReview
  })

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      dragDepth.current++
      setDragging(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const onDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      pickImageRef.current(e.dataTransfer.files)
    }
    const onPaste = (e: ClipboardEvent) => {
      // 优先处理图片（截图粘贴）
      if (e.clipboardData?.files.length) {
        pickImageRef.current(e.clipboardData.files)
        return
      }
      // 没有图片时尝试解析文本表格（Excel/电商页面/Markdown 复制）
      const text = e.clipboardData?.getData('text/plain') ?? ''
      const html = e.clipboardData?.getData('text/html') ?? ''
      if (!text.trim()) return
      const parsed = parseClipboardTable(text, html)
      if (!parsed) return
      if (parsed.items.length === 0) {
        // 解析失败（没识别到价格/名称列），给出提示
        setReviewRef.current({
          items: [],
          source: 'error',
          note: parsed.note ?? '未能从粘贴内容解析出表格',
          images: [],
        })
        return
      }
      // 解析成功：复用识别确认弹窗，source='api' 避免显示"演示识别"
      setReviewRef.current({
        items: parsed.items,
        dims: parsed.dims,
        source: 'api',
        note: parsed.note,
        images: [],
      })
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
    }
  }, [])

  return dragging
}
