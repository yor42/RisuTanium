// @vitest-environment jsdom

/**
 * `modal-summary-item.svelte`: the card header and the rerolled header buttons are named, the star
 * exposes `aria-pressed`, every text area and the bulk checkbox is named by its visible label, the
 * glyphs are hidden and the zinc, rose, red and blue classes are gone (the metric badges keep their
 * hues, E6). Mounts the REAL component over a real `$state` database; the summarizer, the
 * translator and the script engine are stubs, as in `HypaV3Modal.targets.svelte.test.ts`.
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
        selIdState: { selId: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    summarize: vi.fn(async () => 'REROLLED'),
    getCurrentHypaV3Preset: vi.fn(() => ({ settings: { processRegexScript: false } })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(async (text: string) => 'T:' + text),
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

//#endregion

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import ModalSummaryItem from './modal-summary-item.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

/** The hue badges of the metric row keep their categorical colours (E6). */
const E6 = [/^bg-(blue|green|purple|yellow)-900\/70$/, /^text-(blue|green|purple|yellow)-200$/]

const norm = (text: string) => text.replace(/\s+/g, ' ').trim()
const numberLabel = (index: number) => norm(language.hypaV3Modal.summaryNumberLabel.replace('{0}', String(index + 1)))

function installDb(): void {
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: 'hello', chats: [{
                id: 'chat-a', name: '', note: '', localLore: [],
                message: [
                    { chatId: 'memo-s0', role: 'char', data: 'body of s0', time: 0 },
                    { chatId: 'memo-s1', role: 'user', data: 'body of s1', time: 0 },
                ],
                hypaV3Data: {
                    summaries: [
                        { text: 's0', chatMemos: ['memo-s0'], isImportant: true, tags: ['alpha'] },
                        { text: 's1', chatMemos: ['memo-s1'], isImportant: false },
                    ],
                    categories: [{ id: '', name: 'none' }],
                    lastSelectedSummaries: [],
                    metrics: { lastImportantSummaries: [0], lastRecentSummaries: [0], lastSimilarSummaries: [0], lastRandomSummaries: [0] },
                },
            }],
        }],
    } as unknown as Database
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountItem(index: number, extra: Record<string, unknown> = {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props = {
        summaryIndex: index,
        hypaV3Data: DBState.db.characters[0].chats[0].hypaV3Data,
        summaryItemStateMap: new WeakMap(),
        expandedMessageState: null,
        searchState: null,
        filterSelected: true,
        categories: [{ id: '', name: 'none' }],
        bulkEditState: { isEnabled: true, selectedSummaries: new Set<number>(), selectedCategory: '', bulkSelectInput: '' },
        uiState: { collapsedSummaries: new Set<number>(), dropdownOpen: false },
        ...extra,
    }
    const app = mount(ModalSummaryItem, { target, props } as never) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

beforeEach(() => {
    installDb()
    // jsdom has no layout, so the card's scroll-into-view calls need a stand-in.
    Element.prototype.scrollIntoView = () => {}
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

/** Taps a button the way the card's dual-action buttons listen, whichever event the environment wires. */
async function activate(button: HTMLButtonElement): Promise<void> {
    if ('ontouchend' in window) {
        button.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }))
        await sleep(350)
    } else {
        button.click()
    }
    await settle()
}

const card = (target: HTMLElement) => target.firstElementChild as HTMLElement
const headerButtons = (target: HTMLElement) =>
    Array.from((card(target).firstElementChild!.lastElementChild as HTMLElement).querySelectorAll('button')) as HTMLButtonElement[]
const textareas = (target: HTMLElement) => Array.from(target.querySelectorAll('textarea')) as HTMLTextAreaElement[]

describe('modal-summary-item accessible names', () => {
    test('regression reproducer: the card header buttons carry their meaning as the name', () => {
        const target = mountItem(0)
        expect(headerButtons(target).map(controlName)).toEqual([
            language.translate,
            language.hypaV3Modal.importantBadge,
            language.reroll,
            language.uiCommon.delete,
            language.hypaV3DeleteAfter,
        ])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the star exposes aria-pressed that follows the summary', () => {
        const important = mountItem(0)
        expect(headerButtons(important)[1].getAttribute('aria-pressed')).toBe('true')
        const plain = mountItem(1)
        expect(headerButtons(plain)[1].getAttribute('aria-pressed')).toBe('false')
    })

    test('regression reproducer: the bulk checkbox and the original text area are named by the summary number', () => {
        const target = mountItem(0)
        const box = target.querySelector('input[type=checkbox]') as HTMLInputElement
        expect(controlName(box)).toBe(numberLabel(0))
        expect(box.hasAttribute('aria-labelledby')).toBe(false)
        const original = textareas(target)[0]
        expect(controlName(original)).toBe(numberLabel(0))
    })

    test('regression reproducer: the translation, rerolled and connected-message text areas are named by their visible labels', async () => {
        const target = mountItem(0)
        await activate(headerButtons(target)[0])
        expect(textareas(target).map(controlName)).toEqual([numberLabel(0), norm(language.hypaV3Modal.translationLabel)])

        headerButtons(target)[2].click()
        await settle()
        const rerolledHeader = Array.from(card(target).querySelectorAll('span'))
            .find((s) => norm(s.textContent ?? '') === norm(language.hypaV3Modal.rerolledSummaryLabel))!
        const rerolledButtons = Array.from(rerolledHeader.parentElement!.querySelectorAll('button')) as HTMLButtonElement[]
        expect(rerolledButtons.map(controlName)).toEqual([language.translate, language.cancel, language.apply])
        expect(textareas(target).map(controlName)).toContain(norm(language.hypaV3Modal.rerolledSummaryLabel))

        await activate(rerolledButtons[0])
        expect(textareas(target).map(controlName)).toContain(norm(language.hypaV3Modal.rerolledTranslationLabel))

        const memo = Array.from(card(target).querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('memo-s0'))!
        memo.click()
        await settle()
        const roleLabel = norm(language.hypaV3Modal.connectedMessageRoleLabel.replace('{0}', 'char'))
        expect(textareas(target).map(controlName)).toContain(roleLabel)

        const countLabel = norm(language.hypaV3Modal.connectedMessageCountLabel.replace('{0}', '1'))
        const collapse = Array.from(card(target).querySelectorAll('button')).find((b) => norm(b.textContent ?? '') === countLabel)!
        const messageTranslate = collapse.parentElement!.querySelector(':scope > div > button') as HTMLButtonElement
        await activate(messageTranslate)
        expect(textareas(target).map(controlName)).toContain(norm(language.hypaV3Modal.connectedMessageTranslationLabel))

        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the glyphs are hidden from the accessibility tree', async () => {
        const target = mountItem(0)
        headerButtons(target)[2].click()
        await settle()
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: no default-palette class is left except the metric badges (E6)', async () => {
        const target = mountItem(0, { bulkEditState: { isEnabled: true, selectedSummaries: new Set<number>([0]), selectedCategory: '', bulkSelectInput: '' } })
        headerButtons(target)[2].click()
        await settle()
        expect(paletteClasses(target, { allow: E6 })).toEqual([])
    })

    test('regression reproducer: delete hovers to the danger token from a neutral rest; the disabled apply keeps a neutral hover', async () => {
        const target = mountItem(0)
        const deleteButtons = headerButtons(target).slice(3)
        for (const button of deleteButtons) {
            expect(button.classList.contains('text-textcolor2')).toBe(true)
            expect(button.classList.contains('hover:text-draculared')).toBe(true)
        }
        headerButtons(target)[2].click()
        await settle()
        const apply = Array.from(card(target).querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === language.apply) as HTMLButtonElement
        expect(apply.className).toContain('disabled:hover:text-textcolor2')
    })

    test('regression reproducer: the text areas use the shared focus ring instead of a zinc or blue ring', () => {
        const target = mountItem(0)
        const editable = textareas(target).filter((t) => !t.readOnly)
        expect(editable.length).toBeGreaterThan(0)
        for (const area of editable) {
            expect(area.classList.contains('risu-focus-ring')).toBe(true)
            expect(Array.from(area.classList).filter((c) => c.startsWith('focus:ring'))).toEqual([])
        }
        const box = target.querySelector('input[type=checkbox]') as HTMLInputElement
        expect(box.classList.contains('risu-focus-ring')).toBe(true)
    })
})
