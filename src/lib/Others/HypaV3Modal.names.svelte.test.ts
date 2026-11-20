// @vitest-environment jsdom

/**
 * `HypaV3Modal.svelte`: the search previous and next buttons and the search field are named, the
 * conversion button keeps its text name, and the whole open modal (header, summary cards, bulk bar,
 * footer) has no unnamed control or field, no exposed glyph and no default-palette class beyond the
 * `bg-black/50` scrim (E2) and the metric badges (E6). Mounts the REAL modal with its real children over
 * a real `$state` database; the summarizer, the translator and the script engine are stubs, as in
 * `HypaV3Modal.targets.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => true),
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => {
            if (k in t) return t[k as string]
            if (k === 'then' || typeof k === 'symbol') return undefined
            return vi.fn(async () => {})
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
    summarize: vi.fn(async () => 'REROLLED'),
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

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import HypaV3Modal from './HypaV3Modal.svelte'

const SCRIM = /^bg-black\/50$/
const E6 = [SCRIM, /^bg-(blue|green|purple|yellow)-900\/70$/, /^text-(blue|green|purple|yellow)-200$/]

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

function installDb(summaryTexts: string[]): void {
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: 'hello', chats: [{
                id: 'chat-a', name: '', note: '', localLore: [],
                message: summaryTexts.map((text) => ({ chatId: 'memo-' + text, role: 'char', data: 'body of ' + text, time: 0 })),
                hypaV3Data: {
                    summaries: summaryTexts.map((text, i) => ({ text, chatMemos: ['memo-' + text], isImportant: i === 0 })),
                    categories: [{ id: '', name: 'none' }],
                    lastSelectedSummaries: [],
                    metrics: { lastImportantSummaries: [0], lastRecentSummaries: [1], lastSimilarSummaries: [2], lastRandomSummaries: [] },
                },
            }],
        }],
    } as unknown as Database
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

beforeEach(() => {
    installDb(['s0', 's1', 's2'])
    Element.prototype.scrollIntoView = () => {}
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const headerButtons = (target: HTMLElement) =>
    Array.from((target.querySelector('h1')!.nextElementSibling as HTMLElement).querySelectorAll(':scope > button')) as HTMLButtonElement[]
const moreButton = (target: HTMLElement) => target.querySelector('div.relative > button') as HTMLButtonElement

async function openSearch(target: HTMLElement): Promise<void> {
    headerButtons(target)[0].click()
    await settle()
}

describe('HypaV3Modal accessible names', () => {
    test('regression reproducer: the search bar names its previous and next buttons and its field', async () => {
        const target = mountModal()
        await openSearch(target)
        const field = target.querySelector('input[placeholder]') as HTMLInputElement
        expect(controlName(field)).toBe(language.search)
        const bar = field.closest('div.flex.items-center.gap-2') as HTMLElement
        const barButtons = Array.from(bar.querySelectorAll(':scope > button')) as HTMLButtonElement[]
        expect(barButtons.map(controlName)).toEqual([language.chatShellFindPrev, language.chatShellFindNext])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the search field uses the shared focus ring, not a zinc ring', async () => {
        const target = mountModal()
        await openSearch(target)
        const field = target.querySelector('input[placeholder]') as HTMLInputElement
        expect(field.classList.contains('risu-focus-ring')).toBe(true)
        expect(Array.from(field.classList).filter((c) => c.startsWith('focus:ring'))).toEqual([])
    })

    test('regression reproducer: the open modal with the dropdown, metrics, bulk bar and search has no unnamed control or field', async () => {
        const target = mountModal()
        await openSearch(target)
        moreButton(target).click()
        await settle()
        const menu = target.querySelector('div.absolute.right-0') as HTMLElement
        ;(menu.querySelector('button') as HTMLButtonElement).click()
        await settle()
        headerButtons(target)[2].click()
        await settle()
        expect(target.querySelectorAll('input[type=checkbox]').length).toBe(3)
        expect(target.querySelector('textarea')).not.toBeNull()
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the glyphs of the whole modal are hidden', async () => {
        const target = mountModal()
        await openSearch(target)
        moreButton(target).click()
        await settle()
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: no default-palette class is left beyond the scrim and the metric badges', async () => {
        const target = mountModal()
        await openSearch(target)
        moreButton(target).click()
        await settle()
        ;(target.querySelector('div.absolute.right-0 button') as HTMLButtonElement).click()
        await settle()
        headerButtons(target)[2].click()
        await settle()
        expect(paletteClasses(target, { allow: E6 })).toEqual([])
        for (const el of Array.from(target.querySelectorAll('.bg-darkbutton'))) {
            expect(el.classList.contains('hover:bg-selected')).toBe(false)
        }
    })

    test('regression reproducer: the search-hit highlight on a connected message uses the themed border ring and is removed after the timeout', async () => {
        const memo = 'abcd1234'
        installDb(['s0', 's1'])
        DBState.db.characters[0].chats[0].hypaV3Data.summaries[1].chatMemos = [memo]
        const target = mountModal()
        // Summaries start collapsed; the connected-message buttons exist only while a summary is expanded.
        for (const toggle of Array.from(target.querySelectorAll('button.gap-2.text-sm.text-textcolor2'))) {
            (toggle as HTMLButtonElement).click()
        }
        await settle()
        await openSearch(target)
        const field = target.querySelector('input[placeholder]') as HTMLInputElement
        field.value = memo
        field.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
        const bar = field.closest('div.flex.items-center.gap-2') as HTMLElement
        const nextButton = bar.querySelectorAll(':scope > button')[1] as HTMLButtonElement
        const button = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes(memo)) as HTMLButtonElement
        expect(button).toBeDefined()
        vi.useFakeTimers()
        try {
            nextButton.click()
            flushSync()
            expect(button.classList.contains('ring-2')).toBe(true)
            expect(button.classList.contains('ring-borderc')).toBe(true)
            expect(button.classList.contains('ring-zinc-500')).toBe(false)
            vi.advanceTimersByTime(1000)
            expect(button.classList.contains('ring-2')).toBe(false)
            expect(button.classList.contains('ring-borderc')).toBe(false)
            expect(button.classList.contains('ring-zinc-500')).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })

    test('guard: the empty state with a possible conversion keeps its text-named button and has no palette class', async () => {
        installDb([])
        DBState.db.characters[0].chats[0].hypaV3Data = { summaries: [], categories: [], lastSelectedSummaries: [] } as never
        const target = mountModal()
        expect(unnamedControls(target, { fields: true })).toEqual([])
        expect(paletteClasses(target, { allow: E6 })).toEqual([])
    })
})
