<script lang="ts">
    import ShellSheet from './ShellSheet.svelte'
    import { ACTION_IDS, DEFAULT_PINNED, readSlots, writeSlots, type ActionId } from '../../ts/chatShell/actionSlots'
    import { language } from '../../lang'

    interface Props { open: boolean; opener?: HTMLElement | null; onclose: () => void; onchange?: () => void }
    let { open, opener = null, onclose, onchange }: Props = $props()
    let slots = $state(readSlots())
    function save(): void { writeSlots(slots); onchange?.() }
    function pin(id: ActionId): void {
        slots = { ...slots, pinned: slots.pinned.includes(id) ? slots.pinned.filter((item) => item !== id) : [...slots.pinned, id] }
        save()
    }
    function move(id: ActionId, delta: number): void {
        const order = [...slots.order]
        const at = order.indexOf(id)
        const target = at + delta
        if (target < 0 || target >= order.length) return
        ;[order[at], order[target]] = [order[target], order[at]]
        slots = { ...slots, order }
        save()
    }
    function defaults(): void { slots = { order: [...ACTION_IDS], pinned: [...DEFAULT_PINNED] }; save() }
</script>

<ShellSheet {open} kind="sheet" label={language.chatShellCustomizeButtons} {opener} {onclose}>
    <h2>{language.chatShellCustomizeButtons}</h2>
    <p>{language.chatShellOnThisDevice}</p>
    {#each slots.order.filter((id) => ACTION_IDS.includes(id as typeof ACTION_IDS[number]) && id !== 'deleteAfter' && id !== 'customizeButtons') as id}
        <div data-part="chat-customize-action">
            <label><input type="checkbox" checked={slots.pinned.includes(id)} onchange={() => pin(id)} />{id}</label>
            <button type="button" aria-label={`${language.chatShellMoveUp} ${id}`} onclick={() => move(id, -1)}>{language.chatShellMoveUp}</button>
            <button type="button" aria-label={`${language.chatShellMoveDown} ${id}`} onclick={() => move(id, 1)}>{language.chatShellMoveDown}</button>
        </div>
    {/each}
    <div data-part="chat-customize-preview">{slots.pinned.join(' · ')}</div>
    <button type="button" onclick={defaults}>{language.chatShellRestoreDefaults}</button>
</ShellSheet>

<style>
    [data-part="chat-customize-action"] { display: flex; align-items: center; gap: var(--space-7); }
    [data-part="chat-customize-action"] label { flex: 1; }
    button { min-height: var(--size-21); color: var(--nexus-text); }
</style>
