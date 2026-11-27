// @vitest-environment jsdom

/**
 * `modal-summary-item.svelte` carries the overlay vocabulary on its real elements (#438 W3-6a). The REAL component is mounted over a real `$state`
 * database; each element is found by tag, id, aria-label, title, text or structure, never by its part, and the part is asserted on it together with
 * its direct parent. The outline tests pin the whole nesting of a plain card, a card with tags and metric badges, and a card with every panel open, so
 * a part that is dropped, renamed, swapped with a sibling or its parent, or moved inward or outward fails.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: the alerts, the summarizer, the translator, the script engine and the module checks, as in `modal-summary-item.names.svelte.test.ts`.
 * Synthetic data only.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const hoisted = vi.hoisted(() => ({
    settings: { processRegexScript: false },
    processScriptFull: vi.fn(),
}))

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
    getCurrentHypaV3Preset: vi.fn(() => ({ settings: hoisted.settings })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(async (text: string) => 'T:' + text),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scripts'), () => ({
    processScriptFull: hoisted.processScriptFull,
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
import { alertConfirm } from 'src/ts/alert'
import { DBState } from 'src/ts/stores.svelte'
import ModalSummaryItem from './modal-summary-item.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

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
    hoisted.settings.processRegexScript = false
    hoisted.processScriptFull.mockReset()
    vi.mocked(alertConfirm).mockClear()
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

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null
const norm = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()

/** The only element of the selector whose normalised text is exactly `text`. */
function byText(root: ParentNode, selector: string, text: string): HTMLElement {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => norm(el.textContent) === norm(text))
    expect(found, `${selector} with text ${text}`).toHaveLength(1)
    return found[0]
}

/** The only button of the root whose aria-label is exactly `label`. */
function byLabel(root: ParentNode, label: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((el) => el.getAttribute('aria-label') === label)
    expect(found, `button labelled ${label}`).toHaveLength(1)
    return found[0]
}

/** The only textarea that the element with this id labels. */
function labelled(root: ParentNode, label: HTMLElement): HTMLTextAreaElement {
    const found = Array.from(root.querySelectorAll<HTMLTextAreaElement>('textarea')).filter((el) => el.getAttribute('aria-labelledby') === label.id)
    expect(found, `textarea labelled by ${label.id}`).toHaveLength(1)
    return found[0]
}

/** The names of the parted elements as a nested string: `name(child child)`; an element without a part is looked through. */
function outline(el: Element): string {
    const inner = Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')
    const name = partOf(el)
    if (name === null) return inner
    return inner === '' ? name : `${name}(${inner})`
}

const S0 = 'modal-row(modal-field modal-text modal-text modal-action modal-action modal-text modal-text modal-text modal-text modal-controls(modal-action modal-action modal-action modal-action modal-action) modal-field modal-action modal-action modal-list(modal-action))'
const S1 = 'modal-row(modal-field modal-text modal-text modal-action modal-controls(modal-action modal-action modal-action modal-action modal-action) modal-field modal-action modal-action modal-list(modal-action))'

const card = (target: HTMLElement) => target.firstElementChild as HTMLElement
const headerRow = (target: HTMLElement) => card(target).firstElementChild as HTMLElement
const leftGroup = (target: HTMLElement) => headerRow(target).firstElementChild as HTMLElement
const cardControls = (target: HTMLElement) => headerRow(target).lastElementChild as HTMLElement
const countLabel = () => language.hypaV3Modal.connectedMessageCountLabel.replace('{0}', '1')

/** A wrapper without a part that holds the element, itself held by `holder`. */
function expectPlainWrapper(el: Element, holder: Element): void {
    const wrapper = el.parentElement as HTMLElement
    expect(partOf(wrapper)).toBeNull()
    expect(wrapper.parentElement).toBe(holder)
}

