/**
 * The notice at the install seam of `restoreColdCharacter` (`../coldCharacterRestore`) when a store2 residency read
 * dropped damaged alternatives units: the character installs with its main conversation, the person is told which chats
 * lost their alternative replies, and the notice does not depend on the caller's `quiet` option (a drop is not a failure
 * any caller reports). The residency is a stand-in that answers a prepared read; the real read is covered by the
 * residency tests.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    markIdentitySeen: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertClear: vi.fn(),
    waitAlert: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/alert'))

//#endregion

import { restoreColdCharacter } from '../coldCharacterRestore'
import { alertError, alertNormal } from 'src/ts/alert'
import { DBState } from 'src/ts/stores.svelte'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import type { Residency, ResidencyRead } from 'src/ts/storage/store2/residency'
import type { FlaggedLeaf } from 'src/ts/storage/store2/treeBytes'
import type { Database } from 'src/ts/storage/database.svelte'

type Slot = Database['characters'][number]

const KEY = '0'.repeat(26)

function stub(): Slot {
    return { chaId: 'cha-a', name: 'Ann', type: 'character', coldstorage: KEY, chatPage: 0, chats: [] } as unknown as Slot
}

function full(): Slot {
    return {
        chaId: 'cha-a', name: 'Ann', type: 'character', chatPage: 0,
        chats: [
            { id: 'chat-one', name: 'First chat', message: [], note: '', localLore: [] },
            { id: 'chat-two', name: '', message: [], note: '', localLore: [] },
            { name: 'Third chat', message: [], note: '', localLore: [] },
        ],
    } as unknown as Slot
}

function leaf(chatId: string, key: string, part: 'alt' | 'chunk' = 'alt'): FlaggedLeaf {
    return { kind: 'chat', chaId: 'cha-a', chatId, part, key, why: 'damaged' }
}

function register(droppedAlt: readonly FlaggedLeaf[]): void {
    const read = { status: 'ok', value: { character: full() }, entry: { u: KEY }, source: { get: () => undefined }, bytes: 1, droppedAlt } as unknown as Extract<ResidencyRead, { status: 'ok' }>
    registerResidency({ readCharacter: async () => read, hydrate: () => {} } as unknown as Residency)
}

beforeEach(() => {
    vi.mocked(alertNormal).mockClear()
    vi.mocked(alertError).mockClear()
})

afterEach(() => {
    resetResidencyForTest()
    vi.restoreAllMocks()
})

describe('a restore that dropped damaged alternatives units', () => {
    test.each([false, true])('names the chats and the character, whatever the quiet option (quiet %s)', async (quiet) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        register([leaf('chat-one', 'store2/k1'), leaf('~2', 'store2/k2'), leaf('chat-two', 'store2/k3'), leaf('chat-one', 'store2/k4')])
        const archived = stub()
        DBState.db = { characters: [archived] } as unknown as Database

        const outcome = await restoreColdCharacter(archived, { quiet })

        expect(outcome.status === 'restored' && outcome.installedHere).toBe(true)
        expect(alertNormal).toHaveBeenCalledTimes(1)
        const text = vi.mocked(alertNormal).mock.calls[0][0]
        expect(text).toContain('Ann')
        expect(text).toContain('"First chat"')
        expect(text).toContain('"Third chat"')
        expect(text).toContain('"chat-two"')
        expect(text.split('"First chat"')).toHaveLength(2)
        expect(alertError).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledTimes(4)
    })

    test('a restore that dropped nothing shows no notice', async () => {
        register([])
        const archived = stub()
        DBState.db = { characters: [archived] } as unknown as Database

        const outcome = await restoreColdCharacter(archived)

        expect(outcome.status === 'restored' && outcome.installedHere).toBe(true)
        expect(alertNormal).not.toHaveBeenCalled()
    })
})
