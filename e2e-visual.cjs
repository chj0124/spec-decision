/* 临时 e2e 验证脚本：视觉重设计后的功能回归 + 主题切换 + 截图检查。验证完删除。 */
const { chromium } = require('playwright')

const BASE = 'http://localhost:4173/'

const seed = {
  id: 's1', name: '零食比价', updatedAt: Date.now(),
  skus: [
    { id: 'n1', name: '香辣味 16g×8袋', price: 4.94, quantity: 16, unit: 'g', packs: 8 },
    { id: 'n2', name: '香辣味 16g×16袋', price: 8.5, quantity: 16, unit: 'g', packs: 16 },
    { id: 'n3', name: '原味 16g×8袋', price: 4.94, quantity: 16, unit: 'g', packs: 8 },
  ],
  config: { dims: [], priceWeight: 50, preference: 'value', category: '零食' },
}

let failures = 0
const check = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failures++ }

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  await page.goto(BASE)
  await page.evaluate((sc) => {
    localStorage.setItem('spec-decision:scenarios', JSON.stringify({ scenarios: [sc], activeId: sc.id }))
  }, seed)
  await page.reload()
  await page.getByText('规格录入').waitFor({ timeout: 8000 })

  /* ---- 主题：首次访问默认暗色 ---- */
  check('首次访问默认暗色主题', await page.evaluate(() => document.documentElement.classList.contains('dark')))

  /* ---- 工作台：KPI 状态带 + 面板网格 ---- */
  check('KPI 状态带：有效规格', await page.getByText('有效规格 SKU').count() === 1)
  check('KPI 状态带：最优单价', await page.getByText('最优单价 BEST').count() === 1)
  check('KPI 状态带：计价模式', await page.getByText('计价模式 MODE').count() === 1)
  check('录入面板标题', await page.getByText('规格录入').count() === 1)
  check('维度面板标题', await page.getByText('参数维度与权重').count() === 1)
  check('指挥舱英文副标', await page.getByText('SPEC DECISION CONSOLE').count() === 1)
  check('实时状态位', await page.getByText(/LOCAL MODE|AI/).count() >= 1)
  await page.screenshot({ path: 'shot-workbench-dark.png', fullPage: false })

  /* ---- 录入：加一行并填规格/价格，验证自动换算 ---- */
  await page.getByText('添加一行规格').click()
  const lastRow = page.locator('tbody tr').last()
  await lastRow.locator('input').nth(1).fill('32g×4袋') // 规格列（双向同步）
  await lastRow.locator('input[type=number]').first().fill('6.9') // 总价
  await page.waitForTimeout(300)
  const rowText = await lastRow.innerText()
  check('新行自动换算每单位价（0.0539/g）', rowText.includes('0.0539'))
  check('规格描述双向同步到含量/数量', await lastRow.locator('input').nth(3).inputValue() === '32')

  /* ---- 报告页全链路 ---- */
  await page.getByText('生成决策报告').click()
  await page.getByText('本期最划算', { exact: true }).waitFor({ timeout: 8000 })
  const champion = await page.locator('section', { hasText: '本期最划算' }).first().innerText()
  check('冠军推荐正确（16g×16袋单价最低 0.0332/g）', champion.includes('16g×16袋'))
  check('冠军卡 ▲▼ 同比小字', /[▲▼] [\d.]+%/.test(champion))
  check('冠军卡英文副标 BEST PICK', champion.includes('BEST PICK'))
  check('性价比全景散点图（VALUE MAP）', await page.getByText('VALUE MAP').count() === 1)
  check('排名面板（RANKING）', await page.getByText('RANKING').count() === 1)
  check('边际效益面板（MARGINAL ANALYSIS）', await page.getByText('MARGINAL ANALYSIS').count() === 1)
  check('避坑提示告警面板（ALERTS）', await page.getByText('ALERTS').count() === 1)
  check('告警分级徽标（中警/高危）', await page.getByText('中警').count() + await page.getByText('高危').count() >= 1)
  check('导出 PNG 按钮', await page.getByText('导出 PNG').count() === 1)
  check('打印 / PDF 按钮', await page.getByText('打印 / PDF').count() === 1)
  check('复制摘要按钮', await page.getByText('复制摘要').count() === 1)
  check('分享链接按钮', await page.getByText('分享链接').count() === 1)
  await page.screenshot({ path: 'shot-report-dark.png', fullPage: true })

  /* ---- 亮/暗主题切换 + 图表联动 ---- */
  await page.getByRole('button', { name: '切换主题' }).click()
  await page.waitForTimeout(400)
  check('切换到亮色主题', await page.evaluate(() => document.documentElement.classList.contains('light')))
  check('亮色下散点图仍在', await page.getByText('VALUE MAP').count() === 1)
  await page.screenshot({ path: 'shot-report-light.png', fullPage: true })
  await page.getByRole('button', { name: '切换主题' }).click()
  await page.waitForTimeout(400)
  check('切回暗色主题', await page.evaluate(() => document.documentElement.classList.contains('dark')))

  /* ---- 粘贴表格导入 ---- */
  await page.getByText('返回编辑').click()
  await page.getByText('规格录入').waitFor({ timeout: 8000 })
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData('text/plain', '规格\t价格\n番茄味 20g×5袋\t7.9\n烧烤味 20g×5袋\t8.5')
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  })
  await page.getByText('确认识别结果').waitFor({ timeout: 8000 })
  check('粘贴导入弹出可编辑确认列表', true)
  check('识别出 2 条规格', await page.getByText(/2 个规格/).count() >= 1)
  await page.getByRole('button', { name: /追加导入|确认导入/ }).click()
  await page.waitForTimeout(400)
  const kpi = await page.locator('div', { hasText: '有效规格 SKU' }).first().innerText()
  check('导入后有效规格变为 6', /6\s*\/\s*6/.test(kpi.replace(/\n/g, ' ')))

  /* ---- 移动端布局 ---- */
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.waitForTimeout(600)
  check('移动端卡片式录入（总价 ¥）', await page.getByText('总价 ¥').first().count() >= 1)
  check('移动端 KPI 状态带在', await page.getByText('有效规格 SKU').count() === 1)
  await page.screenshot({ path: 'shot-mobile.png', fullPage: false })

  await browser.close()
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
