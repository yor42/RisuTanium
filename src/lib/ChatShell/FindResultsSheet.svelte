<script lang="ts">
    import { language } from '../../lang'
    import { windowRange } from '../../ts/chatShell/chatListModel'
    import { displayText, isHiddenAt, promptResetIndex, type SearchHit } from '../../ts/chatShell/inChatSearch'
    import type { Message } from '../../ts/storage/database.svelte'
    import ShellSheet from './ShellSheet.svelte'

    /**
     * Every hit of the search, newest first, as a windowed list: speaker, date and a two-line snippet with the match marked.
     *
     * A tap reports the hit's position through `onpick`; the shell closes the sheet and shows that hit. The "hidden from the prompt"
     * label is computed when a row renders, from the message as it reads now, so a flag changed after the scan shows without a rescan.
     */
    interface Props {
        open: boolean
        opener: HTMLElement | null
        background: readonly HTMLElement[]
        messages: readonly Message[]
        hits: readonly SearchHit[]
        // The normalised query the hits were found with.
        query: string
        complete: boolean
        // Whether the scan included thinking blocks, so the snippet is cut from the same text.
        thinking: boolean
        firstText: string
        userName: string
        charName: string
        // Resolved avatar sources, '' for none; the initial is drawn then.
        userImage: string
        charImage: string
        onpick: (position: number) => void
        onclose: () => void
    }
    let { open, opener, background, messages, hits, query, complete, thinking, firstText, userName, charName, userImage, charImage, onpick, onclose }: Props = $props()

    // A row is a fixed height, so the window of mounted rows is placed by arithmetic.
    const ROW = 72
    const FALLBACK_VIEWPORT = 600
    const LEAD = 30
    const TAIL = 120

    let scrollTop = $state(0)
    let viewport = $state(0)
    let list = $state<HTMLElement>()

    let resetIndex = $derived(open ? promptResetIndex(messages) : -1)
    let range = $derived(open ? windowRange(hits.length, scrollTop, viewport || FALLBACK_VIEWPORT, ROW) : { start: 0, end: 0 })
    let rows = $derived(hits.slice(range.start, range.end))
    let title = $derived(`${language.chatShellFindSeeAll} · ${hits.length.toLocaleString()}${complete ? '' : '+'}`)

    $effect(() => {
        if (!open) scrollTop = 0
        else if (list) viewport = list.clientHeight
    })

    function onScroll(event: Event & { currentTarget: HTMLElement }): void {
        scrollTop = event.currentTarget.scrollTop
        viewport = event.currentTarget.clientHeight
    }

    function textOf(hit: SearchHit): string {
        return hit.message === null ? firstText : hit.message.data
    }

    // The match is marked only when lowercasing keeps every offset; otherwise the snippet is shown without a mark.
    function snippetOf(hit: SearchHit): { before: string, mark: string, after: string } {
        const shown = displayText(textOf(hit), { thinking })
        const lower = shown.toLowerCase()
        const at = lower.length === shown.length ? lower.indexOf(query) : -1
        if (at < 0 || query === '') return { before: shown.slice(0, LEAD + TAIL), mark: '', after: '' }
        const start = Math.max(0, at - LEAD)
        const end = at + query.length
        return { before: `${start > 0 ? '…' : ''}${shown.slice(start, at)}`, mark: shown.slice(at, end), after: shown.slice(end, end + TAIL) }
    }

    function speakerOf(hit: SearchHit): { name: string, image: string } {
        if (hit.message?.role === 'user') return { name: userName, image: userImage }
        return { name: charName, image: charImage }
    }

    function dateOf(hit: SearchHit): string {
        const time = hit.message?.time
        if (typeof time !== 'number') return language.chatShellFindNoDate
        return new Date(time).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    }
</script>

<ShellSheet {open} kind="sheet" mode="side" label={title} {opener} {background} {onclose}>
    {#if open}
        <div class="results-body">
            <h2 data-part="chat-sheet-title" tabindex="-1">{title}</h2>
            <div data-part="chat-find-results" role="list" bind:this={list} onscroll={onScroll}>
                <div class="spacer" style:height="{range.start * ROW}px"></div>
                {#each rows as hit, offset (hit.index)}
                    {@const position = range.start + offset}
                    {@const speaker = speakerOf(hit)}
                    {@const snippet = snippetOf(hit)}
                    <div role="listitem" class="result" style:height="{ROW}px">
                        <button type="button" data-part="chat-sheet-item" data-kind="button" data-sheet-initial={position === 0 ? '' : undefined} onclick={() => onpick(position)}>
                            <span class="avatar" aria-hidden="true">
                                {#if speaker.image !== ''}<img src={speaker.image} alt="" />{:else}{speaker.name.slice(0, 1)}{/if}
                            </span>
                            <span class="result-text">
                                <span class="result-head">
                                    <span class="result-name">{speaker.name}</span>
                                    <span class="result-date">{dateOf(hit)}</span>
                                    {#if isHiddenAt(messages, hit.index, resetIndex)}<span class="result-hidden">{language.chatShellFindHidden}</span>{/if}
                                </span>
                                <span class="snippet">{snippet.before}{#if snippet.mark !== ''}<mark>{snippet.mark}</mark>{/if}{snippet.after}</span>
                            </span>
                        </button>
                    </div>
                {/each}
                <div class="spacer" style:height="{Math.max(0, hits.length - range.end) * ROW}px"></div>
            </div>
        </div>
    {/if}
</ShellSheet>

<style>
    .results-body { display: flex; flex-direction: column; gap: var(--space-5); }
    [data-part="chat-sheet-title"] { margin: 0 0 var(--space-7); font-size: var(--font-size-xl); }
    [data-part="chat-sheet-title"]:focus-visible { outline: var(--stroke-bold) solid var(--nexus-text); }
    [data-part="chat-find-results"] { max-height: 60vh; overflow-y: auto; }
    .result { overflow: hidden; border-bottom: 1px solid var(--nexus-edge); }
    .result [data-part="chat-sheet-item"] { display: flex; align-items: center; gap: var(--space-7); width: 100%; height: 100%; padding: 0 var(--space-10); text-align: left; color: var(--nexus-text); }
    .avatar { flex: none; width: var(--size-touch); height: var(--size-touch); display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: var(--radius-pill); background: var(--nexus-surface-raised); }
    .avatar img { width: 100%; height: 100%; object-fit: cover; }
    .result-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-2); }
    .result-head { display: flex; gap: var(--space-5); font-size: var(--font-size-xs); color: var(--nexus-text-secondary); }
    .result-name { color: var(--nexus-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .result-hidden { margin-inline-start: auto; }
    .snippet { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; font-size: var(--font-size-sm); }
    .snippet mark { background: transparent; color: var(--nexus-text); outline: var(--stroke-bold) solid var(--nexus-ring); outline-offset: calc(var(--stroke-bold) * -1); }
    .results-body :is(button):focus-visible { outline: var(--stroke-bold) solid var(--nexus-text); }
</style>
