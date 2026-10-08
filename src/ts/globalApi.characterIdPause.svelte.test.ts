/**
 * Saving waits, and says so, while a character cannot be saved under its id;
 * it resumes by itself when the cause is gone, and a page whose data cannot be
 * written as a loadable save stops with a named reason.
 *
 * This file drives the REAL, unmocked `saveDb()` loop, `RisuSaveEncoder` and the
 * page's block-store owner against an in-memory byte store (see
 * `saveLoopWorld.ts`); every test starts a fresh module graph. A mocked success
 * here is not evidence of native backend behaviour.
 *
 * Title labels: (R) marks a reproducer that fails against a loop with no
 * pause; (G) marks a guard that passes with or without it; (U) marks a unit of
 * the new indicator store.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { isBlockKey, makeCharacter, makeDb, mutationsOf } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'

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

// Longer than the save debounce (500 ms) plus a loop pass, so a write that would happen has happened.
const QUIET_MS = 1300

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    kit.parkAll()
    vi.restoreAllMocks()
})

const characters = () => h.db!.characters as Entry[]

async function nextStart(w: World): Promise<string> {
    const { makeOwner } = await import('src/ts/storage/tests/blockStoreHarness')
    const { validateLoadedBlocks } = await import('src/ts/storage/blockProfileValidate')
    const { owner } = makeOwner(w.store)
    try {
        const loaded = await owner.load({ validate: validateLoadedBlocks })
        if (loaded.kind !== 'loaded') {
            return `not loaded: ${loaded.kind}`
        }
        return (loaded.tree.characters as unknown as Entry[]).map((c) => `${String(c.chaId)}:${String(c.name)}`).join(',')
    } catch (error) {
        return `THROWS ${error instanceof Error ? error.message : String(error)}`
    }
}

const blockWrites = (w: World) => mutationsOf(w.store, isBlockKey).length

async function held() {
    const hold = await import('src/ts/storage/saveHold')
    return get(hold.heldSaveStore)
}

const BAD_IDS: Array<[string, () => unknown]> = [
    ['config', () => 'config'],
    ['preset', () => 'preset'],
    ['__proto__', () => '__proto__'],
    ['a Symbol', () => Symbol('id')],
    ['300 characters', () => 'x'.repeat(300)],
    ['a lone surrogate', () => 'a\ud800'],
    ['an object', () => ({})],
]

describe('a loaded character renamed in place to an id that cannot key a block (S3)', () => {
    test.each(BAD_IDS)('(R) %s: nothing is written while it stays, the indicator names it, and undoing the rename lets the edit made meanwhile commit', async (_label, bad) => {
        h.db = makeDb('p', ['a', 'b', 'c'])
        const w = await kit.startWorld()
        const alerts = await import('src/ts/alert')
        const stores = await import('src/ts/stores.svelte')
        ;(characters()[1] as Entry).name = 'Bee'
        const original = characters()[1].chaId
        const before = blockWrites(w)

        characters()[1].chaId = bad()
        characters()[0].name = 'edited a'
        w.marks.markCharacterForSave('a')
        await sleepReal(QUIET_MS)

        expect(blockWrites(w)).toBe(before)
        expect(vi.mocked(alerts.alertError)).not.toHaveBeenCalled()
        expect(get(stores.savingStoppedReason)).toBeNull()
        expect(w.api.isSaveClean()).toBe(false)

        characters()[1].chaId = original
        await until(() => blockWrites(w) > before, 'the edit to commit after the undo', 4000)
        await settled(w)
        expect(await nextStart(w)).toBe('a:edited a,b:Bee,c:c')
    })

    test('(U) the indicator names the character and clears with the cause', async () => {
        h.db = makeDb('p', ['a', 'b'])
        const w = await kit.startWorld()
        characters()[1].name = 'Bee'
        const original = characters()[1].chaId
        characters()[1].chaId = 'preset'
        await until(async () => (await held()).length === 1, 'the indicator to show', 3000)

        expect((await held())[0]).toMatchObject({ name: 'Bee', kind: 'unusable-id', archived: false })

        characters()[1].chaId = original
        await until(async () => (await held()).length === 0, 'the indicator to clear', 3000)
        await settled(w)
    })

    test('(R) deleting the character permanently clears the wait and the deletion commits; trashing alone keeps the wait (S3D)', async () => {
        h.db = makeDb('p', ['a', 'b', 'c'])
        const w = await kit.startWorld()
        characters()[1].chaId = 'config'
        characters()[0].name = 'edited a'
        w.marks.markCharacterForSave('a')
        await sleepReal(QUIET_MS)
        const before = blockWrites(w)

        characters()[1].trashTime = Date.now()
        await sleepReal(QUIET_MS)
        expect(blockWrites(w)).toBe(before)

        characters().splice(1, 1)
        w.api.requiresFullEncoderReload.state = true
        await until(() => blockWrites(w) > before, 'the deletion to commit', 4000)
        await settled(w)
        expect(await nextStart(w)).toBe('a:edited a,c:c')
    })
})

describe('a rename that lands during the reload of the encoder (S3R, S17)', () => {
    async function duringReloadInit(w: World, afterBlock: string, act: () => void) {
        const proto = w.risuSave.RisuSaveEncoder.prototype
        const real = proto.encodeBlock
        let fired = false
        const spy = vi.spyOn(proto, 'encodeBlock').mockImplementation(async function (this: InstanceType<typeof w.risuSave.RisuSaveEncoder>, arg) {
            const result = await real.call(this, arg)
            if (!fired && arg.name === afterBlock && this !== w.risuSave.RisuSaveEncoder.prototype) {
                fired = true
                act()
            }
            return result
        })
        return { restore: () => spy.mockRestore(), fired: () => fired }
    }

    test('(R) a rename to a block name between the reload and its snapshot deletes no saved block and writes nothing (S3R)', async () => {
        h.db = makeDb('p', ['a', 'b'])
        const w = await kit.startWorld()
        const before = blockWrites(w)
        const reload = await duringReloadInit(w, 'plugins', () => { characters()[1].chaId = 'config' })

        w.api.requiresFullEncoderReload.state = true
        w.marks.markCharacterForSave('a')
        await until(() => reload.fired(), 'the encoder to reload', 4000)
        await sleepReal(QUIET_MS)
        reload.restore()

        expect(blockWrites(w)).toBe(before)
        expect(w.store.keys('blocks/').some((key) => key.endsWith('/c/' + Buffer.from('b').toString('hex')))).toBe(true)
        characters()[1].chaId = 'b'
        await until(() => w.api.isSaveClean(), 'saving to resume', 4000)
        expect(await nextStart(w)).toBe('a:a,b:b')
    })

    test('(R) an id blanked between the check and the reload snapshot is filled on the next pass and the character loads (S17)', async () => {
        h.db = makeDb('p', ['a', 'b'])
        const w = await kit.startWorld()
        const reload = await duringReloadInit(w, 'plugins', () => { characters()[1].chaId = '' })

        w.api.requiresFullEncoderReload.state = true
        w.marks.markCharacterForSave('a')
        await until(() => reload.fired(), 'the encoder to reload', 4000)
        await until(() => typeof characters()[1].chaId === 'string' && characters()[1].chaId !== '', 'the character to get an id', 4000)
        reload.restore()
        await settled(w)

        const start = await nextStart(w)
        expect(start.split(',')).toHaveLength(2)
        expect(start).toContain(`${String(characters()[1].chaId)}:b`)
    })
})

describe('an id that changes between the snapshot and the serialization (S18)', () => {
    test('(R) the renamed form is never stored, and the character loads under its own id after the undo', async () => {
        h.db = makeDb('p', ['a', 'b'])
        const w = await kit.startWorld()
        const a = characters()[0]
        let renamed = false
        Object.defineProperty(a, 'toJSON', {
            configurable: true,
            enumerable: false,
            value() {
                if (!renamed) {
                    renamed = true
                    a.chaId = 'config'
                    setTimeout(() => { a.chaId = 'a' }, 0)
                    return { ...(this as Entry), chaId: 'config' }
                }
                return { ...(this as Entry) }
            },
        })
        a.name = 'edited a'

        w.marks.markCharacterForSave('a')
        await until(() => renamed, 'the serialization to run', 3000)
        await sleepReal(QUIET_MS)
        await settled(w)

        const start = await nextStart(w)
        expect(start).toBe('a:edited a,b:b')
        const stored = [...w.store.snapshotValues().values()].map((bytes) => new TextDecoder().decode(bytes))
        expect(stored.some((text) => text.includes('"chaId":"config"'))).toBe(false)
    })
})

describe('the character order while saving waits (S19, S13)', () => {
    test('(R) importing and reordering keep the held character\'s folder entry, and the order is repaired after the undo', async () => {
        h.db = makeDb('p', ['a', 'b'])
        h.db.characterOrder = ['a', { id: 'F', name: 'F', data: ['b'] }]
        const w = await kit.startWorld()
        characters()[1].chaId = 'config'
        await sleepReal(QUIET_MS)

        characters().push(makeCharacter('n') as Entry)
        w.api.checkCharOrder(h.db as never)
        // The held character stays in the order under its present id; nothing is pruned.
        expect(h.db.characterOrder).toEqual(['a', { id: 'F', name: 'F', data: ['b'] }, 'config', 'n'])

        characters()[1].chaId = 'b'
        await sleepReal(QUIET_MS)
        w.api.checkCharOrder(h.db as never)
        expect(h.db.characterOrder).toEqual(['a', { id: 'F', name: 'F', data: ['b'] }, 'n'])
    })

    test('(R) an archived character with an id that cannot be saved keeps its folder entry and its top-level entry before any hold exists', async () => {
        h.db = makeDb('p', ['a', 'b'])
        const w = await kit.startWorld({ startLoop: false })
        const stub = makeCharacter('s', { coldstorage: 'unit-1' }) as Entry
        stub.chaId = 'preset'
        characters().push(stub)
        h.db!.characterOrder = ['a', { id: 'F', name: 'F', data: ['preset'] }, 'preset', 'b']

        w.api.checkCharOrder(h.db as never)

        expect(h.db!.characterOrder).toEqual(['a', { id: 'F', name: 'F', data: ['preset'] }, 'preset', 'b'])
    })

    test('(R) a character held with an id that cannot be saved stays in the order, appended when it is unordered', async () => {
        h.db = makeDb('p', ['a', 'b'])
        h.db.characterOrder = ['a', 'b']
        const w = await kit.startWorld()
        characters()[1].chaId = 'config'
        await until(async () => (await held()).length === 1, 'the indicator to show', 3000)

        w.api.checkCharOrder(h.db as never)

        expect(h.db!.characterOrder).toEqual(['a', 'b', 'config'])
    })

    test('(G) a stale entry for an id that is gone is removed once nothing is held', async () => {
        h.db = makeDb('p', ['a', 'b'])
        h.db.characterOrder = ['a', 'b']
        const w = await kit.startWorld()
        characters()[1].chaId = 'config'
        await until(async () => (await held()).length === 1, 'the indicator to show', 3000)
        w.api.checkCharOrder(h.db as never)
        characters().splice(1, 1)
        w.api.requiresFullEncoderReload.state = true
        await until(async () => (await held()).length === 0, 'the indicator to clear', 3000)

        w.api.checkCharOrder(h.db as never)

        expect(h.db!.characterOrder).toEqual(['a'])
    })

    test('(R) a Symbol or object id is never appended to the order, and the order stays usable', async () => {
        h.db = makeDb('p', ['a', 'b'])
        const w = await kit.startWorld()
        const symbolId = Symbol('id')
        characters()[1].chaId = symbolId
        await sleepReal(QUIET_MS)

        expect(() => w.api.checkCharOrder(h.db as never)).not.toThrow()
        expect(() => w.api.checkCharOrder(h.db as never)).not.toThrow()
        expect((h.db!.characterOrder as unknown[]).every((item) => typeof item === 'string')).toBe(true)
        expect(h.db!.characterOrder).not.toContain(symbolId)
    })

    test('(R) entries of the order that are neither an id nor a folder with a list are skipped, not a crash (S13)', async () => {
        h.db = makeDb('p', ['a'])
        h.db.characterOrder = [{}, 5, { id: 'F', name: 'F', data: 'not a list' }, 'a']
        const w = await kit.startWorld()

        expect(() => w.api.checkCharOrder(h.db as never)).not.toThrow()
        expect(h.db.characterOrder).toEqual(['a'])
    })
})

describe('an archived character with an id that cannot key a block (S10 pause)', () => {
    test('(R) is installed as it is, saving waits for it, and deleting it permanently lets the page save again', async () => {
        h.db = makeDb('p', ['a', 'b'])
        const w = await kit.startWorld({ startLoop: false })
        const stub = makeCharacter('s', { coldstorage: 'unit-1' }) as Entry
        stub.chaId = 'preset'
        characters().push(stub)
        characters()[0].name = 'edited a'
        w.start()
        w.marks.markCharacterForSave('a')
        await sleepReal(QUIET_MS)
        const before = blockWrites(w)

        expect(before).toBe(0)
        expect((await held())[0]).toMatchObject({ kind: 'unusable-id', archived: true })

        characters().splice(characters().indexOf(stub), 1)
        w.api.requiresFullEncoderReload.state = true
        await until(() => blockWrites(w) > before, 'the edit to commit', 4000)
        await settled(w)
        expect(await nextStart(w)).toBe('a:edited a,b:b')
    })

    test('(R) a rename before the first pass pauses the first pass, and undoing it saves (S3B)', async () => {
        h.db = makeDb('p', ['a', 'b'])
        const w = await kit.startWorld({ startLoop: false })
        characters()[1].chaId = 'config'
        characters()[0].name = 'edited a'
        w.start()
        w.marks.markCharacterForSave('a')
        await sleepReal(QUIET_MS)
        expect(blockWrites(w)).toBe(0)

        characters()[1].chaId = 'b'
        await until(() => blockWrites(w) > 0, 'the edit to commit', 4000)
        await settled(w)
        expect(await nextStart(w)).toBe('a:edited a,b:b')
    })
})

describe('data that cannot become a loadable save stops saving with a named reason (S21, S8)', () => {
    test('(R) a container that is not a list at boot parks the loop, names the reason and leaves the page unclean', async () => {
        h.db = makeDb('p', ['a'])
        const w = await kit.startWorld({ startLoop: false })
        const stores = await import('src/ts/stores.svelte')
        ;(h.db as Entry).modules = {}
        w.start()
        await until(() => get(stores.savingStoppedReason) !== null, 'saving to stop', 4000)

        expect(get(stores.savingStoppedReason)).toBe('invalid-data')
        expect(blockWrites(w)).toBe(0)
        expect(w.api.isSaveClean()).toBe(false)
    })

    test('(R) a character that serializes to a number parks the loop with a named reason and writes nothing', async () => {
        h.db = makeDb('p', ['a', 'b'])
        const w = await kit.startWorld()
        const stores = await import('src/ts/stores.svelte')
        const alerts = await import('src/ts/alert')
        const before = blockWrites(w)
        Object.defineProperty(characters()[1], 'toJSON', { configurable: true, enumerable: false, value: () => 5 })

        w.marks.markCharacterForSave('b')
        await until(() => get(stores.savingStoppedReason) !== null, 'saving to stop', 4000)

        expect(get(stores.savingStoppedReason)).toBe('invalid-data')
        expect(blockWrites(w)).toBe(before)
        expect(vi.mocked(alerts.alertError)).not.toHaveBeenCalled()
        expect(w.api.isSaveClean()).toBe(false)
    })
})
