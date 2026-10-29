export interface BgmControl {
    volume: number
    src: string
}

const SEPARATOR = '___'

/**
 * Reads the `risu-ctrl` value of a bgm control: `bgm___<volume or auto>___<src>`.
 * The source is everything after the second separator, so a URL that itself
 * holds `___` stays whole. `null` for a control that is not a bgm control.
 */
export function parseBgmControl(ctrlName: string): BgmControl | null {
    const split = ctrlName.split(SEPARATOR)
    if (split[0] !== 'bgm') {
        return null
    }
    return {
        volume: split[1] === 'auto' ? 0.5 : parseFloat(split[1]),
        src: split.slice(2).join(SEPARATOR),
    }
}

/**
 * A control can be played only with a finite volume in [0, 1] and a non-empty
 * source. Anything else is silence, never a clamp or a fallback.
 */
export function isWellFormedBgm(bgm: BgmControl): boolean {
    return Number.isFinite(bgm.volume) && bgm.volume >= 0 && bgm.volume <= 1 && bgm.src.length > 0
}
