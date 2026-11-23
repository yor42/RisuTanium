// @vitest-environment jsdom
/**
 * Pack safe mode and the boot escape logic (`packSafeFlag.svelte.ts`, `packSafeMode.svelte.ts`, the scheme branch of
 * `colorscheme.ts`): TA-8, TA-10, TA-13, TA-14, TA-16, TA-17 and the banner state rules of TA-11. All guards of a new
 * contract, so a red run on the base would only be a missing module. REAL: the flag, the safe-mode module, `colorscheme.ts` and
 * `colour.ts`. FAKED: the database reader, the page mode, the busy answers and the turn-off leaf (its save is TA-15's harness).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    readOnly: false,
    busy: false,
    restoring: false,
    turnOff: vi.fn(),
}))

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
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/gui/systemBars'), () => ({ syncSystemBars: vi.fn() }) as unknown as typeof import('src/ts/gui/systemBars'))
vi.mock(import('src/ts/storage/pageStorageMode'), () => ({
    getPageStorageMode: vi.fn(() => (h.readOnly ? { kind: 'read-only', reason: 'too-new', source: 'main' } : { kind: 'store2' })),
}) as unknown as typeof import('src/ts/storage/pageStorageMode'))
vi.mock(import('src/ts/process/memory/busyActions'), () => ({ isBusy: vi.fn(() => h.busy) }) as unknown as typeof import('src/ts/process/memory/busyActions'))
vi.mock(import('src/ts/drive/restoreInProgress'), () => ({ restoreInProgress: vi.fn(() => h.restoring) }) as unknown as typeof import('src/ts/drive/restoreInProgress'))
vi.mock('src/ts/themePack/turnOff', () => ({ turnOffThemePack: h.turnOff, registerPackRequestCanceller: vi.fn() }))

import { isLite } from 'src/ts/lite'
import { defaultColorScheme, effectiveColorScheme, PACK_SCHEME_NAME, updateColorScheme } from 'src/ts/gui/colorscheme'
import { packSafe } from './packSafeFlag.svelte'
import {
    bannerAccess, bannerPalette, bootThemePackStep, dismissPackBanner, enterPackSafeMode, holdPackUntilDecided, leavePackSafeMode, offerBootEscape,
    packAnnouncement, packBanner, releasePackHold, resetPackSafeModeForTests, setBannerTouchExploration, tapTurnOff,
} from './packSafeMode.svelte'

const USER = { bgcolor: '#101820', darkbg: '#0a1016', borderc: '#445566', selected: '#223344', draculared: '#ff5555', textcolor: '#e0e8f0', textcolor2: '#a0a8b0', darkBorderc: '#334455', darkbutton: '#203040', type: 'dark' } as const
/** A pack copy whose text equals its background: unreadable, the case the escape exists for. */
const PACK_COPY = { ...USER, bgcolor: '#ff00ff', textcolor: '#ff00ff', darkbutton: '#ff00ff', borderc: '#ff00ff', type: 'light' } as const

function packDb(extra: Record<string, unknown> = {}): void {
    for (const key of Object.keys(h.db)) delete h.db[key]
    Object.assign(h.db, {
        colorScheme: structuredClone(PACK_COPY),
        colorSchemeName: PACK_SCHEME_NAME,
        themePackSchemeSnapshot: { name: 'dark', scheme: structuredClone(USER) },
        customColorScheme: structuredClone(USER),
        activeThemePack: 'builtin:banana-cocoa',
        textTheme: 'standard',
        font: 'default',
        ...extra,
    })
}

function rootText(): string {
    return document.documentElement.style.getPropertyValue('--risu-theme-textcolor')
}

beforeEach(() => {
    packDb()
    isLite.set(false)
    h.readOnly = false
    h.busy = false
    h.restoring = false
    h.turnOff.mockReset()
    resetPackSafeModeForTests()
    document.documentElement.removeAttribute('style')
})

afterEach(() => {
    resetPackSafeModeForTests()
})

