import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'
import { UNDO_TTL_MS } from '../../lib/undo'
import type { DecisionConfig, Sku } from '../../lib/types'

const SCENARIOS_KEY = 'spec-decision:scenarios'

const CONFIG: DecisionConfig = { dims: [], priceWeight: 50, preference: 'value' }

function scenario(id: string, name: string, skus: Sku[] = []) {
  return { id, name, skus, config: { ...CONFIG, dims: [] }, updatedAt: 1_000 }
}

/** 直接铺一份含两份清单的本地工作区，这样"删除清单"按钮才会出现（至少保留一份）。 */
function seed(scenarios = [scenario('a', '清单A'), scenario('b', '清单B')], activeId = 'a') {
  localStorage.setItem(SCENARIOS_KEY, JSON.stringify({ scenarios, activeId, rev: 0 }))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('App 撤销 toast', () => {
  it('删除清单后弹出撤销提示，点击撤销可恢复该清单', async () => {
    const user = userEvent.setup()
    seed()
    render(<App />)

    // 激活清单 A：删除需二次确认
    await user.click(screen.getByRole('button', { name: '删除清单' }))
    await user.click(screen.getByRole('button', { name: '确认' }))

    // 清单条里不再有「清单A」，同时出现限时撤销提示
    expect(screen.queryByRole('button', { name: '清单A' })).not.toBeInTheDocument()
    const toast = screen.getByRole('status')
    expect(within(toast).getByText(/已删除清单「清单A」，可在 \d+ 秒内撤销。/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '撤销' }))

    // 清单恢复，提示条收起
    expect(screen.getByRole('button', { name: '清单A' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('关闭撤销提示后清单保持删除状态', async () => {
    const user = userEvent.setup()
    seed()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '删除清单' }))
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(screen.getByRole('status')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '关闭撤销提示' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '清单A' })).not.toBeInTheDocument()
  })

  it('超过时限后撤销提示自动消失', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup()
    seed()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '删除清单' }))
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(screen.getByRole('status')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(UNDO_TTL_MS + 1000)
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('只有一份清单时不提供删除入口（至少保留一份）', () => {
    seed([scenario('a', '唯一清单')], 'a')
    render(<App />)
    expect(screen.queryByRole('button', { name: '删除清单' })).not.toBeInTheDocument()
  })
})
