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

import { isColdStub } from 'src/ts/storage/store2/codec'
import type { OpenedBackend } from './fenceFixtures'
import {
    bootB, ffSetup, ffTeardown, ffWorldOver, openNamed, ownEdit, personalityOf, scenarioR25, scenarioR29, scenarioR30, signal, takenBy,
    type BackendName,
} from './ffFixtures'
import { chars, parsedKey, runLoopOver } from './lineFixtures'

/**
 * The fast-forward over several hops on the memory store: two dispatch-booted pages run the real
 * save loop over one store and each takes the other's commit before its own, and the rows that must hold on every
 * store (a bulk final that does not descend, a commit-key rollback, a peer that alternates with this page) are run
 * here on memory. The Node variants are in ffLoopNode.test.ts.
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

const NAMES: readonly BackendName[] = ['memory']

describe.each(NAMES)('%s', (name) => {
    test('R30 two pages alternating disjoint commits: each takes the other\'s commit before its own and neither parks', async () => {
        opened = await openNamed(name)
        const backend = opened.backend
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
        for (const page of [a, b]) {
            expect(page.peer.asked).toEqual([])
            expect(page.peer.clean).toEqual([])
        }
        expect(loopA.crashed).toEqual([])
        expect(loopB.crashed).toEqual([])
        const final = await page.freeze()
        expect(personalityOf(final.db, 0)).toBe('a3')
        expect(personalityOf(final.db, 1)).toBe('b3')
        expect(personalityOf(a.db, 0)).toBe('a3')
        expect(personalityOf(b.db, 1)).toBe('b3')
        // What each page took from the other is its stub or its text; never an older value.
        expect(isColdStub(chars(a.db)[1]) || personalityOf(a.db, 1) === 'b3').toBe(true)
        expect(isColdStub(chars(b.db)[0]) || personalityOf(b.db, 0) === 'a3').toBe(true)
        expect(a.context.encoder.manifestKey).toBe((await parsedKey(backend)).current?.key)
    })

    test('R30 a peer page alternating with the booted page', async () => {
        opened = await openNamed(name)
        await scenarioR30(name, opened.backend)
    })

    test('R29 a commit-key rollback parks and applies nothing', async () => {
        opened = await openNamed(name)
        await scenarioR29(name, opened.backend)
    })

    test('R25 a bulk final over this page\'s commit under the marker parks and keeps its edit', async () => {
        opened = await openNamed(name)
        await scenarioR25(name, opened.backend)
    })
})
