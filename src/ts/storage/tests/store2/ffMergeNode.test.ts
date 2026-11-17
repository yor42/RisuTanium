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
import { chaIdOf, chars } from './lineFixtures'
import { chatsAt, ffSetup, ffTeardown, mergeWorld, openNamed, peerCommits } from './ffFixtures'

/**
 * Stage 3B row R1n: R1 on a node-kind page over the real Node server (a child process, as the other node rows). The
 * merge is the same record-by-record take; a pass here says nothing about a real browser.
 */

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let hostHandle: ReturnType<typeof ffSetup>
let opened: OpenedBackend | null = null

beforeEach(() => {
    hostHandle = ffSetup()
})

afterEach(async () => {
    ffTeardown()
    await opened?.close()
    opened = null
})

describe('the open character merges in place on a node page (R1n)', () => {
    test('R1n B shows C/X and has it open; A edits C/Y and C\'s lore: both are taken with no park, X and the objects stay', async () => {
        opened = await openNamed('node')
        const w = await mergeWorld({ backend: opened.backend, kind: 'node' })
        const { b } = w
        expect(b.context.session.kind).toBe('node')
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
        expect(chars(b.db)[3]).toBe(owner)
        expect(chatsAt(b.db, 3)).toBe(chatArray)
        expect(chatsAt(b.db, 3)[0]).toBe(x)
        expect(chatsAt(b.db, 3)[1]).toBe(y)
        expect(w.world.crashed).toEqual([])
    })
})
