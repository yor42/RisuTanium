// @vitest-environment happy-dom
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
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import type { Database } from 'src/ts/storage/database.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { resetPutBackForTest, startCharacterPutBack } from 'src/ts/process/memory/characterPutBack'
import { isColdStub } from 'src/ts/storage/store2/codec'
import { setFastForwardHostForTest } from 'src/ts/storage/store2/fastForward'
import { bootB, ffSetup, ffTeardown, ffWorld, runLoopWorld, signal, sleepMs, takenBy, type PageB } from './ffFixtures'
import { chaIdOf, chars } from './lineFixtures'

/**
 * The page's own notion of "in use", through the fast-forward's real host: the host binds `inUse` to the put-back's keep
 * set, so the open selection, the previous selection and the members of an open group are never swapped for a peer's
 * stub (the stage-1 install route): the peer's body change is merged into the same full character. A character with a
 * reply being written is neither swapped nor changed until the reply ends. A binding to a narrower set routes one of
 * them to the stub install, and these rows fail.
 */

let stopPutBack: (() => void) | null = null

beforeEach(() => {
    ffSetup()
    setFastForwardHostForTest(null)
    resetPutBackForTest()
})

afterEach(() => {
    stopPutBack?.()
    stopPutBack = null
    resetPutBackForTest()
    selectedCharID.set(-1)
    DBState.db = {} as unknown as Database
    ffTeardown()
})

const PEER_BODY = 'peer body edit'

async function pageOver(options: { replyOwners?: () => ReadonlySet<string> } = {}) {
    const base = await ffWorld()
    const b: PageB = await bootB(base.memory)
    DBState.db = b.db
    return { ...base, b, world: runLoopWorld(b.context, b.db, options) }
}

describe('a character in use here is never swapped for a peer\'s stub', () => {
    test('U0 control: a character in use nowhere is swapped for the peer\'s stub, so the rows below prove the guard and not the setup', async () => {
        const { memory, page, b, world } = await pageOver()
        await page.commitEdit((db) => { chars(db)[3].personality = PEER_BODY })
        signal(world)
        await takenBy(b, memory)
        expect(isColdStub(chars(b.db)[3])).toBe(true)
        expect(b.peer.clean).toEqual([])
    })

    test('U1 the open selection takes the peer\'s body change in place and stays a full character', async () => {
        const { memory, page, b, world } = await pageOver()
        selectedCharID.set(3)
        await page.commitEdit((db) => { chars(db)[3].personality = PEER_BODY })
        signal(world)
        await takenBy(b, memory)
        expect(isColdStub(chars(b.db)[3])).toBe(false)
        expect(chars(b.db)[3].personality).toBe(PEER_BODY)
        expect(b.peer.clean).toEqual([])
        expect(b.peer.asked).toEqual([])
    })

    test('U2 the previous selection takes the peer\'s body change in place after the selection moved on', async () => {
        const { memory, page, b, world } = await pageOver()
        stopPutBack = startCharacterPutBack()
        selectedCharID.set(3)
        selectedCharID.set(0)
        await page.commitEdit((db) => { chars(db)[3].personality = PEER_BODY })
        signal(world)
        await takenBy(b, memory)
        expect(isColdStub(chars(b.db)[3])).toBe(false)
        expect(chars(b.db)[3].personality).toBe(PEER_BODY)
        expect(b.peer.clean).toEqual([])
    })

    test('U3 the members of the open group take the peer\'s body change in place', async () => {
        const { memory, page, b, world } = await pageOver()
        const member = chaIdOf(b.db, 3)
        chars(b.db)[1].type = 'group'
        chars(b.db)[1].characters = [member]
        selectedCharID.set(1)
        await page.commitEdit((db) => { chars(db)[3].personality = PEER_BODY })
        signal(world)
        await takenBy(b, memory)
        expect(isColdStub(chars(b.db)[3])).toBe(false)
        expect(chars(b.db)[3].personality).toBe(PEER_BODY)
        expect(b.peer.clean).toEqual([])
    })

    test('U4 a character whose reply is being written waits for the reply to end, then is no longer in use', async () => {
        let owners: ReadonlySet<string> = new Set()
        const { memory, page, b, world } = await pageOver({ replyOwners: () => owners })
        const before = chars(b.db)[3].personality
        owners = new Set([chaIdOf(b.db, 3)])
        await page.commitEdit((db) => { chars(db)[3].personality = PEER_BODY })
        signal(world)
        // While the reply is written the whole fast-forward waits: nothing applied, no notice, never a stub.
        await sleepMs(400)
        expect(isColdStub(chars(b.db)[3])).toBe(false)
        expect(chars(b.db)[3].personality).toBe(before)
        expect(b.peer.clean).toEqual([])
        expect(b.peer.asked).toEqual([])
        // With the reply over nothing holds the character, so it takes the clean, not-open stub install.
        owners = new Set()
        await takenBy(b, memory)
        expect(isColdStub(chars(b.db)[3])).toBe(true)
        expect(b.peer.clean).toEqual([])
    })
})
