// 端到端冒烟：真浏览器跑通「启动 → 生成示例 → 出报告 → 导出 PNG」主链路，并守住几条易回归的约束
// （首屏不预载 charts / html-to-image chunk、PWA manifest、页脚版本号、备份入口、主题切换、移动端无横向溢出）。
//
// 用法：npm run e2e        （会先 npm run build，再起 vite preview，跑完自动关闭）
//
// 说明：仓库依赖的是 `playwright` 库而非 `@playwright/test`，所以这里自带一个极小的
// 断言与服务器管理，不引入新的依赖，也不需要框架配置。

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { BASE_URL, HOST, PORT, STARTUP_TIMEOUT_MS, STEP_TIMEOUT_MS, VIEWPORTS } from './config.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 版本号断言不写死字面量：从 package.json 读，升版本时 e2e 不会跟着挂
const { version: pkgVersion } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))

const results = []
function check(name, passed, detail) {
  results.push({ name, passed: Boolean(passed) })
  const mark = passed ? 'ok  ' : 'FAIL'
  const extra = passed || detail === undefined ? '' : `  ← ${detail}`
  console.log(`${mark}: ${name}${extra}`)
}

/* ---------------- preview 服务器 ---------------- */

function startPreview() {
  const bin = path.join(ROOT, 'node_modules', '.bin', 'vite')
  // 必须显式 --host：vite preview 默认只监听 [::1]，IPv4 的 127.0.0.1 会连不上。
  const child = spawn(bin, ['preview', '--host', HOST, '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, no_proxy: '127.0.0.1,localhost', NO_PROXY: '127.0.0.1,localhost' },
  })
  return child
}

