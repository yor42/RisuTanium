// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    markIdentitySeen: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import type { Database } from 'src/ts/storage/database.svelte'
import { characterMatchesAcknowledged, freshEntry, type PreviousEncoding } from 'src/ts/storage/store2/codec'
import { createFastForward, setFastForwardHostForTest, type FastForwardFrame } from 'src/ts/storage/store2/fastForward'
import { defaultKeyEnv } from 'src/ts/storage/store2/format'
import { fakeLists } from './codecFixtures'
import { chaIdOf, chars, clone, parsedKey, until } from './lineFixtures'
import { bootB, chatsAt, FF_HOSTS, ffSetup, ffTeardown, ffWorld, mergeWorld, peerCommits, testHost, useFfHost, type PageB } from './ffFixtures'

/**
 * The fast-forward's oracle, the caught `after` hooks and the content rules of the steps (O, K, G rows of stage 3B).
 * The oracle rows drive `createFastForward().run` directly with a hand-built frame; the others run the real save loop.
 */

let hostHandle: ReturnType<typeof ffSetup>

beforeEach(() => {
    hostHandle = ffSetup()
})

afterEach(() => {
    ffTeardown()
})

type Slots = unknown[]

function remove(db: Database, index: number): void {
    const id = chaIdOf(db, index)
    ;(db.characters as unknown as Slots).splice(index, 1)
    db.characterOrder = db.characterOrder.filter(item => item !== id)
}

async function manual() {
    const { memory, page } = await ffWorld()
    const b = await bootB(memory)
    const frame = async (): Promise<FastForwardFrame> => ({
        read: await memory.readCommit(),
        key: await parsedKey(memory),
        baseKey: b.context.encoder.manifestKey,
        encoder: b.context.encoder,
        port: { getDatabase: () => b.db, now: () => Date.now() },
        snapshot: null,
    })
    return { memory, page, b, frame }
}

const snapshotOf = (b: PageB): { json: string, identities: unknown[] } => ({ json: JSON.stringify(b.db.characters), identities: [...b.db.characters] })

