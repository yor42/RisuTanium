// @vitest-environment happy-dom

/**
 * The HypaV3 modal's search field takes no search action from a composing Enter, and searches on the Enter that
 * follows a composition end. The next button passes a synthetic Enter event to the search handler, so the
 * guard sits on the field's keydown binding and the button keeps searching even right after a composition.
 *
 * Mounts the REAL `HypaV3Modal.svelte` over a real `$state` database. The summarizer, translator and script
 * engine are stubs. The Enter keydown is built like the Samsung WebView sequence (MC-329): compositionend, then
 * keydown Enter 13 with isComposing false. Only a live composition (isComposing or keyCode 229) holds an Enter;
 * there is no time window after compositionend. The gap test stubs `performance.now` to place the Enter at
 * +2 ms and +200 ms, so a guard that holds an Enter shortly after compositionend fails it.
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

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountModal(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(HypaV3Modal, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function openSearch(target: HTMLElement): HTMLInputElement {
    const bar = target.querySelector('h1')!.nextElementSibling as HTMLElement
    ;(bar.querySelector(':scope > button') as HTMLButtonElement).click()
    flushSync()
    const field = target.querySelector<HTMLInputElement>('form input')
    if (!field) throw new Error('no search field')
    return field
}

// The result counter appears once a search has run.
const counter = (target: HTMLElement) => /\d+\/\d+/.exec(target.textContent ?? '')?.[0] ?? null

beforeEach(() => {
    installDb()
    Element.prototype.scrollIntoView = vi.fn()
})

afterEach(async () => {
    vi.restoreAllMocks()
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('T-R-Hypa the Enter that follows a composition end', () => {
    test.each([2, 200])('an Enter at +%s ms after compositionend searches once', (gap) => {
        const target = mountModal()
        const field = openSearch(target)
        const clock = vi.spyOn(performance, 'now')
        clock.mockReturnValue(1000)
        imeEventSequence(field, 'alpha')
        flushSync()
        clock.mockReturnValue(1000 + gap)
        enterKeydown(field)
        flushSync()
        expect(counter(target)).toBe('1/2')
    })

    test('guard: the next button still searches right after a composition end (programmatic event)', () => {
        const target = mountModal()
        const field = openSearch(target)
        imeEventSequence(field, 'alpha')
        flushSync()
        const buttons = Array.from(field.closest('div.sticky')!.querySelectorAll('button')) as HTMLButtonElement[]
        buttons[buttons.length - 1].click()
        flushSync()
        expect(counter(target)).toBe('1/2')
    })

    test('guard: a composing Enter does not search', () => {
        const target = mountModal()
        const field = openSearch(target)
        imeEventSequence(field, 'alpha')
        flushSync()
        const composing = enterKeydown(field, { isComposing: true, keyCode: 229 })
        flushSync()
        expect(composing.defaultPrevented).toBe(false)
        expect(counter(target)).toBeNull()
    })
})
