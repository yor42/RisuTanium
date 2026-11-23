<script lang="ts">
    import { flushSync, untrack } from 'svelte'
    import { SvelteSet } from 'svelte/reactivity'
    import { ListChecksIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { backCloseHandler, registerBackHandler } from 'src/ts/backHandlers'
    import { replyTargets, stopWorkIn } from 'src/ts/process/chatOrigin'
    import { DBState, settingsOpen } from 'src/ts/stores.svelte'
    import { studioOpen } from 'src/ts/studio/studioOpen'
    import PatternDialog from 'src/lib/Nexus/pattern/PatternDialog.svelte'
    import { makeInert, returnFocus } from 'src/lib/Nexus/pattern/patternFocus'
    import { backgroundOf } from './homeLayer'
    import { taskRows, type TaskRow } from './homeTasks'

    interface Props {
        /** Whether the dialog is open; owned by the bar so a band change keeps it open. */
        open?: boolean
        /** Placement classes from the bar. */
        class?: string
    }

    let { open = $bindable(false), class: className = '' }: Props = $props()

    const uid = $props.id()
    const titleId = `${uid}-home-tasks-title`

    // While no reply is registered the derived never reads the characters, so an idle Home tracks only the
    // reply version; the characters are read (and tracked) only while a reply runs.
    const targets = $derived(replyTargets())
    const rows = $derived<TaskRow[]>(targets.length === 0 ? [] : taskRows(targets, DBState.db.characters ?? [], language.settingsPage.unnamed))
    const count = $derived(rows.length)

    let button = $state<HTMLButtonElement>()
    let host = $state<HTMLElement>()
    let closeButton = $state<HTMLButtonElement>()
    let announced = 0
    let message = $state('')
    // Rows whose Stop was pressed; a row leaves the set when its reply has ended.
    const stopping = new SvelteSet<string>()

    // Escape (oncancel), Close and Back. The update is flushed first, so the dialog and the inert set are
    // gone when focus returns to the button.
    function close(): void {
        if (!open) return
        open = false
        flushSync()
        returnFocus(button ?? null)
    }

    // A cover (Settings, Studio) owns the screen: the dialog closes without taking focus back. PatternDialog
    // is given no trigger, so nothing in its teardown returns focus either.
    // The stores are subscribed only while the dialog is open, so a closed Home reads neither.
    $effect(() => {
        if (!open) return
        const closeOnCover = (covered: boolean) => {
            if (covered) open = false
        }
        const unsubscribers = [settingsOpen.subscribe(closeOnCover), studioOpen.subscribe(closeOnCover)]
        return () => {
            for (const unsubscribe of unsubscribers) unsubscribe()
        }
    })

    // The page behind goes inert from the host, which wraps the dialog only: it is never the button's
    // sibling set, or the dialog itself would be inert.
    $effect(() => {
        if (!open || !host) return
        return makeInert(backgroundOf(host))
    })

    $effect(() => {
        if (!open) return
        return registerBackHandler(backCloseHandler({
            isOpen: () => open,
            snapshot: () => open,
            close,
        }))
    })

    function stop(row: TaskRow): void {
        if (stopping.has(row.key)) return
        stopWorkIn({ chaId: row.chaId, chatId: row.chatId })
        stopping.add(row.key)
    }

    $effect(() => {
        const keys = new Set(rows.map((row) => row.key))
        untrack(() => {
            for (const key of [...stopping]) {
                if (!keys.has(key)) stopping.delete(key)
            }
        })
    })

    // The polite status is empty at open and speaks only a count change from the count taken at open.
    $effect(() => {
        if (open) {
            announced = untrack(() => count)
        } else {
            message = ''
        }
    })
    $effect(() => {
        const current = count
        if (!untrack(() => open) || current === announced) return
        announced = current
        message = current === 0 ? language.homeTasksEmpty : language.homeTasksCount(current)
    })

    // When the focused row's reply ends, focus moves to the Stop now at its place, else the one before, else
    // Close. The row being focused is recorded on focusin, because a removed control leaves nothing to ask. A
    // focus that already sits on a live control of the dialog is left where it is.
    let renderedKeys: string[] = []
    let focusedKey: string | null = null
    function noteFocus(event: FocusEvent): void {
        const target = event.target
        if (!host || !(target instanceof HTMLElement) || !target.matches('[data-part="home-run-stop"]')) {
            focusedKey = null
            return
        }
        const stops = Array.from(host.querySelectorAll('[data-part="home-run-stop"]'))
        focusedKey = renderedKeys[stops.indexOf(target)] ?? null
    }
    $effect(() => {
        const keys = rows.map((row) => row.key)
        const previous = renderedKeys
        renderedKeys = keys
        const lost = focusedKey
        if (lost === null || keys.includes(lost) || !host) return
        focusedKey = null
        const active = document.activeElement
        if (active && active !== document.body && host.contains(active)) return
        const index = previous.indexOf(lost)
        const stops = Array.from(host.querySelectorAll<HTMLElement>('[data-part="home-run-stop"]'))
        const next = stops[index] ?? stops[index - 1] ?? closeButton
        next?.focus()
    })
</script>

<div class="relative flex shrink-0 items-center {className}">
    <button
        type="button"
        bind:this={button}
        data-part="home-tasks-button"
        aria-haspopup="dialog"
        aria-label={count > 0 ? language.homeTasksName(count) : undefined}
        class="relative flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-borderc/10 bg-darkbg text-textcolor hover:bg-selected/50 risu-focus-ring"
        onclick={() => { open = true }}
    >
        <ListChecksIcon size={22} aria-hidden="true" />
        <span class="sr-only">{language.homeTasks}</span>
        {#if count > 0}
            <span data-part="home-badge" aria-hidden="true" class="home-tasks-badge">{count}</span>
        {/if}
    </button>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div bind:this={host} class="contents" onfocusin={noteFocus}>
        <PatternDialog role="dialog" labelId={titleId} cancelSafe oncancel={close} {open}>
            <div data-part="home-dialog" class="flex flex-col gap-3 p-4">
                <p class="sr-only" role="status" aria-live="polite">{message}</p>
                <h2 id={titleId} data-part="home-dialog-title" class="text-lg font-semibold">{language.homeTasksTitle}</h2>
                {#if rows.length === 0}
                    <p data-part="home-dialog-body">{language.homeTasksEmpty}</p>
                {:else}
                    <ul data-part="home-task-list" class="m-0 flex list-none flex-col gap-2 p-0">
                        {#each rows as row (row.key)}
                            <li data-part="home-task-row" class="flex items-center justify-between gap-3">
                                <div class="min-w-0">
                                    <div data-part="home-run-title" class="break-words font-semibold">{row.name}</div>
                                    <div data-part="home-run-meta" class="break-words text-sm opacity-80">{row.chatName}</div>
                                </div>
                                <div data-part="home-task-actions" class="shrink-0">
                                    <button
                                        type="button"
                                        class="pattern-button"
                                        data-part="home-run-stop"
                                        aria-label={stopping.has(row.key) ? undefined : language.chatStopReplyFor(row.name)}
                                        aria-disabled={stopping.has(row.key) ? 'true' : undefined}
                                        onclick={() => stop(row)}
                                    >{stopping.has(row.key) ? language.keepAliveStopping : language.chatShellStop}</button>
                                </div>
                            </li>
                        {/each}
                    </ul>
                {/if}
                <div data-part="home-dialog-actions" class="flex justify-end">
                    <button
                        type="button"
                        bind:this={closeButton}
                        class="pattern-button"
                        data-part="home-dialog-action"
                        onclick={close}
                    >{language.uiCommon.close}</button>
                </div>
            </div>
        </PatternDialog>
    </div>
</div>

<style>
    /* The count badge: the accent fill with the label colour the accent is lifted against. */
    .home-tasks-badge {
        position: absolute;
        inset-block-start: calc(-1 * var(--home-space-2));
        inset-inline-end: calc(-1 * var(--home-space-2));
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        min-inline-size: calc(var(--home-text-xs) + 2 * var(--home-space-2));
        block-size: calc(var(--home-text-xs) + 2 * var(--home-space-2));
        padding-inline: var(--home-space-2);
        border-radius: 9999px;
        background: var(--home-accent-solid);
        color: var(--pattern-on-accent);
        font-size: var(--home-text-xs);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        line-height: 1;
        pointer-events: none;
    }
    @media (forced-colors: active) {
        .home-tasks-badge {
            background: Canvas;
            color: CanvasText;
            border: 1px solid CanvasText;
        }
    }
</style>
