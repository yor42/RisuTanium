import { language } from '../../../lang'
import { downloadFile } from '../../downloadFile'
import { openOutsideBusy } from '../../drive/exportDialogBusy'
import { downloadNotice } from '../../exportNotice'
import { parseLorebookImport } from '../../process/lorebook.svelte'
import { NoLorebookInPng, lorebookExportBytes } from '../../process/lorebookFile'
import { beginBusy, type BusyHandle } from '../../process/memory/busyActions'
import { postToast, type PlainToastInit } from '../../toast/toastHost.svelte'
import { selectMultipleFile } from '../../util'
import type { StudioResult } from '../history/ownerHistory.svelte'
import { loreImport, type LoreImportOp } from './loreImport'
import type { LoreHost } from './loreListModel'

/** What the import flow touches outside the list: the picker, the file reader and the notices. Tests pass stubs. */
export interface LoreImportDeps {
    /** Null when nothing was picked. */
    pick: () => Promise<readonly { name: string, data: Uint8Array }[] | null>
    parse: (data: Uint8Array) => unknown[]
    toast: (init: PlainToastInit) => void
}

export interface LoreExportDeps {
    beginBusy: () => BusyHandle
    /** True when the file was saved; false when the person cancelled the dialog. */
    save: (name: string, bytes: Uint8Array, busy: BusyHandle) => Promise<boolean>
    toast: (init: PlainToastInit) => void
}

export const defaultLoreImportDeps: LoreImportDeps = {
    pick: () => selectMultipleFile(['json', 'lorebook', 'png']),
    parse: parseLorebookImport,
    toast: (init) => { postToast(init) },
}

export const defaultLoreExportDeps: LoreExportDeps = {
    beginBusy: () => beginBusy('export'),
    save: (name, bytes, busy) => downloadFile(name, bytes, { aroundPicker: (open) => openOutsideBusy(busy, open) }),
    toast: (init) => { postToast(init) },
}

function errorText(error: unknown): string {
    return error instanceof NoLorebookInPng ? language.errors.noData : `${error}`
}

/**
 * Picks lorebook files and appends their entries as one step. `alive` is read once, after the pick and with nothing
 * awaited before the write, so a surface that closed during the pick writes nothing. A file that fails to read writes
 * nothing for any file. `run` is the pane's own-op runner: it shows a refusal itself.
 */
export async function runLoreImport(
    host: LoreHost,
    alive: () => boolean,
    run: (op: LoreImportOp) => StudioResult,
    deps: LoreImportDeps = defaultLoreImportDeps,
): Promise<void> {
    const files = await deps.pick()
    if (files === null || files.length === 0) return
    if (!alive()) return
    const imported: unknown[] = []
    try {
        for (const file of files) {
            for (const entry of deps.parse(file.data)) imported.push(entry)
        }
    } catch (error) {
        deps.toast({ kind: 'error', text: errorText(error) })
        return
    }
    const op = loreImport(host, imported)
    const result = run(op)
    if (!result.ok) return
    const summary = op.summary()
    if (summary === null) return
    const sentences: string[] = []
    if (summary.renamedIds > 0 || summary.renamedFolders > 0) sentences.push(language.studioLoreImportRenamed(summary.renamedIds, summary.renamedFolders))
    if (summary.skipped > 0) sentences.push(language.studioLoreImportSkipped(summary.skipped))
    const sub = sentences.length > 0 ? sentences.join(' ') : undefined
    if (result.unchanged === true) {
        deps.toast({ kind: 'info', text: language.studioLoreImportNone, sub: summary.skipped > 0 ? language.studioLoreImportSkipped(summary.skipped) : undefined })
        return
    }
    deps.toast({ kind: 'info', text: language.studioLoreImported(summary.count), sub })
}

/** Saves the list in the classic export bytes. The busy mark ends however the save ends. */
export async function runLoreExport(list: unknown, deps: LoreExportDeps = defaultLoreExportDeps): Promise<void> {
    const busy = deps.beginBusy()
    try {
        const saved = await deps.save('lorebook_export.json', lorebookExportBytes(list), busy)
        if (!saved) return
        deps.toast({ kind: 'info', text: downloadNotice(language.successExport) })
    } catch (error) {
        deps.toast({ kind: 'error', text: `${error}` })
    } finally {
        busy.end()
    }
}
