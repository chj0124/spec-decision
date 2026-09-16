import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { BASE_URL, HOST, PORT, STARTUP_TIMEOUT_MS } from './config.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STEP = 12000

function startPreview() {
  return spawn(path.join(ROOT, 'node_modules', '.bin', 'vite'), ['preview', '--host', HOST, '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, no_proxy: '127.0.0.1,localhost', NO_PROXY: '127.0.0.1,localhost' },
  })
}

function probe(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const settle = (ok) => { socket.destroy(); resolve(ok) }
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => settle(true))
    socket.on('timeout', () => settle(false))
    socket.on('error', () => settle(false))
  })
}

async function waitForServer(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe(host, port)) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

const log = (...a) => console.log('[dbg]', ...a)

function instrument(page) {
  page.addInitScript(() => {
    window.__writes = []
    window.__logs = []
    window.__log = (s) => { window.__logs.push(s) }
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k, v) {
      if (k === 'spec-decision:scenarios') {
        try {
          const j = JSON.parse(v)
          window.__writes.push(
            'rev=' + j.rev + ' skus=' + JSON.stringify((j.scenarios?.[0]?.skus ?? []).map((s) => s.id.slice(-4) + ':' + s.name)),
          )
        } catch {}
      }
      return orig.call(this, k, v)
    }
  })
  page.on('pageerror', (e) => log('pageerror:', e.message))
}

const dump = (page) => page.evaluate(() => ({
  writes: window.__writes ?? [],
  logs: window.__logs ?? [],
  hasLog: typeof window.__log,
}))

const st = (page) => page.evaluate(() => {
  const raw = localStorage.getItem('spec-decision:scenarios')
  const j = raw ? JSON.parse(raw) : null
  return { rev: j?.rev, skus: (j?.scenarios?.[0]?.skus ?? []).map((s) => s.id.slice(-4) + ':' + s.name) }
})

const firstRow = (page) => page.locator('[aria-label="删除此行"]:visible').first()
const skuRows = (page) => page.locator('tr', { has: page.locator('[aria-label="删除此行"]') })
const addRow = async (page, label) => {
  const rows = skuRows(page)
  const index = await rows.count()
  await page.getByRole('button', { name: '添加一行规格' }).click()
  await rows.nth(index).locator('input').first().fill(label)
}

const server = startPreview()
log('server up?', await waitForServer(HOST, PORT, STARTUP_TIMEOUT_MS))
const browser = await chromium.launch({ args: ['--no-proxy-server', '--disable-dev-shm-usage'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page1 = await context.newPage()
instrument(page1)
const page2 = await context.newPage()
instrument(page2)

const report = async (title, ...pages) => {
  log('=== ' + title)
  log('  storage =', JSON.stringify(await st(page1)))
  for (const [i, p] of pages.entries()) {
    const d = await dump(p)
    log(`  page${i + 1} writes:`)
    for (const w of d.writes) log('    WRITE', w)
    log(`  page${i + 1} logs:`)
    for (const l of d.logs) log('    SYNC', l)
  }
}

const clearDumps = async (...pages) => {
  for (const p of pages) await p.evaluate(() => { window.__writes = []; window.__logs = [] }).catch(() => {})
}

const step = async (name, fn) => {
  const t0 = Date.now()
  try {
    await fn()
    log(`STEP OK  ${name} (${Date.now() - t0}ms)`)
  } catch (e) {
    log(`STEP FAIL ${name} (${Date.now() - t0}ms) :: ${e.message}`)
    throw e
  }
}

const values = (page) =>
  page.evaluate(() => Array.from(document.querySelectorAll('input')).map((i) => i.value))

try {
  await step('page1 seed', async () => {
    await page1.goto(BASE_URL, { waitUntil: 'load', timeout: STEP })
    await page1.getByRole('button', { name: 'AI 生成示例', exact: true }).click()
    await firstRow(page1).waitFor({ timeout: STEP })
  })

  await step('page2 load', async () => {
    await page2.goto(BASE_URL, { waitUntil: 'load', timeout: STEP })
    await firstRow(page2).waitFor({ timeout: STEP })
  })

  await step('page2 addRow TAB-B', async () => {
    await addRow(page2, 'TAB-B 新增')
  })

  await step('page2 stored has TAB-B', async () => {
    await page2.waitForFunction(
      () => (localStorage.getItem('spec-decision:scenarios') ?? '').includes('TAB-B 新增'),
      null,
      { timeout: 8000 },
    )
  })

  await step('page1 addRow TAB-A', async () => {
    await addRow(page1, 'TAB-A 新增')
  })

  await step('page1 stored has both', async () => {
    await page1.waitForFunction(
      () => {
        const raw = localStorage.getItem('spec-decision:scenarios')
        if (!raw) return false
        const names = (JSON.parse(raw).scenarios?.[0]?.skus ?? []).map((s) => s.name)
        return names.includes('TAB-A 新增') && names.includes('TAB-B 新增')
      },
      null,
      { timeout: 8000 },
    )
  })

  await step('page1 UI has TAB-B', async () => {
    await page1.waitForFunction(
      (l) => Array.from(document.querySelectorAll('input')).some((i) => i.value === l),
      'TAB-B 新增',
      { timeout: 8000 },
    )
  })

  await step('page2 banner', async () => {
    await page2.getByText('另一标签页已修改').waitFor({ timeout: 8000 })
  })

  await step('page2 load click', async () => {
    await page2.getByRole('button', { name: '载入', exact: true }).click()
  })

  await step('page2 UI has TAB-A', async () => {
    await page2.waitForFunction(
      (l) => Array.from(document.querySelectorAll('input')).some((i) => i.value === l),
      'TAB-A 新增',
      { timeout: 8000 },
    )
  })

  log('storage =', JSON.stringify(await st(page1)))
  log('page1 values =', JSON.stringify(await values(page1)))
  log('page2 values =', JSON.stringify(await values(page2)))
  log('page1 banner?', await page1.getByText('另一标签页已修改').isVisible().catch(() => false))
  log('page2 banner?', await page2.getByText('另一标签页已修改').isVisible().catch(() => false))
} catch (e) {
  log('FATAL', e.message)
  await report('at failure', page1, page2).catch(() => {})
} finally {
  await context.close()
  await browser.close()
  server.kill('SIGTERM')
}
