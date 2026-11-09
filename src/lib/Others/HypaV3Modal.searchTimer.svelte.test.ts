// @vitest-environment jsdom

/**
 * The desktop search jump to a summary match focuses the summary textarea read-only and returns focus to the
 * search field after a short delay. The delayed callback must tolerate a modal that closed in the meantime, and
 * while the modal stays open it must still restore focus and clear the textarea's readOnly flag.
 *
 * Mounts the REAL `HypaV3Modal.svelte` over a real `$state` database; collaborators are stubs.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => false),
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
    ensureCurrentModulesOrAlert: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/process/moduleEnsure'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { enterKeydown, imeEventSequence } from 'src/ts/ime/tests/imeEventSequence'
import HypaV3Modal from './HypaV3Modal.svelte'

function installDb(): void {
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: '',
            chats: [{
                id: 'chat-0', name: '', message: [], note: '', localLore: [],
                hypaV3Data: {
                    summaries: ['alpha one', 'alpha two'].map((text) => ({ text, chatMemos: ['memo-' + text], isImportant: false })),
                    categories: [{ id: '', name: 'none' }],
                    lastSelectedSummaries: [],
                },
            }],
        }],
    } as unknown as Database
    selectedCharID.set(0)
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown>, open: boolean }> = []

function mountModal(): { target: HTMLElement, entry: (typeof mounted)[number] } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(HypaV3Modal, { target, props: {} }) as unknown as Record<string, unknown>
    const entry = { target, app, open: true }
    mounted.push(entry)
    flushSync()
    return { target, entry }
}

function openSearch(target: HTMLElement): HTMLInputElement {
    const bar = target.querySelector('h1')!.nextElementSibling as HTMLElement
    ;(bar.querySelector(':scope > button') as HTMLButtonElement).click()
    flushSync()
    const field = target.querySelector<HTMLInputElement>('form input')
    if (!field) throw new Error('no search field')
    return field
}

// Runs a search so the jump lands on the first summary match; the textarea is read-only until the timer fires.
function jumpToFirstSummaryMatch(target: HTMLElement): { field: HTMLInputElement, textarea: HTMLTextAreaElement } {
    const field = openSearch(target)
    imeEventSequence(field, 'alpha')
    flushSync()
    enterKeydown(field)
    flushSync()
    const textarea = Array.from(target.querySelectorAll('textarea')).find((t) => t.readOnly)
    if (!textarea) throw new Error('search jump did not make a textarea read-only')
    return { field, textarea }
}

beforeEach(() => {
    installDb()
    Element.prototype.scrollIntoView = vi.fn()
    // The desktop branch runs only where the window has no `ontouchend`; jsdom declares the handler property.
    vi.stubGlobal('window', new Proxy(window, {
        has: (target, key) => key !== 'ontouchend' && Reflect.has(target, key),
        get: (target, key) => {
            const value = Reflect.get(target, key, target)
            return typeof value === 'function' ? value.bind(target) : value
        },
    }))
    vi.useFakeTimers()
})

afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    for (const m of mounted) {
        if (m.open) await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('T-R-Hypa search jump focus timer', () => {
    test('guard: while the modal is open, the timer returns focus to the search field and clears readOnly', () => {
        const { target } = mountModal()
        const { field, textarea } = jumpToFirstSummaryMatch(target)
        expect(document.activeElement).toBe(textarea)
        vi.advanceTimersByTime(300)
        expect(textarea.readOnly).toBe(false)
        expect(document.activeElement).toBe(field)
    })

    test('the timer does nothing that throws after the modal unmounted', async () => {
        const { target, entry } = mountModal()
        jumpToFirstSummaryMatch(target)
        await unmount(entry.app as never)
        entry.open = false
        expect(() => vi.advanceTimersByTime(300)).not.toThrow()
    })
})
