// How the scripts of one owner are written. Pure: reads only the first effect of the first trigger, the same
// place the classic trigger editor looks.

export type ScriptMode = 'lua' | 'v2' | 'v1' | 'empty'

export interface ScriptListEntry {
    effect?: readonly { type?: string }[]
}

/**
 * `triggerlua` and `triggercode` both run as Lua in the engine, so both read as `lua`. `v2Header` is the V2 rule
 * list. Any other first effect is a V1 trigger list. A missing or empty list is `empty`, never V1.
 */
export function scriptModeOf(list: readonly ScriptListEntry[] | undefined | null): ScriptMode {
    if (!list || list.length === 0) return 'empty'
    const type = list[0]?.effect?.[0]?.type
    if (type === 'triggerlua' || type === 'triggercode') return 'lua'
    if (type === 'v2Header') return 'v2'
    return 'v1'
}