describe('TA-8: the scheme branch', () => {
    it('with the flag on, the pack scheme name paints the scheme turning the pack off restores', () => {
        expect(effectiveColorScheme(h.db as never).bgcolor).toBe(PACK_COPY.bgcolor)
        enterPackSafeMode('boot')
        expect(effectiveColorScheme(h.db as never)).toEqual(expect.objectContaining({ bgcolor: '#1a1a1a' }))
    })

    it('a missing snapshot restores the default scheme, and a missing custom slot is tolerated', () => {
        delete h.db.themePackSchemeSnapshot
        delete h.db.customColorScheme
        enterPackSafeMode('url')
        expect(effectiveColorScheme({ colorSchemeName: PACK_SCHEME_NAME, colorScheme: PACK_COPY as never })).toEqual(defaultColorScheme)
    })

    it('lite, built-in names and own schemes are unchanged by the flag', () => {
        enterPackSafeMode('boot')
        h.db.colorSchemeName = 'dark'
        expect(effectiveColorScheme(h.db as never).bgcolor).toBe('#1a1a1a')
        h.db.colorSchemeName = 'custom'
        h.db.colorScheme = structuredClone(USER)
        expect(effectiveColorScheme(h.db as never)).toEqual(USER)
        h.db.colorSchemeName = PACK_SCHEME_NAME
        isLite.set(true)
        expect(effectiveColorScheme(h.db as never).bgcolor).toBe('#1f2937')
    })

    it('the root variables repaint with the flag in both directions', () => {
        updateColorScheme()
        expect(rootText()).toBe(PACK_COPY.textcolor)
        enterPackSafeMode('boot')
        expect(rootText()).toBe('#f5f5f5')
        leavePackSafeMode()
        expect(rootText()).toBe(PACK_COPY.textcolor)
    })
})

describe('PM-1: the Android hold', () => {
    it('holds only a page with safe mode off, as `undecided`, and says whether it held', () => {
        expect(holdPackUntilDecided()).toBe(true)
        expect(packSafe.on).toBe(true)
        expect(packSafe.source).toBe('undecided')
        expect(holdPackUntilDecided()).toBe(false)
        expect(packSafe.source).toBe('undecided')
    })

    it('does not take over a page that already has safe mode on', () => {
        enterPackSafeMode('url')
        expect(holdPackUntilDecided()).toBe(false)
        expect(packSafe.source).toBe('url')
    })

    it('the hold and its release repaint nothing, announce nothing and write nothing', () => {
        updateColorScheme()
        const painted = rootText()
        const before = structuredClone(h.db)
        holdPackUntilDecided()
        expect(rootText()).toBe(painted)
        expect(packAnnouncement.off).toBe(false)
        expect(packBanner.mode).toBe('hidden')
        releasePackHold()
        expect(rootText()).toBe(painted)
        expect(packAnnouncement.off).toBe(false)
        expect(packBanner.mode).toBe('hidden')
        expect(h.db).toEqual(before)
        expect(h.turnOff).not.toHaveBeenCalled()
    })

    it('the release ends an `undecided` hold', () => {
        holdPackUntilDecided()
        releasePackHold()
        expect(packSafe.on).toBe(false)
        expect(packSafe.source).toBeNull()
    })

    it.each(['url', 'shortcut', 'boot', 'noAnswer'] as const)('the release leaves safe mode from `%s` on', (source) => {
        enterPackSafeMode(source)
        releasePackHold()
        expect(packSafe.on).toBe(true)
        expect(packSafe.source).toBe(source)
    })

    it('the release on a page with safe mode off changes nothing', () => {
        releasePackHold()
        expect(packSafe.on).toBe(false)
        expect(packSafe.source).toBeNull()
    })
})

describe('TA-10: nothing is persisted by safe mode or the banner', () => {
    it('entering, leaving, offering and dismissing write no database field', () => {
        const before = structuredClone(h.db)
        offerBootEscape(h.db)
        enterPackSafeMode('boot')
        leavePackSafeMode()
        enterPackSafeMode('shortcut')
        dismissPackBanner()
        leavePackSafeMode()
        expect(h.db).toEqual(before)
        expect(h.turnOff).not.toHaveBeenCalled()
    })
})

