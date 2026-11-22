// @vitest-environment jsdom
/**
 * TA-5(e), the mounted-screen walk (part 5: the boot banner). Fixture F8: BootPackEscape.svelte mounted directly, as App renders it
 * (App carries no part and the banner sits outside every wrapper), in its offer and notice forms. The component is real; only
 * state and services behind the safe-mode module are mocked. The root carries the critical marker, has no part above it
 * outside the lists, no message-role ancestor or sibling, and holds no part of its own children.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { escapeWalkViolations } from './fixtures/criticalClosure'
import { CRITICAL_PARTS, ESCAPE_ANCESTORS } from './engine'

const h = vi.hoisted(() => ({ db: {} as Record<string, unknown> }))

vi.mock(import('src/ts/alert'), () => ({ alertError: vi.fn() }) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({ downloadFile: vi.fn() }) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: h.db },
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/gui/systemBars'), () => ({ syncSystemBars: vi.fn() }) as unknown as typeof import('src/ts/gui/systemBars'))
vi.mock(import('src/ts/storage/pageStorageMode'), () => ({ getPageStorageMode: vi.fn(() => ({ kind: 'store2' })) }) as unknown as typeof import('src/ts/storage/pageStorageMode'))
vi.mock(import('src/ts/process/memory/busyActions'), () => ({ isBusy: vi.fn(() => false) }) as unknown as typeof import('src/ts/process/memory/busyActions'))
vi.mock(import('src/ts/drive/restoreInProgress'), () => ({ restoreInProgress: vi.fn(() => false) }) as unknown as typeof import('src/ts/drive/restoreInProgress'))
vi.mock('src/ts/themePack/turnOff', () => ({ turnOffThemePack: vi.fn(), registerPackRequestCanceller: vi.fn() }))

import { enterPackSafeMode, offerBootEscape, resetPackSafeModeForTests } from 'src/ts/themePack/packSafeMode.svelte'
import BootPackEscape from 'src/lib/Others/BootPackEscape.svelte'

const allowed = new Set<string>([...ESCAPE_ANCESTORS, ...CRITICAL_PARTS])
let app: ReturnType<typeof mount> | undefined
let target: HTMLElement

function mountBanner(): void {
    target = document.createElement('main')
    document.body.appendChild(target)
    app = mount(BootPackEscape, { target })
    flushSync()
}

beforeEach(() => {
    for (const key of Object.keys(h.db)) delete h.db[key]
    Object.assign(h.db, { colorScheme: { type: 'dark' }, colorSchemeName: 'default', activeThemePack: 'builtin:banana-cocoa' })
    resetPackSafeModeForTests()
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    document.body.replaceChildren()
    resetPackSafeModeForTests()
})

describe('F8 the boot banner', () => {
    test('offer: one marked root, nothing unlisted above it, no part inside it', () => {
        offerBootEscape(h.db)
        mountBanner()
        expect(escapeWalkViolations(document, 'boot-pack-escape', { count: 1, marked: true }, allowed)).toEqual([])
        expect(target.querySelector('[data-part="boot-pack-escape"] [data-part]')).toBeNull()
    })

    test('notice: one marked root, nothing unlisted above it, no part inside it', () => {
        enterPackSafeMode('url')
        offerBootEscape(h.db)
        mountBanner()
        expect(escapeWalkViolations(document, 'boot-pack-escape', { count: 1, marked: true }, allowed)).toEqual([])
        expect(target.querySelector('[data-part="boot-pack-escape"] [data-part]')).toBeNull()
    })
})