describe.each(FF_HOSTS)('the oracle (O1, O1b, O3) (%s host)', (mode) => {
    useFfHost(mode)
    test('O1 a taken step that was skipped but reported applied: park oracle, nothing changed, the encoder stays', async () => {
        const { memory, page, b, frame } = await manual()
        hostHandle.host.state.inUse.add(chaIdOf(b.db, 3))
        const { applyVerified } = await import('src/ts/storage/store2/fastForward/apply')
        const fastForward = createFastForward({ backend: memory, kind: 'indexeddb', lists: fakeLists, env: defaultKeyEnv, apply: steps => applyVerified(steps.slice(1)) })
        await page.commitEdit((db) => { chars(db)[3].personality = 'peer card' })
        const before = snapshotOf(b)
        const manifest = b.context.encoder.manifestKey
        expect(await fastForward.run(await frame())).toEqual({ kind: 'park', reason: 'oracle' })
        expect(JSON.stringify(b.db.characters)).toBe(before.json)
        expect(b.context.encoder.manifestKey).toBe(manifest)
    })

    test('O1b the oracle\'s fresh encode throws after a verified apply that removes a character: run resolves to park oracle with nothing changed', async () => {
        const { memory, page, b, frame } = await manual()
        hostHandle.host.state.inUse.add(chaIdOf(b.db, 3))
        hostHandle.host.state.selected = 3
        let detection: PreviousEncoding | null = null
        const fastForward = createFastForward({
            backend: memory, kind: 'indexeddb', lists: fakeLists, env: defaultKeyEnv,
            freshEntry: (slot, options) => {
                detection ??= options.previous
                if (options.previous !== detection) {
                    throw new TypeError('the oracle\'s encode failed')
                }
                return freshEntry(slot, options)
            },
        })
        await page.commitEdit((db) => {
            remove(db, 0)
            chars(db)[2].personality = 'peer card'
        })
        const before = snapshotOf(b)
        const manifest = b.context.encoder.manifestKey
        expect(await fastForward.run(await frame())).toEqual({ kind: 'park', reason: 'oracle' })
        expect(JSON.stringify(b.db.characters)).toBe(before.json)
        expect(b.db.characters.every((slot, index) => slot === before.identities[index])).toBe(true)
        expect(hostHandle.host.state.selected).toBe(3)
        expect(b.context.encoder.manifestKey).toBe(manifest)
    })

    test('O3 an oracle trip in a fast-forward that also removes and inserts leaves the original objects in order, the selection alone and no forget call', async () => {
        const { memory, page, b, frame } = await manual()
        hostHandle.host.state.inUse.add(chaIdOf(b.db, 3))
        hostHandle.host.state.selected = 3
        let detection: PreviousEncoding | null = null
        const fastForward = createFastForward({
            backend: memory, kind: 'indexeddb', lists: fakeLists, env: defaultKeyEnv,
            freshEntry: (slot, options) => {
                detection ??= options.previous
                return options.previous === detection ? freshEntry(slot, options) : 'unknown'
            },
        })
        await page.commitEdit((db) => {
            const added = clone(chars(db)[0])
            added.chaId = 'inserted-by-peer'
            ;(db.characters as unknown as Slots).splice(2, 0, added)
            db.characterOrder = [...db.characterOrder, 'inserted-by-peer']
            remove(db, 0)
            chars(db)[3].personality = 'peer card'
        })
        const before = snapshotOf(b)
        expect(await fastForward.run(await frame())).toEqual({ kind: 'park', reason: 'oracle' })
        expect(b.db.characters).toHaveLength(before.identities.length)
        expect(b.db.characters.every((slot, index) => slot === before.identities[index])).toBe(true)
        expect(hostHandle.host.state.selected).toBe(3)
        expect(hostHandle.host.state.calls?.selects).toEqual([])
        expect(hostHandle.host.state.calls?.forgotten).toEqual([])
    })

    test('T16 an oracle trip in a fast-forward that removes, inserts and installs a replacement stub undoes all three: the original objects stay in order, the selection alone and no forget call', async () => {
        const { memory, page, b, frame } = await manual()
        hostHandle.host.state.inUse.add(chaIdOf(b.db, 3))
        hostHandle.host.state.selected = 3
        let detection: PreviousEncoding | null = null
        const fastForward = createFastForward({
            backend: memory, kind: 'indexeddb', lists: fakeLists, env: defaultKeyEnv,
            freshEntry: (slot, options) => {
                detection ??= options.previous
                return options.previous === detection ? freshEntry(slot, options) : 'unknown'
            },
        })
        await page.commitEdit((db) => {
            const added = clone(chars(db)[0])
            added.chaId = 'inserted-by-peer'
            ;(db.characters as unknown as Slots).splice(2, 0, added)
            db.characterOrder = [...db.characterOrder, 'inserted-by-peer']
            remove(db, 0)
            chars(db)[0].personality = 'peer replaced card'
            chars(db)[3].personality = 'peer merged card'
        })
        const before = snapshotOf(b)
        expect(await fastForward.run(await frame())).toEqual({ kind: 'park', reason: 'oracle' })
        expect(b.db.characters).toHaveLength(before.identities.length)
        expect(b.db.characters.every((slot, index) => slot === before.identities[index])).toBe(true)
        expect(JSON.stringify(b.db.characters)).toBe(before.json)
        expect(hostHandle.host.state.selected).toBe(3)
        expect(hostHandle.host.state.calls?.forgotten).toEqual([])
    })
})

describe.each(FF_HOSTS)('after hooks (O4) (%s host)', (mode) => {
    useFfHost(mode)
    test('O4 a forgetLoaded that throws is reported, the encoder is the peer\'s and the selection remap still ran', async () => {
        const { memory, page, b, frame } = await manual()
        const { host, state } = testHost()
        const forgetError = new Error('forget failed')
        host.forgetLoaded = () => { throw forgetError }
        state.selected = 2
        setFastForwardHostForTest(host)
        const fastForward = createFastForward({ backend: memory, kind: 'indexeddb', lists: fakeLists, env: defaultKeyEnv })
        const edited = await page.commitEdit(db => remove(db, 0))
        const kept = chaIdOf(b.db, 2)
        expect(await fastForward.run(await frame())).toEqual({ kind: 'applied' })
        expect(b.context.encoder.manifestKey).toBe(edited.current?.key)
        expect(console.error).toHaveBeenCalledWith(forgetError)
        expect(state.selected).toBe(1)
        expect(chaIdOf(b.db, 1)).toBe(kept)
    })
})

