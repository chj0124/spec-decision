import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Report from '../Report'
import { decide } from '../../lib/engine'
import type { DecisionConfig, Sku } from '../../lib/types'

/**
 * 报告页的两处关键交互：导出 / 分享菜单，以及「预算优先」下的预算输入框。
 * 只断言用户看得见的行为：菜单开合、复制后的文案反馈、链接过长时的降级提示、
 * 预算草稿的保留与非法字符过滤。
 */

const SKUS: Sku[] = [
  { id: 'a', name: '原味 38g×20袋', price: 39.9, quantity: 38, unit: 'g', packs: 20 },
  { id: 'b', name: '香辣 38g×20袋', price: 49.9, quantity: 38, unit: 'g', packs: 20 },
]

function makeConfig(overrides: Partial<DecisionConfig> = {}): DecisionConfig {
  return { dims: [], priceWeight: 50, preference: 'value', ...overrides }
}

function renderReport({
  config: configOverrides,
  getShareUrl,
}: {
  config?: Partial<DecisionConfig>
  getShareUrl?: () => Promise<string>
} = {}) {
  const config = makeConfig(configOverrides)
  render(
    <Report
      result={decide(SKUS, config)}
      config={config}
      onBack={vi.fn()}
      onPreferenceChange={vi.fn()}
      onBudgetChange={vi.fn()}
      getShareUrl={getShareUrl}
    />,
  )
  return config
}

function setup(overrides: Parameters<typeof renderReport>[0] = {}) {
  const onBudgetChange = vi.fn()
  const user = userEvent.setup()
  // user-event 的 setup() 会把 navigator.clipboard 换成自己的桩，
  // 所以剪贴板探针必须在它之后安装，否则读不到我们自己的调用记录。
  // 显式标注入参类型，否则 mock.calls[0][0] 推断成空元组，取下标会被 TS 拦下。
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {})
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  const config = makeConfig(overrides.config)
  render(
    <Report
      result={decide(SKUS, config)}
      config={config}
      onBack={vi.fn()}
      onPreferenceChange={vi.fn()}
      onBudgetChange={onBudgetChange}
      getShareUrl={overrides.getShareUrl}
    />,
  )
  return { user, onBudgetChange, writeText }
}

/** 导出 / 分享菜单的入口按钮 */
const entry = () => screen.getByRole('button', { name: /导出 \/ 分享/ })
/** 预算输入框（仅「预算优先」出现） */
const budgetInput = () => screen.getByLabelText('预算') as HTMLInputElement

afterEach(() => {
  vi.useRealTimers()
})

describe('Report 导出 / 分享菜单', () => {
  it('默认收起，点击入口后展开各个动作', async () => {
    const { user } = setup()

    expect(screen.queryByText('复制文字摘要')).not.toBeInTheDocument()

    await user.click(entry())

    expect(screen.getByText('导出 PNG 图片')).toBeInTheDocument()
    expect(screen.getByText('打印 / 存为 PDF')).toBeInTheDocument()
    expect(screen.getByText('复制文字摘要')).toBeInTheDocument()
  })

  it('再次点击入口可收起菜单', async () => {
    const { user } = setup()

    await user.click(entry())
    expect(screen.getByText('复制文字摘要')).toBeInTheDocument()

    await user.click(entry())
    expect(screen.queryByText('复制文字摘要')).not.toBeInTheDocument()
  })

  it('复制文字摘要：写入剪贴板并给出「已复制到剪贴板」反馈', async () => {
    const { user, writeText } = setup()

    await user.click(entry())
    await user.click(screen.getByText('复制文字摘要'))

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain('【规格决策摘要】')
    expect(await screen.findByText('已复制到剪贴板')).toBeInTheDocument()
  })

  it('复制摘要后菜单会自动收起', async () => {
    // shouldAdvanceTime 让假时钟跟随真实时间推进，user-event 的内部等待才不会卡死
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup()
    renderReport()

    await user.click(entry())
    await user.click(screen.getByText('复制文字摘要'))
    expect(await screen.findByText('已复制到剪贴板')).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(1400) })
    expect(screen.queryByText('已复制到剪贴板')).not.toBeInTheDocument()
  })

  it('提供 getShareUrl 时可复制分享链接，并给出「链接已复制」反馈', async () => {
    const url = 'https://example.com/#s=abc'
    const { user, writeText } = setup({ getShareUrl: async () => url })

    await user.click(entry())
    await user.click(screen.getByText('复制分享链接'))

    expect(await screen.findByText('链接已复制')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(url)
  })

  it('未提供 getShareUrl 时不显示分享链接入口', async () => {
    const { user } = setup()

    await user.click(entry())

    expect(screen.queryByText('复制分享链接')).not.toBeInTheDocument()
  })

  it('分享链接过长时改为提示改用备份文件，并不自动复制', async () => {
    const longUrl = `https://example.com/#s=${'a'.repeat(2100)}`
    const { user, writeText } = setup({ getShareUrl: async () => longUrl })

    await user.click(entry())
    await user.click(screen.getByText('复制分享链接'))

    expect(await screen.findByText(/可能自动截断/)).toBeInTheDocument()
    expect(writeText).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '仍要复制链接' }))
    expect(writeText).toHaveBeenCalledWith(longUrl)
  })
})

describe('Report 预算输入', () => {
  it('仅在「预算优先」偏好下出现预算输入框', () => {
    setup({ config: { preference: 'value' } })
    expect(screen.queryByLabelText('预算')).not.toBeInTheDocument()
  })

  it('输入预算时保留草稿并实时回传数字', async () => {
    const { user, onBudgetChange } = setup({ config: { preference: 'budget' } })

    await user.type(budgetInput(), '19.9')

    expect(budgetInput().value).toBe('19.9')
    expect(onBudgetChange).toHaveBeenLastCalledWith(19.9)
  })

  it('过滤非法字符：字母进不了输入框', async () => {
    const { user, onBudgetChange } = setup({ config: { preference: 'budget' } })

    await user.type(budgetInput(), '12abc')

    expect(budgetInput().value).toBe('12')
    expect(onBudgetChange).toHaveBeenLastCalledWith(12)
  })

  it('多个小数点只保留第一个', async () => {
    const { user } = setup({ config: { preference: 'budget' } })

    await user.type(budgetInput(), '1.2.3')

    expect(budgetInput().value).toBe('1.23')
  })

  it('清空输入回传 undefined，表示没有填写预算', async () => {
    const { user, onBudgetChange } = setup({
      config: { preference: 'budget', budget: 50 },
    })

    expect(budgetInput().value).toBe('50')

    await user.clear(budgetInput())

    expect(onBudgetChange).toHaveBeenLastCalledWith(undefined)
  })
})
