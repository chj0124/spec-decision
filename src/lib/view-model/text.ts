import type { ComputedSku } from '../types'
import { parseFlavor } from '../engine'

/** 一句话结论 / 图表轴标签里的短名：优先「口味·规格」，超长截断 */
export function shortSpec(name: string): string {
  const { spec, flavor } = parseFlavor(name)
  if (spec && spec.length <= 12) return flavor ? `${flavor}·${spec}` : spec
  return name.length > 12 ? name.slice(0, 12) + '…' : name
}

/**
 * 每件量词：优先用商品实际的件数量词（瓶/罐/袋/盒…），
 * 没有再按"是否多件"回退——多件用「包」、单件用「件」。
 * 这样瓶装饮料会显示"每瓶价格"而不是硬编码的"每包价格"。
 */
export const packWord = (packs: number, packUnit?: string): string =>
  packUnit || (packs > 1 ? '包' : '件')

/** 列表级每件量词：取列表里实际出现过的量词，没有则回退 */
export const listPackWord = (items: ComputedSku[]): string =>
  items.find((i) => i.packUnit)?.packUnit || (items.some((i) => i.packs > 1) ? '包' : '件')

/**
 * 把一条避坑提示拆成「粗体结论 + 灰色细节」两行（图注排版用）。
 * 提示句都是「结论，补充说明。」的写法，于是在第一个逗号处断开：
 * 「」单价比「」贵 357% ／ 除非有特殊需求，否则是明显的智商税。
 */
export function splitWarnText(text: string): { lead: string; detail: string } {
  const i = text.indexOf('，')
  const strip = (s: string) => s.replace(/[。，]$/, '')
  if (i === -1) return { lead: strip(text), detail: '' }
  return { lead: strip(text.slice(0, i)), detail: text.slice(i + 1) }
}

/**
 * SVG <text> 不会自动换行，这里按「可用宽度（以字宽 em 计）」手工折行：
 * CJK 字符记 1 个字宽，ASCII 记 0.55，逐字累加、超宽即断行。
 */
export function wrapCjk(text: string, maxEm: number): string[] {
  const widthOf = (ch: string) => (/[\u2e80-\ufeff]/.test(ch) ? 1 : 0.55)
  const lines: string[] = []
  let cur = ''
  let w = 0
  for (const ch of text) {
    const cw = widthOf(ch)
    if (w + cw > maxEm && cur) {
      lines.push(cur)
      cur = ch
      w = cw
    } else {
      cur += ch
      w += cw
    }
  }
  if (cur) lines.push(cur)
  return lines
}
