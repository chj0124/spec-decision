import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState } from '../workbench/EmptyState'
import { GenExampleNotice } from '../workbench/GenExampleNotice'

function renderEmpty(genLoading = false) {
  const onGenExample = vi.fn()
  const onPickImage = vi.fn()
  const onQuickEntry = vi.fn()
  const onAdd = vi.fn()
  render(
    <EmptyState
      genLoading={genLoading}
      onGenExample={onGenExample}
      onPickImage={onPickImage}
      onQuickEntry={onQuickEntry}
      onAdd={onAdd}
    />,
  )
  return { onGenExample, onPickImage, onQuickEntry, onAdd }
}

describe('EmptyState 首启引导', () => {
  it('把「粘贴规格表」与「一键生成示例」讲成两条明确的主路径', () => {
    renderEmpty()
    expect(screen.getByRole('button', { name: /粘贴你的规格表/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /一键生成示例/ })).toBeInTheDocument()
  })

  it('两条路径各触发自己的入口，互不串线', async () => {
    const user = userEvent.setup()
    const { onQuickEntry, onGenExample } = renderEmpty()

    await user.click(screen.getByRole('button', { name: /粘贴你的规格表/ }))
    expect(onQuickEntry).toHaveBeenCalledTimes(1)
    expect(onGenExample).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /一键生成示例/ }))
    expect(onGenExample).toHaveBeenCalledTimes(1)
  })

  it('给出「录入 → 设定维度 → 生成报告」三步说明', () => {
    renderEmpty()
    expect(screen.getByText('录入候选')).toBeInTheDocument()
    expect(screen.getByText('设定维度')).toBeInTheDocument()
    expect(screen.getByText('生成报告')).toBeInTheDocument()
  })

  it('保留截图识别与手动添加两个备选入口', () => {
    const { onPickImage, onAdd } = renderEmpty()
    expect(screen.getByRole('button', { name: /截图识别/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /手动添加/ })).toBeInTheDocument()
    expect(onPickImage).toBeTypeOf('function')
    expect(onAdd).toBeTypeOf('function')
  })

  it('生成中禁用示例入口并提示进度，避免重复触发', () => {
    renderEmpty(true)
    expect(screen.getByRole('button', { name: /生成中/ })).toBeDisabled()
  })
})

describe('GenExampleNotice 生成来源显性化', () => {
  it('source=ai 时标明 AI 实时生成', () => {
    render(<GenExampleNotice source="ai" genSummary="已加载「蓝牙耳机」示例：12 个 SKU" genError={null} />)
    expect(screen.getByText(/AI 实时生成/)).toBeInTheDocument()
    expect(screen.getByText(/已加载「蓝牙耳机」示例/)).toBeInTheDocument()
  })

  it('source=fallback 时标明内置示例，并把回退原因一并交代', () => {
    render(
      <GenExampleNotice
        source="fallback"
        genSummary="已加载「猫粮」示例：15 个 SKU"
        genError="未配置 AI，已加载内置真实商品示例"
      />,
    )
    expect(screen.getByText(/内置示例/)).toBeInTheDocument()
    expect(screen.getByText(/已加载「猫粮」示例/)).toBeInTheDocument()
    expect(screen.getByText(/未配置 AI，已加载内置真实商品示例/)).toBeInTheDocument()
  })

  it('硬失败（无 summary）时只给出错误说明', () => {
    render(<GenExampleNotice source={null} genSummary={null} genError="生成示例失败：网络超时" />)
    expect(screen.getByText(/生成示例失败：网络超时/)).toBeInTheDocument()
    expect(screen.queryByText(/内置示例/)).not.toBeInTheDocument()
  })
})
