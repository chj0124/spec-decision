import { describe, it, expect } from 'vitest'
import {
  captureDelete,
  captureImport,
  removeScenario,
  restoreScenario,
  applyUndo,
  emptyHistory,
  pushHistory,
  undoHistory,
  redoHistory,
  HISTORY_LIMIT,
} from './undo'
import { newScenario } from './store'
import type { Workspace } from './store'

/** 用固定 id 造清单，避免 newScenario 里 uid() 的随机值让断言不稳定 */
const sc = (id: string, name = id) => ({ ...newScenario(name), id })

const ws = (...ids: string[]): Workspace => ({
  scenarios: ids.map((id) => sc(id)),
  activeId: ids[0],
  rev: 0,
})

describe('removeScenario 删除清单', () => {
  it('只剩一份时拒绝删除，原样返回', () => {
    const w = ws('a')
    expect(removeScenario(w, 'a')).toBe(w)
  })

  it('删掉非激活项，焦点不动', () => {
    const next = removeScenario(ws('a', 'b'), 'b')
    expect(next.scenarios.map((s) => s.id)).toEqual(['a'])
    expect(next.activeId).toBe('a')
  })

  it('删掉激活项时焦点回落到剩下的第一份，不指向已不存在的清单', () => {
    const w: Workspace = { scenarios: [sc('a'), sc('b')], activeId: 'a', rev: 0 }
    const next = removeScenario(w, 'a')
    expect(next.scenarios.map((s) => s.id)).toEqual(['b'])
    expect(next.activeId).toBe('b')
  })

  it('id 不存在时原样返回，不误删别的清单', () => {
    const w = ws('a', 'b')
    expect(removeScenario(w, 'zzz')).toBe(w)
  })
})

describe('captureDelete 撤销槽快照', () => {
  it('只有一份清单时不给撤销槽（这种删除本来就不允许）', () => {
    expect(captureDelete(ws('a'), 'a')).toBeNull()
  })

  it('id 不存在时不给撤销槽', () => {
    expect(captureDelete(ws('a', 'b'), 'zzz')).toBeNull()
  })

  it('记录被删清单的内容、原位置与当时的激活项', () => {
    const w: Workspace = { scenarios: [sc('a', '零食'), sc('b', '饮料')], activeId: 'a', rev: 0 }
    const slot = captureDelete(w, 'b')!
    expect(slot).toMatchObject({ kind: 'delete', index: 1, activeId: 'a' })
    expect(slot.label).toBe('已删除清单「饮料」')
    expect(slot.scenario.id).toBe('b')
    expect(slot.scenario.name).toBe('饮料')
  })
})

