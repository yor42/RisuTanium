// @vitest-environment jsdom

/**
 * The bulk bar, the bulk re-summary result and the two managers inside the REAL `HypaV3Modal.svelte` (#438 W3-6b). The bar and the result are the
 * last children of the modal frame; the managers are siblings of the identity layer. The REAL modal is mounted with its real children, the real
 * `WindowedSegment` and the real windowing geometry hook over a real `$state` database; each element is found by tag, text, aria-label or structure,
 * never by its part.
 *
 * Tests starting `acceptance:` fail on the base (the W3-6b parts are absent). Tests starting `guard:` pass before and after.
 * MOCKED: the alerts, the summarizer, the translator, the script engine and the save marks, as in `HypaV3Modal.parts.svelte.test.ts`. Synthetic data only.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const hoisted = vi.hoisted(() => ({
    settings: { processRegexScript: false, preserveOrphanedMemory: false, doNotSummarizeUserMessage: false },
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
        hypaV3ModalOpen: writable(false),
        settingsOpen: writable(false),
        SettingsMenuIndex: writable(0),
        selIdState: { selId: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    summarize: vi.fn(async () => 'REROLLED'),
    getCurrentHypaV3Preset: vi.fn(() => ({ settings: hoisted.settings })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(async (text: string) => text),
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

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

//#endregion

import { language } from 'src/lang'
import { alertConfirm } from 'src/ts/alert'
import { DBState, hypaV3ModalOpen } from 'src/ts/stores.svelte'
import { allRowsGeometry, setWindowGeometryForTests } from 'src/ts/windowing/windowHost.svelte'
import HypaV3Modal from './HypaV3Modal.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

type Installed = { firstMessage?: string, withNext?: boolean }

/** Three summaries over the messages `s0`..`s2`; `memo-next` is the message after the last memo unless `withNext` is false. */
function installDb(texts: string[], { firstMessage = 'hello', withNext = true }: Installed = {}): void {
    const message = texts.map((text) => ({ chatId: 'memo-' + text, role: 'char', data: 'body of ' + text, time: 0 }))
    if (withNext) message.push({ chatId: 'memo-next', role: 'char', data: 'body of next', time: 0 })
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage, chats: [{
                id: 'chat-a', name: '', note: '', localLore: [],
                message,
                hypaV3Data: {
                    summaries: texts.map((text, i) => ({ text, chatMemos: ['memo-' + text], isImportant: i === 0 })),
                    categories: [{ id: '', name: 'none' }],
                    lastSelectedSummaries: [],
                    metrics: { lastImportantSummaries: [0], lastRecentSummaries: [1], lastSimilarSummaries: [2], lastRandomSummaries: [] },
                },
            }],
        }],
    } as unknown as Database
}

