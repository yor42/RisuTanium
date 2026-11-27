<script lang="ts">
    import { flushSync, untrack } from 'svelte'
    import { SvelteSet } from 'svelte/reactivity'
    import { ListChecksIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { backgroundJobs, taskShown } from 'src/ts/alertTask.svelte'
    import { backCloseHandler, registerBackHandler } from 'src/ts/backHandlers'
    import { previewTargets, replyTargets, stopWorkIn } from 'src/ts/process/chatOrigin'
    import { DBState, settingsOpen } from 'src/ts/stores.svelte'
    import { studioOpen } from 'src/ts/studio/studioOpen'
    import PatternDialog from 'src/lib/Nexus/pattern/PatternDialog.svelte'
    import { makeInert, returnFocus } from 'src/lib/Nexus/pattern/patternFocus'
    import { buildTaskLabels } from 'src/lib/Nexus/pattern/taskToastPresenter'
    import { backgroundOf } from './homeLayer'
    import { jobProgressText, taskKey, taskRows, type TaskRow } from './homeTasks'

    type TasksTab = 'replies' | 'background'
    const TABS: readonly TasksTab[] = ['replies', 'background']
    const PREVIEW_KEY = 'preview:'
    const TASK_KEY = 'task:'

    interface Props {
        /** Whether the dialog is open; owned by the bar so a band change keeps it open. */
        open?: boolean
        /** The selected tab; owned by the bar like `open`, so a band change keeps it. */
        tab?: TasksTab
        /** Placement classes from the bar. */
        class?: string
    }

    let { open = $bindable(false), tab = $bindable('replies'), class: className = '' }: Props = $props()

    const uid = $props.id()
    const titleId = `${uid}-home-tasks-title`
    const tabId = (id: TasksTab): string => `${uid}-home-tasks-tab-${id}`
    const panelId = (id: TasksTab): string => `${uid}-home-tasks-panel-${id}`

    // While no reply is registered the derived never reads the characters, so an idle Home tracks only the
    // reply version; the characters are read (and tracked) only while a reply runs.
    const targets = $derived(replyTargets())
    const rows = $derived<TaskRow[]>(targets.length === 0 ? [] : taskRows(targets, DBState.db.characters ?? [], language.settingsPage.unnamed))
    const count = $derived(rows.length)

    // Previews follow the same version as the replies and read no names. Names are resolved only for the rows the
    // Background tab shows, and task state is read only while the dialog is open.
    const previews = $derived(previewTargets())
    const jobs = $derived(open ? backgroundJobs() : [])
    const previewRows = $derived<TaskRow[]>(open && tab === 'background' && previews.length > 0 ? taskRows(previews, DBState.db.characters ?? [], language.settingsPage.unnamed) : [])
    const otherCount = $derived(previews.length + jobs.length)
    const labels = $derived(buildTaskLabels())
    const slotBusy = $derived(open && taskShown())

    let button = $state<HTMLButtonElement>()
    let host = $state<HTMLElement>()
    let closeButton = $state<HTMLButtonElement>()
    let announced = 0
    let announcedOther = 0
    let message = $state('')
    // Chats whose Stop was pressed, shared by both tabs because Stop ends everything the chat runs; a chat leaves
    // the set when neither a reply nor a preview of it is registered.
    const stopping = new SvelteSet<string>()

    // The first tab is chosen here, the only place the dialog is opened, so a remount with the dialog already open
    // never chooses again: the Background tab only when nothing replies and something else runs.
    function openDialog(): void {
        tab = targets.length === 0 && (previews.length > 0 || backgroundJobs().length > 0) ? 'background' : 'replies'
        open = true
    }

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
        const keys = new Set([...targets, ...previews].map((target) => taskKey(target.chaId, target.chatId)))
        untrack(() => {
            for (const key of [...stopping]) {
                if (!keys.has(key)) stopping.delete(key)
            }
        })
    })

    function tabLabel(id: TasksTab): string {
        return id === 'replies' ? language.homeTasksTabReplies(count) : language.homeTasksTabOther(otherCount)
    }

    // Arrows wrap, Home and End jump; the new tab is selected and focused at once.
    function onTabKeydown(event: KeyboardEvent, current: TasksTab): void {
        const at = TABS.indexOf(current)
        let next = at
        if (event.key === 'ArrowRight') next = (at + 1) % TABS.length
        else if (event.key === 'ArrowLeft') next = (at + TABS.length - 1) % TABS.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = TABS.length - 1
        else return
        event.preventDefault()
        tab = TABS[next]
        host?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
    }

    // The polite status is empty at open and speaks only a count change from the counts taken at open, each count
    // in its own words, whichever tab is selected.
    $effect(() => {
        if (open) {
            announced = untrack(() => count)
            announcedOther = untrack(() => otherCount)
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
    $effect(() => {
        const current = otherCount
        if (!untrack(() => open) || current === announcedOther) return
        announcedOther = current
        message = current === 0 ? language.homeTasksOtherEmpty : language.homeTasksOtherCount(current)
    })

    // The keys of the rows the selected tab renders, as their `data-key` attributes carry them.
    const panelKeys = $derived<string[]>(!open ? [] : tab === 'replies'
        ? rows.map((row) => row.key)
        : [...previewRows.map((row) => PREVIEW_KEY + row.key), ...jobs.map((job) => TASK_KEY + job.id)])
    // Which jobs offer Cancel: a control that leaves its row needs the same recovery as a row that leaves.
    const offerSignature = $derived(jobs.map((job) => (job.canCancel ? '1' : '0')).join(''))

    // When the focused row ends, focus moves to the control at the same place in the row now at its place, else in the
    // one before, else Close. When only the focused control leaves its row (Cancel), focus moves to the first control
    // of that row. The row being focused is recorded on focusin, because a removed control leaves nothing to ask. A
    // focus that already sits on a live control of the dialog is left where it is.
    let renderedKeys: string[] = []
    let renderedOffers = ''
    let focusedKey: string | null = null
    let focusedIndex = 0
    function noteFocus(event: FocusEvent): void {
        const target = event.target
        const row = host && target instanceof HTMLButtonElement && host.contains(target) ? target.closest<HTMLElement>('li[data-key]') : null
        if (!row || !(target instanceof HTMLButtonElement)) {
            focusedKey = null
            return
        }
        focusedKey = row.dataset.key ?? null
        focusedIndex = Array.from(row.querySelectorAll('button')).indexOf(target)
    }
    $effect(() => {
        if (!open) {
            renderedKeys = []
            renderedOffers = ''
            focusedKey = null
            return
        }
        const keys = panelKeys
        const offers = offerSignature
        const previous = renderedKeys
        const previousOffers = renderedOffers
        renderedKeys = keys
        renderedOffers = offers
        const lost = focusedKey
        if (lost === null || !host) return
        const stays = keys.includes(lost)
        if (stays && offers === previousOffers) return
        const active = document.activeElement
        const focusKept = active !== null && active !== document.body && host.contains(active)
        if (focusKept) {
            if (!stays) focusedKey = null
            return
        }
        focusedKey = null
        const items = Array.from(host.querySelectorAll<HTMLElement>('li[data-key]'))
        const index = previous.indexOf(lost)
        const row = stays ? items.find((item) => item.dataset.key === lost) : (items[index] ?? items[index - 1])
        const controls = row ? Array.from(row.querySelectorAll<HTMLElement>('button')) : []
        const next = controls[focusedIndex] ?? controls[0] ?? closeButton
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
        onclick={openDialog}
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
                <div role="tablist" aria-label={language.homeTasks} data-part="home-task-tabs" class="flex gap-2">
                    {#each TABS as id (id)}
                        <button
                            type="button"
                            role="tab"
                            id={tabId(id)}
                            data-part="home-task-tab"
                            aria-selected={tab === id}
                            aria-controls={panelId(id)}
                            tabindex={tab === id ? 0 : -1}
                            class="min-h-11 min-w-0 flex-1 break-words rounded-md border border-borderc/10 px-3 py-2 risu-focus-ring {tab === id ? 'bg-selected' : 'bg-darkbg hover:bg-selected/50'}"
                            onclick={() => { tab = id }}
                            onkeydown={(event) => onTabKeydown(event, id)}
                        >{tabLabel(id)}</button>
                    {/each}
                </div>
                <div
                    role="tabpanel"
                    id={panelId('replies')}
                    data-part="home-task-panel"
                    aria-labelledby={tabId('replies')}
                    hidden={tab !== 'replies'}
                    tabindex={tab === 'replies' && rows.length === 0 ? 0 : undefined}
                >
                    {#if tab === 'replies'}
                        {#if rows.length === 0}
                            <p data-part="home-dialog-body">{language.homeTasksEmpty}</p>
                        {:else}
                            <ul data-part="home-task-list" class="m-0 flex list-none flex-col gap-2 p-0">
                                {#each rows as row (row.key)}
                                    <li data-part="home-task-row" data-key={row.key} class="flex items-center justify-between gap-3">
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
                    {/if}
                </div>
                <div
                    role="tabpanel"
                    id={panelId('background')}
                    data-part="home-task-panel"
                    aria-labelledby={tabId('background')}
                    hidden={tab !== 'background'}
                    tabindex={tab === 'background' && otherCount === 0 ? 0 : undefined}
                >
                    {#if tab === 'background'}
                        {#if otherCount === 0}
                            <p data-part="home-dialog-body">{language.homeTasksOtherEmpty}</p>
                        {:else}
                            <ul data-part="home-task-list" class="m-0 flex list-none flex-col gap-2 p-0">
                                {#each previewRows as row (PREVIEW_KEY + row.key)}
                                    <li data-part="home-task-row" data-key={PREVIEW_KEY + row.key} class="flex flex-wrap items-center justify-between gap-3">
                                        <div class="min-w-0 flex-1 basis-40">
                                            <div data-part="home-run-title" class="break-words font-semibold">{row.name}</div>
                                            <div data-part="home-run-meta" class="break-words text-sm opacity-80">{row.chatName}</div>
                                            <div data-part="home-run-kind" class="break-words text-sm opacity-80">{language.homeTasksPreview}</div>
                                        </div>
                                        <div data-part="home-task-actions" class="flex shrink-0 flex-wrap gap-2">
                                            <button
                                                type="button"
                                                class="pattern-button"
                                                data-part="home-run-stop"
                                                aria-label={stopping.has(row.key) ? undefined : language.homeTasksStopPreviewFor(row.name)}
                                                aria-disabled={stopping.has(row.key) ? 'true' : undefined}
                                                onclick={() => stop(row)}
                                            >{stopping.has(row.key) ? language.keepAliveStopping : language.chatShellStop}</button>
                                        </div>
                                    </li>
                                {/each}
                                {#each jobs as job (TASK_KEY + job.id)}
                                    <li data-part="home-task-row" data-key={TASK_KEY + job.id} class="flex flex-wrap items-center justify-between gap-3">
                                        <div class="min-w-0 flex-1 basis-40">
                                            <div data-part="home-run-title" class="break-words font-semibold">{job.title}</div>
                                            {#if job.subtitle}
                                                <div data-part="home-run-meta" class="break-words text-sm opacity-80">{job.subtitle}</div>
                                            {/if}
                                            <div data-part="home-run-progress" class="break-words text-sm opacity-80">{jobProgressText(job.view, labels)}</div>
                                        </div>
                                        <div data-part="home-task-actions" class="flex shrink-0 flex-wrap gap-2">
                                            <button
                                                type="button"
                                                class="pattern-button"
                                                data-part="home-task-open"
                                                aria-label={language.homeTasksOpenFor(job.title)}
                                                aria-disabled={slotBusy ? 'true' : undefined}
                                                onclick={() => { if (!slotBusy && job.open()) open = false }}
                                            >{language.patternTaskToastOpen}</button>
                                            {#if job.canCancel}
                                                <button
                                                    type="button"
                                                    class="pattern-button"
                                                    data-part="home-run-cancel"
                                                    aria-label={language.homeTasksCancelFor(job.title)}
                                                    onclick={() => { job.cancel() }}
                                                >{language.cancel}</button>
                                            {/if}
                                        </div>
                                    </li>
                                {/each}
                            </ul>
                        {/if}
                    {/if}
                </div>
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
