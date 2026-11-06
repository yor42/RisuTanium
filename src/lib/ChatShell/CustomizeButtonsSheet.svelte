<script lang="ts">
    import ShellSheet from './ShellSheet.svelte'
    import { ACTION_IDS, DEFAULT_PINNED, type ActionId, type ActionSlots } from '../../ts/chatShell/actionSlots'
    import { currentSlots, syncSlots, updateSlots } from '../../ts/chatShell/slotsStore.svelte'
    import { language } from '../../lang'

    interface Props { open: boolean; opener?: HTMLElement | null; background?: readonly HTMLElement[]; onclose: () => void; onchange?: () => void }
    let { open, opener = null, background = [], onclose, onchange }: Props = $props()
    syncSlots()
    let slots = $derived(currentSlots())
    $effect(() => { if (open) syncSlots() })
    // Both the row-hosted and the Settings-hosted sheet change the one shared layout, so each change starts from the latest.
    function save(next: ActionSlots): void { updateSlots(next); onchange?.() }
    const labels: Record<string, string> = {
        copy: language.copy, edit: language.edit, translate: language.translate,
        readAloud: language.chatShellReadAloud, delete: language.remove,
        branch: language.chatShellBranch, bookmark: language.bookmark,
        hideAI: language.disableMessage, newReply: language.chatShellNewReply,
        stepPrev: language.chatShellPreviousReply, stepNext: language.chatShellNextReply,
        selectText: language.chatShellSelectText,
    }
    function labelOf(id: ActionId): string { return labels[id] ?? id }
    function pin(id: ActionId): void {
        const latest = currentSlots()
        save({ ...latest, pinned: latest.pinned.includes(id) ? latest.pinned.filter((item) => item !== id) : [...latest.pinned, id] })
    }
    function move(id: ActionId, delta: number): void {
        const latest = currentSlots()
        const order = [...latest.order]
        const at = order.indexOf(id)
        const target = at + delta
        if (target < 0 || target >= order.length) return
        ;[order[at], order[target]] = [order[target], order[at]]
        save({ ...latest, order })
    }
    function defaults(): void { save({ order: [...ACTION_IDS], pinned: [...DEFAULT_PINNED] }) }
</script>

<ShellSheet {open} kind="sheet" label={language.chatShellCustomizeButtons} {opener} {background} inertOutside={background.length === 0} {onclose}>
    <h2>{language.chatShellCustomizeButtons}</h2>
    <p>{language.chatShellOnThisDevice}</p>
    {#each slots.order.filter((id) => ACTION_IDS.includes(id as typeof ACTION_IDS[number]) && id !== 'deleteAfter' && id !== 'customizeButtons') as id}
        <div data-part="chat-customize-action">
            <label style:min-height="var(--size-touch)"><input type="checkbox" style:width="var(--space-12)" style:height="var(--space-12)" checked={slots.pinned.includes(id)} onchange={() => pin(id)} />{labelOf(id)}</label>
            <button type="button" aria-label={`${language.chatShellMoveUp} ${labelOf(id)}`} onclick={() => move(id, -1)}>{language.chatShellMoveUp}</button>
            <button type="button" aria-label={`${language.chatShellMoveDown} ${labelOf(id)}`} onclick={() => move(id, 1)}>{language.chatShellMoveDown}</button>
        </div>
    {/each}
    <div data-part="chat-customize-preview">{slots.pinned.map(labelOf).join(' · ')}</div>
    <button type="button" onclick={defaults}>{language.chatShellRestoreDefaults}</button>
</ShellSheet>

<style>
    [data-part="chat-customize-action"] { display: flex; align-items: center; gap: var(--space-7); }
    [data-part="chat-customize-action"] label { flex: 1; display: flex; align-items: center; gap: var(--space-7); }
    [data-part="chat-customize-action"] input[type="checkbox"] { flex: none; }
    button { min-height: var(--size-21); color: var(--nexus-text); }
</style>
