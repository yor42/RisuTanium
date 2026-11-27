// @vitest-environment jsdom

/**
 * `botpreset.svelte` carries the overlay vocabulary on its real elements (#438 W3-4, MC-4160). The REAL component is mounted, together with the REAL
 * PromptDiffModal it opens; each element is found by tag, role, aria-label, text or structure, never by its part, and the part is asserted on it
 * together with its direct parent. The outline tests pin the whole nesting for the list, select mode and edit mode, so a part that is dropped,
 * renamed, swapped with a sibling or its parent, moved into a comment, forwarded through a component tag, or moved inward or outward fails.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: the modules of `botpreset.names.svelte.test.ts` (storage and platform edges, the alert module, `src/ts/stores.svelte`), except
 * PromptDiffModal, which is real. Synthetic presets only.
 */
import { flushSync, mount, unmount } from 'svelte'
import { allRowsGeometry, setWindowGeometryForTests } from 'src/ts/windowing/windowHost.svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import 'src/ts/polyfill'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from 'src/ts/platform'

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

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const stub: Record<string, unknown> = {
        forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
        checkCharOrder: vi.fn(),
        requiresFullEncoderReload: { state: false },
        AppendableBuffer: class {}, VirtualWriter: class {}, LocalWriter: class {}, BlankWriter: class {},
        downloadFile: vi.fn(), saveAsset: vi.fn(), readImage: vi.fn(), toGetter: vi.fn((o: unknown) => o),
        aiWatermarkingLawApplies: vi.fn(() => false), aiLawApplies: vi.fn(() => false),
        hubURL: '',
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => false),
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/storage/database.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    const { DBState } = await import('src/ts/stores.svelte')
    return { ...actual, getDatabase: vi.fn((_o?: { snapshot?: boolean }) => DBState.db) }
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false, isNodeServer: false, isIOS: () => false,
    getDetailedOSLabel: vi.fn(async () => 'test-os'), getFallbackOSLabel: vi.fn(() => 'test-os'),
    getRisuEnvironmentLabel: vi.fn((): RisuEnvironmentLabel => 'web'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(),
    remove: vi.fn(), readDir: vi.fn(async () => []), BaseDirectory: { AppData: 0 },
}))

vi.mock('src/ts/tokenizer', () => ({ tokenizeAccurate: vi.fn(async () => 0) }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        MobileGUIStack: writable([]), CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }), MobileSearch: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 }, SettingsMenuIndex: writable(0), ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false), botMakerMode: writable(false), DynamicGUI: writable(false),
        sideBarClosing: writable(false), sideBarStore: writable({ tab: 0 }), PlaygroundStore: writable({ open: false }),
        QuickSettings: writable([]), additionalHamburgerMenu: writable([]), CharConfigSubMenu: writable(0),
        MobileGUI: writable(false), hypaV3ModalOpen: writable(false), ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false), alertGenerationInfoStore: writable(null),
        openPresetList: writable(true),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/characterCards'), () => ({
    openRealmUpload: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

//#endregion

import { language } from 'src/lang'
import { alertConfirm } from 'src/ts/alert'
import { DBState } from 'src/ts/stores.svelte'
import BotPreset from './botpreset.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function plain(name: string, text: string) {
    return { type: 'plain', type2: 'normal', role: 'system', text, name }
}