describe('modal-summary-item overlay parts', () => {
    test('acceptance: the card root, with an unparted header row and left group', () => {
        const target = mountItem(0)
        const root = card(target)
        expect(partOf(root)).toBe('modal-row')
        expect(root.parentElement).toBe(target)
        expect(partOf(headerRow(target))).toBeNull()
        expect(headerRow(target).parentElement).toBe(root)
        expect(partOf(leftGroup(target))).toBeNull()
        expect(leftGroup(target).parentElement).toBe(headerRow(target))
    })

    test('acceptance: the left group holds the checkbox, the number, the category chip, the tag chips and the badges', () => {
        const target = mountItem(0)
        const left = leftGroup(target)
        const box = left.querySelector('input[type=checkbox]') as HTMLElement
        expect(partOf(box)).toBe('modal-field')
        expect(box.parentElement).toBe(left)
        const number = left.querySelector('span[id$="-number"]') as HTMLElement
        expect(partOf(number)).toBe('modal-text')
        expect(number.parentElement).toBe(left)
        const chip = Array.from(left.querySelectorAll<HTMLElement>(':scope > span')).filter((s) => s.querySelector('svg') !== null)
        expect(chip).toHaveLength(1)
        expect(partOf(chip[0])).toBe('modal-text')
        expect(chip[0].parentElement).toBe(left)
        const tag = byText(left, 'button', '#alpha')
        expect(partOf(tag)).toBe('modal-action')
        expect(tag.parentElement).toBe(left)
        const addTag = left.querySelector(`button[title="${language.hypaV3Modal.tagManager}"]`) as HTMLElement
        expect(partOf(addTag)).toBe('modal-action')
        expect(addTag.parentElement).toBe(left)
        for (const text of [language.hypaV3Modal.importantBadge, language.recent, language.hypaV3Modal.similarBadge, language.random]) {
            const badge = byText(left, 'span', text)
            expect(partOf(badge), text).toBe('modal-text')
            expectPlainWrapper(badge, left)
        }
    })

    test('acceptance: the card controls and their five actions', () => {
        const target = mountItem(0)
        const controls = cardControls(target)
        expect(partOf(controls)).toBe('modal-controls')
        expect(controls.parentElement).toBe(headerRow(target))
        const labels = [language.translate, language.hypaV3Modal.importantBadge, language.reroll, language.uiCommon.delete, language.hypaV3DeleteAfter]
        expect(Array.from(controls.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))).toEqual(labels)
        for (const label of labels) {
            const button = byLabel(controls, label)
            expect(partOf(button), label).toBe('modal-action')
            expect(button.parentElement, label).toBe(controls)
        }
    })

    test('acceptance: the summary text area sits in an unparted wrapper', () => {
        const target = mountItem(0)
        const area = card(target).querySelector('textarea[aria-labelledby$="-number"]') as HTMLElement
        expect(partOf(area)).toBe('modal-field')
        expectPlainWrapper(area, card(target))
    })

    test('acceptance: the translation label and its text area', async () => {
        const target = mountItem(0)
        await activate(byLabel(cardControls(target), language.translate))
        const label = byText(card(target), 'div[id]', language.hypaV3Modal.translationLabel)
        expect(partOf(label)).toBe('modal-text')
        const area = labelled(card(target), label)
        expect(partOf(area)).toBe('modal-field')
        expect(area.parentElement).toBe(label.parentElement)
        expectPlainWrapper(label, card(target))
    })

    test('acceptance: the rerolled panel, its controls and its translation', async () => {
        const target = mountItem(0)
        byLabel(cardControls(target), language.reroll).click()
        await settle()
        const label = byText(card(target), 'span', language.hypaV3Modal.rerolledSummaryLabel)
        expect(partOf(label)).toBe('modal-text')
        const row = label.parentElement as HTMLElement
        expect(partOf(row)).toBeNull()
        const controls = label.nextElementSibling as HTMLElement
        expect(partOf(controls)).toBe('modal-controls')
        expect(controls.parentElement).toBe(row)
        for (const name of [language.translate, language.cancel, language.apply]) {
            const button = byLabel(controls, name)
            expect(partOf(button), name).toBe('modal-action')
            expect(button.parentElement, name).toBe(controls)
        }
        const area = labelled(card(target), label)
        expect(partOf(area)).toBe('modal-field')
        expectPlainWrapper(area, card(target))

        await activate(byLabel(controls, language.translate))
        const translationLabel = byText(card(target), 'div[id]', language.hypaV3Modal.rerolledTranslationLabel)
        expect(partOf(translationLabel)).toBe('modal-text')
        const translationArea = labelled(card(target), translationLabel)
        expect(partOf(translationArea)).toBe('modal-field')
        expect(translationArea.parentElement).toBe(translationLabel.parentElement)
        expectPlainWrapper(translationLabel, card(target))
    })

    test('acceptance: the connected messages header, its translate button and the chip list', () => {
        const target = mountItem(0)
        const collapse = byText(card(target), 'button', countLabel())
        expect(partOf(collapse)).toBe('modal-action')
        expect(partOf(collapse.parentElement)).toBeNull()
        const messageTranslate = collapse.parentElement!.querySelector(':scope > div > button') as HTMLElement
        expect(partOf(messageTranslate)).toBe('modal-action')
        expect(partOf(messageTranslate.parentElement)).toBeNull()
        const chip = byText(card(target), 'button', 'memo-s0')
        expect(partOf(chip)).toBe('modal-action')
        const list = chip.parentElement as HTMLElement
        expect(partOf(list)).toBe('modal-list')
        expect(list.parentElement).toBe(card(target))
    })

    test('acceptance: the expanded message, its role label and its translation', async () => {
        const target = mountItem(0)
        byText(card(target), 'button', 'memo-s0').click()
        await settle()
        const role = byText(card(target), 'div[id]', language.hypaV3Modal.connectedMessageRoleLabel.replace('{0}', 'char'))
        expect(partOf(role)).toBe('modal-text')
        const area = labelled(card(target), role)
        expect(area.value).toBe('body of s0')
        expect(partOf(area)).toBe('modal-field')
        expect(area.parentElement).toBe(role.parentElement)
        expectPlainWrapper(role, card(target))

        const collapse = byText(card(target), 'button', countLabel())
        await activate(collapse.parentElement!.querySelector(':scope > div > button') as HTMLButtonElement)
        const translationLabel = byText(card(target), 'div[id]', language.hypaV3Modal.connectedMessageTranslationLabel)
        expect(partOf(translationLabel)).toBe('modal-text')
        const translationArea = labelled(card(target), translationLabel)
        expect(partOf(translationArea)).toBe('modal-field')
        expect(translationArea.parentElement).toBe(translationLabel.parentElement)
        expectPlainWrapper(translationLabel, card(target))
    })

    test('acceptance: the connected message that is not found', async () => {
        DBState.db.characters[0].chats[0].hypaV3Data.summaries[1].chatMemos = ['memo-gone']
        const target = mountItem(1)
        byText(card(target), 'button', 'memo-gone').click()
        await settle()
        const span = byText(card(target), 'span', language.hypaV3Modal.connectedMessageNotFoundLabel)
        expect(partOf(span)).toBe('modal-text')
        expectPlainWrapper(span, card(target))
    })

    test('acceptance: the connected message that fails to load, and the whole outline of each card', async () => {
        hoisted.settings.processRegexScript = true
        hoisted.processScriptFull.mockRejectedValue(new Error('boom'))
        const failing = mountItem(0)
        byText(card(failing), 'button', 'memo-s0').click()
        await settle()
        const span = byText(card(failing), 'span', language.hypaV3Modal.connectedMessageLoadingError.replace('{0}', 'boom'))
        expect(partOf(span)).toBe('modal-text')
        expectPlainWrapper(span, card(failing))

        hoisted.settings.processRegexScript = false
        expect(outline(mountItem(0))).toBe(S0)
        expect(outline(mountItem(1))).toBe(S1)
    })

    test('acceptance: the outline of a card with the translation and the rerolled panel open', async () => {
        const target = mountItem(0)
        await activate(byLabel(cardControls(target), language.translate))
        byLabel(cardControls(target), language.reroll).click()
        await settle()
        const rerolledControls = byText(card(target), 'span', language.hypaV3Modal.rerolledSummaryLabel).nextElementSibling as HTMLElement
        await activate(byLabel(rerolledControls, language.translate))
        const inserted = ' modal-text modal-field modal-text modal-controls(modal-action modal-action modal-action) modal-field modal-text modal-field'
        const afterSecondField = S0.indexOf('modal-field', S0.indexOf('modal-field') + 1) + 'modal-field'.length
        expect(outline(card(target).parentElement!)).toBe(S0.slice(0, afterSecondField) + inserted + S0.slice(afterSecondField))
    })
})

