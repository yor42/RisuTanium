<script lang="ts">
    import { language } from '../../lang'
    import { isImeComposing } from '../../ts/ime/compositionGuard'
    import { bookmarkEntries, hasUntimed, indexForDay, localDayStart, parseMessageNumber } from '../../ts/chatShell/jumpTarget'
    import type { Chat } from '../../ts/storage/database.svelte'
    import { postToast } from '../../ts/toast/toastHost.svelte'
    import ShellSheet from './ShellSheet.svelte'

    /**
     * Where to go in the chat on screen: the first or the newest message, a message number, a day, or a bookmark.
     *
     * Every row answers with a message index (-1 is the first message) through `onjump`; the shell closes the sheet and runs the jump.
     * A refusal that the sheet can explain (a number outside the chat, a day after the last dated message) leaves the sheet open.
     */
    interface Props {
        open: boolean
        opener: HTMLElement | null
        background: readonly HTMLElement[]
        chat: Chat | null
        onjump: (index: number) => void
        onclose: () => void
    }
    let { open, opener, background, chat, onjump, onclose }: Props = $props()

    const BOOKMARKS_SHOWN = 60

    let numberText = $state('')
    let numberRefused = $state(false)
    let dateText = $state('')

    let messages = $derived(open ? chat?.message ?? [] : [])
    let count = $derived(messages.length)
    let untimed = $derived(hasUntimed(messages))
    let bookmarks = $derived(open && chat ? bookmarkEntries(chat, BOOKMARKS_SHOWN) : { total: 0, shown: [] })
    let dateValid = $derived(localDayStart(dateText) !== null)

    // A new opening starts from empty fields.
    $effect(() => {
        if (!open) return
        numberText = ''
        numberRefused = false
        dateText = ''
    })

    function goNumber(): void {
        const index = parseMessageNumber(numberText, count)
        if (index === null) {
            numberRefused = true
            return
        }
        onjump(index)
    }

    function goDate(): void {
        const start = localDayStart(dateText)
        if (start === null) return
        const target = indexForDay(messages, start)
        if (!target.found) {
            postToast({ kind: 'warning', text: language.chatShellJumpDateAfterLast })
            return
        }
        onjump(target.index)
    }

    function onNumberKey(event: KeyboardEvent): void {
        if (event.key !== 'Enter' || isImeComposing(event)) return
        event.preventDefault()
        goNumber()
    }
</script>

<ShellSheet {open} kind="sheet" mode="side" label={language.chatShellJumpSheet} {opener} {background} {onclose}>
    {#if open}
        <div class="jump-body">
            <h2 data-part="chat-sheet-title" tabindex="-1">{language.chatShellJumpSheet}</h2>
            <button type="button" data-part="chat-sheet-item" data-kind="button" data-sheet-initial onclick={() => onjump(-1)}>{language.chatShellJumpFirst}</button>
            <button type="button" data-part="chat-sheet-item" data-kind="button" disabled={count === 0} onclick={() => onjump(count - 1)}>{language.chatShellJumpNewest}</button>
            {#if count > 0}
                <div data-part="chat-jump-number" class="jump-row">
                    <label for="jump-number-field">{language.chatShellJumpNumber}</label>
                    <div class="jump-field">
                        <input id="jump-number-field" type="text" inputmode="numeric" autocomplete="off" aria-invalid={numberRefused ? 'true' : undefined} aria-describedby={numberRefused ? 'jump-number-error' : undefined} bind:value={numberText} oninput={() => { numberRefused = false }} onkeydown={onNumberKey} />
                        <button type="button" data-kind="button" class="jump-go" onclick={goNumber}>{language.chatShellJumpGo}</button>
                    </div>
                    {#if numberRefused}
                        <p id="jump-number-error" role="alert" class="jump-note jump-error">{language.chatShellNumberError(count)}</p>
                    {/if}
                </div>
                <div data-part="chat-jump-date" class="jump-row">
                    <label for="jump-date-field">{language.chatShellJumpDate}</label>
                    <div class="jump-field">
                        <input id="jump-date-field" type="date" bind:value={dateText} />
                        <button type="button" data-kind="button" class="jump-go" disabled={!dateValid} onclick={goDate}>{language.chatShellJumpGo}</button>
                    </div>
                    {#if untimed}
                        <p class="jump-note">{language.chatShellNoTimeSkipped}</p>
                    {/if}
                </div>
            {/if}
            <section data-part="chat-jump-bookmarks" aria-labelledby="jump-bookmarks-heading">
                <h3 id="jump-bookmarks-heading" class="jump-heading">{language.chatShellBookmarksHeading(bookmarks.total)}</h3>
                {#if bookmarks.total === 0}
                    <p class="jump-note">{language.noBookmarks}</p>
                {:else}
                    {#each bookmarks.shown as entry (entry.chatId)}
                        <button type="button" data-part="chat-sheet-item" data-kind="button" onclick={() => onjump(entry.index)}>{entry.label}</button>
                    {/each}
                    {#if bookmarks.total > bookmarks.shown.length}
                        <p class="jump-note">{language.chatShellBookmarksFirst(BOOKMARKS_SHOWN)}</p>
                    {/if}
                {/if}
            </section>
        </div>
    {/if}
</ShellSheet>

<style>
    .jump-body { display: flex; flex-direction: column; gap: var(--space-5); }
    [data-part="chat-sheet-title"] { margin: 0 0 var(--space-7); font-size: var(--font-size-xl); }
    [data-part="chat-sheet-title"]:focus-visible { outline: var(--stroke-bold) solid var(--nexus-text); }
    .jump-body [data-part="chat-sheet-item"] { display: block; width: 100%; min-height: var(--size-touch); padding: var(--space-7) var(--space-10); text-align: left; color: var(--nexus-text); border-bottom: 1px solid var(--nexus-edge); overflow-wrap: anywhere; }
    .jump-body [data-part="chat-sheet-item"]:disabled { opacity: var(--opacity-half); }
    .jump-row { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5) var(--space-10); border-bottom: 1px solid var(--nexus-edge); }
    .jump-field { display: flex; gap: var(--space-5); }
    .jump-field input { flex: 1; min-width: 0; min-height: var(--size-touch); padding: 0 var(--space-7); color: var(--nexus-text); background: var(--nexus-surface-raised); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); }
    .jump-field input[aria-invalid="true"] { border-color: var(--nexus-text); }
    .jump-go { flex: none; min-height: var(--size-touch); padding: 0 var(--space-10); color: var(--nexus-text); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); }
    .jump-go:disabled { opacity: var(--opacity-half); cursor: not-allowed; }
    .jump-body :is(button, input):focus-visible { outline: var(--stroke-bold) solid var(--nexus-text); }
    .jump-note { margin: 0; font-size: var(--font-size-xs); color: var(--nexus-text-secondary); }
    .jump-error { color: var(--nexus-text); }
    .jump-heading { margin: var(--space-7) 0 0; font-size: var(--font-size-sm); color: var(--nexus-text-secondary); }
</style>
