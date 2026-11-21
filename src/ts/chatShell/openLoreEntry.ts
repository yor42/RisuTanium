import type { LoreEntryTarget } from '../process/loreUse'
import type { StudioTarget } from '../studio/studioTarget'

/** The Studio visit that shows a listed entry: the entry itself when named, else the owner's lorebook list. */
export function studioTargetOfLoreEntry(target: LoreEntryTarget): StudioTarget {
    const visit: StudioTarget = { owner: { ...target.owner }, kind: 'lore', from: 'chat' }
    if (target.item !== undefined) visit.item = target.item
    return visit
}

/**
 * Opens the lorebook editor on a listed entry: Studio when it can open (it then shows the entry), else the classic
 * editor's lorebook page for that owner, which has no way to name one entry. An entry whose owner the scan could
 * not tell goes to the classic page too. Loaded on the tap, so the chat view does not load Studio with every message.
 */
export async function openLoreEntry(target: LoreEntryTarget, element: HTMLElement): Promise<void> {
    const [{ studioEligible }, { openStudio }, { openInClassicEditor }] = await Promise.all([
        import('../studio/studioSwitch.svelte'),
        import('../studio/studioScreen.svelte'),
        import('../studio/classicLinks.svelte'),
    ])
    if (target.owner.id !== '' && studioEligible() && openStudio(studioTargetOfLoreEntry(target), { element })) return
    openInClassicEditor(target.owner.type, 'lore')
}
