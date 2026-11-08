// @vitest-environment jsdom
// The real service and the real model over the per-step store: what one save puts and deletes after an
// ordinary edit, a coalesced edit, an undo or redo, a delete and a restore, whether the baseline came from
// a load or from earlier saves, and that no save changes the history the page keeps. Every case runs over
// the memory double and over the IndexedDB adapter on fake-indexeddb. Time moves only through the fake
// clock; the adapter's own asynchrony is awaited with real ticks.
import 'fake-indexeddb/auto'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, type OwnerKey } from '../ownerPhase'
import { STUDIO_DB_NAME, STUDIO_DB_VERSION, STUDIO_STORE_NAME, createStudioStoreIdb } from '../studioStoreIdb'
import type { StudioHistoryStore } from '../studioHistoryStore'
import { createFakeClock, drainMicrotasks, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, storedRecord, type MemoryStudioStore } from './studioStoreDoubles'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
    }
})

interface LiveCharacter {
    chaId: string
    desc: string
    alternateGreetings: string[]
    chats: { id?: string; note: string; fmIndex?: number }[]
    chatPage: number
}

function makeCharacter(chaId: string): LiveCharacter {
    return { chaId, desc: 'd0', alternateGreetings: ['g0', 'g1', 'g2', 'g3'], chats: [{ id: 'c1', note: 'n0', fmIndex: 2 }], chatPage: 0 }
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

// ---------------------------------------------------------------- two backends behind one shape

interface Writes {
    puts: string[]
    deletes: string[]
}

interface Backend {
    make(options?: { capBytes?: number }): StudioHistoryStore
    stored(): Promise<Map<string, string>>
    // The write requests issued since the last call, as parts (`h`, `i`, `r`, `s:<id>`, `d:<id>`, `range`).
    take(): Promise<Writes>
    // Everything started has finished.
    idle(): Promise<void>
}

// `h:<owner>` is the header; an `e:` key is the part after its gen; a key outside the owner range is kept whole.
function partOf(key: string): string {
    if (key.startsWith('h:')) return 'h'
    if (!key.startsWith('e:')) return key
    return key.slice(key.indexOf('|', key.indexOf('|') + 1) + 1)
}

function sorted(writes: Writes): Writes {
    return { puts: [...writes.puts].sort(), deletes: [...writes.deletes].sort() }
}

function doubleBackend(): Backend {
    const shared = new Map<string, string>()
    const stores: MemoryStudioStore[] = []
    const taken = new Map<MemoryStudioStore, number>()
    return {
        make: (options) => {
            const store = createMemoryStudioStore({ shared, capBytes: options?.capBytes })
            stores.push(store)
            return store
        },
        stored: async () => new Map(shared),
        take: async () => {
            const out: Writes = { puts: [], deletes: [] }
            for (const store of stores) {
                const from = taken.get(store) ?? 0
                for (const write of store.writes.slice(from)) {
                    for (const request of write.requests) {
                        if (request.op === 'put') out.puts.push(partOf(request.key))
                        else out.deletes.push(request.op === 'delete' ? partOf(request.key) : 'range')
                    }
                }
                taken.set(store, store.writes.length)
            }
            return out
        },
        idle: () => drainMicrotasks(),
    }
}

function idbBackend(): Backend {
    const factory = new IDBFactory()
    let inflight = 0
    const log: { op: 'put' | 'delete'; key: string }[] = []
    const nativePut = IDBObjectStore.prototype.put
    const nativeDelete = IDBObjectStore.prototype.delete
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        log.push({ op: 'put', key: String(key) })
        return nativePut.call(this, value, key)
    })
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
        log.push({ op: 'delete', key: query instanceof IDBKeyRange ? 'range' : String(query) })
        return nativeDelete.call(this, query)
    })
    const track = async <T,>(work: Promise<T>): Promise<T> => {
        inflight += 1
        try {
            return await work
        } finally {
            inflight -= 1
        }
    }
    return {
        make: (options) => {
            const store = createStudioStoreIdb({ factory, capBytes: options?.capBytes })
            return {
                open: () => track(store.open()),
                load: (owner) => track(store.load(owner)),
                save: (owner, record, protect) => track(store.save(owner, record, protect)),
                onClosed: (callback) => store.onClosed(callback),
            }
        },
        stored: async () => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = factory.open(STUDIO_DB_NAME, STUDIO_DB_VERSION)
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(request.error)
            })
            const objects = db.transaction(STUDIO_STORE_NAME, 'readonly').objectStore(STUDIO_STORE_NAME)
            const keys = await new Promise<IDBValidKey[]>((resolve) => {
                const request = objects.getAllKeys()
                request.onsuccess = () => resolve(request.result)
            })
            const values = await new Promise<unknown[]>((resolve) => {
                const request = objects.getAll()
                request.onsuccess = () => resolve(request.result)
            })
            db.close()
            return new Map(keys.map((key, index) => [String(key), String(values[index])]))
        },
        take: async () => {
            const out: Writes = { puts: [], deletes: [] }
            for (const entry of log.splice(0)) {
                if (entry.op === 'put') out.puts.push(partOf(entry.key))
                else out.deletes.push(entry.key === 'range' ? 'range' : partOf(entry.key))
            }
            return out
        },
        idle: async () => {
            await drainMicrotasks()
            while (inflight > 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, 1))
            }
            await drainMicrotasks()
        },
    }
}

