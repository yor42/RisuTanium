// @vitest-environment jsdom

/**
 * Every Theme pack radio (None, the built-ins, the installed packs) is named through aria-label equal to its visible
 * name text, and none keeps aria-labelledby (TalkBack speaks only aria-label for a radio). REAL: ThemePackRow and its
 * flow. MOCKED: as the sibling ThemePackRow test does (a real `$state` DBState, no file chooser, alerts, asset store or
 * install transaction is ever driven here).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { Database } from 'src/ts/storage/database.svelte'
import type { ThemePackApplyState } from 'src/ts/themePack/activePack.svelte'
import type { ThemePackRecordV1 } from 'src/ts/themePack/packRecord'
import { BUILTIN_PACKS } from 'src/ts/themePack/builtins'
import { controlName } from '../../../a11yNames.test-helpers'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: async () => true,
    alertNormal: vi.fn(),
    alertToast: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/process/memory/busyActions'), async (importOriginal) => ({
    ...await importOriginal(),
    isBusy: () => false,
}))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFileObject: async () => null,
    readPickedFileBytes: async () => new Uint8Array(),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    requestSaveNow: vi.fn(),
    saveAsset: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({ read: async () => ({ bytes: null }) }),
    pageStoreIsOpfsTransitional: async () => false,
}) as unknown as typeof import('src/ts/storage/store/appStore'))
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/themePack/activePack.svelte'), () => {
    const status: ThemePackApplyState = $state({ activeId: undefined, phase: 'none' })
    return { themePackApplyState: () => status, requestPackScheme: vi.fn(), cancelPackSchemeRequest: vi.fn() } as unknown as typeof import('src/ts/themePack/activePack.svelte')
})

vi.mock(import('src/ts/gui/colorscheme'), () => ({ leavePackScheme: vi.fn() }) as unknown as typeof import('src/ts/gui/colorscheme'))

import { DBState } from 'src/ts/stores.svelte'
import ThemePackRow from './ThemePackRow.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function recordOf(id: string, overrides: Partial<ThemePackRecordV1> = {}): ThemePackRecordV1 {
    return {
        v: 1,
        id,
        name: `Pack ${id}`,
        version: '1.2.3',
        license: 'MIT',
        attribution: 'An author',
        modes: ['dark'],
        fonts: [],
        archive: `assets/tp-${'ab'.repeat(32)}.risutheme`,
        bytes: 2048,
        installedAt: 1,
        ...overrides,
    }
}

function show(themePacks: unknown[]): HTMLElement {
    DBState.db = { themePacks } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(ThemePackRow, { target }))
    flushSync()
    return target
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('ThemePackRow form control names', () => {
    test('None, the built-ins and the installed packs are named by aria-label equal to the visible name, with no aria-labelledby', () => {
        const target = show([recordOf('light', { modes: ['light'] }), recordOf('dark')])
        const radios = [...target.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
        expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual([
            language.themePackNone,
            ...BUILTIN_PACKS.map((pack) => pack.name),
            'Pack light',
            'Pack dark',
        ])
        for (const radio of radios) {
            expect(radio.hasAttribute('aria-labelledby')).toBe(false)
            const visible = radio.closest('label')!.querySelector('span[id]')
            expect(controlName(radio)).toBe(radio.getAttribute('aria-label'))
            expect(visible).not.toBeNull()
            expect((visible!.textContent ?? '').trim()).toBe(radio.getAttribute('aria-label'))
        }
    })
})
