// @vitest-environment jsdom

/**
 * `previewMayStart` refuses while a task is shown: a preview started under a running import would post its covering
 * wait, make the card step aside, and generate concurrently with the import.
 *
 * Mocks follow `previewRunner.test.ts`; `alertTask.svelte.ts` is real. Only `sendChat` and the process index are stand-ins.
 */
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import 'src/ts/polyfill'

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

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
    alertStore: writable({ type: 'none', msg: '' }),
    loadoutModalStore: { open: false },
    MobileGUIStack: writable(0),
    MobileSideBar: writable(0),
    openPersonaList: writable(false),
    openPresetList: writable(false),
    OpenRealmStore: writable(false),
    PlaygroundStore: writable(0),
    QuickSettings: { open: false, index: 0 },
    SafeModeStore: writable(false),
    selectedCharID: writable(-1),
    settingsOpen: writable(false),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('src/ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => liveDBState.db),
        changeToPreset: vi.fn(),
        getCurrentCharacter: vi.fn(() => ({ name: 'Bob' })),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: vi.fn(),
}) as unknown as typeof import('src/ts/process/index.svelte'))

//#endregion

import { previewMayStart } from 'src/ts/process/previewRunner'
import { resetAlertPromptsForTests } from 'src/ts/alertPrompts'
import { setComposerWindow } from 'src/ts/process/generationOwnership.svelte'
import { alertTask, answerTask, resetTaskHostForTests } from 'src/ts/alertTask.svelte'
import { alertStore } from 'src/ts/stores.svelte'
import { doingChat as doingChatStore } from 'src/ts/process/index.svelte'
import type { Writable } from 'svelte/store'
const doingChat = doingChatStore as Writable<boolean>

const def = { title: 'Import', steps: [{ label: 'Read file' }] }

beforeEach(() => {
    resetAlertPromptsForTests()
    resetTaskHostForTests()
    doingChat.set(false)
    setComposerWindow(false)
    alertStore.set({ type: 'none', msg: '' })
})

afterEach(() => {
    resetTaskHostForTests()
    resetAlertPromptsForTests()
})

describe('previewMayStart under a task', () => {
    test('R10 refuses while a task is shown over an empty store, and allows again once it is answered or closed', () => {
        expect(previewMayStart()).toBe(true)
        const handle = alertTask(def)
        expect(previewMayStart()).toBe(false)
        void handle.finish({ headline: 'Done' })
        expect(previewMayStart()).toBe(false)
        answerTask({ kind: 'ok' })
        expect(previewMayStart()).toBe(true)

        alertTask(def).close()
        expect(previewMayStart()).toBe(true)
    })
})
