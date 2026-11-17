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
import { chaIdOf, chars, parsedKey, until } from './lineFixtures'
import { bootB, ffSetup, ffTeardown, ffWorld, runLoopWorld, sleepMs } from './ffFixtures'

/**
 * A commit-key write this page made itself (a pin, an unpin) is never another writer's: it does not start the five-minute
 * window in which a Node page holds back the question about a standing foreign marker.
 */

const ROWS = 80

beforeEach(() => {
    ffSetup()
})

afterEach(() => {
    ffTeardown()
})

async function nodePageWithOwnWrites(own: 'pin' | 'pin-unpin') {
    const { memory } = await ffWorld({ mintLine: true, count: ROWS })
    const b = await bootB(memory)
    b.context.session = { kind: 'node', committer: b.context.session.committer }
    b.context.markerOwnerProbe = async () => 'unknown'
    b.peer.foreignAnswers.push('wait')
    // Back-offs of 400 ms keep the passes retrying under the marker for longer than the page's own write takes to land.
    const loop = runLoopWorld(b.context, b.db, { sleep: () => sleepMs(400) })
    const committer = b.context.session.committer
    if (committer === null) {
        throw new Error('The page has no committer.')
    }
    const current = (await parsedKey(memory)).current?.key
    if (current === undefined) {
        throw new Error('The store has no current tree.')
    }
    // The marker stands before this page judges any key, so the marker itself is no foreign write it saw.
    const peer = createCommitter(memory, { owner: 'peer-page' })
    void peer.commit(await peer.readCommit(), { newUnits: 100, carry: IMPORT_REPLACES_BASE, label: 'bulk', build: () => new Promise(() => { }) })
    await until(async () => (await parsedKey(memory)).staging !== null, 'the marker', 4000)
    for (const [index] of chars(b.db).entries()) {
        chars(b.db)[index].personality = `edited ${index}`
        loop.mark(chaIdOf(b.db, index))
    }
    // The page's own key write lands while its passes are still retrying under the marker, before the question is due.
    await sleepMs(150)
    expect((await committer.pin(await committer.readCommit(), current, 'own pin')).status).toBe('committed')
    if (own === 'pin-unpin') {
        expect((await committer.unpin(await committer.readCommit(), current)).status).toBe('committed')
    }
    return { b }
}

describe('own commit-key writes are not foreign writes', () => {
    test('R4a a page whose own pin changed the key still asks about a young foreign marker', async () => {
        const { b } = await nodePageWithOwnWrites('pin')
        await until(() => b.peer.foreignAsked.length >= 1, 'the question of a page that wrote only itself', 8000)
    })

    test('R4b an own pin and unpin do not suppress the question either', async () => {
        const { b } = await nodePageWithOwnWrites('pin-unpin')
        await until(() => b.peer.foreignAsked.length >= 1, 'the question after an own pin and unpin', 8000)
    })

    test('R4c a committer knows the epochs of the keys it built, and no other', async () => {
        const { memory } = await ffWorld({ mintLine: true, count: ROWS })
        const committer = createCommitter(memory, { owner: 'own-page' })
        const other = createCommitter(memory, { owner: 'other-page' })
        const current = (await parsedKey(memory)).current?.key
        if (current === undefined) {
            throw new Error('The store has no current tree.')
        }
        const pinned = await committer.pin(await committer.readCommit(), current, 'own pin')
        if (pinned.status !== 'committed') {
            throw new Error('The pin did not commit.')
        }
        expect(committer.ownsEpoch?.(pinned.value.epoch)).toBe(true)
        expect(other.ownsEpoch?.(pinned.value.epoch)).toBe(false)
    })
})
