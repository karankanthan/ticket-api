// Approval Control Center selection rules, shared by the page and its tests.
import type { Priority, QueueItem } from '../api/types'
import { PRIORITIES, priorityMeta } from './meta'

export type Scope = 'all' | 'p1' | 'p1p2'

/** null = no priority filter: "All eligible" includes every queued ticket, whatever its priority. */
export const SCOPE_PRIORITIES: Record<Scope, Priority[] | null> = { all: null, p1: ['urgent'], p1p2: ['urgent', 'high'] }
export const SCOPE_LABEL: Record<Scope, string> = { all: 'All eligible priorities', p1: 'P1 only', p1p2: 'P1 + P2' }

export interface Preset {
  count: number
  scope: Scope
  ids: string[]
}

export function inScope(item: QueueItem, scope: Scope): boolean {
  const allowed = SCOPE_PRIORITIES[scope]
  return allowed === null || allowed.includes((item.ticket?.priority ?? '') as Priority)
}

/** Ids of the top `count` items in the scope. `items` must already be in ranking order. */
export function topN(items: QueueItem[], scope: Scope, count: number): string[] {
  return items.filter((i) => inScope(i, scope)).slice(0, count).map((i) => i.item_id)
}

export function isKnownPriority(priority: string | undefined): boolean {
  return PRIORITIES.includes((priority ?? '') as Priority)
}

/** Why an eligible ticket is not in the selection, or null when it is selected. */
export function exclusionReason(
  item: QueueItem,
  ctx: { scope: Scope; selected: Set<string>; matches: (item: QueueItem) => boolean; preset: Preset | null; items: QueueItem[] },
): string | null {
  if (ctx.selected.has(item.item_id)) return null
  if (!inScope(item, ctx.scope)) return `Not in ${SCOPE_LABEL[ctx.scope]} (${priorityMeta(item.ticket?.priority).label})`
  if (!ctx.matches(item)) return 'Hidden by the current search or category filter'
  const preset = ctx.preset && ctx.preset.scope === ctx.scope ? ctx.preset : null
  if (preset) {
    if (preset.ids.includes(item.item_id)) return 'Deselected manually'
    const ranked = ctx.items.filter((i) => inScope(i, ctx.scope))
    const position = ranked.findIndex((i) => i.item_id === item.item_id) + 1
    return `Outside the Top ${preset.count} (ranked #${position} of ${ranked.length})`
  }
  return 'Not selected'
}
