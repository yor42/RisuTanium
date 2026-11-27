// The portrait half of Studio's setters. Pure: each builder reads the live owner through a `LiveReader` and returns the one
// `portraitSet` op of its step, or a reason; nothing here writes, marks or records. Each mirrors the classic panel's own
// mutation exactly (`selectCharImg` with `dumpCharImage`, `changeCharImage`, and the two removals), so a classic edit and a
// Studio edit leave the same `image`, `ccAssets` and `pngExif`.

import type { JsonValue } from '../../storage/blockFrame'
import type { ExifValue, LiveReader, PortraitOp, PortraitRow, PortraitValue, StepLabel } from '../history/historyModel'
import type { AssetBuildResult } from './assetSetters'

type BuiltOk = Extract<AssetBuildResult, { ok: true }>
type BuiltFail = Extract<AssetBuildResult, { ok: false }>

// `chunkCount` is how many PNG text notes the step copies into the exif map: zero when the picture gave none, or when the
// exif map cannot be written into (then the add lands without them).
export type PortraitAddBuild = (BuiltOk & { chunkCount: number }) | BuiltFail

// The row the classic panel appends for a main photo that stops being main.
function demotedRow(path: string): PortraitRow {
    return { type: 'icon', name: 'iconx', uri: path, ext: 'png' }
}

function rowsOf(value: PortraitValue): PortraitRow[] {
    return value.alternates.had ? value.alternates.rows.map((row) => ({ type: row.type, uri: row.uri, name: row.name, ext: row.ext })) : []
}

function mainOf(value: PortraitValue): string {
    return value.image.had ? value.image.value : ''
}

function finish(label: StepLabel, before: PortraitValue, after: PortraitValue, pngExif?: PortraitOp['pngExif']): BuiltOk {
    return { ok: true, label, ops: [{ op: 'portraitSet', before, after, ...(pngExif === undefined ? {} : { pngExif }) }] }
}

// Add or replace: the new file becomes main, a non-empty old main is appended to the alternates (created when absent), and
// the picture's text notes are assigned over the existing exif map key by key. The map is only touched when the picture
// gave notes and the map can be written into.
export function buildPortraitAdd(path: string, chunks: Readonly<Record<string, string>>, live: LiveReader): PortraitAddBuild {
    const before = live.portrait ? live.portrait() : null
    if (before === null || path === '') {
        return { ok: false, reason: 'precondition' }
    }
    const old = mainOf(before)
    const after: PortraitValue = {
        image: { had: true, value: path },
        alternates: old === '' ? (before.alternates.had ? { had: true, rows: rowsOf(before) } : { had: false }) : { had: true, rows: [...rowsOf(before), demotedRow(old)] },
    }
    const names = Object.keys(chunks)
    let pngExif: PortraitOp['pngExif']
    if (names.length > 0) {
        const exif = live.pngExif ? live.pngExif() : null
        if (exif !== null) {
            const merged: { [key: string]: JsonValue } = exif.had && typeof exif.value === 'object' && exif.value !== null && !Array.isArray(exif.value) ? { ...exif.value } : {}
            for (const name of names) {
                merged[name] = chunks[name]
            }
            const afterExif: ExifValue = { had: true, value: merged }
            pngExif = { before: exif, after: afterExif }
        }
    }
    return { ...finish({ kind: 'portraitAdd' }, before, after, pngExif), chunkCount: pngExif === undefined ? 0 : names.length }
}

// Make main: the alternate at `index` leaves the list, a non-empty old main is appended, and the alternate's file is main.
export function buildPortraitMakeMain(index: number, live: LiveReader): AssetBuildResult {
    const before = live.portrait ? live.portrait() : null
    if (before === null || !before.alternates.had || !Number.isInteger(index) || index < 0 || index >= before.alternates.rows.length) {
        return { ok: false, reason: 'precondition' }
    }
    const rows = rowsOf(before)
    const [promoted] = rows.splice(index, 1)
    const old = mainOf(before)
    if (old !== '') {
        rows.push(demotedRow(old))
    }
    return finish({ kind: 'portraitMain' }, before, { image: { had: true, value: promoted.uri }, alternates: { had: true, rows } })
}

// Remove the main photo (the first alternate, if any, becomes main) or the alternate at an index.
export function buildPortraitRemove(target: 'main' | number, live: LiveReader): AssetBuildResult {
    const before = live.portrait ? live.portrait() : null
    if (before === null) {
        return { ok: false, reason: 'precondition' }
    }
    if (target === 'main') {
        if (mainOf(before) === '') {
            return { ok: false, reason: 'precondition' }
        }
        const rows = rowsOf(before)
        if (rows.length === 0) {
            return finish({ kind: 'portraitRemove' }, before, { image: { had: true, value: '' }, alternates: before.alternates.had ? { had: true, rows } : { had: false } })
        }
        const [promoted] = rows.splice(0, 1)
        return finish({ kind: 'portraitRemove' }, before, { image: { had: true, value: promoted.uri }, alternates: { had: true, rows } })
    }
    if (!before.alternates.had || !Number.isInteger(target) || target < 0 || target >= before.alternates.rows.length) {
        return { ok: false, reason: 'precondition' }
    }
    const rows = rowsOf(before)
    rows.splice(target, 1)
    return finish({ kind: 'portraitRemove' }, before, { image: before.image.had ? { had: true, value: before.image.value } : { had: false }, alternates: { had: true, rows } })
}
