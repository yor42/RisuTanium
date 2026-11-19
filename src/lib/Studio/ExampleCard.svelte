<script lang="ts">
    import { EllipsisIcon, GripVerticalIcon } from '@lucide/svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import type { StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import type { LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import { turnMarks } from '../../ts/studio/longText/exampleTurns'
    import LongTextField from './LongTextField.svelte'
    import type { PreviewSourceInput } from './LongTextPreview.svelte'

    // One example card: its header (title, turn counts, handle and menu) and the card's text field. The form owns the
    // port, the hold and every write; the card only reports what the user asked for.
    interface Props {
        id: number
        index: number
        kind: 'opening' | 'block'
        // The 1-based number among the example blocks; unused for the opening.
        number: number
        subtitle: string
        canMoveUp: boolean
        canMoveDown: boolean
        port: LongTextWritePort
        editable: boolean
        ownerLabel: string
        previewSource: () => PreviewSourceInput
        onresult: (result: StudioResult | null) => void
        onmove: (delta: -1 | 1) => void
        ondelete: () => void
        onmarkopening: () => void
        // Capture-phase `input` at the card, ahead of the field's own handler: the form reads the input type there.
        oninputcapture: (event: Event) => void
        // The card's full-screen layer opened or closed; the form widens or releases its hold for this card.
        onfocuslayer: (open: boolean) => void
    }

    let { id, index, kind, number, subtitle, canMoveUp, canMoveDown, port, editable, ownerLabel, previewSource, onresult, onmove, ondelete, onmarkopening, oninputcapture, onfocuslayer }: Props = $props()

    let root = $state<HTMLElement | undefined>()
    let menuOpen = $state(false)

    const title = $derived(kind === 'opening' ? language.ltOpening : language.ltExCard(number))
    const handleLabel = $derived(kind === 'opening' ? language.ltOpening : language.ltExCardHandle(number))
    const menuLabel = $derived(kind === 'opening' ? language.ltOpening : language.ltExCardMenu(number))

    function closeMenu(): void {
        menuOpen = false
    }

    async function toggleMenu(): Promise<void> {
        if (menuOpen) {
            closeMenu()
            return
        }
        menuOpen = true
        await afterFlush()
        root?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    }

    function menuButton(): HTMLElement | null {
        return root?.querySelector<HTMLElement>('[data-part="studio-example-menu"]') ?? null
    }

    // Alt+ArrowUp and Alt+ArrowDown act on the handle and the menu button only; inside the text field they are the
    // field's own keys.
    function onCardKey(event: KeyboardEvent): void {
        if (event.isComposing || event.keyCode === 229) return
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        if (!editable) return
        onmove(event.key === 'ArrowUp' ? -1 : 1)
    }

    function onMenuButtonKey(event: KeyboardEvent): void {
        if (event.key === 'Escape' && menuOpen) {
            event.stopPropagation()
            closeMenu()
            return
        }
        onCardKey(event)
    }

    function onMenuKey(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.stopPropagation()
            closeMenu()
            menuButton()?.focus()
            return
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        const items = Array.from(event.currentTarget instanceof HTMLElement ? event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') : [])
        if (items.length === 0) return
        const at = items.indexOf(document.activeElement as HTMLElement)
        const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at <= 0 ? items.length - 1 : at - 1)
        items[next].focus()
    }

    function onMenuFocusOut(event: FocusEvent): void {
        const related = event.relatedTarget
        if (related instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(related)) return
        if (related === null) return
        closeMenu()
    }

    function pick(action: () => void): void {
        closeMenu()
        action()
    }

    const iconButtonClass = 'flex min-h-11 min-w-11 items-center justify-center rounded-md border border-darkborderc hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
    const itemClass = 'min-h-11 w-full px-3 text-left hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
</script>

<div bind:this={root} class="flex flex-col gap-1 rounded-md border border-darkborderc p-2" data-part="studio-example-card" data-kind={kind} oninputcapture={oninputcapture}>
    <div class="flex items-center gap-2">
        <button
            type="button"
            data-part="studio-example-handle"
            class="{iconButtonClass} select-none"
            aria-label={handleLabel}
            disabled={!editable}
            onkeydown={onCardKey}
        ><GripVerticalIcon size={18} aria-hidden="true" /></button>
        <div class="min-w-0 flex-1">
            <div data-part="studio-example-title" class="truncate font-bold">{title}</div>
            {#if kind === 'opening'}
                <div data-part="studio-example-opening-note" class="text-sm text-textcolor2">{language.ltOpeningNote}</div>
            {/if}
            <div data-part="studio-example-subtitle" class="text-sm text-textcolor2">{subtitle}</div>
        </div>
        <div class="relative">
            <button
                type="button"
                data-part="studio-example-menu"
                data-row={id}
                class={iconButtonClass}
                aria-label={menuLabel}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={!editable}
                onclick={toggleMenu}
                onkeydown={onMenuButtonKey}
            ><EllipsisIcon size={18} aria-hidden="true" /></button>
            {#if menuOpen}
                <div
                    role="menu"
                    tabindex="-1"
                    data-part="studio-example-menu-list"
                    class="absolute right-0 z-10 mt-1 flex min-w-48 flex-col overflow-hidden rounded-md border border-darkborderc bg-darkbg text-textcolor"
                    onkeydown={onMenuKey}
                    onfocusout={onMenuFocusOut}
                >
                    {#if kind === 'opening'}
                        <button type="button" role="menuitem" data-part="studio-example-mark-opening" class={itemClass} disabled={!editable} onclick={() => pick(onmarkopening)}>{language.ltOpeningMark}</button>
                    {:else}
                        <button type="button" role="menuitem" data-part="studio-example-move-up" class={itemClass} disabled={!editable || !canMoveUp} onclick={() => pick(() => onmove(-1))}>{language.ltCardMoveUp}</button>
                        <button type="button" role="menuitem" data-part="studio-example-move-down" class={itemClass} disabled={!editable || !canMoveDown} onclick={() => pick(() => onmove(1))}>{language.ltCardMoveDown}</button>
                    {/if}
                    <button type="button" role="menuitem" data-part="studio-example-delete" class="{itemClass} text-draculared" disabled={!editable} onclick={() => pick(ondelete)}>{language.ltExDelete}</button>
                </div>
            {/if}
        </div>
    </div>
    <LongTextField
        {port}
        part="studio-example-input"
        {index}
        ariaLabel={title}
        kind="example"
        mode="cbs"
        {ownerLabel}
        extraMarks={(text) => turnMarks(text, ownerLabel)}
        {onfocuslayer}
        {previewSource}
        {editable}
        busy={!editable}
        fieldClass="min-h-20 w-full min-w-0 rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
        {onresult}
    />
</div>
