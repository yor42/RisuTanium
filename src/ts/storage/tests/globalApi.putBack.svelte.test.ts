/**
 * The character put-back (`process/memory/characterPutBack.ts`) against the
 * real save loop: a restored character is saved as a full block of its own, and
 * a character put back as its stub must be written into the stubs pack again,
 * which only an explicit mark of the character guarantees.
 *
 * This file drives the REAL, unmocked `saveDb()` loop, `RisuSaveEncoder` and the
 * page's block-store owner against an in-memory byte store (see
 * `saveLoopWorld.ts`), the real restore, the real put-back and a reactive
 * `DBState`; every test starts a fresh module graph. A mocked success here is
 * not evidence of native backend behaviour.
 *
 * Effects live in this suite: none. `saveLoopMocks.svelte.ts` replaces
 * `registerDbChangeEffects`, so nothing marks a restored character as the
 * identity tracker does in the application; the test marks it itself, after
 * each restore, and says so. The put-back marks its own swap. The identity
 * tracker's refusal to mark a stub put back into its slot is shown in
 * `dbChangeEffects.svelte.test.ts` with the real `registerDbChangeEffects`.
 *
 * Labels: "acceptance" tests the put-back, which does not exist on the base;
 * "guard" passes with or without the code it names. The explicit mark in the
 * swap is falsified by removing it: the acceptance test then fails because the
 * stub is never written.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeCharacter, makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { characterBlockKey, stubsKey } from 'src/ts/storage/blockKeys'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import type { FaultRule } from 'src/ts/storage/tests/blockStoreHarness'

vi.setConfig({ testTimeout: 40_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const kit = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

type Entry = Record<string, unknown>

const units = new Map<string, unknown>()

let stops: Array<() => void> = []

beforeEach(() => {
    vi.clearAllMocks()
    units.clear()
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
    // The reader of the units: a map. Registered again for every world, whose module graph is fresh.
    vi.doMock('src/ts/process/coldstorage.svelte', async () => {
        const { noteReadSize } = await import('src/ts/process/memory/restoredBytes')
        return {
            getColdStorageItem: vi.fn(),
            readColdStorageItem: async (key: string) => {
                const unit = units.get(key)
                if (unit === undefined) {
                    return { status: 'missing' }
                }
                const json = JSON.stringify(unit)
                const result = { status: 'ok', value: JSON.parse(json) }
                noteReadSize(result, json.length)
                return result
            },
        }
    })
})

afterEach(() => {
    for (const stop of stops) {
        stop()
    }
    stops = []
    kit.parkAll()
    vi.restoreAllMocks()
})

interface Arena {
    w: World
    generation: string
    stores: typeof import('src/ts/stores.svelte')
    /** Restores `x` in place, then marks it as the identity tracker does in the application. */
    restoreX(): Promise<void>
    /** Selects `y` and marks it, so that a commit follows; the put-back of `x` waits for that commit. */
    moveOn(): Promise<void>
    /** The characters a fresh page would boot with from the store as it is now, or why it would not. */
    reload(): Promise<Entry[] | string>
    slotOfX(): Entry
}

/** A world whose profile holds `x` archived (a stub in the stubs pack) beside two full characters. */
async function startArchivedWorld(kind: 'tauri' | 'node'): Promise<Arena> {
    const full = makeCharacter('x')
    full.chats = [{ id: 'x-chat', message: [{ role: 'char', data: 'hello from the unit', time: 1 }], note: '', name: '', localLore: [] }]
    units.set('unit-x', { character: full })
    const db = makeDb('p', ['y', 'z'])
    ;(db.characters as unknown[]).unshift(buildColdStub(full as never, 'unit-x', []))
    h.db = db
    const w = await kit.startWorld({ kind, startLoop: false })
    const stores = await import('src/ts/stores.svelte')
    // The application's database is the reactive proxy; the loop reads it through getDatabase().
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Record<string, unknown>
    w.start()
    await sleepReal(150)
    const { restoreColdCharacter } = await import('src/ts/process/coldCharacterRestore')
    const putBack = await import('src/ts/process/memory/characterPutBack')
    // The mocked store survives a world's module reset, so the previous test's selection is still in it.
    stores.selectedCharID.set(-1)
    stops.push(putBack.startCharacterPutBack())
    const characters = () => h.db!.characters as Entry[]
    const slotOfX = () => characters().find((c) => c.chaId === 'x')!
    return {
        w,
        generation: w.owner.committedState()!.generation,
        stores,
        slotOfX,
        async restoreX() {
            const outcome = await restoreColdCharacter(slotOfX() as never, { byChaId: true, quiet: true })
            expect(outcome.status).toBe('restored')
            await nextCommit(w, () => w.marks.markCharacterForSave('x'))
        },
        async moveOn() {
            await nextCommit(w, () => {
                stores.selectedCharID.set(characters().findIndex((c) => c.chaId === 'y'))
                w.marks.markCharacterForSave('y')
            })
        },
        async reload() {
            const { makeOwner } = await import('src/ts/storage/tests/blockStoreHarness')
            const { validateLoadedBlocks } = await import('src/ts/storage/blockProfileValidate')
            const { owner } = makeOwner(w.store.cloneUngated())
            const loaded = await owner.load({ validate: validateLoadedBlocks })
            if (loaded.kind !== 'loaded') {
                return `not loaded: ${loaded.kind}`
            }
            return loaded.tree.characters as unknown as Entry[]
        },
    }
}

