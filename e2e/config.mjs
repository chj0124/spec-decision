// e2e 共享配置。
//
// 仓库装的是 `playwright` 库本身（不是 `@playwright/test`），所以没有框架级的
// playwright.config.ts；这个文件承担同样的职责：端口、地址、超时、视口尺寸集中一处。

/** preview 服务器端口。刻意避开 4173/5173，减少与本地其他进程撞车的概率。 */
export const PORT = 4588

export const HOST = '127.0.0.1'

export const BASE_URL = `http://${HOST}:${PORT}`

/** 等待 preview 服务器就绪的上限 */
export const STARTUP_TIMEOUT_MS = 60_000

/** 单次导航 / 元素等待上限。AI 生成示例与报告懒加载都要跨 chunk，给宽一点。 */
export const STEP_TIMEOUT_MS = 30_000

/** 覆盖的视口：桌面与手机（响应式回归） */
export const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
}