describe('modal-summary-item behaviour and unclaimed elements', () => {
    test('guard: Delete this and Delete after confirm and remove, the star toggles, Apply writes the rerolled text, a tag chip opens the manager', async () => {
        const onOpenTagManager = vi.fn()
        const target = mountItem(0, { onOpenTagManager })
        byText(card(target), 'button', '#alpha').click()
        expect(onOpenTagManager).toHaveBeenCalledWith(0)

        const summaries = DBState.db.characters[0].chats[0].hypaV3Data.summaries
        byLabel(cardControls(target), language.hypaV3Modal.importantBadge).click()
        await settle()
        expect(summaries[0].isImportant).toBe(false)

        byLabel(cardControls(target), language.reroll).click()
        await settle()
        const rerolledControls = byText(card(target), 'span', language.hypaV3Modal.rerolledSummaryLabel).nextElementSibling as HTMLElement
        byLabel(rerolledControls, language.apply).click()
        await settle()
        expect(summaries[0].text).toBe('REROLLED')

        byLabel(cardControls(target), language.uiCommon.delete).click()
        await settle()
        expect(vi.mocked(alertConfirm)).toHaveBeenCalledTimes(1)
        expect(DBState.db.characters[0].chats[0].hypaV3Data.summaries).toHaveLength(1)
    })

    test('guard: Delete after confirms twice and leaves the earlier summaries', async () => {
        const target = mountItem(0)
        byLabel(cardControls(target), language.hypaV3DeleteAfter).click()
        await settle()
        expect(vi.mocked(alertConfirm)).toHaveBeenCalledTimes(2)
        expect(DBState.db.characters[0].chats[0].hypaV3Data.summaries).toHaveLength(1)
    })

    test('guard: the panel wrappers, the rerolled header row and the count span carry no part', async () => {
        const target = mountItem(0)
        await activate(byLabel(cardControls(target), language.translate))
        byLabel(cardControls(target), language.reroll).click()
        await settle()
        byText(card(target), 'button', 'memo-s0').click()
        await settle()
        expect(partOf(headerRow(target))).toBeNull()
        expect(partOf(leftGroup(target))).toBeNull()
        const badge = byText(leftGroup(target), 'span', language.hypaV3Modal.importantBadge)
        expect(partOf(badge.parentElement)).toBeNull()
        const rerolledLabel = byText(card(target), 'span', language.hypaV3Modal.rerolledSummaryLabel)
        expect(partOf(rerolledLabel.parentElement)).toBeNull()
        const panels = Array.from(card(target).querySelectorAll<HTMLElement>(':scope > div:not(.flex)'))
        expect(panels.length).toBeGreaterThan(0)
        for (const panel of panels) expect(partOf(panel), panel.className).toBeNull()
        const collapse = byText(card(target), 'button', countLabel())
        expect(collapse.querySelector('span')).not.toBeNull()
        expect(partOf(collapse.querySelector('span'))).toBeNull()
    })
})
