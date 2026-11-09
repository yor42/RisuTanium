// @vitest-environment happy-dom

/**
 * HypaV3Modal under Svelte's async scheduler: block effects run before the component's
 * own `$effect.pre`, so the modal must not read `hypaV3Data` in markup until that effect
 * has created it for a chat that has none.
 *
 * The app ships the sync scheduler; this file switches the async one on for itself through
 * the public `svelte/internal/flags/async` export (vitest isolates module state per file;
 * `beforeAll` enables it before the first mount),
 * so it pins the guard against a later flag change. The chat without `hypaV3Data` has the
 * shape `createNewChat` in `src/ts/characters.ts` produces.
 *
 * Mounts the REAL `HypaV3Modal.svelte` with its real children over a real `$state`
 * database. The summarizer, translator, script engine, alerts and module wait are stubs.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach, beforeAll } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: async () => false,
        alertStore: writable({ type: 'none', msg: '' }),
    }
    const recorded: Record<string, unknown> = {}
    return new Proxy(stub, {
        get: (t, k) => {
            if (k in t) return t[k as string]
            if (k === 'then' || typeof k === 'symbol') return undefined
            return (recorded[k] ??= vi.fn(async () => {}))
        },
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        hypaV3ModalOpen: writable(false),
        settingsOpen: writable(false),
        SettingsMenuIndex: writable(0),
        selIdState: { selId: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    summarize: vi.fn(async () => ''),
    getCurrentHypaV3Preset: vi.fn(() => ({ settings: { processRegexScript: false } })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(async (text: string) => text),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scripts'), () => ({
    processScriptFull: vi.fn(),
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/moduleRefList'), () => ({
    hasModuleStubs: vi.fn(() => false),
}) as unknown as typeof import('src/ts/process/moduleRefList'))

vi.mock(import('src/ts/process/moduleEnsure'), () => ({
    ensureCurrentModulesOrAlert: vi.fn(async (): Promise<boolean> => true),
}) as unknown as typeof import('src/ts/process/moduleEnsure'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import HypaV3Modal from './HypaV3Modal.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Chat 0 holds two summaries; chat 1 is shaped like the chat `createNewChat` adds: no `hypaV3Data`. */
function installTwoChats(): void {
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: '',
            chats: [
                {
                    id: 'chat-a', name: '', message: [], note: '', localLore: [],
                    hypaV3Data: {
                        summaries: ['s0', 's1'].map((text) => ({ text, chatMemos: ['memo-' + text], isImportant: false })),
                        categories: [{ id: '', name: 'none' }],
                        lastSelectedSummaries: [],
                    },
                },
                { id: 'chat-b', message: [], note: '', name: 'New Chat 2', localLore: [], fmIndex: -1 },
            ],
        }],
    } as unknown as Database
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

// A static import is rejected by the Svelte compiler in a .svelte.test.ts file; the flag is
// read at runtime, so enabling it before the first mount is enough.
beforeAll(async () => {
    await import('svelte/internal/flags/async')
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('HypaV3Modal under the async scheduler', () => {
    test('regression reproducer: switching to a chat without hypaV3Data creates it and shows the empty state without throwing', async () => {
        installTwoChats()
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(HypaV3Modal, { target, props: {} }) as unknown as Record<string, unknown>
        mounted.push({ target, app })
        flushSync()
        await sleep(20)
        flushSync()
        expect(target.querySelectorAll('textarea').length, 'chat 0 shows its two summaries').toBe(2)

        DBState.db.characters[0].chatPage = 1
        expect(() => flushSync()).not.toThrow()
        await sleep(20)
        expect(() => flushSync()).not.toThrow()

        const created = DBState.db.characters[0].chats[1].hypaV3Data
        expect(created, 'chat 1 gets the default hypaV3Data').toBeDefined()
        expect(created!.summaries).toEqual([])
        expect(target.querySelectorAll('textarea').length, 'no summary cards remain').toBe(0)
        expect(target.querySelector('h1'), 'the modal is rendered').not.toBeNull()
    })
})
