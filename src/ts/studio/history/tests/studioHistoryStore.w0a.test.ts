// Whole-record refusal through the store with edits that keep every entry's length (a length change would be caught
// by the index check before the parser ran), the toggle path through a real save and load, and the owner cap
// against the restore entry the new restore paths enlarge.
import { describe, expect, test } from 'vitest'
import { OWNER_CAP_BYTES, asideMarkKey, deletedPart, entryKey, headerKey, ownerCapFor, stepPart, storedSizeOf } from '../studioHistoryStore'
import type { OwnerRecord, RestorePath, RestorePoint, SetPath, Step } from '../historyModel'
import { characterOwnerKey, type OwnerKey } from '../ownerPhase'
import { createMemoryStudioStore, seedOwner, storedRecord, walkOracle } from './studioStoreDoubles'

const CHARACTER = characterOwnerKey('c1')

function setStep(id: string, path: SetPath, before: string, after: string): Step {
    return {
        id,
        at: 1,
        label: { kind: 'field', field: path },
        ops: [{ op: 'set', path, before: { had: true, value: before }, after: { had: true, value: after } }],
    }
}

function recordOf(done: Step[], restore: RestorePoint | null = null): OwnerRecord {
    return { ownerKey: CHARACTER, touchedAt: 4, done, undone: [], deleted: [], restore }
}

function restoreHolding(paths: readonly RestorePath[], length: number): RestorePoint {
    const fields: RestorePoint['fields'] = {}
    for (const path of paths) {
        fields[path] = { before: { had: true, value: 'b'.repeat(length) }, last: { had: true, value: 'l'.repeat(length) } }
    }
    return { visitId: 'v1', at: 2, fields }
}

describe('a toggle step and restore key survive a real save and load', () => {
    test('A1: a record with a set customModuleToggle step, its restore key and every other new path reloads equal', async () => {
        const record = recordOf(
            [
                setStep('p:1', 'firstMessage', 'a', 'b'),
                setStep('p:2', 'exampleMessage', 'c', 'd'),
                setStep('p:3', 'customModuleToggle', 'e', 'f'),
                {
                    id: 'p:4',
                    at: 2,
                    label: { kind: 'field', field: 'customModuleToggle' },
                    ops: [{ op: 'set', path: 'customModuleToggle', before: { had: true, value: 'f' }, after: { had: false } }],
                },
            ],
            restoreHolding(['desc', 'firstMessage', 'exampleMessage', 'customModuleToggle'], 3),
        )
        const store = createMemoryStudioStore()
        await store.load(CHARACTER)
        expect(await store.save(CHARACTER, record, new Set([CHARACTER]))).toMatchObject({ kind: 'ok' })
        expect(await createMemoryStudioStore({ shared: store.shared }).load(CHARACTER)).toEqual({ kind: 'ok', record })
    })
})

describe('WR1: a record outside the closed union is refused whole by a same-length edit of one entry', () => {
    // One entry of a stored five-step record, edited as JSON text without changing its length.
    function seeded(edit: (text: string) => string, part = stepPart('p:3')): Map<string, string> {
        const done = [1, 2, 3, 4, 5].map((n) => setStep(`p:${n}`, 'desc', `a${n}`, `b${n}`))
        const shared = new Map<string, string>()
        seedOwner(shared, recordOf(done, restoreHolding(['desc'], 2)), 'w:1')
        const gen = storedRecord(shared, CHARACTER)?.header.gen as string
        const key = entryKey(CHARACTER, gen, part)
        const text = shared.get(key) as string
        const edited = edit(text)
        expect(edited).not.toBe(text)
        expect(edited.length).toBe(text.length)
        shared.set(key, edited)
        return shared
    }

    function replacing(from: string, to: string): (text: string) => string {
        return (text) => {
            expect(text).toContain(from)
            return text.replace(from, to)
        }
    }

    const edits = {
        'a set path outside the union': () => seeded(replacing('"path":"desc"', '"path":"abcd"')),
        'an unknown label kind': () => seeded(replacing('"kind":"field"', '"kind":"zzzzz"')),
        'an unknown op kind (MW1)': () => seeded(replacing('"op":"set"', '"op":"sxx"')),
        'an unknown restore key': () => seeded(replacing('"desc":{', '"abcd":{'), 'r'),
        'an entry that is not valid JSON (MW2)': () => seeded((text) => `${text.slice(0, -1)} `),
        'an entry of the wrong kind (MW2)': () => seeded(replacing('"k":"s"', '"k":"d"')),
    }

    test.each(Object.keys(edits))('%s: the owner reads unreadable, never with fewer steps', async (name) => {
        const shared = edits[name as keyof typeof edits]()
        expect(storedRecord(shared, CHARACTER)).toBeNull()
        expect(await createMemoryStudioStore({ shared }).load(CHARACTER)).toEqual({ kind: 'unreadable' })
    })

    test.each(Object.keys(edits))('after %s one save keeps the stored header aside and every original entry byte-equal', async (name) => {
        const shared = edits[name as keyof typeof edits]()
        const headerText = shared.get(headerKey(CHARACTER)) as string
        const originals = [...shared].filter(([key]) => key.startsWith('e:'))
        const store = createMemoryStudioStore({ shared })
        expect(await store.load(CHARACTER)).toEqual({ kind: 'unreadable' })
        const mine = recordOf([setStep('p:9', 'desc', 'x', 'y')])
        expect(await store.save(CHARACTER, mine, new Set([CHARACTER]))).toMatchObject({ kind: 'ok', asided: true })
        expect(shared.get(asideMarkKey(CHARACTER))).toBe(headerText)
        for (const [key, value] of originals) {
            expect(shared.get(key), key).toBe(value)
        }
        expect(await createMemoryStudioStore({ shared }).load(CHARACTER)).toEqual({ kind: 'ok', record: mine })
    })
})

