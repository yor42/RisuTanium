// @vitest-environment jsdom

/**
 * The lazy loader of the Theme pack row: the settings registry, the renderer and the shell rows reach only the loader (the
 * row, the install flow and the theme pack runtime load on the first mount), a failed load shows a notice and no unhandled
 * rejection, the host element exists in every state, and a row that arrives late takes focus only when the person has not
 * moved it and the loader is still mounted. All are guards for new behaviour.
 *
 * MOCKED: the row module and the install module count their own evaluation; the platform, file, alert and click-handler
 * modules and `stores.svelte` are the stand-ins the other page tests use, because the registry statically reaches every
 * custom component.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const evaluated = vi.hoisted(() => ({ row: 0, install: 0 }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    encryptBuffer: vi.fn(async (d: unknown) => d),
    selectSingleFile: vi.fn(async () => null),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
    changeFullscreen: vi.fn(),
    sleep: vi.fn(async () => {}),
    selectFileByDom: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string, settings: unknown) => ({ name, settings })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/presets'), () => ({
    normalizeTranslatorPresetState: vi.fn(),
}) as unknown as typeof import('src/ts/translator/presets'))

vi.mock(import('src/ts/polyfill'), () => ({
    safeStructuredClone: vi.fn((v: unknown) => JSON.parse(JSON.stringify(v))),
}) as unknown as typeof import('src/ts/polyfill'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('src/ts/rpack/rpack_js.js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const menu = $state([] as unknown[])
    return {
        DBState: state,
        additionalSettingsMenu: menu,
        easyPanelStore: { open: false },
        SettingsMenuIndex: writable(-1),
        CustomGUISettingMenuStore: writable(false),
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        MobileGUI: writable(false),
        settingsOpen: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

// The row is replaced by the stub, and both modules count their own evaluation.
vi.mock('./ThemePackRow.svelte', async () => {
    evaluated.row += 1
    const stub = await import('./ThemePackRowStub.svelte')
    return { default: stub.default }
})
vi.mock('src/ts/themePack/install', () => {
    evaluated.install += 1
    return { installThemePack: vi.fn(), removeThemePackAt: vi.fn(), setActiveThemePack: vi.fn() }
})

import { language } from 'src/lang'
import { resetSearch, setHighlight } from 'src/ts/settingsShell/settingsSearchState.svelte'
import Loader, { resetThemePackRowLoaderForTests } from './ThemePackRowLoader.svelte'
import ThemePackRowStub from './ThemePackRowStub.svelte'

const ROW_ID = 'display.themePack'
const mounted: Array<ReturnType<typeof mount>> = []
const unhandled: unknown[] = []
const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        flushSync()
        await tick()
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
}

function show(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(Loader, { target }))
    flushSync()
    return target
}

function host(target: HTMLElement): HTMLElement | null {
    return target.querySelector<HTMLElement>('[data-part="theme-pack-row-host"]')
}

function stubRadio(target: HTMLElement): HTMLInputElement | null {
    return target.querySelector<HTMLInputElement>('[data-part="theme-pack-stub-none"]')
}

function deferredRow(): { importRow: () => Promise<{ default: typeof ThemePackRowStub }>, resolve: () => void } {
    let release: () => void = () => {}
    const promise = new Promise<{ default: typeof ThemePackRowStub }>((resolve) => {
        release = () => resolve({ default: ThemePackRowStub })
    })
    return { importRow: () => promise, resolve: release }
}

// The registry statically reaches icon users; the first transform of the icon library is slow and must not land inside a wait.
beforeAll(() => import('@lucide/svelte'), 300000)

beforeEach(() => {
    process.on('unhandledRejection', onUnhandled)
    unhandled.length = 0
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    resetSearch()
    process.off('unhandledRejection', onUnhandled)
})

describe('T4-10 the row loads on the first mount only', () => {
    test('the registry, the renderer and a shell row reach neither the row nor the install module; mounting the loader loads the row', async () => {
        resetThemePackRowLoaderForTests()
        const { customComponents } = await import('src/ts/setting/customComponents')
        await import('src/ts/setting/settingRegistry')
        await import('src/lib/SettingsShell/ShellSettingRow.svelte')
        expect(customComponents['ThemePackRow']).toBe(Loader)
        expect(evaluated.row).toBe(0)
        expect(evaluated.install).toBe(0)

        const target = show()
        expect(stubRadio(target)).toBeNull()
        await settle()
        expect(evaluated.row).toBe(1)
        expect(stubRadio(target)).not.toBeNull()
        expect(evaluated.install).toBe(0)
    })

    test('a later mount renders the loaded row at once', async () => {
        resetThemePackRowLoaderForTests(async () => ({ default: ThemePackRowStub }))
        const first = show()
        await settle()
        expect(stubRadio(first)).not.toBeNull()
        const second = show()
        expect(stubRadio(second)).not.toBeNull()
    })

    test('while it loads, the host element shows the title only', async () => {
        const deferred = deferredRow()
        resetThemePackRowLoaderForTests(deferred.importRow)
        const target = show()
        expect(host(target)).not.toBeNull()
        expect(host(target)!.textContent).toBe(language.themePackRowTitle)
        expect(host(target)!.querySelector('input, button, .loadmove, .animate-spin')).toBeNull()
        deferred.resolve()
        await settle()
        expect(host(target)).not.toBeNull()
        expect(stubRadio(target)).not.toBeNull()
    })

    test('a rejected import shows the notice and reports no unhandled rejection', async () => {
        resetThemePackRowLoaderForTests(() => Promise.reject(new Error('chunk failed')))
        const target = show()
        await settle()
        expect(host(target)!.textContent).toContain(language.themePackRowLoadFailed)
        expect(stubRadio(target)).toBeNull()
        expect(unhandled).toEqual([])
    })

    test('a rejected import is tried again by the next mount', async () => {
        resetThemePackRowLoaderForTests(() => Promise.reject(new Error('chunk failed')))
        show()
        await settle()
        resetThemePackRowLoaderForTests(async () => ({ default: ThemePackRowStub }))
        const again = show()
        await settle()
        expect(stubRadio(again)).not.toBeNull()
    })
})

describe('the late arrival focus', () => {
    test('a row that loads after its arrival takes focus from the page body', async () => {
        const deferred = deferredRow()
        resetThemePackRowLoaderForTests(deferred.importRow)
        const target = show()
        setHighlight(ROW_ID)
        await settle()
        deferred.resolve()
        await settle()
        expect(document.activeElement).toBe(stubRadio(target))
    })

    test('an import that settles in the same synchronous block as the arrival highlight still ends on the first radio', async () => {
        const field = document.createElement('input')
        document.body.appendChild(field)
        field.focus()
        const deferred = deferredRow()
        resetThemePackRowLoaderForTests(deferred.importRow)
        const target = show()
        await settle()
        // Behaviour guard: the import settles and the highlight is set back to back, and the row must still end on its
        // first radio. It does not discriminate the late-focus predicate in jsdom, which does not realise an order in
        // which the row assignment is queued ahead of the flush that carries the highlight (an accepted limitation).
        deferred.resolve()
        setHighlight(ROW_ID)
        await settle()
        expect(stubRadio(target)).not.toBeNull()
        expect(document.activeElement).toBe(stubRadio(target))
    })

    test('it does not take focus the person moved to another control, or when another row was the arrival', async () => {
        const other = document.createElement('button')
        document.body.appendChild(other)
        const deferred = deferredRow()
        resetThemePackRowLoaderForTests(deferred.importRow)
        const target = show()
        setHighlight(ROW_ID)
        await settle()
        other.focus()
        deferred.resolve()
        await settle()
        expect(document.activeElement).toBe(other)
        expect(stubRadio(target)).not.toBeNull()

        const second = deferredRow()
        resetThemePackRowLoaderForTests(second.importRow)
        const target2 = show()
        setHighlight('display.somethingElse')
        await settle()
        other.blur()
        second.resolve()
        await settle()
        expect(document.activeElement).not.toBe(stubRadio(target2))
    })

    test('a row that is already loaded is not focused by the loader', async () => {
        resetThemePackRowLoaderForTests(async () => ({ default: ThemePackRowStub }))
        show()
        await settle()
        const target = show()
        setHighlight(ROW_ID)
        await settle()
        expect(document.activeElement).not.toBe(stubRadio(target))
    })

    test('a loader destroyed before the row arrives throws nothing and takes no focus', async () => {
        const other = document.createElement('button')
        document.body.appendChild(other)
        const deferred = deferredRow()
        resetThemePackRowLoaderForTests(deferred.importRow)
        const target = show()
        setHighlight(ROW_ID)
        await settle()
        other.blur()
        unmount(mounted.pop()!)
        target.remove()
        deferred.resolve()
        await settle()
        expect(document.activeElement).toBe(document.body)
        expect(unhandled).toEqual([])
    })
})