const xOf = (characters: Entry[] | string): Entry => {
    if (typeof characters === 'string') {
        throw new Error(characters)
    }
    return characters.find((c) => c.chaId === 'x')!
}

const isStubEntry = (entry: Entry) => typeof entry.coldstorage === 'string'

describe('a restored character put back as its stub, through the real save loop', () => {
    test('acceptance: the stub is written into the pack, a reboot loads it, and a second restore yields the unit content', async () => {
        const a = await startArchivedWorld('tauri')
        const originalStub = a.slotOfX()
        expect(a.w.owner.committedState()!.packed).toContain('x')

        await a.restoreX()

        // Before the put-back: x is a full block of its own and is not in the pack.
        expect(a.w.owner.committedState()!.packed).not.toContain('x')
        expect(a.w.store.peek(characterBlockKey(a.generation, 'x'))).not.toBeNull()
        expect(isStubEntry(a.slotOfX())).toBe(false)
        expect(isStubEntry(xOf(await a.reload()))).toBe(false)

        await a.moveOn()

        // After: the slot holds the stub it had, the pack member decodes to the stub and a reboot loads the stub.
        expect(a.slotOfX()).toBe(originalStub)
        expect(a.w.owner.committedState()!.packed).toContain('x')
        expect(a.w.store.peek(stubsKey(a.generation))).not.toBeNull()
        const stubAfterReboot = xOf(await a.reload())
        expect(stubAfterReboot.coldstorage).toBe('unit-x')
        expect((stubAfterReboot.chats as Entry[])[0].message).toEqual([expect.objectContaining({ data: '' })])

        await a.restoreX()

        const restored = xOf(await a.reload())
        expect(isStubEntry(restored)).toBe(false)
        expect(((restored.chats as Entry[])[0].message as Entry[])[0].data).toBe('hello from the unit')
        expect(isStubEntry(a.slotOfX())).toBe(false)
    })

    test('acceptance: a character edited after the restore is not put back and its edit is saved as the full block', async () => {
        const a = await startArchivedWorld('tauri')
        await a.restoreX()
        ;((a.slotOfX().chats as Entry[])[0].message as Entry[])[0].data = 'edited after the restore'
        await nextCommit(a.w, () => a.w.marks.markCharacterForSave('x'))

        await a.moveOn()

        expect(isStubEntry(a.slotOfX())).toBe(false)
        const rebooted = xOf(await a.reload())
        expect(isStubEntry(rebooted)).toBe(false)
        expect(((rebooted.chats as Entry[])[0].message as Entry[])[0].data).toBe('edited after the restore')
    })
})

describe('guard: repeated cycles where the clean-up after a commit is skipped (no Web Locks)', () => {
    test.each([
        ['an equal stub', undefined],
        ['a different stub (a newer lastInteraction)', 4242],
    ])('archive, restore, put back with %s, restore, reload: every reload is correct', async (_label, interaction) => {
        const a = await startArchivedWorld('tauri')
        for (let round = 0; round < 2; round++) {
            await a.restoreX()
            expect(isStubEntry(xOf(await a.reload()))).toBe(false)

            if (interaction !== undefined) {
                a.slotOfX().lastInteraction = interaction + round
            }
            await a.moveOn()
            const stub = xOf(await a.reload())
            expect(stub.coldstorage, `round ${round}`).toBe('unit-x')
            expect(stub.lastInteraction).toBe(interaction === undefined ? undefined : interaction + round)
            // Back to home (no selection), so the next round's move to y is a selection change that arms the put-back.
            a.stores.selectedCharID.set(-1)
        }
        await a.restoreX()
        expect(((xOf(await a.reload()).chats as Entry[])[0].message as Entry[])[0].data).toBe('hello from the unit')
    })
})

describe('guard: a clean-up delete that landed but was reported uncertain, through a put-back (versioned store)', () => {
    /** Arranges that the next clean-up delete naming `key` lands and then reports an uncertain outcome; the rule's `times` shows it fired. */
    function uncertainDeleteOf(a: Arena, key: string): FaultRule {
        const rule: FaultRule = {
            match: (op) => op.kind === 'deleteMany' && op.keys.includes(key),
            mode: 'after',
            error: new a.w.errors.StoreDeleteManyError([{ key, outcome: 'unknown' }]),
        }
        a.w.store.faults.push(rule)
        return rule
    }

    test('the pack delete after a restore, then an equal stub put back, then the own-key delete after the put-back, then an equal restore', async () => {
        const a = await startArchivedWorld('node')
        const packDelete = uncertainDeleteOf(a, stubsKey(a.generation))
        await a.restoreX()
        expect(packDelete.times ?? 1).toBe(0)
        expect(a.w.store.peek(stubsKey(a.generation))).toBeNull()
        expect(isStubEntry(xOf(await a.reload()))).toBe(false)

        const ownDelete = uncertainDeleteOf(a, characterBlockKey(a.generation, 'x'))
        await a.moveOn()
        expect(ownDelete.times ?? 1).toBe(0)
        expect(a.w.store.peek(characterBlockKey(a.generation, 'x'))).toBeNull()
        expect(xOf(await a.reload()).coldstorage).toBe('unit-x')

        await a.restoreX()
        const restored = xOf(await a.reload())
        expect(isStubEntry(restored)).toBe(false)
        expect(((restored.chats as Entry[])[0].message as Entry[])[0].data).toBe('hello from the unit')
    })
})