async function mountPresets(options: { compare?: boolean, close?: () => void } = {}): Promise<HTMLElement> {
    DBState.db = {
        formatversion: 5,
        botPresets: [
            { id: 'p1', name: 'P1', aiModel: 'm1', slot: 1, promptTemplate: [plain('Main', 'a')] },
            { id: 'p2', name: 'P2', aiModel: 'm2', promptTemplate: [plain('Main', 'b')] },
        ],
        botPresetsId: 0,
        aiModel: 'm1',
        NAIsettings: {},
        showPromptComparison: options.compare ?? true,
        promptDiffPrefs: { diffStyle: 'line', formatStyle: 'card', viewStyle: 'unified', showOnlyChanges: false, isGrouped: false, contextRadius: 1 },
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    // The windowed rows mount once the host has read the band: every row falls in it, as these tests are not about which rows are in the page.
    setWindowGeometryForTests(allRowsGeometry())
    const app = mount(BotPreset, { target, props: { close: options.close ?? vi.fn() } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await Promise.resolve()
    flushSync()
    await Promise.resolve()
    flushSync()
    return target
}

beforeEach(() => {
    vi.mocked(alertConfirm).mockClear()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    document.body.replaceChildren()
})

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null

/** The only element of the selector whose trimmed text is exactly `text`. */
function byText(root: ParentNode, selector: string, text: string): HTMLElement {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => el.textContent?.trim() === text)
    expect(found, `${selector} with text ${text}`).toHaveLength(1)
    return found[0]
}

/** The names of the parted elements as a nested string: `name(child child)`; an element without a part is looked through. */
function outline(el: Element): string {
    const inner = Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')
    const name = partOf(el)
    if (name === null) return inner
    return inner === '' ? name : `${name}(${inner})`
}

const labelled = (root: ParentNode, label: string): HTMLElement => {
    const found = root.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`)
    expect(found, `aria-label ${label}`).toHaveLength(1)
    return found[0]
}

/** The row `button` of a preset, found by the text of its name. */
const rowOf = (target: HTMLElement, name: string): HTMLElement => byText(target, 'span', name).closest('button') as HTMLElement

const frameOf = (target: HTMLElement): HTMLElement => target.firstElementChild!.firstElementChild as HTMLElement

const FOUR_ACTIONS = 'modal-action modal-action modal-action modal-action'
const LIST_OUTLINE = `modal-botpreset(modal-frame(modal-header(modal-title modal-close) modal-row(modal-text modal-text modal-controls(${FOUR_ACTIONS})) `
    + `modal-row(modal-text modal-controls(${FOUR_ACTIONS})) modal-footer(${FOUR_ACTIONS}) modal-text))`

describe('botpreset overlay parts', () => {
    test('acceptance: the layer, frame, header, title and close', async () => {
        const target = await mountPresets()
        const layer = target.firstElementChild as HTMLElement
        expect(partOf(layer)).toBe('modal-botpreset')
        const frame = layer.firstElementChild as HTMLElement
        expect(partOf(frame)).toBe('modal-frame')
        expect(frame.parentElement).toBe(layer)
        const title = byText(frame, 'h2', language.presets)
        expect(partOf(title)).toBe('modal-title')
        const header = title.parentElement as HTMLElement
        expect(partOf(header)).toBe('modal-header')
        expect(header.parentElement).toBe(frame)
        const close = labelled(target, language.uiCommon.close)
        expect(partOf(close)).toBe('modal-close')
        const wrapper = close.parentElement as HTMLElement
        expect(partOf(wrapper)).toBeNull()
        expect(wrapper.parentElement).toBe(header)
    })

    test('acceptance: each row, its name, slot badge and four tools, and the unparted list structure around it', async () => {
        const target = await mountPresets()
        const frame = frameOf(target)
        for (const name of ['P1', 'P2']) {
            const nameSpan = byText(target, 'span', name)
            expect(partOf(nameSpan)).toBe('modal-text')
            const row = nameSpan.parentElement as HTMLElement
            expect(row.tagName).toBe('BUTTON')
            expect(partOf(row)).toBe('modal-row')
            const item = row.parentElement as HTMLElement
            expect(item.tagName).toBe('LI')
            expect(item.hasAttribute('data-window-key')).toBe(true)
            expect(partOf(item)).toBeNull()
            const list = item.parentElement as HTMLElement
            expect(list.tagName).toBe('UL')
            expect(partOf(list)).toBeNull()
            expect(list.parentElement).toBe(frame)
            const tools = row.lastElementChild as HTMLElement
            expect(partOf(tools)).toBe('modal-controls')
            expect(tools.parentElement).toBe(row)
            for (const label of [language.comparePreset, language.copy, language.export, language.remove]) {
                const action = labelled(row, label)
                expect(partOf(action), label).toBe('modal-action')
                expect(action.parentElement).toBe(tools)
            }
            for (const gap of Array.from(item.querySelectorAll('[role="listitem"]'))) expect(partOf(gap)).toBeNull()
        }
        const badge = byText(rowOf(target, 'P1'), 'span', '1')
        expect(partOf(badge)).toBe('modal-text')
        expect(badge.parentElement).toBe(rowOf(target, 'P1'))
        for (const gap of Array.from(target.querySelectorAll('[role="listitem"]'))) expect(partOf(gap)).toBeNull()
    })

    test('acceptance: the toolbar buttons and the quick-preset hint', async () => {
        const target = await mountPresets()
        const frame = frameOf(target)
        const add = labelled(target, language.add)
        const toolbar = add.parentElement as HTMLElement
        expect(partOf(toolbar)).toBe('modal-footer')
        expect(toolbar.parentElement).toBe(frame)
        for (const label of [language.add, language.import, language.presetBundleSelect, language.othersUi.editMode]) {
            const button = labelled(target, label)
            expect(button.tagName).toBe('BUTTON')
            expect(partOf(button), label).toBe('modal-action')
            expect(button.parentElement).toBe(toolbar)
        }
        const hint = byText(frame, 'span', language.quickPreset)
        expect(partOf(hint)).toBe('modal-text')
        expect(hint.parentElement).toBe(frame)
    })

    test('acceptance: the whole list nests as header, rows, footer and hint under one layer and frame', async () => {
        const target = await mountPresets()
        expect(outline(target)).toBe(LIST_OUTLINE)
    })

    test('acceptance: select mode swaps the toolbar for the select bar, drops the badge and empties the row tools', async () => {
        const target = await mountPresets()
        labelled(target, language.presetBundleSelect).click()
        flushSync()
        const frame = frameOf(target)
        const bar = frame.querySelector('[data-select-bar]') as HTMLElement
        expect(partOf(bar)).toBe('modal-footer')
        expect(bar.parentElement).toBe(frame)
        const all = byText(bar, 'button', language.presetBundleAll)
        const cancel = byText(bar, 'button', language.cancel)
        const exportButton = bar.querySelectorAll('button')[2] as HTMLElement
        expect(bar.querySelectorAll('button')).toHaveLength(3)
        for (const button of [all, cancel, exportButton]) {
            expect(partOf(button)).toBe('modal-action')
            expect(button.parentElement).toBe(bar)
        }
        expect(target.querySelector('span[data-select-mark]')).not.toBeNull()
        for (const mark of Array.from(target.querySelectorAll('span[data-select-mark]'))) expect(partOf(mark)).toBeNull()
        expect(outline(target)).toBe('modal-botpreset(modal-frame(modal-header(modal-title modal-close) modal-row(modal-text modal-controls) '
            + 'modal-row(modal-text modal-controls) modal-footer(modal-action modal-action modal-action) modal-text))')
    })

    test('acceptance: edit mode keeps the rows and tools and leaves the shared text input unparted', async () => {
        const target = await mountPresets()
        labelled(target, language.othersUi.editMode).click()
        flushSync()
        const inputs = Array.from(target.querySelectorAll('input[type="text"]'))
        expect(inputs).toHaveLength(2)
        for (const input of inputs) expect(partOf(input)).toBeNull()
        expect(outline(target)).toBe(`modal-botpreset(modal-frame(modal-header(modal-title modal-close) modal-row(modal-controls(${FOUR_ACTIONS})) `
            + `modal-row(modal-controls(${FOUR_ACTIONS})) modal-footer(${FOUR_ACTIONS}) modal-text))`)
    })

    test('acceptance: without the comparison setting each row tool group holds three actions', async () => {
        const target = await mountPresets({ compare: false })
        for (const name of ['P1', 'P2']) {
            const tools = rowOf(target, name).lastElementChild as HTMLElement
            expect(partOf(tools)).toBe('modal-controls')
            expect(Array.from(tools.children).map(partOf)).toEqual(['modal-action', 'modal-action', 'modal-action'])
        }
    })

    test('acceptance: the diff modal opened by two Compare picks renders beside the layer with only its four parts', async () => {
        const target = await mountPresets()
        labelled(rowOf(target, 'P1'), language.comparePreset).click()
        flushSync()
        labelled(rowOf(target, 'P2'), language.comparePreset).click()
        flushSync()
        for (let i = 0; i < 5; i++) {
            await sleep(20)
            flushSync()
        }
        const dialog = target.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement
        expect(dialog).not.toBeNull()
        const diffLayer = dialog.parentElement as HTMLElement
        expect(partOf(diffLayer)).toBe('modal-prompt-diff')
        expect(diffLayer.parentElement).toBe(target)
        const listLayer = target.firstElementChild as HTMLElement
        expect(partOf(listLayer)).toBe('modal-botpreset')
        expect(listLayer.contains(diffLayer)).toBe(false)
        expect(outline(diffLayer)).toBe('modal-prompt-diff(modal-frame(modal-header(modal-close)))')
    })

    test('guard: a row click in select mode ticks the row and does nothing else', async () => {
        const close = vi.fn()
        const target = await mountPresets({ close })
        labelled(target, language.presetBundleSelect).click()
        flushSync()
        const row = rowOf(target, 'P2')
        expect(row.getAttribute('aria-pressed')).toBe('false')
        row.click()
        flushSync()
        expect(rowOf(target, 'P2').getAttribute('aria-pressed')).toBe('true')
        expect(close).not.toHaveBeenCalled()
    })

    test('guard: the X closes once, and Remove asks for confirmation and keeps both presets while it is refused', async () => {
        const close = vi.fn()
        const target = await mountPresets({ close })
        labelled(target, language.uiCommon.close).click()
        expect(close).toHaveBeenCalledTimes(1)
        labelled(rowOf(target, 'P2'), language.remove).click()
        await sleep(0)
        flushSync()
        expect(alertConfirm).toHaveBeenCalledTimes(1)
        expect(DBState.db.botPresets.map((p) => p.name)).toEqual(['P1', 'P2'])
    })
})
