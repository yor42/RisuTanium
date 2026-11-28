import { language } from '../../../lang'
import type { customscript } from '../../storage/database.svelte'
import { postToast, type PlainToastInit } from '../../toast/toastHost.svelte'
import { selectSingleFile } from '../../util'
import type { StudioResult } from '../history/ownerHistory.svelte'
import { regexImportBadText } from './objListCopy'
import { parseRegexImport } from './regexImport'
import { regexImport, type RegexOp } from './regexListOps'

/** What the import flow touches outside the list: the picker and the notices. Tests pass stubs. */
export interface RegexImportDeps {
    /** Null when nothing was picked. */
    pick: () => Promise<{ name: string, data: Uint8Array } | null>
    toast: (init: PlainToastInit) => void
}

export interface RegexExportDeps {
    exportList: (list: unknown[]) => Promise<void>
    toast: (init: PlainToastInit) => void
}

export const defaultRegexImportDeps: RegexImportDeps = {
    pick: () => selectSingleFile(['json']),
    toast: (init) => { postToast(init) },
}

export const defaultRegexExportDeps: RegexExportDeps = {
    exportList: async (list) => {
        const { exportRegex } = await import('../../process/scripts')
        // The classic export writes the elements as stored, so the list goes out without being checked or copied.
        await exportRegex(list as customscript[])
    },
    toast: (init) => { postToast(init) },
}

/**
 * Picks a regex script file and appends its entries as one step. `alive` is read once, after the pick and with nothing
 * awaited before the write, so a surface that closed during the pick writes nothing. A file that is not readable as a
 * whole writes nothing. `run` is the pane's own-op runner: it shows a refusal itself.
 */
export async function runRegexImport(
    alive: () => boolean,
    run: (op: RegexOp) => StudioResult,
    deps: RegexImportDeps = defaultRegexImportDeps,
): Promise<void> {
    const file = await deps.pick()
    if (file === null) return
    if (!alive()) return
    const parsed = parseRegexImport(file.data)
    if (parsed.kind === 'notRegex') {
        deps.toast({ kind: 'error', text: language.studioRegexImportNotRegex })
        return
    }
    if (parsed.kind === 'empty') {
        deps.toast({ kind: 'info', text: language.studioRegexImportEmpty })
        return
    }
    if (parsed.kind === 'bad') {
        deps.toast({ kind: 'error', text: regexImportBadText(parsed.count, parsed.position, parsed.reasons) })
        return
    }
    const result = run(regexImport(parsed.entries))
    if (!result.ok || result.unchanged === true) return
    deps.toast({ kind: 'info', text: language.studioRegexImported(parsed.entries.length) })
}

/** Saves the list in the classic export bytes. A list that is not an array is refused; a failed save posts an error notice. */
export async function runRegexExport(list: unknown, deps: RegexExportDeps = defaultRegexExportDeps): Promise<void> {
    if (!Array.isArray(list)) return
    try {
        await deps.exportList(list)
    } catch (error) {
        deps.toast({ kind: 'error', text: `${error}` })
    }
}
