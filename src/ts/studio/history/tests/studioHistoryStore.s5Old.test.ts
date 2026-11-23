// T5-OLD: the previous build reads none of a module record that holds a new path or a foreign value, so it refuses the
// record whole and its store sets the newer bytes aside untouched (MC-1827: a refused-whole widening keeps the version).
// The previous build is the real reader over a frozen copy of its registry (the eighteen paths of the build before S5),
// loaded as a second module graph; the record is written by this build's real writer.
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Step } from '../historyModel'
import { moduleOwnerKey, type StoredOwnerKey } from '../ownerPhase'
import type { StoredOwnerRecord } from '../studioHistoryStore'
import { seedOwner, storedRecord } from './studioStoreDoubles'

const PREVIOUS_PATHS: readonly string[] = [
    'desc', 'firstMessage', 'exampleMessage', 'customModuleToggle', 'hideChatIcon', 'risutanium_render_when_complete', 'note', 'systemPrompt',
    'replaceGlobalNote', 'additionalText', 'personality', 'scenario', 'depth_prompt.prompt', 'additionalData.creator',
    'additionalData.character_version', 'nickname', 'defaultVariables', 'translatorNote',
]

interface PreviousBuild {
    createMemoryStudioStore: typeof import('./studioStoreDoubles').createMemoryStudioStore
    asideMarkKey: typeof import('../studioHistoryStore').asideMarkKey
}

async function previousBuild(): Promise<PreviousBuild> {
    vi.resetModules()
    vi.doMock('../fieldRegistry', async () => {
        const actual = await vi.importActual<typeof import('../fieldRegistry')>('../fieldRegistry')
        const keep = (table: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(table).filter(([path]) => PREVIOUS_PATHS.includes(path)))
        return { ...actual, FIELD_SPECS: keep(actual.FIELD_SPECS), FIELD_PRESENTATION: keep(actual.FIELD_PRESENTATION) }
    })
    const doubles = await import('./studioStoreDoubles')
    const store = await import('../studioHistoryStore')
    return { createMemoryStudioStore: doubles.createMemoryStudioStore, asideMarkKey: store.asideMarkKey }
}

afterEach(() => {
    vi.doUnmock('../fieldRegistry')
    vi.resetModules()
})

const OWNER: StoredOwnerKey = moduleOwnerKey('m1')

function recordOf(step: Step): StoredOwnerRecord {
    return { ownerKey: OWNER, touchedAt: 4, done: [step], undone: [], deleted: [], restore: null }
}

const namespaceStep: Step = {
    id: 'p:1',
    at: 1,
    label: { kind: 'field', field: 'moduleNamespace' },
    ops: [{ op: 'set', path: 'moduleNamespace', before: { had: false }, after: { had: true, value: 'ns' } }],
}
const foreignStep: Step = {
    id: 'p:1',
    at: 1,
    label: { kind: 'field', field: 'moduleLowLevelAccess' },
    ops: [{ op: 'set', path: 'moduleLowLevelAccess', before: { had: 'foreign', value: 1 }, after: { had: true, value: false } }],
}
const toggleStep: Step = {
    id: 'p:1',
    at: 1,
    label: { kind: 'field', field: 'customModuleToggle' },
    ops: [{ op: 'set', path: 'customModuleToggle', before: { had: false }, after: { had: true, value: 'a=A' } }],
}

describe('T5-OLD: a record of this build that the previous build cannot read', () => {
    test.each([
        ['a set of a new path', namespaceStep],
        ['a foreign value', foreignStep],
    ])('%s: the previous build refuses it whole and sets the newer bytes aside', async (_name, step) => {
        const record = recordOf(step)
        const shared = new Map<string, string>()
        seedOwner(shared, record, 'w:1')
        // This build reads what it wrote.
        expect(storedRecord(shared, OWNER)?.record).toEqual(record)
        const written = new Map(shared)

        const previous = await previousBuild()
        const store = previous.createMemoryStudioStore({ shared })
        expect(await store.load(OWNER)).toEqual({ kind: 'unreadable' })
        expect(shared).toEqual(written)

        // Its own save sets the newer header aside and writes nothing over the newer entries.
        const header = [...written].find(([key]) => key.endsWith(OWNER) && !key.includes('aside'))
        expect(header).toBeDefined()
        const own = recordOf(toggleStep)
        expect(await store.save(OWNER, own, new Set([OWNER]))).toEqual({ kind: 'ok', asided: true, trimmed: false })
        expect(shared.get(previous.asideMarkKey(OWNER))).toBe(written.get(header?.[0] as string))
        for (const [key, value] of written) {
            if (key !== header?.[0]) {
                expect(shared.get(key), key).toBe(value)
            }
        }
    })

    test('control: a record of old paths only reads for the previous build', async () => {
        const record = recordOf(toggleStep)
        const shared = new Map<string, string>()
        seedOwner(shared, record, 'w:1')
        const previous = await previousBuild()
        expect(await previous.createMemoryStudioStore({ shared }).load(OWNER)).toEqual({ kind: 'ok', record })
    })
})
