// @vitest-environment jsdom

/**
 * The Shortcuts page names each preset-slot select, which has no visible label of its own, by a
 * screen-reader-only span naming the slot, with that span first in the description. The real component
 * and the real `setDatabase` build the rows, as `HotkeySettings.svelte.test.ts` does.
 *
 * MOCKED: `stores.svelte` (a `$state` DBState and plain writable stores), the platform, file and click-handler
 * modules that `setDatabase` imports, and `alert`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

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
    alertConfirm: vi.fn(async () => true),
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
    return {
        DBState: state,
        SafeModeStore: writable(false),
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        settingsOpen: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

//#endregion

import { language } from 'src/lang'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { setDatabase, type Database } from 'src/ts/storage/database.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { fieldNameProblems, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import HotkeySettings from './HotkeySettings.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

const KNOWN_UNNAMED: string[] = []

function show(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(HotkeySettings, { target, props: {} }))
    flushSync()
    return target
}

beforeEach(() => {
    resetBackHandlersForTests()
    setDatabase({ pluginCustomStorage: {}, botPresets: [{ name: 'Alpha' }, { name: 'Beta' }] } as Database)
})

afterEach(async () => {
    for (const app of mounted.splice(0)) {
        await unmount(app)
    }
    document.body.replaceChildren()
    resetToastHostForTests()
})

describe('HotkeySettings value-control names', () => {
    test('regression reproducer: the nine preset-slot selects are named by their slot in source order', () => {
        const target = show()
        const slots = [1, 2, 3, 4, 5, 6, 7, 8, 9]
        expect(fieldNameProblems(target, slots.map((n) => ({ name: language.settingsShellHkSlotFor(n) })))).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })
})
