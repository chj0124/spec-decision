import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installGlobalErrorHandlers } from './lib/telemetry'
import './index.css'

// 先挂全局错误捕获，再渲染 React：这样连首屏渲染期抛出的错误也能被记录。
// 上报内容经过白名单脱敏，不含任何 SKU / 价格 / API key 等业务数据。
installGlobalErrorHandlers()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// 生产环境注册 Service Worker：让应用可安装到桌面/主屏并支持离线打开。
// 开发环境不注册，避免缓存干扰热更新。
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 注册失败（如无 HTTPS / 隐私模式）不影响正常使用 */
    })
  })
}
