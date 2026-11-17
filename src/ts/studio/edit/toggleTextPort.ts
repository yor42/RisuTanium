// The one place the toggle builder reaches the history service: a thin adapter over the whole-value text write of a
// character's toggle definition. It reads the live string from the same field the write targets and never infers
// whether a write will land; a refused write comes back as a refusal.
import { DBState } from '../../stores.svelte'
import type { StudioResult } from '../history/ownerHistory.svelte'
import { characterOwnerKey, type OwnerKey } from '../history/ownerPhase'
import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService, historyBannerText } from '../history/studioHistoryService.svelte'

export type TogglePortMode = 'typing' | 'single'

export interface ToggleTextPort {
    readonly owner: OwnerKey
    /** First use of the owner's history for this visit; builds the service first when it is not built. */
    begin(): void
    /** The live definition text; '' when the field is absent. */
    read(): string
    /**
     * Reactive. Not editable while the history is loading, for a private owner, or without a service. A restricted
     * owner (private, a group, gone) shows nothing at all.
     */
    view(): { editable: boolean, banner: string | null, restricted: boolean }
    /** One text write of the whole string, or null when there is no write path (no service, not editable). */
    write(next: string, mode: TogglePortMode): StudioResult | null
    closeOpenStep(): void
}

export function characterTogglePort(chaId: string): ToggleTextPort {
    const owner = characterOwnerKey(chaId)
    return {
        owner,
        begin() {
            if (getStudioHistoryService()) {
                beginOwnerVisit(owner)
            } else {
                ensureStudioHistory()
            }
        },
        read() {
            const found = DBState.db.characters?.find((candidate) => candidate?.chaId === chaId)
            return found && found.type !== 'group' && typeof found.customModuleToggle === 'string' ? found.customModuleToggle : ''
        },
        view() {
            const found = DBState.db.characters?.find((candidate) => candidate?.chaId === chaId)
            const hidden = !found || found.type === 'group' || found.license === 'private'
            const service = getStudioHistoryService()
            if (!service) {
                return { editable: false, banner: null, restricted: hidden }
            }
            const view = service.view(owner)
            return { editable: view.editable, banner: historyBannerText(view.banner), restricted: hidden || view.restricted }
        },
        write(next, mode) {
            const service = getStudioHistoryService()
            return service && service.view(owner).editable ? service.editText(owner, 'customModuleToggle', next, mode) : null
        },
        closeOpenStep() {
            getStudioHistoryService()?.closeOpenStep(owner)
        },
    }
}
