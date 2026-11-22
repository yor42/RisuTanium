// Pack safe mode and the boot escape banner: the light module behind "Turn off theme pack". It imports the colour code, the
// flag, the boot window, the turn-off leaf and the page guards; it imports nothing from the driver, the apply core or the
// judge client, so the banner works even when the driver chunk failed to load. Nothing here is persisted: the flag and the
// banner state live in memory, and the only write is the existing turn-off.
import { get } from 'svelte/store'
import { isLite } from '../lite'
import { restoreInProgress } from '../drive/restoreInProgress'
import { isBusy } from '../process/memory/busyActions'
import { getPageStorageMode } from '../storage/pageStorageMode'
import {
    defaultColorScheme, effectiveColorScheme, PACK_SCHEME_NAME, schemeWithoutPack, updateColorScheme, updateTextThemeAndCSS,
    type ColorScheme, type SchemeSource,
} from '../gui/colorschemeCore'
import { over, parseConcrete, toHex, type Rgba } from './colour'
import { packSafe, type PackSafeSource } from './packSafeFlag.svelte'
import { registerPackRequestCanceller, turnOffThemePack } from './turnOff'

export { registerPackRequestCanceller }

export type BannerMode = 'hidden' | 'offer' | 'notice'

/**
 * What the banner shows. `offer` is the boot question for a pack that is active; `notice` says the pack is off for this
 * session. `canTurnOff` is false on a read-only page, where only Dismiss is offered.
 */
export const packBanner: { mode: BannerMode, canTurnOff: boolean } = $state({ mode: 'hidden', canTurnOff: true })

let offered = false

function repaint(): void {
    try {
        updateColorScheme()
        updateTextThemeAndCSS()
    } catch (error) {
        console.error(error)
    }
}

function pageWritable(): boolean {
    return getPageStorageMode().kind !== 'read-only'
}

function showNotice(): void {
    packBanner.canTurnOff = pageWritable()
    packBanner.mode = 'notice'
}

/** Turns pack safe mode on: no sheet is committed and the user's own scheme paints. A live offer becomes the notice. */
export function enterPackSafeMode(source: PackSafeSource): void {
    packSafe.on = true
    packSafe.source = source
    repaint()
    if (packBanner.mode === 'offer') {
        showNotice()
    }
}

/** Turns pack safe mode off: the driver applies the active pack again and the pack scheme paints. */
export function leavePackSafeMode(): void {
    packSafe.on = false
    packSafe.source = null
    repaint()
}

/** Dismisses the banner for this page load. */
export function dismissPackBanner(): void {
    packBanner.mode = 'hidden'
}

/**
 * The one offer per page load, made at boot: the offer for an active pack, or the notice when pack safe mode is already on.
 * Without an active pack nothing is shown.
 */
export function offerBootEscape(db: { activeThemePack?: unknown }): void {
    if (offered) {
        return
    }
    offered = true
    if (typeof db.activeThemePack !== 'string' || db.activeThemePack === '') {
        return
    }
    if (packSafe.on) {
        showNotice()
        return
    }
    packBanner.canTurnOff = true
    packBanner.mode = 'offer'
}

/**
 * The tap on "Turn off theme pack". The pack goes away at once with no write. A read-only page stops there (notice with
 * Dismiss only); a busy page stops there with the action still offered; otherwise the turn-off is saved and safe mode ends.
 */
export function tapTurnOff(): void {
    enterPackSafeMode('boot')
    if (!pageWritable()) {
        packBanner.canTurnOff = false
        packBanner.mode = 'notice'
        return
    }
    if (isBusy({ ignoreDialogWaits: true }) || restoreInProgress()) {
        packBanner.canTurnOff = true
        packBanner.mode = 'notice'
        return
    }
    turnOffThemePack()
    leavePackSafeMode()
    dismissPackBanner()
}

/**
 * The boot step after the scheme is read: paint, offer the escape, then start the driver without waiting for it. The offer
 * comes before the driver import, so a chunk that fails to load still shows the banner.
 */
export function bootThemePackStep(
    db: { activeThemePack?: unknown },
    importDriver: () => Promise<{ startThemePackApply: () => void }>,
): void {
    updateColorScheme()
    updateTextThemeAndCSS()
    offerBootEscape(db)
    void importDriver().then((m) => m.startThemePackApply()).catch((error) => console.error(error))
}

/** The banner's colours: literal opaque sRGB strings, so no theme token, pack or scheme variable can change them. */
export interface BannerPalette {
    background: string
    text: string
    buttonFill: string
    buttonText: string
    border: string
    colorScheme: 'light' | 'dark'
}

/**
 * The scheme the screen shows while pack safe mode is on: under the pack scheme name (and not lite) the scheme turning the
 * pack off restores, else the effective scheme. Taken from the stored fields, so a pack with an unreadable copy still gets
 * the user's pre-pack colours.
 */
export function bannerScheme(db: SchemeSource): ColorScheme {
    return db.colorSchemeName === PACK_SCHEME_NAME && !get(isLite) ? schemeWithoutPack(db).colorScheme : effectiveColorScheme(db)
}

const BLACK: Rgba = [0, 0, 0, 1]
const WHITE: Rgba = [255, 255, 255, 1]

function literal(value: unknown, fallback: string, backdrop: Rgba): string {
    const parsed = typeof value === 'string' ? parseConcrete(value) : null
    return toHex(over(parsed ?? (parseConcrete(fallback) as Rgba), backdrop))
}

/** Pure. The background is forced opaque (composited over black for a dark scheme and over white for a light one). */
export function bannerPalette(db: SchemeSource): BannerPalette {
    const scheme = bannerScheme(db)
    const type = scheme.type === 'light' ? 'light' : 'dark'
    const base = type === 'light' ? WHITE : BLACK
    const background = literal(scheme.bgcolor, defaultColorScheme.bgcolor, base)
    const backdrop = parseConcrete(background) as Rgba
    return {
        background,
        text: literal(scheme.textcolor, defaultColorScheme.textcolor, backdrop),
        buttonFill: literal(scheme.darkbutton, defaultColorScheme.darkbutton, backdrop),
        buttonText: literal(scheme.textcolor, defaultColorScheme.textcolor, backdrop),
        border: literal(scheme.borderc, defaultColorScheme.borderc, backdrop),
        colorScheme: type,
    }
}

/** Test seam: forgets the offer and hides the banner. */
export function resetPackSafeModeForTests(): void {
    offered = false
    packBanner.mode = 'hidden'
    packBanner.canTurnOff = true
    packSafe.on = false
    packSafe.source = null
}
