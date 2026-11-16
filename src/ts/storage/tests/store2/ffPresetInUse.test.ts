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
import { bootB, ffSetup, ffTeardown, ffWorld, runLoopWorld, signal, takenBy, type PageB } from './ffFixtures'
import { chaIdOf, chars, until } from './lineFixtures'

/**
 * The page's own notion of "in use", through the fast-forward's real host: the host binds `inUse` to the put-back's keep
 * set, so the open selection, the previous selection and the members of an open group are never swapped for a peer's
 * stub, and a character with a reply being written is never swapped either. A binding to a narrower set swaps one of
 * them, and these rows fail.
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

    test('U1 the open selection parks the peer\'s body change and stays a full character', async () => {
        const { page, b, world } = await pageOver()
        selectedCharID.set(3)
        await page.commitEdit((db) => { chars(db)[3].personality = PEER_BODY })
        signal(world)
        await until(() => b.peer.clean.length >= 1, 'the clean notice', 8000)
        expect(isColdStub(chars(b.db)[3])).toBe(false)
    })

    test('U2 the previous selection stays a full character after the selection moved on', async () => {
        const { page, b, world } = await pageOver()
        stopPutBack = startCharacterPutBack()
        selectedCharID.set(3)
        selectedCharID.set(0)
        await page.commitEdit((db) => { chars(db)[3].personality = PEER_BODY })
        signal(world)
        await until(() => b.peer.clean.length >= 1, 'the clean notice', 8000)
        expect(isColdStub(chars(b.db)[3])).toBe(false)
    })

    test('U3 the members of the open group stay full characters', async () => {
        const { page, b, world } = await pageOver()
        const member = chaIdOf(b.db, 3)
        chars(b.db)[1].type = 'group'
        chars(b.db)[1].characters = [member]
        selectedCharID.set(1)
        await page.commitEdit((db) => { chars(db)[3].personality = PEER_BODY })
        signal(world)
        await until(() => b.peer.clean.length >= 1, 'the clean notice', 8000)
        expect(isColdStub(chars(b.db)[3])).toBe(false)
    })

    test('U4 a character whose reply is being written stays a full character', async () => {
        let owners: ReadonlySet<string> = new Set()
        const { page, b, world } = await pageOver({ replyOwners: () => owners })
        owners = new Set([chaIdOf(b.db, 3)])
        await page.commitEdit((db) => { chars(db)[3].personality = PEER_BODY })
        signal(world)
        await until(() => b.peer.clean.length >= 1 || b.peer.asked.length >= 1, 'the notice', 8000)
        expect(isColdStub(chars(b.db)[3])).toBe(false)
    })
})
