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

/**
 * 启动 Chromium。新克隆的仓库 / CI 冷启动都没有 Playwright 的浏览器缓存，
 * 此时 `chromium.launch()` 会抛 "Executable doesn't exist"；这里捕获后自动补装一次再重试，
 * 让 `npm run e2e` 在无缓存环境也能一把通过。
 * Linux 上同时补系统依赖库（--with-deps），否则浏览器会因缺 libatk 之类直接起不来。
 */
async function launchChromium() {
  const args = ['--no-proxy-server', '--disable-dev-shm-usage']
  try {
    return await chromium.launch({ args })
  } catch (e) {
    const message = e?.message ?? ''
    if (!/Executable doesn't exist|playwright install/i.test(message)) throw e
    console.log('未检测到 Chromium，正在安装（playwright install chromium）…')
    const installArgs = process.platform === 'linux' ? ['install', '--with-deps', 'chromium'] : ['install', 'chromium']
    const code = await new Promise((resolve) => {
      const child = spawn(path.join(ROOT, 'node_modules', '.bin', 'playwright'), installArgs, {
        cwd: ROOT,
        stdio: 'inherit',
      })
      child.once('exit', (c) => resolve(c ?? 1))
    })
    if (code !== 0) throw new Error(`playwright install chromium 失败（exit ${code}）`)
    return await chromium.launch({ args })
  }
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

    /* --- 首启引导（F7）：干净 storage 下必须是两条主路径 + 三步说明 --- */
    const pathQuick = await page.getByRole('button', { name: /粘贴你的规格表/ }).count()
    const pathGen = await page.getByRole('button', { name: /一键生成示例/ }).count()
    const stepCount = await page.getByText(/录入候选|设定维度|生成报告/).count()
    check(
      `[${name}] 首启空状态给出两条主路径与三步说明`,
      pathQuick === 1 && pathGen === 1 && stepCount >= 3,
      `quick=${pathQuick} gen=${pathGen} steps=${stepCount}`,
    )

    /* --- 主链路：生成示例 → 出报告 --- */
    // 用 exact 精确匹配：空状态大卡片上还有个「一键生成示例 …」，模糊匹配会撞车。
    await page.getByRole('button', { name: 'AI 生成示例', exact: true }).click()
    // 只数 :visible —— 桌面表格行和移动端卡片行是两套 DOM，被 CSS 隐藏的那套不能算。
    const delButtons = page.locator('[aria-label="删除此行"]:visible')
    await delButtons.first().waitFor({ timeout: STEP_TIMEOUT_MS })
    const rowCount = await delButtons.count()
    check(`[${name}] 生成示例后出现多个规格行`, rowCount >= 3, `rows=${rowCount}`)

    // F7：生成来源必须显性化，用户要知道这份示例是 AI 现生成还是内置模板兜底。
    const srcBadge = await page.getByText(/AI 实时生成|内置示例/).count()
    check(`[${name}] 生成来源已显性标注`, srcBadge >= 1, `badge=${srcBadge}`)

    // 同样用 exact：底部还有个「生成决策报告」的 CTA 会撞上 /报告/。
    const reportNav = page.getByRole('button', { name: '报告', exact: true })
    check(`[${name}] 有数据后「报告」入口可用`, await reportNav.isEnabled())

    await reportNav.click()
    // 报告页懒加载 chunk 到位后才会出现工具栏的「导出 / 分享」入口
    // （分享链接等动作已收进该下拉菜单，不再各占一个按钮）。
    await page.getByRole('button', { name: /导出 \/ 分享|生成中/ }).first().waitFor({ timeout: STEP_TIMEOUT_MS })
    check(`[${name}] 报告页懒加载并渲染成功`, true)

    /* --- 报告导出 PNG（P2-4）：真下载一张图片，验完即弃 --- */
    await page.getByRole('button', { name: /导出 \/ 分享/ }).first().click()
    const downloadPromise = page.waitForEvent('download', { timeout: STEP_TIMEOUT_MS })
    await page.getByRole('button', { name: '导出 PNG 图片', exact: true }).click()
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

/**
 * 双标签页一致性（B1）：同一 context 下开两个 page、共享 localStorage / BroadcastChannel。
 * 覆盖任务验收「双标签页各改一次、来回切换后两边的改动都还在；并发写不会静默丢失」。
 *
 * 叙事：A 改一次 → B 必须检出外部变更并提示（而非静默把 A 的改动盖掉）→
 *       B 载入后再改一次 → A 检出并载入 → 两边的改动都在。
 * 这里只用桌面视口跑一遍：它验证的是数据协议，与响应式无关。
 */
async function runMultiTab(browser) {
  const name = '双标签页'
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop })
  const pageA = await context.newPage()
  const pageB = await context.newPage()

  const pageErrors = []
  for (const p of [pageA, pageB]) p.on('pageerror', (e) => pageErrors.push(e.message))

  // 断言失败时返回 false 而不是抛出：让每条 check 都能独立报出结果
  const appeared = async (locator, timeout = STEP_TIMEOUT_MS) => {
    try {
      await locator.first().waitFor({ timeout })
      return true
    } catch {
      return false
    }
  }

  const rename = async (page, next) => {
    await page.getByLabel('重命名清单').click()
    // 重命名态下页面只有这一个 maxLength=24 的输入框（新建输入框此时不渲染）
    const input = page.locator('input[maxLength="24"]')
    await input.fill(next)
    await input.press('Enter')
  }

  try {
    // A 先进入并生成示例数据
    await pageA.goto(BASE_URL, { waitUntil: 'load', timeout: STEP_TIMEOUT_MS })
    await pageA.getByRole('button', { name: 'AI 生成示例', exact: true }).click()
    await pageA.locator('[aria-label="删除此行"]:visible').first().waitFor({ timeout: STEP_TIMEOUT_MS })
    await pageA.waitForTimeout(300)

    // B 随后打开：与 A 共用同一份本地数据，此刻尚无外部改动
    await pageB.goto(BASE_URL, { waitUntil: 'load', timeout: STEP_TIMEOUT_MS })
    check(`[${name}] 第二个标签页就绪`, await appeared(pageB.getByRole('button', { name: '新建', exact: true })))
    await pageA.waitForTimeout(300)

    // ① A 改一次
    await rename(pageA, 'A侧改动')
    check(`[${name}] A 的改动已生效`, await appeared(pageA.getByRole('button', { name: 'A侧改动', exact: true })))
    await pageA.waitForTimeout(300)

    // ② B 必须检出外部变更并提示，而不是静默覆盖
    const bannerHint = '另一标签页已修改，载入？'
    check(`[${name}] B 检出外部变更并提示`, await appeared(pageB.getByText(bannerHint)))

    // ③ B 载入最新版本后再改一次
    await pageB.getByRole('button', { name: '载入', exact: true }).click()
    check(`[${name}] B 载入后同步到 A 的改动`, await appeared(pageB.getByRole('button', { name: 'A侧改动', exact: true })))

    await pageB.getByRole('button', { name: '新建', exact: true }).click()
    const createInput = pageB.locator('input[placeholder="新清单名称"]')
    await createInput.fill('B侧新增')
    await createInput.press('Enter')
    check(`[${name}] B 的改动已生效`, await appeared(pageB.getByRole('button', { name: 'B侧新增', exact: true })))

    // ④ A 来回切回：应检出 B 的写入并载入
    check(`[${name}] A 检出 B 的外部变更并提示`, await appeared(pageA.getByText(bannerHint)))
    await pageA.getByRole('button', { name: '载入', exact: true }).click()

    // ⑤ 两边改动必须都还在：既没被静默覆盖，也没在切换中丢掉
    const keptA = (await pageA.getByRole('button', { name: 'A侧改动', exact: true }).count()) === 1
    const keptB = (await pageA.getByRole('button', { name: 'B侧新增', exact: true }).count()) === 1
    check(`[${name}] 来回切换后两边改动都在（A 视角）`, keptA && keptB, `A侧改动=${keptA} B侧新增=${keptB}`)

    // 落盘内容才是最终事实：直接核对本地 JSON
    const stored = await pageA.evaluate((key) => {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : null
    }, 'spec-decision:scenarios')
    const names = (stored?.scenarios ?? []).map((s) => s.name)
    check(
      `[${name}] 落盘内容同时含两边改动`,
      names.includes('A侧改动') && names.includes('B侧新增'),
      names.join(' / '),
    )

    check(`[${name}] 无未捕获异常`, pageErrors.length === 0, pageErrors.join(' ; '))
  } catch (e) {
    check(`[${name}] 用例执行未抛错`, false, e?.message ?? String(e))
  } finally {
    await context.close()
  }
}

