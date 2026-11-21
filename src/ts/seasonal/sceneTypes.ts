// Types shared by the seasonal logo host (host.ts) and the scene modules under ./scenes. A scene module default-exports
// a SceneDef; the host builds it on its day only, so a scene's code and fonts never load on other days.
import type { OccasionKey, OccasionVariant } from './calendar'

export interface SceneFont {
    family: string
    url: string
    weight?: number
    /** Upper bound on waiting for the face; the scene then uses its fallback. Default 2500 ms. */
    timeoutMs?: number
    /** Text the loader measures the face with. */
    sample?: string
}

/** The stage box in px relative to the stage's anchor; `wrapped` is true where the mode switcher sits on a row below the brand. */
export interface StageBox {
    width: number
    height: number
    wrapped: boolean
    rowBottom: number
    wrapTop: number | null
}

/** Positions in stage px of the status mark and the word box. */
export interface StageOffset {
    markX: number
    markY: number
    markSize: number
    wordX: number
    wordY: number
    wordWidth: number
    wordHeight: number
}

export interface GameSpec {
    /** SVG markup of the target in the game panel; `__UID__` is replaced with a unique id prefix. */
    targetSvg?: string
}

export interface SceneContext {
    key: OccasionKey
    variant: OccasionVariant
    /** The animation layer: aria-hidden, no pointer events, may extend below the top bar. */
    stage: HTMLElement
    /** The wordmark element, already holding the everyday wordmark and its accessible-name node. */
    word: HTMLElement
    /** Over-layer covering exactly the word box; only game elements receive pointer events. */
    over: HTMLElement
    root: HTMLElement
    /** Layer stacked over the status mark, or null where the host has no mark. */
    markSlot: HTMLElement | null
    /** Unique prefix for SVG ids. */
    uid: string
    lang: string
    date: Date
    year: number
    theme: 'light' | 'dark'
    /** True when reduced motion or low power is in effect; the host calls finish() without play(). */
    reduced: boolean
    anniversaryUrl: string | null
    stageWidth(): number
    stageBox(): StageBox
    stageOffset(): StageOffset
    fitText(node: HTMLElement | null, maxPx?: number): number
    fonts: { ready(family: string): Promise<boolean> }
    onLink(url: string | null): void
    setName(text: string, lang?: string | null): void
    setDescription(text: string, lang?: string | null): void
    onRelayout(fn: (box: StageBox) => void): void
    /** Pausable timers: they stop while the page is hidden. */
    setTimeout(fn: () => void, ms: number): number
    clearTimeout(id: number): void
    attachGame(node: HTMLElement, spec?: GameSpec): HTMLElement
    showGreeting(spec?: { text?: string, shortText?: string, url?: string | null }): HTMLElement
    hideGreeting(): void
}

export interface SceneInstance {
    /** Runs the timeline and ends in the final pose; a returned promise settles when it is done. */
    play(): void | Promise<void>
    /** Jumps to the final pose at once; safe at any time, including before play(). */
    finish(): void
    /** Removes everything the scene added and clears its timers and animations. */
    destroy(): void
}

export interface SceneDef {
    key: OccasionKey
    /** At most 10000; the host calls finish() when play() has not settled by durationMs + 500. */
    durationMs: number
    fonts?: SceneFont[]
    build(ctx: SceneContext): SceneInstance
}

export interface SceneModule {
    default: SceneDef
}

/** Resolves a scene by occasion; null means the day shows the everyday wordmark. */
export type SceneLoader = (key: OccasionKey) => Promise<SceneDef | null>
