// @vitest-environment jsdom

/**
 * `botpreset.svelte`: every icon-only control has an accessible name and a hidden glyph, the compare
 * and edit toggles expose their state, the four `role="button"` row controls activate on Enter and
 * Space only when they are the event target, the edit-mode name field is named, and scheme tokens
 * replace the palette classes (the drop indicator and the compare toggle use a ring as their
 * non-colour cue). The scrim stays `bg-black/50` (E2). Mounts the REAL component with the mocks of
 * `botpreset.deleteTarget.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'
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
        hubURL: '', usingSw: false,
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

vi.mock('src/lib/Others/PromptDiffModal.svelte', () => ({ default: () => {} }))

//#endregion

import { language } from 'src/lang'
import { RISU_PRESET_DRAG_TYPE } from 'src/ts/dragTypes'
import { DBState } from 'src/ts/stores.svelte'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import BotPreset from './botpreset.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountPresets(): HTMLElement {
    DBState.db = {
        formatversion: 5,
        botPresets: [{ name: 'P1', aiModel: 'm1' }, { name: 'P2', aiModel: 'm2' }],
        botPresetsId: 0,
        aiModel: 'm1',
        NAIsettings: {},
        showPromptComparison: true,
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(BotPreset, { target, props: { close: vi.fn() } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function rowControls(target: HTMLElement, title: string): HTMLElement[] {
    const span = Array.from(target.querySelectorAll('span')).find((s) => s.textContent?.trim() === title)
    if (!span) throw new Error('row not found: ' + title)
    return Array.from(span.closest('button')!.querySelectorAll<HTMLElement>('[role=button]'))
}

function toolbar(target: HTMLElement): HTMLButtonElement[] {
    return Array.from(target.querySelectorAll('div.flex.mt-2.items-center > button'))
}

function key(el: Element, init: KeyboardEventInit): void {
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    flushSync()
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('botpreset accessible names', () => {
    test('regression reproducer: the X, the row controls and the toolbar are named and every glyph is hidden', () => {
        const target = mountPresets()
        expect(controlName(target.querySelector('div.grow.flex.justify-end > button')!)).toBe(language.uiCommon.close)
        for (const title of ['P1', 'P2']) {
            expect(rowControls(target, title).map(controlName)).toEqual([
                language.comparePreset, language.copy, language.export, language.remove,
            ])
        }
        expect(toolbar(target).map(controlName)).toEqual([language.add, language.import, language.presetBundleSelect, language.othersUi.editMode])
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the edit-mode name field is named', () => {
        const target = mountPresets()
        toolbar(target)[3].click()
        flushSync()
        expect(unnamedControls(target, { fields: true })).toEqual([])
        const fields = Array.from(target.querySelectorAll('input[type="text"]'))
        expect(fields.map(controlName)).toEqual([language.name, language.name])
    })
})

describe('botpreset state and keyboard', () => {
    test('regression reproducer: the edit and compare toggles expose their state', () => {
        const target = mountPresets()
        const diff = rowControls(target, 'P1')[0]
        expect(diff.getAttribute('aria-pressed')).toBe('false')
        diff.click()
        flushSync()
        expect(diff.getAttribute('aria-pressed')).toBe('true')
        expect(diff.classList.contains('ring-1')).toBe(true)
        const edit = toolbar(target)[3]
        expect(edit.getAttribute('aria-pressed')).toBe('false')
        edit.click()
        flushSync()
        expect(edit.getAttribute('aria-pressed')).toBe('true')
    })

    test('regression reproducer: Space activates a row control from the control itself, Enter from a nested element does not', () => {
        const target = mountPresets()
        const diff = rowControls(target, 'P1')[0]
        key(diff.querySelector('svg')!, { key: 'Enter' })
        expect(diff.getAttribute('aria-pressed')).toBe('false')
        key(diff.querySelector('svg')!, { key: ' ' })
        expect(diff.getAttribute('aria-pressed')).toBe('false')
        key(diff, { key: ' ' })
        expect(diff.getAttribute('aria-pressed')).toBe('true')
        key(diff, { key: 'Enter' })
        expect(diff.getAttribute('aria-pressed')).toBe('false')
    })
})

describe('botpreset colours', () => {
    test('regression reproducer: no palette class remains at rest except the scrim', () => {
        const target = mountPresets()
        expect(paletteClasses(target, { allow: [/^bg-black\/50$/] })).toEqual([])
        const divider = target.querySelector('div[role="listitem"]') as HTMLElement
        expect(divider.classList.contains('hover:bg-selected')).toBe(true)
    })

    test('regression reproducer: the drag-over drop indicator uses the selected fill with a ring', () => {
        const target = mountPresets()
        const dragData = { types: [RISU_PRESET_DRAG_TYPE], effectAllowed: '', dropEffect: '', setData: vi.fn(), setDragImage: vi.fn(), getData: vi.fn() }
        const fire = (el: Element, type: string) => {
            const event = new Event(type, { bubbles: true, cancelable: true })
            Object.defineProperty(event, 'dataTransfer', { value: dragData })
            el.dispatchEvent(event)
            flushSync()
        }
        const row = target.querySelector('button[draggable="true"]')!
        fire(row, 'dragstart')
        const divider = target.querySelector('div[role="listitem"]') as HTMLElement
        fire(divider, 'dragover')
        for (const cls of ['bg-selected', 'ring-1', 'ring-borderc']) {
            expect(divider.classList.contains(cls)).toBe(true)
        }
        expect(paletteClasses(target, { allow: [/^bg-black\/50$/] })).toEqual([])
    })
})