describe('restoreScenario 撤销删除', () => {
  it('按原位置插回，清单顺序与删除前一致', () => {
    const before = ws('a', 'b', 'c')
    const slot = captureDelete(before, 'b')!
    const back = restoreScenario(removeScenario(before, 'b'), slot)
    expect(back.scenarios.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('撤销只补回被删清单，不回滚这期间对其他清单的编辑', () => {
    const before = ws('a', 'b')
    const slot = captureDelete(before, 'b')!
    // 删除之后，用户在剩下的清单里改了名字
    const after = removeScenario(before, 'b')
    const edited: Workspace = {
      ...after,
      scenarios: after.scenarios.map((s) => (s.id === 'a' ? { ...s, name: '改过的名字' } : s)),
    }
    const back = restoreScenario(edited, slot)
    expect(back.scenarios.map((s) => s.id)).toEqual(['a', 'b'])
    expect(back.scenarios.find((s) => s.id === 'a')!.name).toBe('改过的名字')
  })

  it('被删的正好是当时在看的那份，撤销后焦点还给被删的那份', () => {
    const before: Workspace = { scenarios: [sc('a'), sc('b')], activeId: 'b', rev: 0 }
    const slot = captureDelete(before, 'b')!
    const after = removeScenario(before, 'b')
    expect(after.activeId).toBe('a')
    expect(restoreScenario(after, slot).activeId).toBe('b')
  })

  it('被删的不是激活项时，不改变用户当前的焦点', () => {
    const before: Workspace = { scenarios: [sc('a'), sc('b')], activeId: 'a', rev: 0 }
    const slot = captureDelete(before, 'b')!
    expect(restoreScenario(removeScenario(before, 'b'), slot).activeId).toBe('a')
  })

  it('重复撤销不会插入出两份同 id 清单', () => {
    const before = ws('a', 'b')
    const slot = captureDelete(before, 'b')!
    const once = restoreScenario(removeScenario(before, 'b'), slot)
    const twice = restoreScenario(once, slot)
    expect(twice.scenarios.filter((s) => s.id === 'b')).toHaveLength(1)
  })
})

describe('applyUndo 覆盖导入', () => {
  it('撤销覆盖导入：整份还原到导入前的工作区', () => {
    const prev = ws('a', 'b')
    const incoming = ws('x')
    const slot = captureImport(prev, incoming)
    expect(applyUndo(incoming, slot)).toBe(prev)
  })

  it('标签说明这次导入了多少份清单', () => {
    const slot = captureImport(ws('a'), ws('x', 'y', 'z'))
    expect(slot.label).toContain('3')
  })
})

describe('有界撤销栈（F4）', () => {
  it('记录"改动前"的快照：past 递增、同时清空 redo 分支', () => {
    const s0 = ws('a')
    const s1 = ws('a', 'b')
    const h = pushHistory(pushHistory(emptyHistory, s0), s1)
    expect(h.past).toEqual([s0, s1])
    expect(h.future).toEqual([])
  })

  it('同一次动作里连续改动（拿到同一个"改动前"引用）只压一步', () => {
    // 典型：生成示例先后改清单与配置，两次改动共用同一个"改动前"
    const s0 = ws('a')
    const h = pushHistory(pushHistory(emptyHistory, s0), s0)
    expect(h.past).toEqual([s0])
  })

  it('新的改动会丢弃 redo 分支', () => {
    const s0 = ws('a')
    const s1 = ws('a', 'b')
    const undone = undoHistory(pushHistory(emptyHistory, s0), s1)!
    expect(undone.history.future).toEqual([s1])

    const after = pushHistory(undone.history, undone.workspace)
    expect(after.future).toEqual([])
  })

  it('上限 50：超出后丢弃最旧的一步，栈顶始终是最新一步', () => {
    const states = Array.from({ length: HISTORY_LIMIT + 1 }, (_, i) => ws(`c${i}`))
    let h = emptyHistory
    for (const s of states) h = pushHistory(h, s)

    expect(h.past).toHaveLength(HISTORY_LIMIT)
    expect(h.past[0]).toBe(states[1])
    expect(h.past[h.past.length - 1]).toBe(states[states.length - 1])
  })

  it('连续编辑 3 次可逐步撤回，再逐步重做', () => {
    const s0 = ws('a')
    const s1 = ws('a', 'b')
    const s2 = ws('a', 'b', 'c')
    const s3 = ws('a', 'b', 'c', 'd')
    let h = emptyHistory
    for (const s of [s0, s1, s2]) h = pushHistory(h, s)

    const u1 = undoHistory(h, s3)!
    expect(u1.workspace).toBe(s2)
    const u2 = undoHistory(u1.history, s2)!
    expect(u2.workspace).toBe(s1)
    const u3 = undoHistory(u2.history, s1)!
    expect(u3.workspace).toBe(s0)
    expect(u3.history.past).toEqual([])
    expect(u3.history.future).toEqual([s1, s2, s3])

    const r1 = redoHistory(u3.history, s0)!
    expect(r1.workspace).toBe(s1)
    const r2 = redoHistory(r1.history, s1)!
    expect(r2.workspace).toBe(s2)
    const r3 = redoHistory(r2.history, s2)!
    expect(r3.workspace).toBe(s3)
    expect(r3.history.future).toEqual([])
    expect(r3.history.past).toEqual([s0, s1, s2])
  })

  it('已到最早一步不能再撤、没有重做分支不能再重做', () => {
    expect(undoHistory(emptyHistory, ws('a'))).toBeNull()
    expect(redoHistory(emptyHistory, ws('a'))).toBeNull()
  })

  it('危险操作检查点并入同一历史：删掉的清单也能用栈回退找回', () => {
    const before = ws('a', 'b')
    const slot = captureDelete(before, 'b')!
    const afterDelete = removeScenario(before, 'b')

    const back = undoHistory(pushHistory(emptyHistory, before), afterDelete)!
    expect(back.workspace.scenarios.map((s) => s.id)).toEqual(['a', 'b'])

    // 既有 toast 的"外科式"撤销语义保持不变：只补回被删的那份
    expect(applyUndo(afterDelete, slot).scenarios.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('覆盖导入同样是历史里的一步', () => {
    const prev = ws('a', 'b')
    const incoming = ws('x')
    const back = undoHistory(pushHistory(emptyHistory, prev), incoming)!
    expect(back.workspace).toBe(prev)
    expect(captureImport(prev, incoming).snapshot).toBe(prev)
  })
})