describe('WR1: an unreadable undone step or deleted item refuses the whole record', () => {
    // Every list of the record holds an entry, so an edit to an undone or a deleted entry is the only damage.
    function seededLists(part: string, edit: (text: string) => string): Map<string, string> {
        const record: OwnerRecord = {
            ownerKey: CHARACTER,
            touchedAt: 4,
            done: [setStep('p:1', 'desc', 'a1', 'b1'), setStep('p:2', 'desc', 'a2', 'b2')],
            undone: [setStep('p:3', 'desc', 'a3', 'b3'), setStep('p:4', 'desc', 'a4', 'b4')],
            deleted: [{ id: 'x:1', at: 3, index: 10, value: 'v', sideChat: null }],
            restore: null,
        }
        const shared = new Map<string, string>()
        seedOwner(shared, record, 'w:1')
        expect(storedRecord(shared, CHARACTER)?.record).toEqual(record)
        const gen = storedRecord(shared, CHARACTER)?.header.gen as string
        const key = entryKey(CHARACTER, gen, part)
        const text = shared.get(key) as string
        const edited = edit(text)
        expect(edited).not.toBe(text)
        expect(edited.length).toBe(text.length)
        shared.set(key, edited)
        return shared
    }

    const edits = {
        'an undone step with an unknown op kind': () => seededLists(stepPart('p:4'), (text) => text.replace('"op":"set"', '"op":"sxx"')),
        'an undone step with a set path outside the union': () => seededLists(stepPart('p:3'), (text) => text.replace('"path":"desc"', '"path":"abcd"')),
        'a deleted item with an index that is not a position': () => seededLists(deletedPart('x:1'), (text) => text.replace('"index":10', '"index":-1')),
    }

    test.each(Object.keys(edits))('%s: the owner reads unreadable, never with fewer undone steps or deleted items', async (name) => {
        const shared = edits[name as keyof typeof edits]()
        expect(storedRecord(shared, CHARACTER)).toBeNull()
        expect(await createMemoryStudioStore({ shared }).load(CHARACTER)).toEqual({ kind: 'unreadable' })
    })

    test.each(Object.keys(edits))('after %s one save keeps the stored header aside and every original entry byte-equal', async (name) => {
        const shared = edits[name as keyof typeof edits]()
        const headerText = shared.get(headerKey(CHARACTER)) as string
        const originals = [...shared].filter(([key]) => key.startsWith('e:'))
        const store = createMemoryStudioStore({ shared })
        expect(await store.load(CHARACTER)).toEqual({ kind: 'unreadable' })
        const mine = recordOf([setStep('p:9', 'desc', 'x', 'y')])
        expect(await store.save(CHARACTER, mine, new Set([CHARACTER]))).toMatchObject({ kind: 'ok', asided: true })
        expect(shared.get(asideMarkKey(CHARACTER))).toBe(headerText)
        for (const [key, value] of originals) {
            expect(shared.get(key), key).toBe(value)
        }
        expect(await createMemoryStudioStore({ shared }).load(CHARACTER)).toEqual({ kind: 'ok', record: mine })
    })
})