describe.each(FF_HOSTS)('what the steps write (K1, K2, G1 to G3, G5 to G7) (%s host)', (mode) => {
    useFfHost(mode)
    test('K1 a taken core writes only the keys that differ: an unchanged nested object keeps its identity and a key the peer dropped is gone', async () => {
        const w = await mergeWorld()
        hostHandle.host.state.inUse.add(chaIdOf(w.b.db, 3))
        const live = chars(w.b.db)[3]
        const nested = Object.entries(live).find(([name, value]) => !['chats', 'globalLore'].includes(name) && typeof value === 'object' && value !== null && !['customscript', 'triggerscript'].includes(name))
        expect(nested).toBeDefined()
        const [name, value] = nested ?? ['', null]
        const chatArray = live.chats
        const outcome = await peerCommits(w, (db) => {
            chars(db)[3].personality = 'peer card'
            delete chars(db)[3].creatorNotes
        })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(live.personality).toBe('peer card')
        expect(Object.hasOwn(live, 'creatorNotes')).toBe(false)
        expect(live[name]).toBe(value)
        expect(live.chats).toBe(chatArray)
        expect(chars(w.b.db)[3]).toBe(live)
    })

    test('K2 a lore or scripts bag the peer emptied removes every field of it, and a bag it filled is written', async () => {
        const w = await mergeWorld()
        hostHandle.host.state.inUse.add(chaIdOf(w.b.db, 3))
        const outcome = await peerCommits(w, (db) => {
            delete chars(db)[3].globalLore
            chars(db)[3].customscript = [{ comment: 'peer script', in: 'a', out: 'b', type: 'editinput', flag: '' }]
        })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(Object.hasOwn(chars(w.b.db)[3], 'globalLore')).toBe(false)
        expect(chars(w.b.db)[3].customscript).toEqual([{ comment: 'peer script', in: 'a', out: 'b', type: 'editinput', flag: '' }])
    })

    test('G1 a record this page kept is not guarded: its commit after the take lands without a park', async () => {
        const w = await mergeWorld()
        chatsAt(w.b.db, 3)[0].note = 'kept note'
        expect(await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })).toEqual({ kind: 'applied' })
        await until(() => w.world.state.saved >= 1, 'the commit of the kept record', 8000)
        expect(w.b.peer.asked).toEqual([])
        expect(w.b.peer.clean).toEqual([])
    })

    test('G2 a stale writer that writes a taken chat back to its pre-take content is a revert: the page asks ff-revert', async () => {
        const w = await mergeWorld()
        const chaId = chaIdOf(w.b.db, 3)
        hostHandle.host.state.inUse.add(chaId)
        const y = chatsAt(w.b.db, 3)[1]
        const original = y.note
        expect(await peerCommits(w, (db) => { chatsAt(db, 3)[1].note = 'peer note' })).toEqual({ kind: 'applied' })
        expect(y.note).toBe('peer note')
        y.note = original
        w.world.mark(chaId)
        await until(() => w.b.peer.asked.length >= 1, 'the ff-revert question', 8000)
        expect(w.b.peer.asked[0]).toMatchObject({ reason: 'ff-revert' })
    })

    test('G3 the taken units carry digests: the character is clean against the acknowledged encoding after the take', async () => {
        const w = await mergeWorld()
        hostHandle.host.state.inUse.add(chaIdOf(w.b.db, 3))
        expect(await peerCommits(w, (db) => { chatsAt(db, 3)[1].note = 'peer note'; chars(db)[3].personality = 'peer card' })).toEqual({ kind: 'applied' })
        expect(characterMatchesAcknowledged(chars(w.b.db)[3] as never, { env: defaultKeyEnv, lists: fakeLists, previous: w.b.context.encoder.acknowledged() })).toBe('clean')
    })

    test('G6 an unmarked character whose only kept record is the view: the take keeps this page\'s chat and the next pass commits it', async () => {
        const w = await mergeWorld()
        chars(w.b.db)[3].chatPage = 1
        expect(await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })).toEqual({ kind: 'applied' })
        expect(chars(w.b.db)[3].chatPage).toBe(1)
        await until(() => w.world.state.saved >= 1, 'the commit of the view', 8000)
        const read = await w.page.freeze()
        expect(chars(read.db)[3].chatPage).toBe(1)
        expect(chars(read.db)[3].personality).toBe('peer card')
    })

    test('G7 a holder that kept the taken chat across the take and writes to it afterwards: the value is in the database and in the next commit', async () => {
        const w = await mergeWorld()
        const chaId = chaIdOf(w.b.db, 3)
        hostHandle.host.state.inUse.add(chaId)
        const held = chatsAt(w.b.db, 3)[1]
        expect(await peerCommits(w, (db) => { chatsAt(db, 3)[1].note = 'peer note' })).toEqual({ kind: 'applied' })
        held.note = 'holder wrote this'
        expect(chatsAt(w.b.db, 3)[1].note).toBe('holder wrote this')
        w.world.mark(chaId)
        await until(() => w.world.state.saved >= 1, 'the holder\'s commit', 8000)
        const read = await w.page.freeze()
        expect(chatsAt(read.db, 3)[1].note).toBe('holder wrote this')
    })
})
