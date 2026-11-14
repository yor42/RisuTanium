<script lang="ts">
    import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'
    import ChevronUpIcon from '@lucide/svelte/icons/chevron-up'
    import ListIcon from '@lucide/svelte/icons/list'
    import SearchIcon from '@lucide/svelte/icons/search'
    import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal'
    import XIcon from '@lucide/svelte/icons/x'
    import { language } from '../../lang'
    import { isImeComposing } from '../../ts/ime/compositionGuard'
    import { DEFAULT_FILTERS } from '../../ts/chatShell/findSession'
    import type { SearchFilters } from '../../ts/chatShell/inChatSearch'

    /**
     * The search bar that replaces the header while search is open: row 1 is the field and its controls, row 2 the counter and "See all".
     *
     * The bar owns the field's text and reports it raw through `onquery`; the session normalises it. Everything it shows about the search
     * comes in as props, so it keeps no copy of the hits. The bar sets no geometry outside itself: rows are fixed heights, and the
     * no-results panel is an overlay below row 2.
     */
    interface Props {
        // The normalised query; '' means no search, and row 2 and the panel are absent.
        query: string
        count: number
        // The position of the hit shown last (0 is the newest), or null when none is shown.
        current: number | null
        complete: boolean
        filters: SearchFilters
        characterName: string
        onquery: (value: string, options: { composing: boolean }) => void
        oncomposing: (on: boolean) => void
        // 1 is the next older hit, -1 the newer one.
        onstep: (direction: 1 | -1) => void
        onclose: () => void
        onclearfilters: () => void
        onfilters: (opener: HTMLElement) => void
        onseeall: (opener: HTMLElement) => void
    }
    let { query, count, current, complete, filters, characterName, onquery, oncomposing, onstep, onclose, onclearfilters, onfilters, onseeall }: Props = $props()

    let root = $state<HTMLElement>()
    let field = $state<HTMLInputElement>()
    let text = $state('')

    let filtersOn = $derived(
        filters.speaker !== DEFAULT_FILTERS.speaker || filters.hasImage !== DEFAULT_FILTERS.hasImage
        || filters.thinking !== DEFAULT_FILTERS.thinking || filters.from !== DEFAULT_FILTERS.from || filters.to !== DEFAULT_FILTERS.to,
    )
    let counter = $derived.by(() => {
        if (count === 0) return ''
        const index = current === null ? '…' : (current + 1).toLocaleString()
        const total = count.toLocaleString()
        return complete ? language.chatShellFindCounter(index, total) : language.chatShellFindCounterPartial(index, total)
    })
    // Row 2 with no counter while hits are still being found: the scan is the feedback, so the row says it is busy.
    let busy = $derived(query !== '' && count === 0 && !complete)
    let empty = $derived(query !== '' && complete && count === 0)
    let summary = $derived.by(() => {
        const parts: string[] = []
        if (filters.speaker === 'me') parts.push(language.chatShellFindSpeakerMe)
        if (filters.speaker === 'char') parts.push(characterName || language.chatShellFindSpeakerChar)
        if (filters.hasImage) parts.push(language.chatShellFindHasImage)
        if (filters.thinking) parts.push(language.chatShellFindIncludeThinking)
        if (filters.from !== '' || filters.to !== '') parts.push(`${filters.from} – ${filters.to}`)
        return parts.join(' · ')
    })

    export function element(): HTMLElement | undefined {
        return root
    }

    export function focusField(select = false): void {
        field?.focus()
        if (select) field?.select()
    }

    function onInput(event: Event): void {
        text = (event.currentTarget as HTMLInputElement).value
        // A composing input event never arms the auto-show; the session turns it back on at compositionend.
        const composing = 'isComposing' in event && event.isComposing === true
        onquery(text, { composing })
    }

    function onFieldKey(event: KeyboardEvent): void {
        if (event.key !== 'Enter' || isImeComposing(event)) return
        // Enter steps and never leaves the field, so the keyboard stays up on a phone.
        event.preventDefault()
        onstep(event.shiftKey ? -1 : 1)
    }

    // Esc is taken for the whole bar, from the field and from every button, so the listener sits on the landmark itself instead of a template handler on a non-interactive element.
    $effect(() => {
        const bar = root
        if (!bar) return
        bar.addEventListener('keydown', onRootKey)
        return () => bar.removeEventListener('keydown', onRootKey)
    })

    // Esc clears a non-empty field first, then closes. The default is prevented so a search field's native clearing never doubles it.
    function onRootKey(event: KeyboardEvent): void {
        if (event.key !== 'Escape' || isImeComposing(event)) return
        event.preventDefault()
        if (text !== '') {
            text = ''
            onquery('', { composing: false })
            return
        }
        onclose()
    }
