// The combined toggles view: the value rows of every source, one list per source, with the keys that more than one
// source defines marked. Pure. Each source is read on its own (MC-1745): the only fact that crosses sources is which
// other owners hold the same key, and a group left open names only its own source.
import type { OwnerTag } from './ownerModel'
import { parseDefinition, type Definition, type LineId, type ValueKind } from './toggleDef'

export type CombinedSourceInput = {
    readonly ownerKey: string
    readonly name: string
    readonly tags: readonly OwnerTag[]
    /** Null: the text cannot be shown (a stub or a private owner). */
    readonly text: string | null
}

export type CombinedEntry = {
    /** Index in `parseDefinition(text).lines` of the value row. */
    readonly line: number
    readonly key: string
    readonly label: string
    readonly valueKind: ValueKind
    /** Label of the group that holds the row, else null. */
    readonly group: string | null
    /** Names of the other owners that define the same key, exactly spelled. */
    readonly shared: readonly string[]
}

export type CombinedSource = {
    readonly ownerKey: string
    readonly name: string
    readonly tags: readonly OwnerTag[]
    readonly entries: readonly CombinedEntry[]
    readonly unreadable: number
    /** This source's own text ends inside a group. */
    readonly unclosedGroup: boolean
}

export type ToggleCombined = {
    readonly active: readonly CombinedSource[]
    readonly off: readonly CombinedSource[]
    /** Active sources whose text cannot be shown; off ones are not counted. */
    readonly unshown: number
}

type ReadSource = {
    readonly input: CombinedSourceInput
    readonly def: Definition
    readonly keys: ReadonlySet<string>
}

function readSource(input: CombinedSourceInput, text: string): ReadSource {
    const def = parseDefinition(text)
    const keys = new Set<string>()
    for (const line of def.lines) {
        if (line.form.kind === 'value') {
            keys.add(line.parts[0])
        }
    }
    return { input, def, keys }
}

/**
 * `active` in the merged view's toggles order and `off` in model order; the caller passes owners that cannot be read
 * with `text: null`. `appOwners` maps a key to the names of the app's other owners that define it.
 */
export function buildToggleCombined(
    active: readonly CombinedSourceInput[],
    off: readonly CombinedSourceInput[],
    appOwners: ReadonlyMap<string, readonly string[]>,
): ToggleCombined {
    const readable = (inputs: readonly CombinedSourceInput[]): ReadSource[] => {
        const read: ReadSource[] = []
        for (const input of inputs) {
            if (input.text !== null) {
                read.push(readSource(input, input.text))
            }
        }
        return read
    }
    const activeRead = readable(active)
    const offRead = readable(off)
    const listed = [...activeRead, ...offRead]

    const sourceOf = (read: ReadSource): CombinedSource => {
        const { input, def } = read
        const byId = new Map<LineId, number>(def.lines.map((line, index) => [line.id, index]))
        const entries: CombinedEntry[] = []
        let unreadable = 0
        def.lines.forEach((line, index) => {
            if (line.form.kind === 'dropped') {
                unreadable++
                return
            }
            if (line.form.kind !== 'value') {
                return
            }
            const key = line.parts[0]
            const groupId = def.outline.parentOf.get(line.id)
            const groupLine = groupId === undefined ? undefined : def.lines[byId.get(groupId) ?? -1]
            const shared: string[] = []
            for (const other of listed) {
                if (other.input.ownerKey !== input.ownerKey && other.keys.has(key) && !shared.includes(other.input.name)) {
                    shared.push(other.input.name)
                }
            }
            for (const name of appOwners.get(key) ?? []) {
                if (!shared.includes(name)) {
                    shared.push(name)
                }
            }
            entries.push({
                line: index,
                key,
                label: line.parts[1],
                valueKind: line.form.valueKind,
                group: groupLine === undefined ? null : groupLine.parts[1] ?? groupLine.parts[0] ?? '',
                shared,
            })
        })
        return {
            ownerKey: input.ownerKey,
            name: input.name,
            tags: input.tags,
            entries,
            unreadable,
            unclosedGroup: def.outline.openAtEnd !== null,
        }
    }

    return {
        active: activeRead.map(sourceOf),
        off: offRead.map(sourceOf),
        unshown: active.filter((input) => input.text === null).length,
    }
}
