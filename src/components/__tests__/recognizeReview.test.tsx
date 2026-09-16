import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RecognizeReview from '../RecognizeReview'
import type { RecognizedSku } from '../../lib/recognize'

/**
 * 识别确认流：AI 识别结果 → 人工核对 → 导入。
 * 这里只断言「用户看得见的行为」：条数反馈、无效行不计入、增删行、重置、两种导入方式。
 */

const IMAGES = ['data:image/png;base64,AAA']

/** 两条口味不同、价格不同的零食：价格列会展示，含量/单位/件数全同会被折叠 */
const ITEMS: RecognizedSku[] = [
  { name: '原味 38g×20袋', price: 39.9, quantity: 38, unit: 'g', packs: 20, confidence: 1 },
  { name: '香辣 38g×20袋', price: 42, quantity: 38, unit: 'g', packs: 20, confidence: 1 },
]

function setup(overrides: Partial<Parameters<typeof RecognizeReview>[0]> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const user = userEvent.setup()
  render(
    <RecognizeReview
      images={IMAGES}
      items={ITEMS}
      source="api"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { user, onConfirm, onCancel }
}

/** 价格输入框按行顺序排列，用下标取第 n 行 */
const priceAt = (i: number) => screen.getAllByPlaceholderText('价格')[i] as HTMLInputElement

describe('RecognizeReview 识别确认流', () => {
  it('展示识别到的规格条数，并给出与有效条数一致的导入入口', () => {
    setup()

    expect(screen.getByText('确认识别结果')).toBeInTheDocument()
    expect(screen.getByText('2 个规格')).toBeInTheDocument()
    expect(screen.getByText(/有效/)).toHaveTextContent('有效 2 / 2 条')
    expect(screen.getByRole('button', { name: '确认导入 2 条' })).toBeEnabled()
  })

  it('点击取消走 onCancel，不触发导入', async () => {
    const { user, onCancel, onConfirm } = setup()

    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('把某行价格清空后该行不计入导入：有效条数与按钮文案同步下降', async () => {
    const { user, onConfirm } = setup()

    await user.clear(priceAt(0))

    expect(screen.getByText(/有效/)).toHaveTextContent('有效 1 / 2 条')
    expect(screen.queryByRole('button', { name: '确认导入 2 条' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '确认导入 1 条' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    const [items, dims, mode] = onConfirm.mock.calls[0]
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe(ITEMS[1].name)
    expect(dims).toEqual([])
    expect(mode).toBe('append')
  })

  it('「补一个 AI 漏掉的规格」新增空行：总条数 +1，但空行不计入有效条数', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: /补一个 AI 漏掉的规格/ }))

    expect(screen.getByText('3 个规格')).toBeInTheDocument()
    expect(screen.getByText(/有效/)).toHaveTextContent('有效 2 / 3 条')
    expect(screen.getByRole('button', { name: '确认导入 2 条' })).toBeEnabled()
  })

  it('删除某行后总条数与有效条数一起减少', async () => {
    const { user } = setup()

    await user.click(screen.getAllByRole('button', { name: '删除此行' })[0])

    expect(screen.getByText('1 个规格')).toBeInTheDocument()
    expect(screen.getByText(/有效/)).toHaveTextContent('有效 1 / 1 条')
  })

  it('「重置」把改动恢复为 AI 原始识别结果', async () => {
    const { user } = setup()

    await user.clear(priceAt(0))
    await user.type(priceAt(0), '99')
    expect(priceAt(0).value).toBe('99')

    await user.click(screen.getByRole('button', { name: /重置/ }))

    expect(priceAt(0).value).toBe('39.9')
    expect(screen.getByText(/有效/)).toHaveTextContent('有效 2 / 2 条')
  })

  it('工作台已有规格时给出「追加导入」，并且默认入口是「替换导入」', async () => {
    const { user, onConfirm } = setup({ existingCount: 5 })

    expect(screen.getByRole('button', { name: '替换导入 2 条' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '追加导入' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm.mock.calls[0][2]).toBe('append')
  })

  it('参数维度可就地增删，并随导入一起回传', async () => {
    const { user, onConfirm } = setup({
      dims: [{ label: '电池容量', type: 'higher-better', unit: 'mAh' }],
    })

    expect(screen.getByDisplayValue('电池容量')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /加维度/ }))
    expect(screen.getByDisplayValue('新维度')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: '删除维度' })[0])
    expect(screen.queryByDisplayValue('电池容量')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('新维度')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: '确认导入 2 条' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '确认导入 2 条' }))
    expect(onConfirm.mock.calls[0][1]).toEqual([{ label: '新维度', type: 'higher-better' }])
  })
})
