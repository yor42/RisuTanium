<script lang="ts">
    import { tick } from 'svelte'
    import { StarIcon } from '@lucide/svelte'
    import { language } from '../../lang'
    import { isOn, selectControl, selectedIndex, shownText, type DuplicateBadge, type PanelValueRow } from '../../ts/chatShell/togglePanel'

    /**
     * One value row of the toggles panel: the label, the control of its kind, the on marker, the duplicate badges and
     * the row menu (the favourite star, the move steps in the Favourites section, Reset, and the shared-value revert).
     * It holds no state of its own about the value: the panel reads it from the chat, writes it through the scope
     * accessors and hands it back here.
     */
    interface Props {
        row: PanelValueRow
        value: string
        badges: DuplicateBadge[]
        // The chat holds its own value for this key and it differs from the shared one.
        chatOnly: boolean
        menuOpen: boolean
        editing: boolean
        draft: string
        onset: (value: string) => void
        onpick: (opener: HTMLElement) => void
        onedit: (opener: HTMLElement) => void
        ondraft: (text: string) => void
        oncommit: () => void
        onmenu: (open: boolean) => void
        onreset: () => void
        onrevert: () => void
        // Favourites: the row is starred (the mark shows on source rows only), this copy sits in the Favourites section
        // (which adds the move steps), and the steps that are possible from here.
        starred?: boolean
        inFavourites?: boolean
        canMoveUp?: boolean
        canMoveDown?: boolean
        onstar?: () => void
        onmove?: (by: -1 | 1) => void
    }

    let {
        row, value, badges, chatOnly, menuOpen, editing, draft, onset, onpick, onedit, ondraft, oncommit, onmenu, onreset, onrevert,
        starred = false, inFavourites = false, canMoveUp = false, canMoveDown = false, onstar, onmove,
    }: Props = $props()

    let on = $derived(isOn(row.kind, value))
    let control = $derived(row.kind === 'select' ? selectControl(row.label, row.options) : null)
    let chosen = $derived(row.kind === 'select' ? selectedIndex(value, row.options) : 0)
    let preview = $derived(shownText(value))
    let inputEl = $state<HTMLInputElement>()
    let resetLabel = $derived(row.kind === 'check' ? language.chatShellTogglesReset : row.kind === 'select' ? language.chatShellTogglesResetSelect : language.chatShellTogglesResetText)

    // The inline field takes focus when it appears.
    $effect(() => {
        if (editing && inputEl) {
            inputEl.focus()
            inputEl.select()
        }
    })

    function onInputKey(event: KeyboardEvent): void {
        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault()
            oncommit()
        }
    }

    // Arrow keys move the one tab stop of a segmented control.
    async function onRadioKey(event: KeyboardEvent): Promise<void> {
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
        if (step === 0) return
        event.preventDefault()
        const group = event.currentTarget as HTMLElement
        const next = (chosen + step + row.options.length) % row.options.length
        onset(String(next))
        await tick()
        group.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
    }

    function openMenu(event: MouseEvent): void {
        event.stopPropagation()
        onmenu(!menuOpen)
    }
</script>