/*
 * 自动草稿恢复（F6）：与双标签页用例共用同一套叙事，因为"提交被判过期"
 * 正是草稿要兜的那条缝 —— 此时本页改动压根没进共享数据，
 * 一旦关掉标签页，不留草稿就是永久丢失（风险卡 D3）。
 */
async function runDraftRecovery(browser) {
  const name = '草稿恢复'
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop })
  const pageA = await context.newPage()
  const pageB = await context.newPage()

  const pageErrors = []
  for (const p of [pageA, pageB]) p.on('pageerror', (e) => pageErrors.push(e.message))

  const appeared = async (locator, timeout = STEP_TIMEOUT_MS) => {
    try {
      await locator.first().waitFor({ timeout })
      return true
    } catch {
      return false
    }
  }

  const rename = async (page, next) => {
    await page.getByLabel('重命名清单').click()
    const input = page.locator('input[maxLength="24"]')
    await input.fill(next)
    await input.press('Enter')
  }

  const scenarioNames = (page) =>
    page.evaluate((key) => {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw).scenarios ?? []).map((s) => s.name) : []
    }, 'spec-decision:scenarios')

  try {
    // A 先进入并生成示例数据
    await pageA.goto(BASE_URL, { waitUntil: 'load', timeout: STEP_TIMEOUT_MS })
    await pageA.getByRole('button', { name: 'AI 生成示例', exact: true }).click()
    await pageA.locator('[aria-label="删除此行"]:visible').first().waitFor({ timeout: STEP_TIMEOUT_MS })
    await pageA.waitForTimeout(300)

    // B 随后打开：此刻与 A 同处一个版本
    await pageB.goto(BASE_URL, { waitUntil: 'load', timeout: STEP_TIMEOUT_MS })
    await pageB.getByRole('button', { name: '新建', exact: true }).waitFor({ timeout: STEP_TIMEOUT_MS })
    await pageA.waitForTimeout(300)

    // ① A 改一次并落盘：落盘版本号前推，B 从此落后
    await rename(pageA, 'A侧改动')
    check(`[${name}] A 的改动已落盘`, await appeared(pageA.getByRole('button', { name: 'A侧改动', exact: true })))
    await pageA.waitForTimeout(300)

    // ② B 在过期状态下再改：提交会被拒（改动进不了共享数据），但草稿必须立刻兜住它
    await rename(pageB, 'B侧未落盘')
    check(`[${name}] B 的过期提交被拦下并提示`, await appeared(pageB.getByText('另一标签页已修改，载入？')))

    const draftOnB = await pageB.evaluate((key) => localStorage.getItem(key), 'spec-decision:draft')
    check(
      `[${name}] 过期改动已被草稿键兜住`,
      Boolean(draftOnB && draftOnB.includes('B侧未落盘')),
      (draftOnB ?? '').slice(0, 200),
    )

    // ③ 关掉 B（模拟崩溃 / 直接关页）：共享数据里没有 B 的改动，只剩草稿这一份
    await pageB.close()
    const names = await scenarioNames(pageA)
    check(
      `[${name}] 共享数据里确实没有 B 的改动（草稿是唯一落点）`,
      names.includes('A侧改动') && !names.includes('B侧未落盘'),
      names.join(' / '),
    )

    // ④ 重开：应认出这条没同步上的草稿，交给用户决定恢复还是丢弃
    const pageC = await context.newPage()
    pageC.on('pageerror', (e) => pageErrors.push(e.message))
    await pageC.goto(BASE_URL, { waitUntil: 'load', timeout: STEP_TIMEOUT_MS })
    check(`[${name}] 重开时提示恢复未保存的改动`, await appeared(pageC.getByText(/检测到上次.*未保存.*的改动/)))

    await pageC.getByRole('button', { name: '恢复', exact: true }).click()
    check(`[${name}] 恢复后改动回到编辑器`, await appeared(pageC.getByRole('button', { name: 'B侧未落盘', exact: true })))

    // 恢复后应当正常落盘；落盘完成前不能开新页，否则读到的还是旧数据
    await pageC.waitForFunction(
      (key) => {
        const raw = localStorage.getItem(key)
        return !!raw && (JSON.parse(raw).scenarios ?? []).some((s) => s.name === 'B侧未落盘')
      },
      'spec-decision:scenarios',
      { timeout: STEP_TIMEOUT_MS },
    )
    check(`[${name}] 恢复后的改动已落盘`, true)

    // ⑤ 再重开一次：草稿已与落盘一致，不该再弹恢复提示
    const pageD = await context.newPage()
    pageD.on('pageerror', (e) => pageErrors.push(e.message))
    await pageD.goto(BASE_URL, { waitUntil: 'load', timeout: STEP_TIMEOUT_MS })
    await pageD.getByRole('button', { name: 'B侧未落盘', exact: true }).waitFor({ timeout: STEP_TIMEOUT_MS })
    check(`[${name}] 数据已同步后重开不再打扰`, (await pageD.getByText(/检测到上次/).count()) === 0)

    check(`[${name}] 无未捕获异常`, pageErrors.length === 0, pageErrors.join(' ; '))
  } catch (e) {
    check(`[${name}] 用例执行未抛错`, false, e?.message ?? String(e))
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

    const browser = await launchChromium()
    try {
      for (const [name, viewport] of Object.entries(VIEWPORTS)) {
        await runSmoke(browser, name, viewport)
      }
      // 双标签页一致性用例与视口无关，单独跑一遍
      await runMultiTab(browser)
      // 自动草稿恢复同样要靠"两个标签页制造过期提交"，也单独跑一遍
      await runDraftRecovery(browser)
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
