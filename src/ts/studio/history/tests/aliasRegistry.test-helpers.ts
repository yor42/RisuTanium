// Shared by the restore-slot tests: the real risky-flag fix rows (`lowLevelAccessFix` over `lowLevelAccess`, and so on, and `biasFix` over `bias`)
// are the aliases of the real registry; `withAliasRows` adds one synthetic alias row over `hideChatIcon`, a holder
// property no real row aliases, so a test can show the slot mechanism over a group the real registry does not hold.
// A `vi.mock` of the registry calls `withAliasRows` through a dynamic import, because a mock factory is hoisted above
// the static imports of its file. The model fixtures follow.

import type { FieldFacts, FieldPresentation } from '../fieldRegistry'
import type { FieldValue, LiveReader, OwnerRecord, SetPath, Step, WriteOp } from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'
import { SESSION_OWNER_KINDS } from '../sessionKinds'

export const FIX = 'lowLevelAccessFix' as string as SetPath
export const BASE = 'lowLevelAccess' as string as SetPath
export const UTILITY_FIX = 'utilityBotFix' as string as SetPath

export const SYNTH_BASE = 'hideChatIcon' as string as SetPath
export const SYNTH_ALIAS = 'hideChatIconAlias' as string as SetPath

export const ALIAS_FACTS: Record<string, FieldFacts> = {
    hideChatIconAlias: { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true, property: 'hideChatIcon', keepForeign: true },
}

const ALIAS_PRESENTATION: Record<string, FieldPresentation> = {
    hideChatIconAlias: { labelKey: 'hideChatIcon', focus: { form: 'studio-display-form', part: 'studio-display-hide-icon' } },
}

export function withAliasRows(
    original: typeof import('../fieldRegistry'),
    facts: Record<string, FieldFacts> = ALIAS_FACTS,
): typeof import('../fieldRegistry') {
    const specs: Record<string, FieldFacts> = { ...original.FIELD_SPECS, ...facts }
    const presentation: Record<string, FieldPresentation> = { ...original.FIELD_PRESENTATION, ...ALIAS_PRESENTATION }
    return {
        ...original,
        FIELD_SPECS: specs as typeof original.FIELD_SPECS,
        FIELD_PRESENTATION: presentation as typeof original.FIELD_PRESENTATION,
    }
}

export const B = (value: boolean): FieldValue => ({ had: true, value })
// What the real reader returns for a stored `1` on a `keepForeign` row.
export const FOREIGN_ONE = { had: 'foreign', value: 1 } as FieldValue

// A reader over one plain holder: `desc` text and the `lowLevelAccess` property. A non-boolean present value reads as
// foreign through a `keepForeign` path (the slot) and as absent through the base row, which has no `keepForeign`.
export function readerOf(holder: Record<string, unknown>): LiveReader {
    return {
        field(path) {
            if (path === 'desc') {
                return { had: true, value: String(holder.desc ?? '') }
            }
            const value = holder.lowLevelAccess
            if (typeof value === 'boolean') {
                return { had: true, value }
            }
            if (value === undefined) {
                return { had: false }
            }
            return path === FIX ? FOREIGN_ONE : { had: false }
        },
        greetings: () => [],
        fmIndex: () => null,
    }
}

export function applyWrites(holder: Record<string, unknown>, writes: readonly WriteOp[]): void {
    for (const write of writes) {
        if (write.op !== 'set') {
            continue
        }
        const key = write.path === 'desc' ? 'desc' : 'lowLevelAccess'
        if (write.value.had === false) {
            delete holder[key]
        } else {
            holder[key] = (write.value as { value: unknown }).value
        }
    }
}

export function setStep(id: string, path: SetPath, before: FieldValue, after: FieldValue): Step {
    return { id, at: 1, label: { kind: 'field', field: path }, ops: [{ op: 'set', path, before, after }] }
}

// The paths of the registry that share one holder property, in registry order, per (holder, property). Groups of one
// are not aliases.
export async function aliasGroups(): Promise<SetPath[][]> {
    const { factsOf, propertyOf, registryPaths } = await import('../fieldAccess')
    const groups = new Map<string, SetPath[]>()
    for (const path of registryPaths()) {
        for (const holder of factsOf(path).holders) {
            const key = holder + '\u0000' + propertyOf(path)
            groups.set(key, [...(groups.get(key) ?? []), path])
        }
    }
    return [...groups.values()].filter((members) => members.length > 1)
}

// The alias rule written out of the registry facts alone: the later row of a group is the slot and accepts every reading
// of the earlier rows. Returns one line per violation; empty when the rule holds.
export async function aliasRuleViolations(): Promise<string[]> {
    const { factsOf } = await import('../fieldAccess')
    const out: string[] = []
    for (const members of await aliasGroups()) {
        const last = members[members.length - 1]
        const slot = factsOf(last)
        for (const member of members) {
            const facts = factsOf(member)
            if (JSON.stringify(facts.holders) !== JSON.stringify(slot.holders)) {
                out.push(`${member}: holders differ from ${last}`)
            }
            if (facts.value !== slot.value) {
                out.push(`${member}: value differs from ${last}`)
            }
            if (facts.keepForeign === true && slot.keepForeign !== true) {
                out.push(`${member}: keepForeign not on ${last}`)
            }
            if (facts.editWhenAbsent && !slot.editWhenAbsent) {
                out.push(`${member}: editWhenAbsent not on ${last}`)
            }
            if (facts.editWhenAbsent && facts.absent !== slot.absent) {
                out.push(`${member}: absent differs from ${last}`)
            }
            for (const [kind, spec] of Object.entries(SESSION_OWNER_KINDS)) {
                const listed: readonly SetPath[] = spec.setPaths
                if (listed.includes(member) && !listed.includes(last)) {
                    out.push(`${kind}: lists ${member} but not ${last}`)
                }
            }
        }
    }
    return out
}

export const descStep =(): Step => setStep('s0', 'desc', { had: true, value: 'a' }, { had: true, value: 'b' })

export function recordOf(done: Step[], undone: Step[] = []): OwnerRecord {
    return { ownerKey: characterOwnerKey('c1'), touchedAt: 1, done, undone, deleted: [], restore: null }
}
