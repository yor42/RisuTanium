// The pure list rules of the preset advanced form: the row operations of the text lists (fallback models, stop strings,
// model tools, format order), the logit bias value rule and the bias file import. Every builder returns a fresh list and
// never touches its input; the form hands the result to the history service as one whole-list value.
import { isBiasList } from '../history/fieldAccess'
import type { BiasRow } from '../history/fieldRegistry'

// The tool the "Search" switch adds and removes.
export const SEARCH_TOOL = 'search'

// The bounds of a preset bias value (classic's number input).
export const PRESET_BIAS_MIN = -101
export const PRESET_BIAS_MAX = 100

// Whether the model takes custom stop strings: classic's condition for them (the local and text generation models),
// asked of the edited preset's own model.
export function modelTakesStopStrings(model: string): boolean {
    return model === 'textgen_webui' || model === 'mancer' || model.startsWith('local_') || model.startsWith('hf:::')
}

export function addEntry(list: readonly string[]): string[] {
    return [...list, '']
}

export function editEntry(list: readonly string[], index: number, value: string): string[] {
    const next = [...list]
    if (index >= 0 && index < next.length) {
        next[index] = value
    }
    return next
}

export function removeEntry(list: readonly string[], index: number): string[] {
    return list.filter((_, i) => i !== index)
}

// `entry` moved one place up (-1) or down (+1); a move past either end changes nothing.
export function moveEntry(list: readonly string[], index: number, step: -1 | 1): string[] {
    const next = [...list]
    const to = index + step
    if (index < 0 || index >= next.length || to < 0 || to >= next.length) {
        return next
    }
    const moved = next[index]
    next[index] = next[to]
    next[to] = moved
    return next
}

// The model tools with "Search" on or off; every other entry stays where it is.
export function withSearchTool(list: readonly string[], on: boolean): string[] {
    if (on) {
        return list.includes(SEARCH_TOOL) ? [...list] : [...list, SEARCH_TOOL]
    }
    return list.filter((tool) => tool !== SEARCH_TOOL)
}

// A typed bias value as the number that is stored: empty or unreadable text is 0 and says so, a number outside the bounds
// is clamped and says so; anything else is stored as typed.
export function clampPresetBias(raw: string): { value: number; note: 'clamp' | 'zeroed' | null } {
    if (raw.trim() === '' || Number.isNaN(Number(raw))) {
        return { value: 0, note: 'zeroed' }
    }
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) {
        return { value: parsed > 0 ? PRESET_BIAS_MAX : PRESET_BIAS_MIN, note: 'clamp' }
    }
    if (parsed > PRESET_BIAS_MAX) {
        return { value: PRESET_BIAS_MAX, note: 'clamp' }
    }
    if (parsed < PRESET_BIAS_MIN) {
        return { value: PRESET_BIAS_MIN, note: 'clamp' }
    }
    return { value: parsed === 0 ? 0 : parsed, note: null }
}

// The list a bias file holds, or null when the text is not one: JSON that is an array whose entries are all
// `[text, finite number]`. A file that is anything else is refused whole.
export function parseBiasFile(text: string): BiasRow[] | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return null
    }
    return isBiasList(parsed) ? parsed.map((row) => [row[0], row[1]]) : null
}
