/**
 * `stopComposerWorkIn` on the REAL composer actions and the REAL work registry: it stops the work registered for the origin
 * it names and nothing registered for another chat, whatever the global abort would do. The collaborators of the composer
 * module are mocked.
 */
import { describe, test, expect, vi, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const state = stores.DBState as unknown as { db: unknown }
    return {
        getDatabase: vi.fn(() => state.db),
        getCurrentCharacter: vi.fn(() => undefined),
        getCurrentChat: vi.fn(() => undefined),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/process/sendCharacterMessage'), () => ({
    sendCharacterMessage: vi.fn(),
}) as unknown as typeof import('src/ts/process/sendCharacterMessage'))

vi.mock(import('src/ts/process/prereroll'), () => ({
    addRerolls: vi.fn(),
}) as unknown as typeof import('src/ts/process/prereroll'))

vi.mock(import('src/ts/process/command'), () => ({
    processMultiCommand: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/process/command'))

vi.mock(import('src/ts/translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/coldstorageData'), () => ({
    isColdChat: vi.fn(() => false),
}) as unknown as typeof import('src/ts/process/coldstorageData'))

//#endregion

import { stopComposerWorkIn } from 'src/ts/process/composerActions.svelte'
import { registerWork, type WorkHandle } from 'src/ts/process/chatOrigin'

const handles: WorkHandle[] = []

afterEach(() => {
    for (const handle of handles.splice(0)) {
        handle.end()
    }
})

describe('stopComposerWorkIn on the real registry', () => {
    test('guard (M12, kills a wrapper that aborts globally): the stop of the named origin runs and another origin\'s does not', () => {
        const stopA = vi.fn<() => void>()
        const stopB = vi.fn<() => void>()
        const originA = { chaId: 'cha-a', chatId: 'chat-a' }
        const originB = { chaId: 'cha-b', chatId: 'chat-b' }
        handles.push(registerWork(originA, stopA, 'reply'), registerWork(originB, stopB, 'reply'))

        stopComposerWorkIn(originA)

        expect(stopA).toHaveBeenCalledTimes(1)
        expect(stopB).not.toHaveBeenCalled()
    })
})
