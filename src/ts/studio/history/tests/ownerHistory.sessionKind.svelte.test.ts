// @vitest-environment jsdom
// The session-kind seam through a probe kind. The data module sessionKinds.ts is replaced by itself plus one
// probe entry, and the probe's adapter is registered by writing into the exported adapter table; every helper
// body (key parsing, target resolution, the service) is the real one.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { liveReaderOf, resolveOwnerTarget } from 'src/ts/studio/edit/ownerTargets'
import { SESSION_OWNER_ADAPTERS, type SessionOwnerAdapter } from 'src/ts/studio/edit/sessionAdapters'
import { resolveLiveTarget, type SetterRefusal } from 'src/ts/studio/edit/studioSetters'
import { readOwnerFields } from 'src/ts/studio/ownerFields'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { isOpAllowedFor, parseOwnerRecord, type FieldValue, type OwnerRecord, type WriteOp } from '../historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { isStoredOwnerKey, parseOwnerKey, parseSessionOwnerKey, parseStoredOwnerKey, READY_DEADLINE_MS, SAVE_MAX_WAIT_MS, sessionOwnerKey, type OwnerKey } from '../ownerPhase'
import { isValidSessionKindName } from '../sessionKinds'
import { setStudioHistoryServiceForTests, beginOwnerVisit, historyBannerText, setStudioVisitAckForTests } from '../studioHistoryService.svelte'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type MemoryStudioStore } from './studioStoreDoubles'
import type { SaveAck } from 'src/ts/studio/edit/saveAck.svelte'
import type { ClaimResult } from '../studioHistoryStore'

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
vi.mock('../sessionKinds', async (importOriginal) => {
    const original = await importOriginal<typeof import('../sessionKinds')>()
    return {
        ...original,
        SESSION_OWNER_KINDS: { probe: { setPaths: ['customModuleToggle'] } },
    }
})

const PROBE = 'probe:x' as OwnerKey
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

interface Backing {
    value?: string
}

// The fake adapter resolves by id from a map and captures the backing object at resolve time (its reader holds
// the object it found then, never the map).
interface FakeAdapter extends SessionOwnerAdapter {
    backings: Map<string, Backing>
    resolves: string[]
    writes: { id: string; writes: readonly WriteOp[] }[]
    noted: number[]
    visits: string[]
    visitAck: SaveAck | null
}

function fakeAdapter(): FakeAdapter {
    const backings = new Map<string, Backing>()
    const adapter: FakeAdapter = {
        backings,
        resolves: [],
        writes: [],
        noted: [],
        visits: [],
        visitAck: null,
        resolve(id): ReturnType<SessionOwnerAdapter['resolve']> {
            adapter.resolves.push(id)
            const backing = backings.get(id)
            if (!backing) {
                return { ok: false, reason: 'gone' satisfies SetterRefusal }
            }
            return {
                ok: true,
                target: {
                    session: 'probe',
                    id,
                    reader: {
                        field: (path): FieldValue => (path === 'customModuleToggle' && typeof backing.value === 'string' ? { had: true, value: backing.value } : { had: false }),
                        greetings: () => null,
                        fmIndex: () => null,
                    },
                },
            }
        },
        write(id, writes) {
            adapter.writes.push({ id, writes })
            const backing = backings.get(id)
            if (!backing) {
                return false
            }
            for (const write of writes) {
                if (write.op === 'set' && write.path === 'customModuleToggle') {
                    if (write.value.had && typeof write.value.value === 'string') {
                        backing.value = write.value.value
                    } else {
                        delete backing.value
                    }
                }
            }
            return true
        },
        noteEdit(_id, marksBefore) {
            adapter.noted.push(marksBefore)
        },
        beginVisit(id) {
            adapter.visits.push(id)
            return adapter.visitAck
        },
    }
    return adapter
}

let adapter: FakeAdapter
let clock: FakeClock
let store: MemoryStudioStore
let claim: { tryClaim: ReturnType<typeof vi.fn<(subject: unknown) => Promise<ClaimResult>>> }
let service: OwnerHistoryService
let landed: number

const adapters = SESSION_OWNER_ADAPTERS as Record<string, SessionOwnerAdapter>

function build(): void {
    clock = createFakeClock(1000)
    store = createMemoryStudioStore({ pageSession: 'p1' })
    claim = { tryClaim: vi.fn(async (): Promise<ClaimResult> => 'granted') }
    landed = 0
    service = createOwnerHistoryService({
        store,
        claim,
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
        onLanded: () => {
            landed += 1
        },
    })
}

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    DBState.db.characters = [] as unknown as typeof DBState.db.characters
    selIdState.selId = 0
    adapter = fakeAdapter()
    adapter.backings.set('x', { value: 'a' })
    adapters.probe = adapter
    build()
})

