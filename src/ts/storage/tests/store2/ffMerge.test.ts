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
import { recordTrashOrigins } from 'src/ts/trashOrigin'
import { chaIdOf, chars, until } from './lineFixtures'
import { chatsAt, ffSetup, ffTeardown, mergeWorld, peerCommits, personalityOf } from './ffFixtures'

/**
 * Stage 3B rows R1 to R14: a loaded character the peer changed is merged record by record, in place, over the real save
 * loop. The base of every row is the line-seeded store; the peer is `peerPage`. Rows R1 to R4, R6, R8, R10, R11 and R14
 * parked before (`character:in-use`, `body-dirty`, `unsaved-view`, `trash-in-use`); the guard on the base is each row's
 * own outcome assertion.
 */

let hostHandle: ReturnType<typeof ffSetup>

beforeEach(() => {
    hostHandle = ffSetup()
})

afterEach(() => {
    ffTeardown()
})

const messagesOf = (chat: Record<string, unknown>): Array<Record<string, unknown>> => chat.message as Array<Record<string, unknown>>

function trash(db: Database, index: number, at: number): void {
    const slot = chars(db)[index]
    slot.trashTime = at
    recordTrashOrigins(db, [{ chaId: String(slot.chaId) }], at)
    db.characterOrder = db.characterOrder.filter(item => item !== slot.chaId)
}

describe('open characters merge in place (R1 to R4)', () => {
    test('R1 B shows C/X and has it open; A edits C/Y and C\'s lore: both are taken with no park, X and the objects stay', async () => {
        const w = await mergeWorld()
        const { b } = w
        hostHandle.host.state.inUse.add(chaIdOf(b.db, 3))
        const owner = chars(b.db)[3]
        const chatArray = chatsAt(b.db, 3)
        const [x, y] = chatArray
        const outcome = await peerCommits(w, (db) => {
            chatsAt(db, 3)[1].note = 'peer y note'
            chars(db)[3].globalLore = []
        })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(chatsAt(b.db, 3)[1].note).toBe('peer y note')
        expect(chars(b.db)[3].globalLore).toEqual([])
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        // Identity: the owner, the chats array and both chat objects are the ones B held.
        expect(chars(b.db)[3]).toBe(owner)
        expect(chatsAt(b.db, 3)).toBe(chatArray)
        expect(chatsAt(b.db, 3)[0]).toBe(x)
        expect(chatsAt(b.db, 3)[1]).toBe(y)
        expect(owner.chatPage ?? 0).toBe(0)
        expect(w.world.crashed).toEqual([])
    })

    test('R2 B is clean on C/X and has it open; A appends to X: B shows the message in X\'s same object and message array', async () => {
        const w = await mergeWorld()
        const { b } = w
        hostHandle.host.state.inUse.add(chaIdOf(b.db, 3))
        const x = chatsAt(b.db, 3)[0]
        const array = messagesOf(x)
        const before = array.length
        const outcome = await peerCommits(w, (db) => {
            messagesOf(chatsAt(db, 3)[0]).push({ role: 'user', data: 'peer appended', time: 1 })
        })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(chatsAt(b.db, 3)[0]).toBe(x)
        expect(messagesOf(x)).toBe(array)
        expect(array).toHaveLength(before + 1)
        expect(array[before].data).toBe('peer appended')
    })

    test('R3 B has an unsaved edit in C/X, C is not open; A edits C\'s card: the card is taken, X keeps the edit, B\'s next commit holds both', async () => {
        const w = await mergeWorld()
        const { b } = w
        const chaId = chaIdOf(b.db, 3)
        chatsAt(b.db, 3)[0].note = 'my unsaved note'
        const outcome = await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(personalityOf(b.db, 3)).toBe('peer card')
        expect(chatsAt(b.db, 3)[0].note).toBe('my unsaved note')
        const saved = w.world.state.saved
        w.world.mark(chaId)
        await until(() => w.world.state.saved > saved, 'the own commit', 8000)
        const read = await w.page.freeze()
        expect(personalityOf(read.db, 3)).toBe('peer card')
        expect(chatsAt(read.db, 3)[0].note).toBe('my unsaved note')
    })

    test('R4 an unmarked raw edit in a record A did not change survives the take and the next pass commits it with no mark by the test', async () => {
        const w = await mergeWorld()
        const { b } = w
        Reflect.set(chatsAt(b.db, 3)[0], 'note', 'raw unmarked note')
        const outcome = await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(chatsAt(b.db, 3)[0].note).toBe('raw unmarked note')
        await until(() => w.world.state.saved >= 1, 'the commit of the kept record', 8000)
        const read = await w.page.freeze()
        expect(chatsAt(read.db, 3)[0].note).toBe('raw unmarked note')
        expect(personalityOf(read.db, 3)).toBe('peer card')
    })

    test('R5 both sides changed chat Y: park conflict:char:<id>:chat:<cid>, and Y keeps this page\'s edit', async () => {
        const w = await mergeWorld()
        const { b } = w
        const cid = String(chatsAt(b.db, 3)[1].id)
        hostHandle.host.state.inUse.add(chaIdOf(b.db, 3))
        chatsAt(b.db, 3)[1].note = 'mine'
        const outcome = await peerCommits(w, (db) => { chatsAt(db, 3)[1].note = 'theirs' })
        expect(outcome).toEqual({ kind: 'park', reason: `conflict:char:${chaIdOf(b.db, 3)}:chat:${cid}` })
        expect(chatsAt(b.db, 3)[1].note).toBe('mine')
    })
})

