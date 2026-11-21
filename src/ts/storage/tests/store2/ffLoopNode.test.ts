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

import type { OpenedBackend } from './fenceFixtures'
import { bootB, ffSetup, ffTeardown, ffWorldOver, openNamed, ownEdit, personalityOf, scenarioR25, scenarioR29, scenarioR30, signal, takenBy } from './ffFixtures'
import { parsedKey, runLoopOver } from './lineFixtures'

/**
 * The fast-forward rows over the real Node server (a child process, through the same fixture as the Node backend
 * tests) and a node-kind page booted through the dispatch: the safety rows keep their offers (a Node page cannot save
 * its stale plan), and a peer's descending commits are taken without a park. A pass here says nothing about a real
 * browser or the Tauri commands.
 */

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let opened: OpenedBackend | null = null

beforeEach(() => {
    ffSetup()
})

afterEach(async () => {
    ffTeardown()
    await opened?.close()
    opened = null
})

async function node() {
    opened = await openNamed('node')
    return opened.backend
}

describe('the node variants', () => {
    test('R25 node: a bulk final over this page\'s ordinary commit under the marker parks with the Node offers and no fast-forward', async () => {
        await scenarioR25('node', await node())
    })

    test('R29 node: the first read after a commit-key rollback parks and does not call the fast-forward', async () => {
        await scenarioR29('node', await node())
    })

    test('R30 node: alternating disjoint commits are all taken and nothing parks', async () => {
        await scenarioR30('node', await node())
    })

    test('R30 node two pages alternating disjoint commits: each takes the other\'s commit before its own and neither parks', async () => {
        const backend = await node()
        const { page } = await ffWorldOver(backend)
        const a = await bootB(backend)
        const loopA = runLoopOver(a.context, a.db)
        const b = await bootB(backend)
        const loopB = runLoopOver(b.context, b.db)
        // The other page's boot resets the page-global registrations; the first page keeps running over its own context.
        const hops = [
            { who: a, loop: loopA, other: b, otherLoop: loopB, index: 0, text: 'a1' },
            { who: b, loop: loopB, other: a, otherLoop: loopA, index: 1, text: 'b1' },
            { who: a, loop: loopA, other: b, otherLoop: loopB, index: 0, text: 'a2' },
            { who: b, loop: loopB, other: a, otherLoop: loopA, index: 1, text: 'b2' },
            { who: a, loop: loopA, other: b, otherLoop: loopB, index: 0, text: 'a3' },
            { who: b, loop: loopB, other: a, otherLoop: loopA, index: 1, text: 'b3' },
        ]
        for (const hop of hops) {
            await takenBy(hop.who, backend)
            await ownEdit(hop.loop, hop.who, hop.index, hop.text)
            signal(hop.otherLoop)
            await takenBy(hop.other, backend)
        }
        for (const p of [a, b]) {
            expect(p.peer.asked).toEqual([])
            expect(p.peer.clean).toEqual([])
        }
        expect(loopA.crashed).toEqual([])
        expect(loopB.crashed).toEqual([])
        const final = await page.freeze()
        expect(personalityOf(final.db, 0)).toBe('a3')
        expect(personalityOf(final.db, 1)).toBe('b3')
        expect(a.context.encoder.manifestKey).toBe((await parsedKey(backend)).current?.key)
    })

    test('the page under test is a node session with a fast-forward', async () => {
        const backend = await node()
        await ffWorldOver(backend)
        const b = await bootB(backend)
        expect(b.context.session.kind).toBe('node')
        expect(b.context.fastForward).toBeDefined()
    })
})
