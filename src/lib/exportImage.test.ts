import { describe, it, expect } from 'vitest'
import { buildReportFileName } from './exportImage'

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d)

describe('buildReportFileName', () => {
  it('无类别：只有前缀与日期', () => {
    expect(buildReportFileName(undefined, at(2026, 4, 25))).toBe('规格决策-20260425')
  })

  it('日期按月日补零', () => {
    expect(buildReportFileName('牛奶', at(2026, 1, 3))).toBe('规格决策-牛奶-20260103')
  })

  it('类别做文件名安全化：斜杠 / 空格转成连字符', () => {
    expect(buildReportFileName('纸巾/抽纸 500g', at(2026, 4, 25))).toBe('规格决策-纸巾-抽纸-500g-20260425')
  })

  it('过长的类别截断到 24 字符', () => {
    expect(buildReportFileName('x'.repeat(40), at(2026, 4, 25))).toBe(
      `规格决策-${'x'.repeat(24)}-20260425`,
    )
  })

  it('纯空白类别视为没有类别', () => {
    expect(buildReportFileName('   ', at(2026, 4, 25))).toBe('规格决策-20260425')
  })
})