<div data-part="toggle-row" data-uid={row.uid} data-key={row.key} data-kind={row.kind} data-on={on ? '' : undefined}>
    <div data-part="toggle-row-line">
        {#if row.kind === 'check'}
            <label data-part="toggle-row-main">
                {#if on}<span data-part="toggle-dot" aria-hidden="true"></span>{/if}
                <span data-part="toggle-label" title={row.label}>{row.label}</span>
                {#if starred && !inFavourites}<span data-part="toggle-star-mark" aria-hidden="true"><StarIcon size={12} fill="currentColor" /></span>{/if}
                <input type="checkbox" role="switch" data-part="toggle-switch" data-row-control checked={on} onchange={() => onset(on ? '0' : '1')} />
            </label>
        {:else}
            <div data-part="toggle-row-main">
                {#if on}<span data-part="toggle-dot" aria-hidden="true"></span>{/if}
                <span data-part="toggle-label" id="toggle-label-{row.uid}" title={row.label}>{row.label}{#if on}<span data-part="toggle-on-a11y">, {language.chatShellTogglesChangedA11y}</span>{/if}</span>
                {#if starred && !inFavourites}<span data-part="toggle-star-mark" aria-hidden="true"><StarIcon size={12} fill="currentColor" /></span>{/if}
                {#if row.kind === 'select' && control === 'inline'}
                    <div role="radiogroup" data-part="toggle-select" data-layout="inline" aria-labelledby="toggle-label-{row.uid}" tabindex="-1" onkeydown={onRadioKey}>
                        {#each row.options as option, index}
                            <button type="button" role="radio" data-part="toggle-select-option" data-row-control aria-checked={index === chosen} tabindex={index === chosen ? 0 : -1} onclick={() => onset(String(index))}>{option}</button>
                        {/each}
                    </div>
                {:else if row.kind === 'select' && control === 'list'}
                    <button type="button" data-part="toggle-select-list" data-row-control aria-haspopup="dialog" aria-labelledby="toggle-label-{row.uid}" onclick={(event) => onpick(event.currentTarget)}>
                        <span>{row.options[chosen] ?? ''}</span><span aria-hidden="true">▾</span>
                    </button>
                {:else if row.kind === 'text' && editing}
                    <input bind:this={inputEl} data-part="toggle-text-input" aria-labelledby="toggle-label-{row.uid}" value={draft} oninput={(event) => ondraft(event.currentTarget.value)} onkeydown={onInputKey} onblur={oncommit} />
                {:else if row.kind === 'text' || row.kind === 'textarea'}
                    <button type="button" data-part="toggle-text-button" data-row-control data-textarea={row.kind === 'textarea' ? '' : undefined} aria-haspopup={row.kind === 'textarea' ? 'dialog' : undefined} aria-labelledby="toggle-label-{row.uid}" onclick={(event) => onedit(event.currentTarget)}>
                        <span data-part="toggle-preview" data-empty={preview === '' ? '' : undefined}>{preview === '' ? language.chatShellTogglesEmpty : preview}</span><span aria-hidden="true">✎</span>
                    </button>
                {/if}
            </div>
            {#if row.kind === 'select' && control === 'stacked'}
                <div role="radiogroup" data-part="toggle-select" data-layout="stacked" aria-labelledby="toggle-label-{row.uid}" tabindex="-1" onkeydown={onRadioKey}>
                    {#each row.options as option, index}
                        <button type="button" role="radio" data-part="toggle-select-option" data-row-control aria-checked={index === chosen} tabindex={index === chosen ? 0 : -1} onclick={() => onset(String(index))}>{option}</button>
                    {/each}
                </div>
            {/if}
        {/if}
        <button type="button" data-part="toggle-menu-button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={language.chatShellTogglesMenu(row.label)} onclick={openMenu}>⋯</button>
    </div>
    {#if chatOnly || badges.length > 0}
        <div data-part="toggle-tags">
            {#if chatOnly}<span data-part="toggle-chat-tag">{language.chatShellTogglesLocalTag}</span>{/if}
            {#each badges as badge}
                <span data-part="toggle-badge" data-mismatch={badge.mismatch ? 'true' : 'false'}>{badge.mismatch ? language.chatShellTogglesDupMismatch(badge.sourceName) : language.chatShellTogglesSameValue(badge.sourceName)}</span>
            {/each}
        </div>
    {/if}
    {#if menuOpen}
        <div role="menu" data-part="toggle-menu" aria-label={language.chatShellTogglesMenu(row.label)}>
            {#if onstar}
                <button type="button" role="menuitem" data-part="toggle-star" onclick={onstar}>{starred ? language.chatShellTogglesUnstar : language.chatShellTogglesStar}</button>
            {/if}
            {#if inFavourites && onmove}
                <button type="button" role="menuitem" data-part="toggle-move-up" disabled={!canMoveUp} onclick={() => onmove(-1)}>{language.chatShellMoveUp}</button>
                <button type="button" role="menuitem" data-part="toggle-move-down" disabled={!canMoveDown} onclick={() => onmove(1)}>{language.chatShellMoveDown}</button>
            {/if}
            <button type="button" role="menuitem" data-part="toggle-reset" onclick={onreset}>{resetLabel}</button>
            {#if chatOnly}
                <button type="button" role="menuitem" data-part="toggle-revert" onclick={onrevert}>{language.chatShellTogglesRevertShared}</button>
            {/if}
        </div>
    {/if}
</div>

<style>
    [data-part="toggle-row"] { display: flex; flex-direction: column; gap: var(--space-3); min-height: var(--size-touch); padding: var(--space-3) var(--space-10); border-bottom: 1px solid var(--nexus-edge); content-visibility: auto; contain-intrinsic-size: auto var(--size-touch); }
    [data-part="toggle-row-line"] { display: flex; align-items: center; gap: var(--space-5); }
    [data-part="toggle-row-main"] { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-7); min-height: var(--size-touch); }
    [data-part="toggle-label"] { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
    [data-part="toggle-on-a11y"] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    [data-part="toggle-dot"] { flex: none; width: var(--space-5); height: var(--space-5); border-radius: var(--radius-circle); background: var(--nexus-accent); }
    [data-part="toggle-select"] { display: flex; gap: var(--space-3); flex: none; }
    [data-part="toggle-select"][data-layout="stacked"] { padding-bottom: var(--space-3); }
    [data-part="toggle-select-option"], [data-part="toggle-select-list"], [data-part="toggle-text-button"], [data-part="toggle-menu-button"], [data-part="toggle-star"], [data-part="toggle-move-up"], [data-part="toggle-move-down"], [data-part="toggle-reset"], [data-part="toggle-revert"] { min-height: var(--size-touch); padding: 0 var(--space-7); color: var(--nexus-text); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); }
    [data-part="toggle-select-option"][aria-checked="true"] { background: var(--color-accent-tint); border-color: var(--nexus-accent); }
    [data-part="toggle-select-list"], [data-part="toggle-text-button"] { display: flex; align-items: center; justify-content: space-between; gap: var(--space-5); max-width: 50%; }
    [data-part="toggle-text-button"][data-textarea] [data-part="toggle-preview"] { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: normal; text-align: left; }
    [data-part="toggle-preview"] { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [data-part="toggle-preview"][data-empty] { color: var(--nexus-text-secondary); }
    [data-part="toggle-text-input"] { flex: 1; min-width: 0; min-height: var(--size-touch); padding: 0 var(--space-7); color: var(--nexus-text); background: var(--nexus-surface-raised); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); }
    [data-part="toggle-menu-button"] { flex: none; min-width: var(--size-touch); border-color: transparent; }
    [data-part="toggle-move-up"]:disabled, [data-part="toggle-move-down"]:disabled { opacity: 0.4; }
    [data-part="toggle-star-mark"] { display: inline-flex; flex: none; color: var(--nexus-accent); }
    [data-part="toggle-tags"] { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    [data-part="toggle-chat-tag"], [data-part="toggle-badge"] { padding: 0 var(--space-5); font-size: var(--font-size-2xs); color: var(--nexus-text-secondary); border: 1px solid var(--nexus-edge); border-radius: var(--radius-pill); }
    [data-part="toggle-badge"][data-mismatch="true"] { color: var(--nexus-text); border-color: var(--nexus-accent); }
    [data-part="toggle-menu"] { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    [data-part="toggle-row"] :is(button, input):focus-visible { outline: var(--stroke-bold) solid var(--nexus-text); }
</style>
