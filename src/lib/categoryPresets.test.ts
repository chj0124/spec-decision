import { describe, it, expect } from 'vitest'
import { matchCategoryPreset } from './categoryPresets'

describe('matchCategoryPreset 品类模板匹配', () => {
  it('耐用品（手机/家电）命中 per-feature，带主参数候选', () => {
    const phone = matchCategoryPreset('手机')
    expect(phone?.mode).toBe('per-feature')
    expect(phone?.primaryDimLabels).toContain('电池')
    expect(matchCategoryPreset('笔记本电脑')?.mode).toBe('per-feature')
    expect(matchCategoryPreset('洗衣机')?.mode).toBe('per-feature')
  })

  it('消耗品（零食/饮料/纸巾）命中 per-unit', () => {
    expect(matchCategoryPreset('零食')?.mode).toBe('per-unit')
    expect(matchCategoryPreset('饮料')?.mode).toBe('per-unit')
    expect(matchCategoryPreset('纸巾')?.mode).toBe('per-unit')
    expect(matchCategoryPreset('五金螺丝')?.mode).toBe('per-unit')
  })

  it('未知品类 / 空值返回 null（调用方回退 per-unit）', () => {
    expect(matchCategoryPreset('没见过的东西')).toBeNull()
    expect(matchCategoryPreset('')).toBeNull()
    expect(matchCategoryPreset(undefined)).toBeNull()
  })
})
