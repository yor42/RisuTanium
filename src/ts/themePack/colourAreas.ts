// The per-area colour spec the apply core reads for every screen area. An area whose judged colour text applies is listed in
// COLOUR_READY_AREAS (colourReady.ts); this table says how that area is judged and painted once it is. Adding an area to the
// colour-ready set is then a table edit here, an entry there and its registry rows (H-7.6).
import { LIGHT_BASE_JUDGE_PREFIX } from './lightBase'
import type { ScreenArea } from './intake'

export interface ColourAreaSpec {
    readonly area: ScreenArea
    /** The text placed before the canonical sheet in the light base proof; null means the area always sits on the dark base. */
    readonly lightProofPrefix: string | null
    /** Whether a contrast or readability warning on this area's judged sheet can switch the own colours on. */
    readonly triggersOwnColours: boolean
    /** Whether the area's sheet decides the pack's default scheme (MC-3001). */
    readonly defaultScheme: boolean
}

export const COLOUR_AREA_SPECS: Readonly<Record<ScreenArea, ColourAreaSpec>> = {
    chat: { area: 'chat', lightProofPrefix: LIGHT_BASE_JUDGE_PREFIX, triggersOwnColours: true, defaultScheme: true },
    studio: { area: 'studio', lightProofPrefix: null, triggersOwnColours: true, defaultScheme: false },
    settings: { area: 'settings', lightProofPrefix: null, triggersOwnColours: true, defaultScheme: false },
    home: { area: 'home', lightProofPrefix: null, triggersOwnColours: false, defaultScheme: false },
}
