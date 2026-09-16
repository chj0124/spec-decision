/** 写剪贴板：优先 Clipboard API，非安全上下文/旧浏览器回退 execCommand */
export async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    /* 继续走回退路径 */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy') } catch { /* 尽力而为 */ }
  document.body.removeChild(ta)
}
