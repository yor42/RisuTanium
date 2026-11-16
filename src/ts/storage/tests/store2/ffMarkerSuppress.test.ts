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

import { createCommitter, IMPORT_REPLACES_BASE } from 'src/ts/storage/store2/commit'
import { chaIdOf, chars, parsedKey, runLoopOver, until } from './lineFixtures'
import { bootB, ffSetup, ffTeardown, ffWorld, sleepMs, type PageB } from './ffFixtures'

/**
 * The bounded Node marker-prompt suppression: a standing foreign marker is not asked about while a foreign commit-key
 * write was seen within five minutes and the marker is young; a page that is not Node, or has seen no foreign write, asks
 * as before.
 */

const ROWS = 80

beforeEach(() => {
    ffSetup()
})

afterEach(() => {
    ffTeardown()
})

async function markedPage(kind: 'node' | 'indexeddb', seenForeignWrite: boolean) {
    const { memory } = await ffWorld({ mintLine: true, count: ROWS })
    const b: PageB = await bootB(memory)
    if (kind === 'node') {
        b.context.session = { kind: 'node', committer: b.context.session.committer }
    }
    b.context.markerOwnerProbe = async () => 'unknown'
    b.peer.foreignAnswers.push('wait')
    const loop = runLoopOver(b.context, b.db)
    if (seenForeignWrite) {
        // One own commit so the page has read a key before the foreign marker lands.
        chars(b.db)[0].personality = 'warm up'
        loop.mark(chaIdOf(b.db, 0))
        await until(() => loop.state.saved >= 1, 'the own commit', 4000)
    }
    const peer = createCommitter(memory, { owner: 'peer-page' })
    void peer.commit(await peer.readCommit(), { newUnits: 100, carry: IMPORT_REPLACES_BASE, label: 'bulk', build: () => new Promise(() => { }) })
    await until(async () => (await parsedKey(memory)).staging !== null, 'the marker', 4000)
    for (const [index] of chars(b.db).entries()) {
        chars(b.db)[index].personality = `edited ${index}`
        loop.mark(chaIdOf(b.db, index))
    }
    return { b, loop }
}

describe('Node marker-prompt suppression', () => {
    test('R-M1 a Node page that saw a foreign write recently does not ask about a young marker', async () => {
        const { b } = await markedPage('node', true)
        await sleepMs(900)
        expect(b.peer.foreignAsked).toEqual([])
    })

    test('R-M2 the same page with no foreign write seen asks, as does an indexeddb page', async () => {
        const unseen = await markedPage('node', false)
        await until(() => unseen.b.peer.foreignAsked.length >= 1, 'the question of a page that saw no foreign write', 8000)
        const web = await markedPage('indexeddb', true)
        await until(() => web.b.peer.foreignAsked.length >= 1, 'the question of an indexeddb page', 8000)
    })
})