// ---------------------------------------------------------------- pages

interface Page {
    clock: FakeClock
    service: OwnerHistoryService
    captured: (() => void)[]
}

function buildPage(backend: Backend, options: { capBytes?: number; visit?: string } = {}): Page {
    const clock = createFakeClock()
    const captured: (() => void)[] = []
    const service = createOwnerHistoryService({
        store: backend.make({ capBytes: options.capBytes }),
        claim: createClaimDouble(),
        clock,
        pageSession: `p${Math.random().toString(16).slice(2, 8)}`,
        getVisitId: () => options.visit ?? 'v1',
        registerLeaveFlush(flush) {
            captured.push(flush)
            return () => {}
        },
    })
    return { clock, service, captured }
}

beforeEach(() => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    DBState.db.characters = [makeCharacter('A')] as unknown as typeof DBState.db.characters
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    vi.restoreAllMocks()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

// A page leave: every ready owner with a pending debounce is saved at once.
async function leave(backend: Backend, page: Page): Promise<void> {
    for (const flush of page.captured) {
        flush()
    }
    await backend.idle()
}

// An edit that is a step of its own (past the coalescing window), saved by a leave.
async function editAndLeave(backend: Backend, page: Page, text: string): Promise<void> {
    page.clock.set(page.clock.now() + 1500)
    expect(page.service.editField(A, 'desc', text).ok).toBe(true)
    await leave(backend, page)
}

async function ready(backend: Backend, page: Page): Promise<void> {
    await page.service.whenReady(A)
    await backend.idle()
}

const newest = (page: Page) => page.service.view(A).done.at(-1)!

describe.each([
    ['memory double', doubleBackend],
    ['IndexedDB adapter', idbBackend],
])('%s', (_label, makeBackend) => {
    let backend: Backend

    beforeEach(() => {
        backend = makeBackend()
    })

    test('T-PD1 (a) one edit after three stored steps, all reached by saves in this page: the new step, the restore point, the index and the header', async () => {
        const page = buildPage(backend)
        await ready(backend, page)
        for (let i = 0; i < 3; i++) {
            await editAndLeave(backend, page, `desc ${i}`)
        }
        await backend.take()
        await editAndLeave(backend, page, 'desc 3')
        expect(sorted(await backend.take())).toEqual({ puts: ['h', 'i', 'r', `s:${newest(page).id}`].sort(), deletes: [] })

        // A new page loads a record equal to memory.
        const later = buildPage(backend, { visit: 'v2' })
        await ready(backend, later)
        expect(later.service.view(A).done).toEqual(page.service.view(A).done)
        expect(later.service.view(A).restore).toEqual(page.service.view(A).restore)
    })

    test('T-PD1 (b) the same edit in a page that loaded the three steps: the baseline holds the objects the page keeps, so nothing else is put', async () => {
        const first = buildPage(backend)
        await ready(backend, first)
        for (let i = 0; i < 3; i++) {
            await editAndLeave(backend, first, `desc ${i}`)
        }
        await backend.take()

        const second = buildPage(backend, { visit: 'v2' })
        await ready(backend, second)
        expect(second.service.view(A).done).toHaveLength(3)
        await backend.take()
        await editAndLeave(backend, second, 'desc 3')
        expect(sorted(await backend.take())).toEqual({ puts: ['h', 'i', 'r', `s:${newest(second).id}`].sort(), deletes: [] })
        const stored = storedRecord(await backend.stored(), A)
        expect(stored?.record.done).toEqual(second.service.view(A).done)
    })

    test('T-PD1 a 101st step deletes the oldest stored step and only that', async () => {
        const page = buildPage(backend)
        await ready(backend, page)
        for (let i = 0; i < 100; i++) {
            page.clock.set(page.clock.now() + 1500)
            expect(page.service.editField(A, 'desc', `desc ${i}`).ok).toBe(true)
        }
        await leave(backend, page)
        expect(page.service.view(A).done).toHaveLength(100)
        const oldest = page.service.view(A).done[0].id
        await backend.take()
        await editAndLeave(backend, page, 'desc 100')
        expect(page.service.view(A).done).toHaveLength(100)
        expect(sorted(await backend.take())).toEqual({ puts: ['h', 'i', 'r', `s:${newest(page).id}`].sort(), deletes: [`s:${oldest}`] })
    })

    test('T-PD2 a coalesced top step is put again with its new content, and a reload shows the later value', async () => {
        const page = buildPage(backend)
        await ready(backend, page)
        page.clock.set(0)
        expect(page.service.editField(A, 'desc', 'one').ok).toBe(true)
        page.clock.set(100)
        await leave(backend, page)
        const id = newest(page).id
        await backend.take()

        page.clock.set(500)
        expect(page.service.editField(A, 'desc', 'two').ok).toBe(true)
        expect(page.service.view(A).done).toHaveLength(1)
        expect(newest(page).id).toBe(id)
        page.clock.set(600)
        await leave(backend, page)
        expect(sorted(await backend.take())).toEqual({ puts: ['h', 'i', 'r', `s:${id}`].sort(), deletes: [] })

        const later = buildPage(backend, { visit: 'v2' })
        await ready(backend, later)
        const op = later.service.view(A).done[0].ops[0]
        expect(op).toMatchObject({ op: 'set', path: 'desc', after: { had: true, value: 'two' } })
    })

    test('T-PD3 an undo and a redo put the moved step, the index and the header, and delete nothing', async () => {
        const page = buildPage(backend)
        await ready(backend, page)
        await editAndLeave(backend, page, 'one')
        await editAndLeave(backend, page, 'two')
        const [first, second] = page.service.view(A).done.map((step) => step.id)
        await backend.take()

        page.clock.set(page.clock.now() + 1500)
        expect(page.service.undo(A).ok).toBe(true)
        await leave(backend, page)
        const undone = sorted(await backend.take())
        expect(undone.deletes).toEqual([])
        expect(undone.puts).toEqual(expect.arrayContaining(['h', 'i', `s:${second}`]))
        expect(undone.puts).not.toContain(`s:${first}`)

        page.clock.set(page.clock.now() + 1500)
        expect(page.service.redo(A).ok).toBe(true)
        await leave(backend, page)
        const redone = sorted(await backend.take())
        expect(redone.deletes).toEqual([])
        expect(redone.puts).toEqual(expect.arrayContaining(['h', 'i', `s:${second}`]))
        expect(redone.puts).not.toContain(`s:${first}`)

        const stored = storedRecord(await backend.stored(), A)
        expect(stored?.record.done).toEqual(page.service.view(A).done)
        expect(stored?.record.undone).toEqual([])
    })

    test('T-PD3 / T-PD5 a delete puts its step and its deleted item; undoing it deletes the item; redoing puts it again; a restore deletes it', async () => {
        const page = buildPage(backend)
        await ready(backend, page)
        page.clock.set(page.clock.now() + 1500)
        expect(page.service.greetingDelete(A, 1).ok).toBe(true)
        await leave(backend, page)
        const item = page.service.view(A).deleted[0]
        const removal = newest(page)
        expect(sorted(await backend.take()).puts).toEqual(expect.arrayContaining(['h', 'i', `s:${removal.id}`, `d:${item.id}`]))

        page.clock.set(page.clock.now() + 1500)
        expect(page.service.undo(A).ok).toBe(true)
        expect(page.service.view(A).deleted).toHaveLength(0)
        await leave(backend, page)
        const undone = sorted(await backend.take())
        expect(undone.deletes).toEqual([`d:${item.id}`])
        expect(undone.puts).toEqual(expect.arrayContaining(['h', 'i', `s:${removal.id}`]))

        page.clock.set(page.clock.now() + 1500)
        expect(page.service.redo(A).ok).toBe(true)
        await leave(backend, page)
        const redone = sorted(await backend.take())
        expect(redone.deletes).toEqual([])
        expect(redone.puts).toEqual(expect.arrayContaining(['h', 'i', `s:${removal.id}`, `d:${item.id}`]))

        page.clock.set(page.clock.now() + 1500)
        expect(page.service.restoreDeleted(A, item.id).ok).toBe(true)
        await leave(backend, page)
        const restored = sorted(await backend.take())
        expect(restored.deletes).toEqual([`d:${item.id}`])
        expect(restored.puts).toEqual(expect.arrayContaining(['h', 'i', `s:${newest(page).id}`]))
        const stored = storedRecord(await backend.stored(), A)
        expect(stored?.record.done).toEqual(page.service.view(A).done)
        expect(stored?.record.deleted).toEqual([])
    })

    test('no trimmed save changes what the page keeps, in any of the four parts', async () => {
        const page = buildPage(backend, { capBytes: 6000 })
        await ready(backend, page)
        for (let i = 0; i < 30; i++) {
            page.clock.set(page.clock.now() + 1500)
            expect(page.service.editField(A, 'desc', `${'x'.repeat(150)}${i}`).ok).toBe(true)
        }
        // A delete that stays done, edits after it, then undos: every part of the record is populated.
        page.clock.set(page.clock.now() + 1500)
        expect(page.service.greetingDelete(A, 0).ok).toBe(true)
        for (let i = 0; i < 6; i++) {
            page.clock.set(page.clock.now() + 1500)
            expect(page.service.editField(A, 'desc', `${'y'.repeat(150)}${i}`).ok).toBe(true)
        }
        for (let i = 0; i < 3; i++) {
            page.clock.set(page.clock.now() + 1500)
            expect(page.service.undo(A).ok).toBe(true)
        }
        const shown = (): string => {
            const { done, undone, deleted, restore } = page.service.view(A)
            return JSON.stringify({ done, undone, deleted, restore })
        }
        const parts = page.service.view(A)
        expect(parts.done.length).toBeGreaterThan(20)
        expect(parts.undone).toHaveLength(3)
        expect(parts.deleted).toHaveLength(1)
        expect(parts.restore).not.toBeNull()
        const before = shown()

        await leave(backend, page)
        expect(page.service.view(A).banner).toBe('trimmed')
        expect(shown()).toBe(before)
        // The stored copy is smaller than memory; memory was not cut to match.
        const stored = storedRecord(await backend.stored(), A)
        expect(stored).not.toBeNull()
        expect(stored!.record.done.length).toBeLessThan(page.service.view(A).done.length)
    })
})
