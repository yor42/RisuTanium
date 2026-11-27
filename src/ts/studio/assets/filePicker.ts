// The chooser Studio uses for pictures and assets, ported from the classic panel's three pickers: the same extension lists,
// an extension re-check after the chooser (the Android chooser is not trusted to filter), and the classic size rule. It only
// picks and sorts: a caller stores the files it is handed and reports the rest.

import { pickedAssetLimitBytes } from '../../globalApi.svelte'
import { beginBusy, type BusyHandle, type BusyKind } from '../../process/memory/busyActions'
import { reportRefusedAssets, splitByAssetLimit } from '../../storage/pickedAssetLimit'
import { readPickedFileBytes, selectMultipleFileObjects, selectSingleFileObject } from '../../util'

// The bytes of a picked file, read the way the classic pickers read them.
export { readPickedFileBytes }

export type PickKind = 'portrait' | 'emotion' | 'asset'

// What each pick accepts, as the classic panel lists it: the character picture, the emotion images and the additional assets.
const EXTENSIONS: Readonly<Record<PickKind, readonly string[]>> = {
    portrait: ['png', 'webp', 'gif', 'jpg', 'jpeg'],
    emotion: ['png', 'webp', 'gif'],
    asset: ['png', 'webp', 'mp4', 'mp3', 'gif', 'jpeg', 'jpg', 'ttf', 'otf', 'css', 'webm', 'woff', 'woff2', 'svg', 'avif'],
}

const BUSY_KINDS: Readonly<Record<PickKind, BusyKind>> = { portrait: 'charImage', emotion: 'charEmotion', asset: 'assetAdd' }

export function pickExtensions(kind: PickKind): readonly string[] {
    return EXTENSIONS[kind]
}

// The lower-case text after the last dot of a file name; '' when there is none.
export function extensionOfName(name: string): string {
    const dot = name.lastIndexOf('.')
    return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

// What a file of a pick ends as: stored by the caller, refused for its type, refused for its size, or not stored.
export type PickFileResult = 'stored' | 'badType' | 'tooLarge' | 'storeFailed'

export type PickOutcome =
    | { kind: 'cancelled' }
    // `files` are the accepted ones in pick order; `badType` and `tooLarge` were refused here (the size refusals were
    // already reported with the classic notice).
    | { kind: 'picked'; files: File[]; badType: File[]; tooLarge: File[] }

export interface PickDeps {
    chooseSingle(extensions: readonly string[]): Promise<File | null>
    chooseMultiple(extensions: readonly string[]): Promise<File[] | null>
    limitBytes(): Promise<number>
    reportTooLarge(refused: readonly File[], limitBytes: number): void
}

const defaultDeps: PickDeps = {
    chooseSingle: (extensions) => selectSingleFileObject([...extensions]),
    chooseMultiple: (extensions) => selectMultipleFileObjects([...extensions]),
    limitBytes: pickedAssetLimitBytes,
    reportTooLarge: reportRefusedAssets,
}

// Opens the chooser for `kind` and sorts what it returns. A portrait pick is one file; the others take several.
export async function pickFiles(kind: PickKind, deps: PickDeps = defaultDeps): Promise<PickOutcome> {
    const extensions = EXTENSIONS[kind]
    let picked: File[] | null
    if (kind === 'portrait') {
        const one = await deps.chooseSingle(extensions)
        picked = one === null ? null : [one]
    } else {
        picked = await deps.chooseMultiple(extensions)
    }
    if (picked === null || picked.length === 0) {
        return { kind: 'cancelled' }
    }
    const typed = picked.filter((file) => extensions.includes(extensionOfName(file.name)))
    const badType = picked.filter((file) => !typed.includes(file))
    const limit = await deps.limitBytes()
    const { within, refused } = splitByAssetLimit(typed, limit)
    deps.reportTooLarge(refused, limit)
    return { kind: 'picked', files: within, badType, tooLarge: refused }
}

// The busy entry of the store phase of a pick: begun after the chooser has delivered its files, never while it is open.
export function beginPickBusy(kind: PickKind): BusyHandle {
    return beginBusy(BUSY_KINDS[kind])
}
