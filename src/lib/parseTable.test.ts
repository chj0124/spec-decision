import { describe, it, expect } from 'vitest'
import { parseClipboardTable } from './parseTable'

/** 生成 "规格\t价格" 两列的 TSV，共 rows 行数据（不含表头） */
function tsv(rows: number): string {
  const lines = ['规格\t价格']
  for (let i = 0; i < rows; i++) lines.push(`规格${i}\t${i + 1}`)
  return lines.join('\n')
}

describe('parseClipboardTable 常规识别', () => {
  it('识别价格列 / 名称列 / 含量列', () => {
    const text = ['规格\t价格\t含量', '16g×8袋\t89.9\t16', '32g×8袋\t159\t32'].join('\n')
    const r = parseClipboardTable(text)
    expect(r).not.toBeNull()
    expect(r!.items).toHaveLength(2)
    expect(r!.items[0].name).toBe('16g×8袋')
    expect(r!.items[0].price).toBe(89.9)
    expect(r!.items[1].price).toBe(159)
  })

  it('少于两行时返回 null', () => {
    expect(parseClipboardTable('规格\t价格')).toBeNull()
  })

  it('没有价格列时给出可读的失败原因', () => {
    const r = parseClipboardTable(['规格\t备注', '甲\t好', '乙\t一般'].join('\n'))
    expect(r).not.toBeNull()
    expect(r!.items).toHaveLength(0)
    expect(r!.note).toContain('没识别到价格列')
  })
})

describe('parseClipboardTable 大数据量护栏（A9）', () => {
  it('10 万行输入不抛 RangeError（最大列数改为循环统计）', () => {
    const rows = 100_000
    let result: ReturnType<typeof parseClipboardTable> = null
    expect(() => { result = parseClipboardTable(tsv(rows)) }).not.toThrow()
    expect(result).not.toBeNull()
    expect(result!.items).toHaveLength(rows)
  })

  it('20 万行不抛 RangeError —— 旧实现 Math.max(...rows.map()) 在该量级栈溢出', () => {
    const rows = 200_000
    let result: ReturnType<typeof parseClipboardTable> = null
    expect(() => { result = parseClipboardTable(tsv(rows)) }).not.toThrow()
    expect(result).not.toBeNull()
    expect(result!.items).toHaveLength(rows)
  })
})