describe('TA-13: the banner palette', () => {
    const LITERAL = /^#[0-9a-f]{6}$/

    it('forces an opaque background and returns literal colour strings only', () => {
        const palette = bannerPalette({ colorSchemeName: 'custom', colorScheme: { ...USER, bgcolor: '#00000080' } as never })
        expect(Object.values(palette).filter((value) => value !== 'dark' && value !== 'light').every((value) => LITERAL.test(value))).toBe(true)
        expect(palette.background).toBe('#000000')
        const light = bannerPalette({ colorSchemeName: 'custom', colorScheme: { ...USER, type: 'light', bgcolor: '#00000080' } as never })
        expect(light.background).toBe('#7f7f7f')
    })

    it('under the pack scheme without lite, it uses the user scheme from the snapshot', () => {
        const palette = bannerPalette(h.db as never)
        expect(palette.background).toBe('#1a1a1a')
        expect(palette.text).toBe('#f5f5f5')
    })

    it('on the user scheme with a pack still active, it uses the effective scheme', () => {
        h.db.colorSchemeName = 'custom'
        h.db.colorScheme = structuredClone(USER)
        delete h.db.themePackSchemeSnapshot
        const palette = bannerPalette(h.db as never)
        expect(palette.background).toBe(USER.bgcolor)
        expect(palette.text).toBe(USER.textcolor)
    })

    it('under lite it uses the lite scheme', () => {
        isLite.set(true)
        expect(bannerPalette(h.db as never).background).toBe('#1f2937')
    })

    it('an unreadable colour falls back to the default scheme and the palette stays literal', () => {
        const palette = bannerPalette({ colorSchemeName: 'custom', colorScheme: { ...USER, textcolor: 'var(--x)', bgcolor: 'nonsense' } as never })
        expect(palette.text).toMatch(LITERAL)
        expect(palette.background).toMatch(LITERAL)
    })
})

describe('TA-14: the boot step offers before the driver import', () => {
    it('offers the banner before importDriver is called', () => {
        const order: string[] = []
        const importDriver = vi.fn(() => {
            order.push(`import:${packBanner.mode}`)
            return Promise.resolve({ startThemePackApply: vi.fn() })
        })
        bootThemePackStep(h.db, importDriver)
        expect(order).toEqual(['import:offer'])
    })

    it('a driver chunk that rejects is logged and the banner is still offered', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => { })
        bootThemePackStep(h.db, () => Promise.reject(new Error('chunk failed')))
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(packBanner.mode).toBe('offer')
        expect(logged).toHaveBeenCalled()
        logged.mockRestore()
    })

    it('starts the driver once it resolves', async () => {
        const start = vi.fn()
        bootThemePackStep(h.db, () => Promise.resolve({ startThemePackApply: start }))
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(start).toHaveBeenCalledTimes(1)
    })
})

describe('TA-11: the banner state', () => {
    it('is absent without a pack and present with one', () => {
        delete h.db.activeThemePack
        offerBootEscape(h.db)
        expect(packBanner.mode).toBe('hidden')
        resetPackSafeModeForTests()
        h.db.activeThemePack = ''
        offerBootEscape(h.db)
        expect(packBanner.mode).toBe('hidden')
        resetPackSafeModeForTests()
        h.db.activeThemePack = 'builtin:banana-cocoa'
        offerBootEscape(h.db)
        expect(packBanner.mode).toBe('offer')
    })

    it('one offer per page load: a dismissed banner is not offered again', () => {
        offerBootEscape(h.db)
        dismissPackBanner()
        offerBootEscape(h.db)
        expect(packBanner.mode).toBe('hidden')
    })

    it('shows the notice instead of the offer when the flag is already on', () => {
        enterPackSafeMode('url')
        offerBootEscape(h.db)
        expect(packBanner.mode).toBe('notice')
        expect(packBanner.canTurnOff).toBe(true)
    })

    it('the flag turning on after the offer switches the banner to the notice', () => {
        offerBootEscape(h.db)
        expect(packBanner.mode).toBe('offer')
        enterPackSafeMode('shortcut')
        expect(packBanner.mode).toBe('notice')
    })

    it('a late flag after a dismissal stays hidden', () => {
        offerBootEscape(h.db)
        dismissPackBanner()
        enterPackSafeMode('shortcut')
        expect(packBanner.mode).toBe('hidden')
    })

    it('a read-only page gets the notice without the action', () => {
        h.readOnly = true
        enterPackSafeMode('url')
        offerBootEscape(h.db)
        expect(packBanner.mode).toBe('notice')
        expect(packBanner.canTurnOff).toBe(false)
    })

    it('a successful turn-off ends safe mode and shows neither offer nor notice (MA-22)', () => {
        offerBootEscape(h.db)
        tapTurnOff()
        expect(h.turnOff).toHaveBeenCalledTimes(1)
        expect(packSafe.on).toBe(false)
        expect(packBanner.mode).toBe('hidden')
    })
})

