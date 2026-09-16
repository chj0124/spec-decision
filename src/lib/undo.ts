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
  return { scenarios, activeId: w.activeId === id ? scenarios[0].id : w.activeId, rev: w.rev }
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
  return { scenarios, activeId, rev: w.rev }
}

/** 把撤销槽写回工作区 */
export function applyUndo(w: Workspace, slot: UndoSlot): Workspace {
  return slot.kind === 'delete' ? restoreScenario(w, slot) : slot.snapshot
}

/* ---------- 有界撤销栈（F4）----------
 * 上面那套"单槽 + TTL"只覆盖破坏性操作（删除清单 / 覆盖导入），且十秒即失效，
 * 连改三次字段只能一路改回去。这里补一条常规的撤销 / 重做历史：
 *  - 每次改动前记一份快照，`past` / `future` 两个序列就是"撤销"与"重做"两向的路；
 *  - 快照存的是 Workspace 引用：状态更新走不可变风格，快照间天然结构共享，
 *    50 步历史并不会真复制 50 份工作区；
 *  - 危险操作（captureDelete / captureImport）额外压一步，于是"删除清单"既能用
 *    toast 外科式撤销，也能被 Ctrl/Cmd+Z 整份回退 —— 合并而非替换。
 */

/** 历史栈上限：超出后丢弃最旧的一步（更早的状态已没什么用处，内存也要可控） */
export const HISTORY_LIMIT = 50

export interface History {
  /** 由旧到新：每一步的"改动前"状态，栈顶（末尾）就是上一步 */
  past: Workspace[]
  /** 由近到远：被撤销掉的状态，栈顶（开头）就是下一步重做 */
  future: Workspace[]
}

export const emptyHistory: History = { past: [], future: [] }

/** 只保留尾部 limit 个，丢弃最旧的（past 用：新的一步压在末尾） */
function capTail<T>(arr: T[], limit: number): T[] {
  return arr.length > limit ? arr.slice(arr.length - limit) : arr
}

/** 只保留头部 limit 个，丢弃最旧的（future 用：下一步在开头） */
function capHead<T>(arr: T[], limit: number): T[] {
  return arr.length > limit ? arr.slice(0, limit) : arr
}

export function canUndo(h: History): boolean {
  return h.past.length > 0
}

export function canRedo(h: History): boolean {
  return h.future.length > 0
}

/**
 * 记一次改动：把"改动前"的工作区压入 past，并丢弃 redo 分支
 * （分叉后再重做旧分支会得到自相矛盾的状态，所以任何新改动都清空 future）。
 *
 * 同一次用户动作可能在同一批次里触发多次改动（典型如"生成示例"先后改清单与配置），
 * 它们拿到的"改动前"是同一个引用 —— 此时不重复压栈，保证一次动作 = 一步撤销。
 */
export function pushHistory(h: History, before: Workspace, limit = HISTORY_LIMIT): History {
  const top = h.past[h.past.length - 1]
  if (top === before) return h.future.length === 0 ? h : { past: h.past, future: [] }
  return { past: capTail([...h.past, before], limit), future: [] }
}

/** 撤回一步：当前状态存入 future，返回上一步；已在最早一步时返回 null */
export function undoHistory(
  h: History,
  current: Workspace,
  limit = HISTORY_LIMIT,
): { workspace: Workspace; history: History } | null {
  if (h.past.length === 0) return null
  return {
    workspace: h.past[h.past.length - 1],
    history: {
      past: h.past.slice(0, -1),
      future: capHead([current, ...h.future], limit),
    },
  }
}

/** 重做一步：与 undoHistory 对称 */
export function redoHistory(
  h: History,
  current: Workspace,
  limit = HISTORY_LIMIT,
): { workspace: Workspace; history: History } | null {
  if (h.future.length === 0) return null
  return {
    workspace: h.future[0],
    history: {
      past: capTail([...h.past, current], limit),
      future: h.future.slice(1),
    },
  }
}