</script>

<div data-part="chat-find-bar" bind:this={root} role="search">
    <div class="row-one">
        <SearchIcon aria-hidden="true" class="lead" />
        <input
            bind:this={field}
            data-part="chat-find-field"
            type="search"
            enterkeyhint="search"
            maxlength={200}
            autocomplete="off"
            aria-label={language.chatShellSearchInChat}
            placeholder={language.chatShellFindPlaceholder}
            value={text}
            oninput={onInput}
            onkeydown={onFieldKey}
            oncompositionstart={() => oncomposing(true)}
            oncompositionend={() => oncomposing(false)}
        />
        <button type="button" class="bar-button" aria-label={language.chatShellFindPrev} title={language.chatShellFindPrev} onclick={() => onstep(-1)}><ChevronUpIcon aria-hidden="true" /></button>
        <button type="button" class="bar-button" aria-label={language.chatShellFindNext} title={language.chatShellFindNext} onclick={() => onstep(1)}><ChevronDownIcon aria-hidden="true" /></button>
        <button type="button" class="bar-button" data-on={filtersOn ? '' : undefined} aria-label={filtersOn ? language.chatShellFindFiltersOn : language.chatShellFindFilters} title={filtersOn ? language.chatShellFindFiltersOn : language.chatShellFindFilters} aria-haspopup="dialog" onclick={(event) => onfilters(event.currentTarget)}><SlidersHorizontalIcon aria-hidden="true" /></button>
        <button type="button" class="bar-button" aria-label={language.chatShellFindClose} title={language.chatShellFindClose} onclick={onclose}><XIcon aria-hidden="true" /></button>
    </div>
    {#if query !== ''}
        <div class="row-two" aria-busy={busy ? 'true' : undefined}>
            <span class="counter">{counter}</span>
            <button type="button" class="see-all" disabled={count === 0} aria-haspopup="dialog" onclick={(event) => onseeall(event.currentTarget)}><ListIcon aria-hidden="true" />{language.chatShellFindSeeAll}</button>
        </div>
    {/if}
    {#if empty}
        <div data-part="chat-find-empty">
            <p class="empty-title">{language.chatShellFindNoResults}</p>
            {#if summary !== ''}
                <p class="empty-summary">{summary}</p>
            {/if}
            {#if filtersOn}
                <button type="button" class="clear-filters" onclick={onclearfilters}>{language.chatShellFindClearFilters}</button>
            {/if}
        </div>
    {/if}
</div>

<style>
    [data-part="chat-find-bar"] { position: relative; pointer-events: auto; flex: none; background: var(--nexus-canvas); color: var(--nexus-text); border-bottom: 1px solid var(--nexus-edge); }
    .row-one { height: var(--header-height); display: flex; align-items: center; gap: var(--space-3); padding: 0 var(--space-7); }
    .row-one :global(.lead) { flex: none; margin-inline: var(--space-5); color: var(--nexus-text-secondary); }
    [data-part="chat-find-field"] { flex: 1; min-width: 0; min-height: var(--size-touch); padding: 0 var(--space-7); color: var(--nexus-text); background: var(--nexus-surface-raised); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); }
    .bar-button { width: var(--size-touch); height: var(--size-touch); flex: none; display: flex; align-items: center; justify-content: center; color: inherit; border-radius: var(--radius-control); }
    .bar-button[data-on] { border: 1px solid var(--nexus-text); }
    .row-two { height: var(--size-17); display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-7); padding: 0 var(--space-10); }
    .counter { line-height: var(--size-17); font-size: var(--font-size-sm); color: var(--nexus-text-secondary); font-variant-numeric: tabular-nums; }
    .see-all { flex: none; display: flex; align-items: center; gap: var(--space-5); min-height: var(--size-touch); padding: 0 var(--space-7); color: var(--nexus-text); border-radius: var(--radius-control); }
    .see-all:disabled { opacity: var(--opacity-half); cursor: not-allowed; }
    [data-part="chat-find-empty"] { position: absolute; top: 100%; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: var(--space-5); padding: var(--space-15) var(--space-10); background: var(--nexus-canvas); border-bottom: 1px solid var(--nexus-edge); }
    .empty-title { margin: 0; color: var(--nexus-text); }
    .empty-summary { margin: 0; font-size: var(--font-size-sm); color: var(--nexus-text-secondary); text-align: center; overflow-wrap: anywhere; }
    .clear-filters { min-height: var(--size-touch); padding: 0 var(--space-10); color: var(--nexus-text); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); }
    [data-part="chat-find-bar"] :is(button, input):focus-visible { outline: var(--stroke-bold) solid var(--nexus-text); }
</style>