// 用 TCP 连接探活而不是 fetch：某些环境（本机代理 / 预加载脚本）会让 Node 的全局 fetch
// 把 localhost 也丢给代理，导致探活永远失败——TCP 层不受影响。
function probe(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const settle = (ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}

async function waitForServer(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe(host, port)) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

/* ---------------- 用例 ---------------- */

/**
 * 从 PNG 的 IHDR 数据块里读出宽高（不引依赖，手解 24 字节头即可）。
 * 只比对文件大小挡不住"纯色空白图"——那种图也能有一两 MB，
 * 但整份报告栅格化出来必然又宽又高，用尺寸当护栏更靠谱。
 */
function readPngSize(file) {
  const buf = readFileSync(file)
  const isPng = buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG'
  if (!isPng) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

async function runSmoke(browser, name, viewport) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()

  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })

  const shot = async (tag) => {
    const file = path.join(tmpdir(), `e2e-${name}-${tag}.png`)
    await page.screenshot({ path: file, fullPage: true }).catch(() => {})
    return file
  }

  try {
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: STEP_TIMEOUT_MS })

    /* --- 启动与静态资源 --- */
    check(`[${name}] 标题正确`, (await page.title()) === '规格决策台 · 买哪个最划算', await page.title())

    const h1 = await page.getByRole('heading', { level: 1 }).first().innerText()
    check(`[${name}] 主标题渲染`, h1.trim() === '规格决策台', h1)

    const manifest = await page.locator('link[rel="manifest"]').getAttribute('href')
    check(`[${name}] PWA manifest 已挂载`, Boolean(manifest && manifest.includes('manifest.webmanifest')), String(manifest))

    const footer = await page.getByText('数据仅保存在你的浏览器本地').count()
    check(`[${name}] 页脚说明存在`, footer > 0, `count=${footer}`)

    // 版本号来自 package.json，构建期由 vite define 注入，页脚须原样展示
    const versionText = await page.getByText(`v${pkgVersion}`, { exact: true }).count()
    check(`[${name}] 页脚显示版本号`, versionText > 0, `expect v${pkgVersion} · count=${versionText}`)

    /* --- 首屏瘦身护栏：charts chunk 不得出现在 modulepreload 里 --- */
    const preloads = await page.$$eval('link[rel="modulepreload"]', (ls) =>
      ls.map((l) => l.getAttribute('href') || ''),
    )
    check(
      `[${name}] 首屏预载不含 charts`,
      preloads.length > 0 && preloads.every((h) => !h.includes('charts')),
      preloads.join(' | '),
    )

    /* --- 备份入口（P0-1） --- */
    const exportBtn = await page.getByLabel('导出工作区备份').count()
    const importBtn = await page.getByLabel('导入工作区备份').count()
    check(`[${name}] 备份导出/导入入口各一个`, exportBtn === 1 && importBtn === 1, `export=${exportBtn} import=${importBtn}`)

    /* --- 主链路：生成示例 → 出报告 --- */
    // 用 exact 精确匹配：空状态大卡片上还有个「AI 生成示例 先看看完整效果」，模糊匹配会撞车。
    await page.getByRole('button', { name: 'AI 生成示例', exact: true }).click()
    // 只数 :visible —— 桌面表格行和移动端卡片行是两套 DOM，被 CSS 隐藏的那套不能算。
    const delButtons = page.locator('[aria-label="删除此行"]:visible')
    await delButtons.first().waitFor({ timeout: STEP_TIMEOUT_MS })
    const rowCount = await delButtons.count()
    check(`[${name}] 生成示例后出现多个规格行`, rowCount >= 3, `rows=${rowCount}`)

    // 同样用 exact：底部还有个「生成决策报告」的 CTA 会撞上 /报告/。
    const reportNav = page.getByRole('button', { name: '报告', exact: true })
    check(`[${name}] 有数据后「报告」入口可用`, await reportNav.isEnabled())

    await reportNav.click()
    // 报告页懒加载 chunk 到位后才会出现分享按钮
    await page.getByRole('button', { name: /分享链接|生成中/ }).waitFor({ timeout: STEP_TIMEOUT_MS })
    check(`[${name}] 报告页懒加载并渲染成功`, true)

    /* --- 报告导出 PNG（P2-4）：真下载一张图片，验完即弃 --- */
    const downloadPromise = page.waitForEvent('download', { timeout: STEP_TIMEOUT_MS })
    await page.getByRole('button', { name: '导出 PNG', exact: true }).click()
    const download = await downloadPromise
    const exportFile = path.join(tmpdir(), `e2e-${name}-export.png`)
    await download.saveAs(exportFile)
    const exportName = download.suggestedFilename()
    const exportBytes = statSync(exportFile).size
    const exportPng = readPngSize(exportFile)
    // 阈值取"视口无关"的宽松下界：这里只用来挡空白图 / 半截图，
    // 不做精确几何比对（桌面 2464×5770、手机 716×8226 都应过关）。
    check(
      `[${name}] 报告导出 PNG 成功`,
      exportName.endsWith('.png') &&
        exportBytes > 5000 &&
        !!exportPng &&
        exportPng.width >= 600 &&
        exportPng.height >= 1500,
      `${exportName} · ${exportPng?.width ?? '?'}×${exportPng?.height ?? '?'} · ${exportBytes}B`,
    )

    /* --- 主题切换 --- */
    const before = await page.getAttribute('html', 'class')
    await page.getByLabel('切换主题').click()
    await page.waitForFunction(
      (prev) => document.documentElement.className !== prev,
      before,
      { timeout: STEP_TIMEOUT_MS },
    )
    const after = await page.getAttribute('html', 'class')
    check(`[${name}] 主题切换生效`, before !== after, `${before} → ${after}`)

    /* --- 移动端横向溢出 --- */
    if (viewport.width < 500) {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      check(`[${name}] 无横向溢出`, overflow <= 2, `overflow=${overflow}px`)
    }

    /* --- 运行期错误 --- */
    check(`[${name}] 无未捕获异常`, pageErrors.length === 0, pageErrors.join(' ; '))
    check(`[${name}] 无 console.error`, consoleErrors.length === 0, consoleErrors.join(' ; '))
  } catch (e) {
    check(`[${name}] 用例执行未抛错`, false, e?.message ?? String(e))
    console.log(`      失败截图：${await shot('failure')}`)
  } finally {
    await context.close()
  }
}

/* ---------------- 入口 ---------------- */

async function main() {
  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.error('未找到 dist/index.html —— 请先执行 npm run build（npm run e2e 已包含这一步）。')
    process.exit(1)
  }

  const server = startPreview()
  const killing = () => server.kill('SIGTERM')
  process.on('exit', killing)

  try {
    const up = await waitForServer(HOST, PORT, STARTUP_TIMEOUT_MS)
    if (!up) {
      console.error(`preview 服务器未能在 ${STARTUP_TIMEOUT_MS}ms 内就绪：${BASE_URL}`)
      process.exit(1)
    }

    const browser = await chromium.launch({
      args: ['--no-proxy-server', '--disable-dev-shm-usage'],
    })
    try {
      for (const [name, viewport] of Object.entries(VIEWPORTS)) {
        await runSmoke(browser, name, viewport)
      }
    } finally {
      await browser.close()
    }
  } finally {
    server.kill('SIGTERM')
  }

  const failed = results.filter((r) => !r.passed)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  if (failed.length > 0) {
    console.error(`失败项：\n- ${failed.map((f) => f.name).join('\n- ')}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('e2e 运行失败：', e)
  process.exit(1)
})
