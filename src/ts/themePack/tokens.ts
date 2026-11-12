// The token stylesheets and part registries the validator judges against: exactly the files the reference validator in
// docs/design reads, bundled as strings so the validator needs no file system. This module is the one place a later stage
// repoints to the app's own tokens (src/styles); until then verdicts match the reference.
import chatThemeTokens from '../../../docs/design/chat/theme-tokens.css?raw'
import nexusTokens from '../../../docs/design/theme/nexus-tokens.css?raw'
import studioTokens from '../../../docs/design/studio/studio-tokens.css?raw'
import studioSlice4 from '../../../docs/design/studio/st4.css?raw'
import settingsThemeTokens from '../../../docs/design/settings/theme-tokens.css?raw'
import homeTokens from '../../../docs/design/home/home-tokens.css?raw'
import partsShell from '../../../docs/design/studio/checks/th/parts-shell.json'
import partsTgb from '../../../docs/design/studio/checks/th/parts-tgb.json'
import partsLte from '../../../docs/design/studio/checks/th/parts-lte.json'

/** One part of a Studio builder's census. */
export interface StudioPart {
    name: string
    critical?: boolean
    child?: boolean
}

/** A Studio builder's part registry (`docs/design/studio/checks/th/parts-*.json`). */
export interface StudioPartRegistry {
    parts?: readonly StudioPart[]
    safe?: readonly string[]
    critical?: readonly string[]
    criticalChildren?: readonly string[]
}

// A missing or emptied file would silently empty a token map and change every verdict, so loading fails instead.
function required(name: string, text: string, sentinel: string): string {
    if (typeof text !== 'string' || !text.includes(sentinel)) throw new Error(`theme pack validator: ${name} is missing or lacks ${sentinel}`)
    return text
}

function parts(name: string, value: StudioPartRegistry): StudioPartRegistry {
    if (!value || !Array.isArray(value.parts) || value.parts.length === 0) throw new Error(`theme pack validator: ${name} has no parts`)
    return value
}

/** The raw text of each token stylesheet, keyed by its path under docs/design. */
export const TOKEN_FILES = {
    'chat/theme-tokens.css': required('chat/theme-tokens.css', chatThemeTokens, '--chat-dur-fast'),
    'theme/nexus-tokens.css': required('theme/nexus-tokens.css', nexusTokens, '--nexus-text'),
    'studio/studio-tokens.css': required('studio/studio-tokens.css', studioTokens, '--studio-'),
    'studio/st4.css': required('studio/st4.css', studioSlice4, '--studio-'),
    'settings/theme-tokens.css': required('settings/theme-tokens.css', settingsThemeTokens, '--settings-'),
    'home/home-tokens.css': required('home/home-tokens.css', homeTokens, '--home-'),
} as const

export type TokenFile = keyof typeof TOKEN_FILES

/** The Studio builders' part registries, keyed by their file name. */
export const STUDIO_PARTS = {
    'parts-shell.json': parts('parts-shell.json', partsShell as StudioPartRegistry),
    'parts-tgb.json': parts('parts-tgb.json', partsTgb as StudioPartRegistry),
    'parts-lte.json': parts('parts-lte.json', partsLte as StudioPartRegistry),
} as const

/** A token stylesheet with its comments removed, as the reference reads it. */
export function tokenFile(file: TokenFile): string {
    return TOKEN_FILES[file].replace(/\/\*[\s\S]*?\*\//g, '')
}