describe('the banner access state and the announcement flag', () => {
    it('touch exploration takes only a boolean and is reset by the test seam', () => {
        expect(bannerAccess.touchExploration).toBe(false)
        setBannerTouchExploration('true')
        setBannerTouchExploration(1)
        setBannerTouchExploration(null)
        expect(bannerAccess.touchExploration).toBe(false)
        setBannerTouchExploration(true)
        expect(bannerAccess.touchExploration).toBe(true)
        setBannerTouchExploration(undefined)
        expect(bannerAccess.touchExploration).toBe(true)
        setBannerTouchExploration(false)
        expect(bannerAccess.touchExploration).toBe(false)
        setBannerTouchExploration(true)
        resetPackSafeModeForTests()
        expect(bannerAccess.touchExploration).toBe(false)
    })

    it('entering safe mode, by a tap or by the shortcut, sets the announcement flag; offering alone does not', () => {
        offerBootEscape(h.db)
        expect(packAnnouncement.off).toBe(false)
        enterPackSafeMode('shortcut')
        expect(packAnnouncement.off).toBe(true)
        resetPackSafeModeForTests()
        expect(packAnnouncement.off).toBe(false)
        offerBootEscape(h.db)
        h.readOnly = true
        tapTurnOff()
        expect(packAnnouncement.off).toBe(true)
        expect(packAnnouncement.turnedOff).toBe(false)
    })

    it('a saved turn-off announces the permanent wording and not the session-only flag', () => {
        offerBootEscape(h.db)
        tapTurnOff()
        expect(h.turnOff).toHaveBeenCalled()
        expect(packAnnouncement.turnedOff).toBe(true)
        expect(packAnnouncement.off).toBe(false)
    })

    it('leaving safe mode clears the announcement so a later entry announces again', () => {
        enterPackSafeMode('shortcut')
        packAnnouncement.turnedOff = true
        leavePackSafeMode()
        expect(packAnnouncement.off).toBe(false)
        expect(packAnnouncement.turnedOff).toBe(false)
        enterPackSafeMode('shortcut')
        expect(packAnnouncement.off).toBe(true)
    })
})

describe('TA-16: a read-only page', () => {
    it('a tap gives safe mode and the notice; the turn-off is never called and the database is unchanged', () => {
        h.readOnly = true
        offerBootEscape(h.db)
        const before = structuredClone(h.db)
        tapTurnOff()
        expect(packSafe.on).toBe(true)
        expect(packBanner.mode).toBe('notice')
        expect(packBanner.canTurnOff).toBe(false)
        expect(h.turnOff).not.toHaveBeenCalled()
        expect(h.db).toEqual(before)
    })
})

describe('TA-17: a busy page', () => {
    it.each([['busy', 'busy'], ['restoring', 'restoring']] as const)('%s: safe mode and the notice with the action; no write', (_label, field) => {
        h[field] = true
        offerBootEscape(h.db)
        tapTurnOff()
        expect(packSafe.on).toBe(true)
        expect(packBanner.mode).toBe('notice')
        expect(packBanner.canTurnOff).toBe(true)
        expect(h.turnOff).not.toHaveBeenCalled()
    })

    it('the action offered by the notice turns the pack off once the page is idle', () => {
        h.busy = true
        offerBootEscape(h.db)
        tapTurnOff()
        h.busy = false
        tapTurnOff()
        expect(h.turnOff).toHaveBeenCalledTimes(1)
        expect(packSafe.on).toBe(false)
        expect(packBanner.mode).toBe('hidden')
    })
})
