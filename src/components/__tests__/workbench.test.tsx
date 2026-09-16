import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Workbench from '../Workbench'
import type { DecisionConfig, Sku } from '../../lib/types'

const CONFIG: DecisionConfig = { dims: [], priceWeight: 50, preference: 'value' }

// 3 个规格：口味 2 个不同值（原味 ×2、香辣 ×1），而 规格（38g）与 件数（20件）完全一致。
// 于是"按口味"是唯一能真正聚合的分组维度，其余选项会被 Workbench 的过滤逻辑剔除。
const SKUS: Sku[] = [
  { id: 'a', name: '原味 38g×20袋', price: 39.9, quantity: 38, unit: 'g', packs: 20 },
  { id: 'b', name: '原味 38g×20袋', price: 49.9, quantity: 38, unit: 'g', packs: 20 },
  { id: 'c', name: '香辣 38g×20袋', price: 45, quantity: 38, unit: 'g', packs: 20 },
]

function renderWorkbench(overrides: { skus?: Sku[]; config?: DecisionConfig } = {}) {
  const onChange = vi.fn()
  const onGenerate = vi.fn()
  const onConfigChange = vi.fn()
  render(
    <Workbench
      skus={overrides.skus ?? SKUS}
      onChange={onChange}
      onGenerate={onGenerate}
      config={overrides.config ?? CONFIG}
      onConfigChange={onConfigChange}
    />,
  )
  return { onChange, onGenerate, onConfigChange }
}

const groupButton = () => screen.getByRole('button', { name: '按口味' })
// 桌面表格与移动端卡片共用分组状态，jsdom 不会应用 Tailwind 媒体查询，
// 两者都会挂到 DOM 上，所以断言分组标题时要限定在桌面表格内，避免多重匹配。
const table = () => screen.getByRole('table')

describe('Workbench 分组折叠', () => {
  it('存在可聚合维度时给出分组选项，默认不展示取消分组', () => {
    renderWorkbench()
    expect(groupButton()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消分组' })).not.toBeInTheDocument()
  })

  it('所有规格在该维度取值相同时不出分组选项（无区分意义）', () => {
    renderWorkbench({
      skus: [
        { id: 'a', name: '原味 38g×20袋', price: 39.9, quantity: 38, unit: 'g', packs: 20 },
        { id: 'b', name: '原味 50g×20袋', price: 42, quantity: 38, unit: 'g', packs: 20 },
        { id: 'c', name: '原味 60g×20袋', price: 45, quantity: 38, unit: 'g', packs: 20 },
      ],
    })
    expect(screen.queryByRole('button', { name: '按口味' })).not.toBeInTheDocument()
  })

  it('点击分组按钮后按口味分组并显示组标题与组内规格数', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(groupButton())

    const t = table()
    // 组标题行：口味名 + 组内规格数（AutoWidthInput 会渲染同名隐藏测量 span，故只认「（N 个规格）」这个唯一文本）
    const flavorHeader = within(t).getByText('（2 个规格）').closest('tr')
    expect(flavorHeader).toHaveTextContent('原味')
    expect(within(t).getByText('（1 个规格）').closest('tr')).toHaveTextContent('香辣')
    expect(screen.getByRole('button', { name: '取消分组' })).toBeInTheDocument()
  })

  it('点击组标题折叠该组，组内数据行从表格中移除', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(groupButton())
    const before = within(table()).getAllByRole('row').length

    // 点击「（2 个规格）」所在的分组标题行，触发 onToggle 折叠该组
    await user.click(within(table()).getByText('（2 个规格）'))
    const after = within(table()).getAllByRole('row').length

    // 原味组有 2 行，折叠后应减少 2 行（组标题行仍在，只是旋转变向）
    expect(after).toBe(before - 2)
    // 组标题仍在，便于再次展开
    expect(within(table()).getByText('（2 个规格）')).toBeInTheDocument()
  })

  it('再次点击组标题可展开，数据行恢复', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(groupButton())
    const expanded = within(table()).getAllByRole('row').length

    const header = () => within(table()).getByText('（2 个规格）')
    await user.click(header())
    expect(within(table()).getAllByRole('row').length).toBe(expanded - 2)

    await user.click(header())
    expect(within(table()).getAllByRole('row').length).toBe(expanded)
  })

  it('点击取消分组恢复未分组视图', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(groupButton())
    expect(within(table()).getByText('（2 个规格）')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '取消分组' }))

    expect(within(table()).queryByText('（2 个规格）')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消分组' })).not.toBeInTheDocument()
  })

  it('再次点击已激活的分组按钮等价于取消分组', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(groupButton())
    expect(within(table()).getByText('（2 个规格）')).toBeInTheDocument()

    await user.click(groupButton())
    expect(within(table()).queryByText('（2 个规格）')).not.toBeInTheDocument()
  })
})
