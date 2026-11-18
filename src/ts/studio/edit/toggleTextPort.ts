// The one place the toggle builder reaches the history service: a thin adapter over the whole-value text write of a
// character's or resident module's toggle definition. It reads the live string from the same field the write targets and never infers
// whether a write will land; a refused write comes back as a refusal.
import { DBState } from '../../stores.svelte'
import type { StudioResult } from '../history/ownerHistory.svelte'
import type { RisuModule } from '../../process/modules'
import { isModuleStub } from '../../storage/moduleStub'
import { characterOwnerKey, moduleOwnerKey, type OwnerKey } from '../history/ownerPhase'
import { moduleSlotsWithId } from './assetSetters'
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

/**
 * The port of a resident module's toggle definition. `moduleId` is the raw stored id, which is also what the module
 * owner key and the published open-module id carry; a Studio owner id of a later duplicate row (`id#row`) never reaches
 * it. The live text is read from the first non-stub slot holding the id, never by slot index; a shared id still shows
 * its text, and the service refuses every write to it.
 */
export function moduleTogglePort(moduleId: string): ToggleTextPort {
    const owner = moduleOwnerKey(moduleId)
    const slotOf = (): RisuModule | null => {
        const slot = moduleSlotsWithId(DBState.db.modules, moduleId).find((candidate) => !isModuleStub(candidate.module))
        return slot ? slot.module as RisuModule : null
    }
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
            const found = slotOf()
            return found && typeof found.customModuleToggle === 'string' ? found.customModuleToggle : ''
        },
        view() {
            const hidden = slotOf() === null
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