const chatOf = () => DBState.db.characters[0].chats[0]

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function mountModal(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(HypaV3Modal, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    // The windowed cards mount once the host has read the band.
    await Promise.resolve()
    flushSync()
    await Promise.resolve()
    flushSync()
    await settle()
    return target
}


beforeEach(() => {
    // Every card falls in the window: these tests are about where the parts sit, not about which cards are in the page.
    setWindowGeometryForTests(allRowsGeometry())
    hoisted.settings.processRegexScript = false
    hoisted.settings.preserveOrphanedMemory = false
    hoisted.settings.doNotSummarizeUserMessage = false
    hoisted.processScriptFull.mockReset()
    vi.mocked(alertConfirm).mockClear()
    hypaV3ModalOpen.set(false)
    installDb(['s0', 's1', 's2'])
    Element.prototype.scrollIntoView = () => {}
})

afterEach(async () => {
    setWindowGeometryForTests(undefined)
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

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

/** The names of the parted elements as a nested string: `name(child child)`; an element without a part is looked through. */
function outline(el: Element): string {
    const inner = Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')
    const name = partOf(el)
    if (name === null) return inner
    return inner === '' ? name : `${name}(${inner})`
}

/** The outline of what an element holds, without the element's own part. */
const inside = (el: Element): string => Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')

const frameOf = (target: HTMLElement) => (target.firstElementChild!.firstElementChild as HTMLElement).firstElementChild as HTMLElement
const headerOf = (target: HTMLElement) => frameOf(target).firstElementChild as HTMLElement
const bodyOf = (target: HTMLElement) => frameOf(target).children[1] as HTMLElement

const BAR = 'modal-footer(modal-controls(modal-action) modal-controls(modal-field modal-action modal-action modal-field modal-action modal-action))'
const RESULT = 'modal-footer(modal-title modal-controls(modal-action modal-action modal-action modal-action) modal-field)'
const CATEGORY_MANAGER = 'modal-hypa-v3-category-manager(modal-frame(modal-header(modal-title modal-controls(modal-action modal-close)) modal-list(modal-row modal-row(modal-action) modal-text)))'
const TAG_MANAGER = 'modal-hypa-v3-tag-manager(modal-frame(modal-header(modal-title modal-close) modal-controls(modal-field modal-action) modal-list(modal-text)))'

const partsOfChildren = (el: Element): Array<string | null> => Array.from(el.children).map(partOf)

async function enterBulkMode(target: HTMLElement): Promise<void> {
    byLabel(headerOf(target), language.hypaV3BulkEdit).click()
    await settle()
}

/** Ticks the first two cards and asks for the merged summary; the mocked summarizer answers at once. */
async function resummarizeFirstTwo(target: HTMLElement): Promise<void> {
    const boxes = Array.from(bodyOf(target).querySelectorAll<HTMLInputElement>('input[type=checkbox]'))
    expect(boxes.length).toBeGreaterThanOrEqual(2)
    boxes[0].click()
    await settle()
    boxes[1].click()
    await settle()
    byText(frameOf(target), 'button', language.hypaV3Modal.reSummarize).click()
    await settle()
}

describe('HypaV3Modal bulk bar, bulk result and managers inside the real modal', () => {
    test('acceptance: the bulk bar is the last child of the frame', async () => {
        const target = await mountModal()
        expect(partsOfChildren(frameOf(target))).toEqual(['modal-header', 'modal-body'])
        await enterBulkMode(target)
        const frame = frameOf(target)
        expect(partsOfChildren(frame)).toEqual(['modal-header', 'modal-body', 'modal-footer'])
        const bar = frame.lastElementChild as HTMLElement
        expect(bar.parentElement).toBe(frame)
        expect(outline(bar)).toBe(BAR)
    })

    test('acceptance: the result sits in the frame between the body and the bar', async () => {
        const target = await mountModal()
        await enterBulkMode(target)
        await resummarizeFirstTwo(target)
        const frame = frameOf(target)
        expect(partsOfChildren(frame)).toEqual(['modal-header', 'modal-body', 'modal-footer', 'modal-footer'])
        const result = frame.children[2] as HTMLElement
        expect(result.parentElement).toBe(frame)
        expect(byText(result, 'h3', language.hypaV3Modal.reSummarizeResult).closest('[data-part="modal-footer"]')).toBe(result)
        expect(outline(result)).toBe(RESULT)
        expect(outline(frame.lastElementChild as HTMLElement)).toBe(BAR)
    })

    test('acceptance: the managers are siblings of the identity layer', async () => {
        const target = await mountModal()
        expect(target.children).toHaveLength(1)
        byLabel(headerOf(target), language.hypaV3Modal.categoryManager).click()
        await settle()
        expect(target.children).toHaveLength(2)
        expect(partOf(target.children[0])).toBe('modal-hypa-v3')
        const categories = target.children[1] as HTMLElement
        expect(partOf(categories)).toBe('modal-hypa-v3-category-manager')
        expect(categories.parentElement).toBe(target)
        expect(outline(categories)).toBe(CATEGORY_MANAGER)

        byLabel(categories, language.uiCommon.close).click()
        await settle()
        expect(target.children).toHaveLength(1)

        const addTag = target.querySelector<HTMLButtonElement>(`button[title="${language.hypaV3Modal.tagManager}"]`)
        expect(addTag).not.toBeNull()
        addTag!.click()
        await settle()
        expect(target.children).toHaveLength(2)
        const tags = target.children[1] as HTMLElement
        expect(partOf(tags)).toBe('modal-hypa-v3-tag-manager')
        expect(tags.parentElement).toBe(target)
        expect(outline(tags)).toBe(TAG_MANAGER)
    })

    test('guard: applying the result asks once, merges the held summaries and leaves the bar as the last child', async () => {
        const target = await mountModal()
        await enterBulkMode(target)
        await resummarizeFirstTwo(target)
        expect(chatOf().hypaV3Data.summaries).toHaveLength(3)
        const result = frameOf(target).children[2] as HTMLElement
        byLabel(result, language.apply).click()
        await settle()
        expect(alertConfirm).toHaveBeenCalledTimes(1)
        expect(chatOf().hypaV3Data.summaries).toHaveLength(2)
        expect(frameOf(target).children).toHaveLength(3)
    })
})
