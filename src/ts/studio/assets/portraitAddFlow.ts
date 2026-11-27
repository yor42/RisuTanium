// The add / replace flow of a character's main portrait: pick, read, store, then one history step. It lives in a module,
// not in the form, so its outcome reaches the user even when the form is gone by the time the store answers.
//
// An add belongs to the Studio visit it started in. `closeStudio` keeps the selected character and the visit id, so the
// service's own guard would still accept the step after Studio closed; the flow therefore checks the visit itself after
// every await and never lands a step, or stores a file it can still skip, for a visit that ended.

import { language } from '../../../lang'
import type { PlainToastInit } from '../../toast/toastHost.svelte'
import { addRefusalNotice } from '../edit/studioToasts'
import type { OwnerHistoryService } from '../history/ownerHistory.svelte'
import type { OwnerKey } from '../history/ownerPhase'
import { studioScreen } from '../studioScreen.svelte'
import type { PickOutcome } from './filePicker'

export type PortraitAddOutcome = 'cancelled' | 'landed' | 'not-added' | 'refused' | 'store-failed' | 'bad-file'

export interface PortraitAddDeps {
    pickFiles(): Promise<PickOutcome>
    readBytes(file: File): Promise<Uint8Array>
    readPortraitTextChunks(bytes: Uint8Array): Promise<Record<string, string>>
    saveImage(bytes: Uint8Array): Promise<string>
    service: Pick<OwnerHistoryService, 'portraitAdd'>
    toastHost: { post(init: PlainToastInit): unknown }
    // Called when the step landed: `n` is the number of PNG text notes it copied (zero when none).
    onLanded(n: number): void
    // The busy entry of the store phase; absent in a caller that has none.
    beginBusy?(): { end(): void }
}

export async function runPortraitAdd(owner: OwnerKey, deps: PortraitAddDeps): Promise<PortraitAddOutcome> {
    const visit = studioScreen.visitId
    const alive = (): boolean => studioScreen.open && studioScreen.visitId === visit
    // A file that was picked and then not added: one app-wide notice, since the form that asked may be gone.
    const notAdded = (): PortraitAddOutcome => {
        deps.toastHost.post({ kind: 'warning', text: language.studioImportNotAdded(1) })
        return 'not-added'
    }

    const picked = await deps.pickFiles()
    if (picked.kind === 'cancelled') {
        return 'cancelled'
    }
    // The chooser may stay open for as long as the person likes; the visit may have ended meanwhile.
    if (!alive()) {
        return notAdded()
    }
    const file = picked.files[0]
    if (file === undefined) {
        // Refused for its type or size: the size refusal was already reported by the picker.
        return 'bad-file'
    }
    const busy = deps.beginBusy?.()
    try {
        const bytes = await deps.readBytes(file)
        if (!alive()) {
            return notAdded()
        }
        const chunks = await deps.readPortraitTextChunks(bytes)
        if (!alive()) {
            return notAdded()
        }
        let path: string
        try {
            path = await deps.saveImage(bytes)
        } catch (error) {
            console.error(error)
            deps.toastHost.post({ kind: 'warning', text: language.studioPortraitStoreFail })
            return 'store-failed'
        }
        // The stored file is left unreferenced when the visit ended, and the next boot sweep removes it.
        if (!alive()) {
            return notAdded()
        }
        const result = deps.service.portraitAdd(owner, path, chunks)
        if (result.ok === false) {
            const notice = addRefusalNotice(alive(), result)
            if (notice.kind === 'not-added') {
                return notAdded()
            }
            deps.toastHost.post({ kind: 'warning', text: notice.text })
            return 'refused'
        }
        deps.onLanded(result.pngChunks ?? 0)
        return 'landed'
    } finally {
        busy?.end()
    }
}
