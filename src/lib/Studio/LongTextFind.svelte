<script lang="ts">
    import { ChevronDownIcon, ChevronUpIcon, XIcon } from '@lucide/svelte'
    import { onMount, untrack } from 'svelte'
    import { language } from '../../lang'
    import { findMatches, mapCaret, MATCH_LIMIT, nearestMatch, replaceAllIn, type FindOptions, type FindTarget, type Match } from '../../ts/studio/longText/findReplace'
    import { editBetween } from '../../ts/studio/longText/highlightSpans'

    // The find and replace bar of the full-screen layer. It reads the nested field only through `field`, and every
    // change it makes goes through the field's `insertText`, so each one is one step of the field's own write kind.
    interface Props {
        field: FindTarget | undefined
        // The field's text as `onvalue` last reported it; the count follows it.
        text: string
        editable: boolean
        replace: boolean
        onclose: () => void
    }

    let { field, text, editable, replace, onclose }: Props = $props()

    let query = $state('')
    let replacement = $state('')
    let caseSensitive = $state(false)
    let activeAt = $state(0)
    let announcement = $state('')
    let queryEl = $state<HTMLInputElement | undefined>()
    // The match the last Next, Previous or Replace selected. Replace acts on it only while the text there still holds
    // the query; an edit since then makes it stale.
    let shown: Match | null = null

    const options = (): FindOptions => ({ caseSensitive })
    const result = $derived(findMatches(text, query, { caseSensitive }))
    const total = $derived(result.matches.length)
    const countText = $derived(query === '' ? '' : result.capped ? language.ltFindCapped(MATCH_LIMIT) : language.ltFindCount(total === 0 ? 0 : Math.min(activeAt, total - 1) + 1, total))

    /** The match the field's selection is on, else the next one from its caret. Reads the field, writes nothing. */
    function refreshActive(): void {
        if (!field || query === '') {
            activeAt = 0
            return
        }
        const found = findMatches(field.value(), query, options()).matches
        const selected = field.selection()
        const exact = found.findIndex((match) => match.start === selected.start && match.end === selected.end)
        activeAt = exact >= 0 ? exact : (nearestMatch(found, selected.start, 1) ?? 0)
    }

    $effect(() => {
        void text
        void query
        void caseSensitive
        untrack(refreshActive)
    })

    function select(found: readonly Match[], at: number): void {
        shown = found[at]
        activeAt = at
        field?.reveal(shown.start, shown.end, queryEl)
    }

    function step(direction: 1 | -1): void {
        if (!field || query === '') return
        const found = findMatches(field.value(), query, options()).matches
        const selected = field.selection()
        const at = nearestMatch(found, direction === 1 ? selected.end : selected.start, direction)
        if (at === null) {
            shown = null
            return
        }
        select(found, at)
    }

    // The text at `match` must still be the query under the case option.
    function holds(current: string, match: Match): boolean {
        const found = findMatches(current.slice(match.start, match.end), query, options()).matches
        return found.length === 1 && found[0].start === 0 && found[0].end === match.end - match.start
    }

    // Outcomes are read from the field after the synchronous insert: a composing or read-only refusal leaves the text
    // as it was, so nothing changes and nothing is announced.
    function replaceOne(): void {
        const f = field
        if (!f || !editable || query === '') return
        const current = f.value()
        let match = shown
        if (match === null) {
            const found = findMatches(current, query, options()).matches
            const at = nearestMatch(found, f.selection().start, 1)
            match = at === null ? null : found[at]
        }
        if (match === null || !holds(current, match)) {
            shown = null
            refreshActive()
            return
        }
        const expected = current.slice(0, match.start) + replacement + current.slice(match.end)
        f.insertText(match.start, match.end, replacement, match.start + replacement.length)
        shown = null
        if (f.value() !== expected) {
            refreshActive()
            return
        }
        const found = findMatches(expected, query, options()).matches
        const at = nearestMatch(found, match.start + replacement.length, 1)
        if (at === null) refreshActive()
        else select(found, at)
    }

    function replaceAll(): void {
        const f = field
        if (!f || !editable || query === '') return
        const current = f.value()
        const { text: next, count } = replaceAllIn(current, query, replacement, options())
        if (count === 0) return
        if (next !== current) {
            const caret = f.selection().end
            const edit = editBetween(current, next)
            f.keepScroll(() => f.insertText(edit.start, edit.start + edit.removed, next.slice(edit.start, edit.start + edit.inserted), mapCaret(caret, edit)))
        }
        if (next !== current && f.value() === next) announcement = language.ltReplacedCount(count)
        shown = null
        refreshActive()
    }

    export function focusQuery(): void {
        queryEl?.focus()
        queryEl?.select()
    }

    onMount(focusQuery)

    // Keys are ignored while an IME is composing. Esc closes only the find bar.
    function onkeydown(event: KeyboardEvent): void {
        if (event.isComposing || event.keyCode === 229) return
        if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onclose()
            return
        }
        if (event.key === 'Enter' && event.target === queryEl) {
            event.preventDefault()
            step(event.shiftKey ? -1 : 1)
        }
    }

    const button = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-selected disabled:opacity-50 cursor-pointer'
    const wordButton = 'shrink-0 rounded-md bg-darkbutton px-3 py-1.5 text-sm hover:bg-selected disabled:opacity-50 cursor-pointer'
    const inputClass = 'min-w-0 flex-1 rounded-md border border-darkborderc bg-darkbg p-1.5 text-textcolor'
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div data-part="lt-find" role="search" class="flex shrink-0 flex-col gap-2 border-b border-darkborderc px-3 py-2" {onkeydown}>
    <div class="flex flex-wrap items-center gap-2">
        <input
            bind:this={queryEl}
            bind:value={query}
            data-part="lt-find-query"
            type="text"
            class="{inputClass} min-w-[8rem]"
            aria-label={language.ltFind}
            oninput={() => { announcement = ''; shown = null }}
        />
        <span data-part="lt-find-count" class="shrink-0 text-sm text-textcolor2">{countText}</span>
        <button type="button" data-part="lt-find-prev" class={button} aria-label={language.ltFindPrev} disabled={total === 0} onclick={() => step(-1)}>
            <ChevronUpIcon size={18} />
        </button>
        <button type="button" data-part="lt-find-next" class={button} aria-label={language.ltFindNext} disabled={total === 0} onclick={() => step(1)}>
            <ChevronDownIcon size={18} />
        </button>
        <label class="flex shrink-0 items-center gap-1 text-sm">
            <input data-part="lt-find-case" type="checkbox" bind:checked={caseSensitive} onchange={() => { announcement = ''; shown = null }} />
            {language.ltMatchCase}
        </label>
        <button type="button" data-part="lt-find-close" class={button} aria-label={language.ltFocusClose} onclick={onclose}>
            <XIcon size={18} />
        </button>
    </div>
    {#if replace}
        <div class="flex flex-wrap items-center gap-2">
            <input
                bind:value={replacement}
                data-part="lt-find-replacement"
                type="text"
                class="{inputClass} min-w-[8rem]"
                aria-label={language.ltReplaceWith}
                disabled={!editable}
                oninput={() => { announcement = '' }}
            />
            <button type="button" data-part="lt-find-replace" class={wordButton} disabled={!editable || query === ''} onclick={replaceOne}>{language.ltReplace}</button>
            <button type="button" data-part="lt-find-replace-all" class={wordButton} disabled={!editable || query === ''} onclick={replaceAll}>{language.ltReplaceAll}</button>
        </div>
    {/if}
    <div data-part="lt-find-live" role="status" aria-live="polite" class="sr-only">{announcement}</div>
</div>