afterEach(() => {
    delete adapters.probe
    setStudioHistoryServiceForTests(null)
    setStudioVisitAckForTests(null)
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('T-O1/T-O2: keys', () => {
    test('a registered session kind parses only through the session parser, with a non-empty id and own-property lookup', () => {
        expect(parseSessionOwnerKey('probe:x')).toEqual({ kind: 'probe', id: 'x' })
        expect(parseOwnerKey('probe:x')).toEqual({ kind: 'probe', id: 'x' })
        expect(parseSessionOwnerKey('probe:')).toBeNull()
        expect(parseSessionOwnerKey('toString:x')).toBeNull()
        expect(parseSessionOwnerKey('constructor:x')).toBeNull()
        expect(parseSessionOwnerKey('character:x')).toBeNull()
        expect(sessionOwnerKey('probe' as never, 'x')).toBe('probe:x')
    })

    test('a session key is never a stored key', () => {
        expect(isStoredOwnerKey('probe:x')).toBe(false)
        expect(parseStoredOwnerKey('probe:x')).toBeNull()
        expect(isStoredOwnerKey('character:x')).toBe(true)
    })

    test('kind names are validated', () => {
        for (const bad of ['character', 'chat', 'module', 'a:b', '']) {
            expect(isValidSessionKindName(bad), bad).toBe(false)
        }
        expect(isValidSessionKindName('preset')).toBe(true)
        expect(isValidSessionKindName('probe')).toBe(true)
    })
})

describe('T-K1: Rule K for a session kind', () => {
    test('only set on the kind\'s own row is allowed', () => {
        const set = (path: string) => ({ op: 'set', path, before: { had: false }, after: { had: false } }) as never
        expect(isOpAllowedFor('probe' as never, set('customModuleToggle'))).toBe(true)
        expect(isOpAllowedFor('probe' as never, set('desc'))).toBe(false)
        for (const op of ['listSet', 'listInsert', 'listRemove', 'chatFm', 'assetRowRemove', 'assetRowInsert', 'assetRowSet', 'assetFolderSet', 'assetFolderOrder', 'textEdit']) {
            expect(isOpAllowedFor('probe' as never, { op } as never), op).toBe(false)
        }
    })

    test('a session record is never read back from the store reader', () => {
        const record: OwnerRecord = { ownerKey: PROBE, touchedAt: 1, done: [], undone: [], deleted: [], restore: null }
        expect(parseOwnerRecord(JSON.parse(JSON.stringify(record)), PROBE as never)).toBeNull()
    })

    test('an asset intent on a session owner is refused before its build runs', () => {
        expect(service.assetDelete(PROBE, 'additionalAssets', [0])).toEqual({ ok: false, reason: 'unknown' })
    })
})

describe('T-S1: a session owner never touches the store', () => {
    function fixtures(characters: unknown[]): void {
        DBState.db.characters = characters as unknown as typeof DBState.db.characters
    }

    test.each([
        ['group first, private character holding the probe id', () => {
            const group = { type: 'group', name: 'g' } as Record<string, unknown>
            return [group, { chaId: 'x', license: 'private', name: 'p' }]
        }],
        ['null slot first', () => [null, { type: 'group', name: 'g' }, { chaId: 'x', license: 'private', name: 'p' }]],
    ])('%s', async (_name, characters) => {
        fixtures(characters())
        service.useOwner(PROBE)
        expect(clock.pendingTimers()).toBe(0)
        expect(service.editText(PROBE, 'customModuleToggle', 'b')).toMatchObject({ ok: true })
        expect(clock.pendingTimers()).toBe(0)
        await clock.advance(READY_DEADLINE_MS + SAVE_MAX_WAIT_MS + 10)
        expect(store.counts).toMatchObject({ open: 0, load: 0, save: 0 })
        expect(claim.tryClaim).not.toHaveBeenCalled()
        const view = service.view(PROBE)
        expect(view).toMatchObject({ phase: 'memoryOnly', banner: 'session', persisted: false, editable: true, restricted: false })
        expect(historyBannerText('session')).toBeNull()
    })
})

describe('T-S2: edit, undo, redo, revert and restore route through the adapter', () => {
    test('every action resolves again and writes the planned values', () => {
        expect(service.editText(PROBE, 'customModuleToggle', 'b')).toMatchObject({ ok: true })
        expect(adapter.writes).toHaveLength(1)
        expect(adapter.writes[0].id).toBe('x')
        expect(adapter.backings.get('x')?.value).toBe('b')
        expect(service.view(PROBE).done).toHaveLength(1)
        expect(adapter.noted).toHaveLength(1)
        expect(landed).toBe(1)

        let resolves = adapter.resolves.length
        expect(service.undo(PROBE)).toMatchObject({ ok: true })
        expect(adapter.backings.get('x')?.value).toBe('a')
        expect(adapter.resolves.length).toBeGreaterThan(resolves)
        resolves = adapter.resolves.length
        expect(service.redo(PROBE)).toMatchObject({ ok: true })
        expect(adapter.backings.get('x')?.value).toBe('b')
        expect(adapter.resolves.length).toBeGreaterThan(resolves)

        expect(service.editText(PROBE, 'customModuleToggle', 'c', 'single')).toMatchObject({ ok: true })
        const stepId = service.view(PROBE).done[0].id
        expect(service.revertTo(PROBE, stepId)).toMatchObject({ ok: true })
        expect(adapter.backings.get('x')?.value).toBe('b')

        adapter.backings.set('x', { value: 'z' })
        const writesBefore = adapter.writes.length
        expect(service.restore(PROBE, new Set())).toMatchObject({ ok: true })
        expect(adapter.writes.length).toBeGreaterThan(writesBefore)
    })

    test('a replaced backing object is read as it is now: undo never writes the old value over it', () => {
        service.editText(PROBE, 'customModuleToggle', 'b')
        adapter.backings.set('x', { value: 'c' })
        const writesBefore = adapter.writes.length
        service.undo(PROBE)
        expect(adapter.backings.get('x')?.value).toBe('c')
        expect(adapter.writes.slice(writesBefore).flatMap((entry) => entry.writes.map((write) => JSON.stringify(write)))).not.toContainEqual(expect.stringContaining('"a"'))
    })

    test('a write answering false records and marks nothing', () => {
        adapter.write = () => false
        expect(service.editText(PROBE, 'customModuleToggle', 'b')).toEqual({ ok: false, reason: 'gone' })
        expect(service.view(PROBE).done).toHaveLength(0)
        expect(adapter.noted).toHaveLength(0)
        expect(landed).toBe(0)
    })
})

describe('T-S3/T-R7: a gone owner and the stored resolver', () => {
    test('a gone session owner is refused before any slot exists', () => {
        adapter.backings.delete('x')
        expect(service.editText(PROBE, 'customModuleToggle', 'b')).toEqual({ ok: false, reason: 'gone' })
        expect(service.view(PROBE).phase).toBe('unused')
        expect(adapter.writes).toHaveLength(0)
    })

    test('resolveLiveTarget answers gone for a session key and never reaches the adapter', () => {
        const resolves = adapter.resolves.length
        expect(resolveLiveTarget(PROBE)).toEqual({ ok: false, reason: 'gone' })
        expect(resolveLiveTarget(PROBE, () => null)).toEqual({ ok: false, reason: 'gone' })
        expect(readOwnerFields(PROBE)).toBeNull()
        expect(adapter.resolves.length).toBe(resolves)
    })

    test('resolveOwnerTarget reaches the adapter and liveReaderOf returns its reader', () => {
        const resolved = resolveOwnerTarget(PROBE, () => null)
        expect(resolved.ok).toBe(true)
        if (resolved.ok) {
            expect(liveReaderOf(resolved.target).field('customModuleToggle')).toEqual({ had: true, value: 'a' })
        }
    })
})

describe('T-V1: the visit path assumes no character', () => {
    test('beginOwnerVisit uses the owner and returns the adapter\'s ack without setAck', () => {
        const setAck = vi.fn()
        const useOwner = vi.fn()
        setStudioHistoryServiceForTests({ ...service, useOwner, setAck } as unknown as OwnerHistoryService)
        const fakeAck = { dispose: vi.fn() } as unknown as SaveAck
        setStudioVisitAckForTests(fakeAck)
        expect(beginOwnerVisit(PROBE)).toBeNull()
        expect(useOwner).toHaveBeenCalledWith(PROBE)
        expect(adapter.visits).toEqual(['x'])
        adapter.visitAck = fakeAck
        expect(beginOwnerVisit(PROBE)).toBe(fakeAck)
        expect(setAck).not.toHaveBeenCalled()
    })
})
