import { language } from '../../../lang'
import { DBState } from '../../stores.svelte'
import { moduleRowOf } from '../assets/openModuleForm.svelte'
import type { StudioConfirm, StudioResult } from '../history/ownerHistory.svelte'
import { parseOwnerKey, type OwnerKey } from '../history/ownerPhase'
import { askStudioRisky } from '../studioScreen.svelte'

/**
 * The name the confirm sheet gives a module: its stored name while that is a non-blank string, else the plural module
 * label the tree falls back to. Read when the sheet opens, from the owner's own row.
 */
export function lowLevelAskName(owner: OwnerKey): string {
    const parsed = parseOwnerKey(owner)
    if (parsed === null || parsed.kind !== 'module') return language.modules
    const row = moduleRowOf(DBState.db.modules, parsed.moduleId)
    // A stored name may be of another type; only a string is shown.
    const name = row === null ? undefined : DBState.db.modules[row.index]?.name
    return typeof name === 'string' && name.trim() !== '' ? name : language.modules
}

/**
 * Runs the confirm step of a Low Level Access turn-on. A result that is not the `confirm-low-level` refusal is returned
 * as it is. On that refusal the sheet is asked: Turn on runs `rerun` once with the confirm, and with the refusal's
 * `expectTop` for an undo or a redo, so a stack that moved while the sheet was open refuses `targetChanged` and nothing
 * lands. Cancel (or Back, Esc, a closed visit) returns the refusal marked `cancelled` and runs nothing; the host shows
 * no message for it. Focus goes back to the element that had it before the sheet, while that element is still connected.
 */
export async function runWithLowLevelConfirm(
    first: StudioResult,
    name: string,
    rerun: (confirm: StudioConfirm, expectTop: string | undefined) => StudioResult | Promise<StudioResult>,
): Promise<StudioResult> {
    if (first.ok !== false || first.reason !== 'confirm-low-level') return first
    const before = typeof document === 'undefined' ? null : document.activeElement
    const confirmed = await askStudioRisky(name)
    if (!confirmed) {
        if (before instanceof HTMLElement && before.isConnected) before.focus()
        return { ok: false, reason: 'confirm-low-level', cancelled: true }
    }
    return rerun('lowLevelOn', first.expectTop)
}
