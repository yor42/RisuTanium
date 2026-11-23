// @vitest-environment jsdom
// T-D1 and T-D2, diagnostics: one registry entry adds a field end to end. The data module is replaced by itself plus
// three probe entries, while the helpers (fieldAccess.ts), the derived tables, the strict reader, the setters and the
// service are the real ones, so these tests execute the real `propertyOf` and `fieldLabelKey` bodies against the probes.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { Chat, character } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { applyCharacterDefaults } from 'src/ts/storage/characterDefaults'
import { applyCharacterWrites, applyChatWrites, buildWrittenModule, createLiveReader, createModuleLiveReader } from 'src/ts/studio/edit/studioSetters'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { fieldLabelKey, propertyOf } from '../fieldAccess'
import type { SetPath } from '../fieldRegistry'
import { RESTORE_PATH_ORDER, type FieldValue, type OwnerRecord, type RestorePoint, type Step, type WriteOp } from '../historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, chatOwnerKey, moduleOwnerKey, type OwnerKey } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, seedOwner, storedRecord } from './studioStoreDoubles'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})
vi.mock('../fieldRegistry', async (importOriginal) => {
    const original = await importOriginal<typeof import('../fieldRegistry')>()
    return {
        ...original,
        FIELD_SPECS: {
            ...original.FIELD_SPECS,
            probeText: { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true },
            sessionOnly: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
            aliasProbe: { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true, property: 'probeAliasTarget' },
        },
        FIELD_PRESENTATION: {
            ...original.FIELD_PRESENTATION,
            probeText: { labelKey: 'nickname', focus: null },
            sessionOnly: { labelKey: 'nickname', focus: null },
            aliasProbe: { labelKey: 'nickname', focus: null },
        },
    }
})

const NICKNAME = 'probeText' as SetPath
const SESSION_ONLY = 'sessionOnly' as SetPath
const ALIAS = 'aliasProbe' as SetPath

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

const live = (): Record<string, unknown> => (DBState.db.characters as unknown as Record<string, unknown>[])[0]

interface Harness {
    clock: FakeClock
    service: OwnerHistoryService
}

function build(): Harness {
    const clock = createFakeClock(1000)
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore({ pageSession: 'p1' }),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
    })
    return { clock, service }
}

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    DBState.db.characters = [
        { chaId: 'A', name: 'A', desc: 'd0', firstMessage: 'f0', exampleMessage: 'e0', alternateGreetings: [], chats: [], chatPage: 0 },
    ] as unknown as typeof DBState.db.characters
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

function nicknameStep(id: string, before: FieldValue, after: FieldValue): Step {
    return { id, at: 1, label: { kind: 'field', field: NICKNAME }, ops: [{ op: 'set', path: NICKNAME, before, after }] }
}

function nicknameRestore(): RestorePoint {
    return { visitId: 'v1', at: 2, fields: { [NICKNAME]: { before: { had: false }, last: { had: true, value: 'x' } } } }
}

function recordOf(ownerKey: OwnerKey, done: Step[], restore: RestorePoint | null = null): OwnerRecord {
    return { ownerKey, touchedAt: 4, done, undone: [], deleted: [], restore }
}

function readBack(record: OwnerRecord): OwnerRecord | null {
    const shared = new Map<string, string>()
    seedOwner(shared, record, 'w:1')
    return storedRecord(shared, record.ownerKey)?.record ?? null
}

