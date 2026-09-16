import type { Scenario, Workspace } from './store'

/** 撤销槽保留时长：超时后自动收起，不再承诺可回退 */
export const UNDO_TTL_MS = 10_000

/**
 * 撤销槽：只保留最近一次破坏性操作的可回退信息。
 * - delete：只存被删的那一份清单及其原位置，撤销时不会顺手回滚这期间对其他清单的编辑
 * - import：覆盖导入换掉了整份工作区，只能整份还原
 */
export type UndoSlot =
  | { kind: 'delete'; label: string; scenario: Scenario; index: number; activeId: string; at: number }
  | { kind: 'import'; label: string; snapshot: Workspace; at: number }

export type DeleteSlot = Extract<UndoSlot, { kind: 'delete' }>
export type ImportSlot = Extract<UndoSlot, { kind: 'import' }>

/**
 * 移除一份清单（至少保留一份）。
 * 被删的正好是激活项时，焦点回落到剩下的第一份，避免出现 activeId 指向不存在的清单。
 */
export function removeScenario(w: Workspace, id: string): Workspace {
  if (w.scenarios.length <= 1) return w
  const scenarios = w.scenarios.filter((s) => s.id !== id)
  if (scenarios.length === w.scenarios.length) return w
  return { ...w, scenarios, activeId: w.activeId === id ? scenarios[0].id : w.activeId }
}

/** 记录一次"删除清单"；必须在真正删除之前调用，否则拿不到原位置与清单内容 */
export function captureDelete(w: Workspace, id: string): DeleteSlot | null {
  if (w.scenarios.length <= 1) return null
  const index = w.scenarios.findIndex((s) => s.id === id)
  if (index < 0) return null
  return {
    kind: 'delete',
    label: `已删除清单「${w.scenarios[index].name}」`,
    scenario: w.scenarios[index],
    index,
    activeId: w.activeId,
    at: Date.now(),
  }
}

/** 记录一次"覆盖导入"：prev 是被替换掉的旧工作区 */
export function captureImport(prev: Workspace, incoming: Workspace): ImportSlot {
  return {
    kind: 'import',
    label: `已覆盖导入 ${incoming.scenarios.length} 份清单`,
    snapshot: prev,
    at: Date.now(),
  }
}

/** 撤销"删除清单"：按原位置插回；被删的那份当时是激活项，就把焦点还给它 */
export function restoreScenario(w: Workspace, slot: DeleteSlot): Workspace {
  // 已经被插回去过（重复点击 / 后续操作又建了同 id 的清单）就不重复插入
  if (w.scenarios.some((s) => s.id === slot.scenario.id)) return w
  const scenarios = [...w.scenarios]
  scenarios.splice(Math.min(slot.index, scenarios.length), 0, slot.scenario)
  const activeId = slot.activeId === slot.scenario.id ? slot.scenario.id : w.activeId
  return { ...w, scenarios, activeId }
}

/** 把撤销槽写回工作区 */
export function applyUndo(w: Workspace, slot: UndoSlot): Workspace {
  return slot.kind === 'delete' ? restoreScenario(w, slot) : slot.snapshot
}
