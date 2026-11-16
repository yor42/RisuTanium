// What a Studio asset list row shows for a file, decided by its extension alone, and the two ports the list leaves to
// later stages. The element named here is the one `assetListUse` turns into the kind of URL the row requests, so what a
// row renders and what it asks the store for cannot drift apart.

import type { AssetListElement } from '../../storage/assetUrlGate'

/** `thumb`: an image that always shows. `audio` and `video`: a type tile until Preview. `tile`: an icon and the extension. */
export type AssetShown = 'thumb' | 'audio' | 'video' | 'tile'

export interface AssetPresentation {
    shown: AssetShown
    /** The element the URL gate decides the request by: `image`, `audio`, `video`, or `none` for a tile. */
    element: AssetListElement
}

const THUMB_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'webp', 'jpeg', 'jpg', 'gif', 'svg', 'avif'])
const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['mp4', 'webm'])

/** The presentation of a row whose file has extension `ext`, compared in lower case. Anything unknown is a tile. */
export function assetPresentationOf(ext: string | undefined): AssetPresentation {
    const lower = (ext ?? '').toLowerCase()
    if (THUMB_EXTENSIONS.has(lower)) {
        return { shown: 'thumb', element: 'image' }
    }
    if (lower === 'mp3') {
        return { shown: 'audio', element: 'audio' }
    }
    if (VIDEO_EXTENSIONS.has(lower)) {
        return { shown: 'video', element: 'video' }
    }
    return { shown: 'tile', element: 'none' }
}

/** The extension of a stored asset row `[name, path, ext?]`: the stored one, else the path's own, else none. */
export function assetRowExt(row: readonly string[]): string {
    const stored = row[2]
    if (stored !== undefined && stored !== '') {
        return stored
    }
    const path = row[1] ?? ''
    const dot = path.lastIndexOf('.')
    return dot === -1 ? '' : path.slice(dot + 1)
}

/** A stored size as text: bytes below 1 KB, then one decimal of KB, MB or GB (1024-based units). */
export function assetSizeText(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`
    }
    const units = ['KB', 'MB', 'GB']
    let value = bytes / 1024
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
    }
    return `${value.toFixed(1)} ${units[unit]}`
}

/** What the used-in count and its places are, supplied by the stage that scans the text. Absent: no count, no note. */
export interface UsedInPort {
    /** The text of the row's used-in button for `name` ("{n} places"), or null while nothing is known yet. */
    usedText(name: string): string | null
    /** Lists the places that use `name`. */
    showUsed(name: string): void
    /** The note under a renamed field, or null when no place still uses `oldName`. */
    renamedNote(oldName: string): { text: string, action: string } | null
    /** Lists the places that still use `oldName`. */
    showRenamed(oldName: string): void
}

/** Opens the picker that adds files to the list. Absent: the list has no Add control. */
export interface AssetPickerPort {
    open(): void
}
