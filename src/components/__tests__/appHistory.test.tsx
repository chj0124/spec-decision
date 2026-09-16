import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'
import type { DecisionConfig, Sku } from '../../lib/types'

const SCENARIOS_KEY = 'spec-decision:scenarios'

const CONFIG: DecisionConfig = { dims: [], priceWeight: 50, preference: 'value' }

function sku(id: string, name: string): Sku {
  return { id, name, price: 0, quantity: 0, unit: 'g', packs: 8 }
}

function scenario(id: string, name: string, skus: Sku[] = []) {
  return { id, name, skus, config: { ...CONFIG, dims: [] }, updatedAt: 1_000 }
}

function seed(
  scenarios = [scenario('a', '清单A', [sku('s1', '原味')]), scenario('b', '清单B')],
  activeId = 'a',
) {
  localStorage.setItem(SCENARIOS_KEY, JSON.stringify({ scenarios, activeId, rev: 0 }))
}

// jsdom 不应用 Tailwind 媒体查询：桌面表格与移动卡片都会挂到 DOM 上，
// 因此取输入框时必须限定在桌面表格内，否则会撞上移动端的同款控件。
const table = () => screen.getByRole('table')
const qtyInput = () => within(table()).getAllByPlaceholderText('16')[0]

describe('App 撤销 / 重做历史（F4）', () => {
  it('连续编辑 3 次可逐步撤回，再逐步重做', async () => {
    const user = userEvent.setup()
    seed()
    render(<App />)

    // 三笔编辑：每敲一位数字都是一次独立的改动，各记一步历史
    await user.type(qtyInput(), '123')
    expect(qtyInput()).toHaveValue(123)

    // 逐步撤回：123 → 12 → 1 → 空
    await user.keyboard('{Control>}z{/Control}')
    expect(qtyInput()).toHaveValue(12)
    await user.keyboard('{Control>}z{/Control}')
    expect(qtyInput()).toHaveValue(1)
    await user.keyboard('{Control>}z{/Control}')
    expect(qtyInput()).toHaveValue(null)

    // 已到最早一步：再撤不再变化
    await user.keyboard('{Control>}z{/Control}')
    expect(qtyInput()).toHaveValue(null)

    // 逐步重做：空 → 1 → 12 → 123
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(qtyInput()).toHaveValue(1)
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(qtyInput()).toHaveValue(12)
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(qtyInput()).toHaveValue(123)

    // 没有更多可重做
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(qtyInput()).toHaveValue(123)
  })

  it('新的一次编辑会砍掉重做分支', async () => {
    const user = userEvent.setup()
    seed()
    render(<App />)

    await user.type(qtyInput(), '12')
    await user.keyboard('{Control>}z{/Control}')
    await user.keyboard('{Control>}z{/Control}')
    expect(qtyInput()).toHaveValue(null)

    // 撤回后又动了一次别的字段：历史从"撤回点"另起一枝，旧的重做分支作废。
    // 这里换用件数上方的价格框（初始为空，输入结果确定）。
    const price = within(table()).getAllByPlaceholderText('4.94')[0]
    await user.type(price, '5')
    expect(price).toHaveValue(5)

    // 已无重做分支：重做不会把件数改回去
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(qtyInput()).toHaveValue(null)
    expect(price).toHaveValue(5)
  })

  it('删除清单也能用 Ctrl/Cmd+Z 整份回退找回（与撤销条并存）', async () => {
    const user = userEvent.setup()
    seed()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '删除清单' }))
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(screen.queryByRole('button', { name: '清单A' })).not.toBeInTheDocument()

    await user.keyboard('{Control>}z{/Control}')

    expect(screen.getByRole('button', { name: '清单A' })).toBeInTheDocument()
    // 历史一动，限时撤销条收起，两套入口不打架
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