describe('T-D1: one registry entry adds a field end to end', () => {
    test('(a) a character record with a nickname set op, label and restore key reads back equal', () => {
        const record = recordOf(A, [nicknameStep('p:1', { had: false }, { had: true, value: 'x' })], nicknameRestore())
        expect(readBack(record)).toEqual(record)
    })

    test('(b) a chat or module record whose set op or restore key names nickname is refused whole; a label alone still reads', () => {
        const chat = chatOwnerKey('A', 'c1')
        const module = moduleOwnerKey('M1')
        for (const key of [chat, module]) {
            expect(readBack(recordOf(key, [nicknameStep('p:1', { had: false }, { had: true, value: 'x' })])), `set op ${key}`).toBeNull()
            expect(readBack(recordOf(key, [], nicknameRestore())), `restore ${key}`).toBeNull()
        }
        const labelOnly: Step = {
            id: 'p:1',
            at: 1,
            label: { kind: 'field', field: NICKNAME },
            ops: [{ op: 'set', path: 'note', before: { had: false }, after: { had: true, value: 'n' } }],
        }
        expect(readBack(recordOf(chat, [labelOnly]))).not.toBeNull()
    })

    test('(c) an edit lands on the live character, undo deletes the key, the restore point holds it and the order places it before the list', async () => {
        const { service } = build()
        await service.whenReady(A)
        expect(service.editText(A, NICKNAME, 'x', 'single')).toEqual({ ok: true })
        expect(live().probeText).toBe('x')
        expect(service.view(A).restore?.fields[NICKNAME]).toEqual({ before: { had: false }, last: { had: true, value: 'x' } })
        expect(service.undo(A).ok).toBe(true)
        expect('probeText' in live()).toBe(false)
        expect(RESTORE_PATH_ORDER.indexOf(NICKNAME)).toBeGreaterThan(RESTORE_PATH_ORDER.indexOf('note'))
        expect(RESTORE_PATH_ORDER.indexOf(NICKNAME)).toBe(RESTORE_PATH_ORDER.indexOf('alternateGreetings') - 3)
    })

    test('(d) the label key comes from the presentation entry by the real accessor', () => {
        expect(fieldLabelKey(NICKNAME)).toBe('nickname')
    })

    test('(e) a path with no holder reads absent and is written by no holder', () => {
        const character = applyCharacterDefaults({ chaId: 'A', sessionOnly: 'v' } as unknown as character) as character
        const chat = { note: 'n', sessionOnly: 'v' } as unknown as Chat
        const module = { id: 'M1', name: 'M1', assets: [], sessionOnly: 'v' } as unknown as RisuModule
        expect(createLiveReader({ character, chat }).field(SESSION_ONLY)).toEqual({ had: false })
        expect(createModuleLiveReader(module).field(SESSION_ONLY)).toEqual({ had: false })
        const writes: WriteOp[] = [{ op: 'set', path: SESSION_ONLY, value: { had: true, value: 'changed' } }]
        applyCharacterWrites(character, writes, null)
        applyChatWrites(chat, writes)
        const copy = buildWrittenModule(module, writes, { folder: { kind: 'keep' }, retained: null })
        expect((character as unknown as Record<string, unknown>).sessionOnly).toBe('v')
        expect((chat as unknown as Record<string, unknown>).sessionOnly).toBe('v')
        expect((copy as unknown as Record<string, unknown>).sessionOnly).toBe('v')
    })
})

describe('T-D2: a path reads and writes its holder property, not its own name', () => {
    test('the accessor returns the property', () => {
        expect(propertyOf(ALIAS)).toBe('probeAliasTarget')
        expect(propertyOf(NICKNAME)).toBe('probeText')
        expect(propertyOf('desc')).toBe('desc')
    })

    test('an edit of the aliased path sets the property, leaves no key of the path name, and undo deletes the property', async () => {
        const { service } = build()
        await service.whenReady(A)
        expect(service.editText(A, ALIAS, 'x', 'single')).toEqual({ ok: true })
        expect(live().probeAliasTarget).toBe('x')
        expect('aliasProbe' in live()).toBe(false)
        expect(createLiveReader({ character: live() as unknown as character, chat: null }).field(ALIAS)).toEqual({ had: true, value: 'x' })
        expect(service.undo(A).ok).toBe(true)
        expect('probeAliasTarget' in live()).toBe(false)
        expect('aliasProbe' in live()).toBe(false)
    })
})
