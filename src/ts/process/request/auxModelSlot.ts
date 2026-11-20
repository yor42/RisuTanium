import type { Database } from '../../storage/database.svelte'

const AUX_SLOT_KEYS: ReadonlySet<string> = new Set(['memory', 'emotion', 'translate', 'otherAx'])

/**
 * The model chosen for an auxiliary mode, or '' when that mode has no slot or its slot is empty. Only the four
 * auxiliary modes have a slot; the chat model and the sub model are never routed through one. The saved
 * `seperateModelsForAxModels` flag is retired and takes no part in this decision. A profile may have no slot
 * object at all, which reads as every slot empty.
 */
export function auxSlotModel(seperateModels: Database['seperateModels'] | null | undefined, mode: string): string {
    if (!AUX_SLOT_KEYS.has(mode)) return ''
    const stored: unknown = seperateModels?.[mode as keyof Database['seperateModels']]
    return typeof stored === 'string' ? stored : ''
}