describe('whole-character records (R6)', () => {
    async function worldWithEmptyChatId() {
        return mergeWorld({
            before: async (page) => {
                await page.commitEdit((db) => { chatsAt(db, 3)[0].id = '' })
            },
        })
    }

    test('R6 a chat with an empty id: a peer-only change takes the whole character in place; both sides changing is one whole conflict', async () => {
        const w = await worldWithEmptyChatId()
        const { b } = w
        hostHandle.host.state.inUse.add(chaIdOf(b.db, 3))
        const first = chatsAt(b.db, 3)[0]
        const outcome = await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(personalityOf(b.db, 3)).toBe('peer card')
        expect(chatsAt(b.db, 3)[0]).toBe(first)
        chars(b.db)[3].personality = 'my card'
        const again = await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card two' })
        expect(again).toEqual({ kind: 'park', reason: `conflict:char:${chaIdOf(b.db, 3)}:whole` })
        expect(personalityOf(b.db, 3)).toBe('my card')
    })
})

describe('chat list and view (R8, R11)', () => {
    test('R8 A prepends a chat: B\'s view stays on the same chat id at its new index, and the chat objects keep their identity', async () => {
        const w = await mergeWorld()
        const { b } = w
        hostHandle.host.state.inUse.add(chaIdOf(b.db, 3))
        const x = chatsAt(b.db, 3)[0]
        const outcome = await peerCommits(w, (db) => {
            const chats = chatsAt(db, 3)
            chats.unshift({ ...JSON.parse(JSON.stringify(chats[0])) as Record<string, unknown>, id: 'copy-by-peer', name: 'Copy' })
            chars(db)[3].chatPage = 1
        })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(chatsAt(b.db, 3).map(chat => chat.id)).toContain('copy-by-peer')
        expect(chatsAt(b.db, 3)[0].id).toBe('copy-by-peer')
        expect(chatsAt(b.db, 3)[1]).toBe(x)
        expect(chars(b.db)[3].chatPage).toBe(1)
    })

    test('R11 A deletes B\'s shown, unwritten chat: B shows the chat A shows, else the first', async () => {
        const w = await mergeWorld()
        const { b } = w
        hostHandle.host.state.inUse.add(chaIdOf(b.db, 3))
        const survivor = chatsAt(b.db, 3)[1]
        const outcome = await peerCommits(w, (db) => { chatsAt(db, 3).splice(0, 1) })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(chatsAt(b.db, 3)).toHaveLength(1)
        expect(chatsAt(b.db, 3)[0]).toBe(survivor)
        expect(chars(b.db)[3].chatPage ?? 0).toBe(0)
    })
})

describe('trash, deletion against an edit and shapes (R10, R14)', () => {
    test('R10 B edits open C; A trashes C: both merge with no park', async () => {
        const w = await mergeWorld()
        const { b } = w
        hostHandle.host.state.inUse.add(chaIdOf(b.db, 3))
        chatsAt(b.db, 3)[0].note = 'my edit while open'
        const at = Date.now()
        const outcome = await peerCommits(w, (db) => { trash(db, 3, at) })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(chars(b.db)[3].trashTime).toBe(at)
        expect(chatsAt(b.db, 3)[0].note).toBe('my edit while open')
        expect(b.peer.asked).toEqual([])
    })

    test('R14 B deletes the only message of a one-message chat; A appends to it: a conflict, not a silent take, and B keeps its deletion', async () => {
        const w = await mergeWorld()
        const { b } = w
        const cid = String(chatsAt(b.db, 3)[1].id)
        expect(messagesOf(chatsAt(b.db, 3)[1])).toHaveLength(1)
        messagesOf(chatsAt(b.db, 3)[1]).length = 0
        const outcome = await peerCommits(w, (db) => { messagesOf(chatsAt(db, 3)[1]).push({ role: 'user', data: 'peer reply', time: 2 }) })
        expect(outcome).toEqual({ kind: 'park', reason: `conflict:char:${chaIdOf(b.db, 3)}:chat:${cid}` })
        expect(messagesOf(chatsAt(b.db, 3)[1])).toHaveLength(0)
    })
})