describe('the owner cap against the restore entry', () => {
    const CAP_BYTES = 20000
    const OWNER_CAP = ownerCapFor(CAP_BYTES)

    function twentySteps(): Step[] {
        return Array.from({ length: 20 }, (_, at) => setStep(`p:${at + 1}`, 'desc', `a${at}`, `b${at}`))
    }

    async function saveAndReload(record: OwnerRecord, capBytes: number): Promise<{ saved: unknown; loaded: unknown }> {
        const store = createMemoryStudioStore({ capBytes })
        await store.load(CHARACTER)
        const saved = await store.save(CHARACTER, record, new Set<OwnerKey>([CHARACTER]))
        const loaded = await createMemoryStudioStore({ shared: store.shared, capBytes }).load(CHARACTER)
        return { saved, loaded }
    }

    test('T1s: a restore entry alone over the owner cap stores no step and no restore point, and says trimmed', async () => {
        const record = recordOf(twentySteps(), restoreHolding(['desc'], 3000))
        const oracle = walkOracle(record, OWNER_CAP)
        expect(oracle.done).toEqual([])
        expect(oracle.restore).toBeNull()
        const { saved, loaded } = await saveAndReload(record, CAP_BYTES)
        expect(saved).toMatchObject({ kind: 'ok', trimmed: true })
        expect(loaded).toEqual({ kind: 'ok', record: oracle })
    })

    test('T1s: a restore entry just under the cap keeps itself and the newest steps, and drops the oldest', async () => {
        const record = recordOf(twentySteps(), restoreHolding(['desc'], 1500))
        const oracle = walkOracle(record, OWNER_CAP)
        expect(oracle.restore).toEqual(record.restore)
        expect(oracle.done.length).toBeGreaterThan(0)
        expect(oracle.done.length).toBeLessThan(20)
        expect(oracle.done.at(-1)?.id).toBe('p:20')
        const { saved, loaded } = await saveAndReload(record, CAP_BYTES)
        expect(saved).toMatchObject({ kind: 'ok', trimmed: true })
        expect(loaded).toEqual({ kind: 'ok', record: oracle })
    })

    test('T1s: a record whose counted size equals the owner cap exactly is kept whole, and one counted byte less trims the oldest step', async () => {
        const record = recordOf(twentySteps().slice(0, 4), restoreHolding(['desc'], 5))
        const exact = storedSizeOf(record, CHARACTER, Infinity)
        // ownerCapFor halves the byte cap, so twice the size yields an owner cap equal to the size.
        expect(ownerCapFor(2 * exact)).toBe(exact)
        const kept = await saveAndReload(record, 2 * exact)
        expect(kept.saved).toMatchObject({ kind: 'ok', trimmed: false })
        expect(kept.loaded).toEqual({ kind: 'ok', record })

        const tight = await saveAndReload(record, 2 * (exact - 1))
        expect(tight.saved).toMatchObject({ kind: 'ok', trimmed: true })
        expect(tight.loaded).toEqual({ kind: 'ok', record: walkOracle(record, exact - 1) })
        expect(walkOracle(record, exact - 1).done.length).toBe(3)
    })

    test('T-1s: a restore point holding the four new text paths over the real owner cap stores nothing, and just under it stores everything', async () => {
        const paths: RestorePath[] = ['desc', 'firstMessage', 'exampleMessage', 'customModuleToggle']
        const steps = [setStep('p:1', 'firstMessage', 'a', 'b'), setStep('p:2', 'exampleMessage', 'c', 'd')]
        const over = recordOf(steps, restoreHolding(paths, 140000))
        const overStore = createMemoryStudioStore()
        await overStore.load(CHARACTER)
        expect(await overStore.save(CHARACTER, over, new Set<OwnerKey>([CHARACTER]))).toMatchObject({ kind: 'ok', trimmed: true })
        expect(storedRecord(overStore.shared, CHARACTER)?.record).toEqual(walkOracle(over, OWNER_CAP_BYTES))
        expect(storedRecord(overStore.shared, CHARACTER)?.record.done).toEqual([])
        expect(storedRecord(overStore.shared, CHARACTER)?.record.restore).toBeNull()

        const under = recordOf(steps, restoreHolding(paths, 100000))
        const underStore = createMemoryStudioStore()
        await underStore.load(CHARACTER)
        expect(await underStore.save(CHARACTER, under, new Set<OwnerKey>([CHARACTER]))).toMatchObject({ kind: 'ok', trimmed: false })
        expect(storedRecord(underStore.shared, CHARACTER)?.record).toEqual(under)
    })
})
