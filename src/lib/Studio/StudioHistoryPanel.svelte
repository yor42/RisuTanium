<script lang="ts">
    import { tick, untrack } from 'svelte'
    import { XIcon } from '@lucide/svelte'
    import { language } from '../../lang'
    import { uniqueChatById } from '../../ts/studio/edit/studioSetters'
    import { createStudioToasts, refusalText, runDismissingConsumed } from '../../ts/studio/edit/studioToasts'
    import type { StepLabel } from '../../ts/studio/history/historyModel'
    import type { OwnerHistoryService, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { parseOwnerKey, type OwnerKey } from '../../ts/studio/history/ownerPhase'
    import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService, historyBannerText, studioHistoryLoadFailed } from '../../ts/studio/history/studioHistoryService.svelte'
    import { closeStudioHistory } from '../../ts/studio/studioBack.svelte'
    import { selectedHistoryOwner, setStudioRestoreSheetOpen, studioScreen } from '../../ts/studio/studioScreen.svelte'
    import { DBState } from '../../ts/stores.svelte'
    import type { ToastHost } from '../../ts/toast/toastHost.svelte'

    // The History of the selected owner: its steps (newest first, with the undone ones above), the deleted first
    // messages and the restore point. Every action goes through the history service, which writes the live
    // character, marks it for saving and records the step. Nothing is rendered for a private character, a group or
    // a missing one, and that is re-checked at every render.
    interface Props {
        // The toast host whose Undo toasts an action can end; the app's own host when absent.
        host?: ToastHost
    }

    let { host }: Props = $props()

    const toasts = createStudioToasts({ service: getStudioHistoryService, host: untrack(() => host) })

    const service = $derived(getStudioHistoryService())
    const owner = $derived(selectedHistoryOwner())
    const bound = $derived(DBState.db.characters?.find((candidate) => candidate?.chaId === studioScreen.chaId))
    const hiddenCharacter = $derived(bound === undefined || bound.type === 'group' || bound.license === 'private')
    // A chat without a unique id has no history.
    const historyOwner = $derived.by((): OwnerKey | null => {
        const parsed = owner === null ? null : parseOwnerKey(owner)
        if (owner === null || parsed === null || bound === undefined || bound.type === 'group') return null
        return parsed.kind === 'chat' && uniqueChatById(bound.chats, parsed.chatId) === null ? null : owner
    })
    const view = $derived(service && historyOwner !== null && !hiddenCharacter ? service.view(historyOwner) : null)
    const hidden = $derived(hiddenCharacter || view?.restricted === true)

    $effect(() => {
        if (!service) {
            ensureStudioHistory()
            return
        }
        if (historyOwner !== null && !hidden) {
            const key = historyOwner
            untrack(() => beginOwnerVisit(key))
        }
    })

    const banner = $derived(view ? historyBannerText(view.banner) : null)
    // The history service could not be loaded at all: there is nothing to list until a retry builds it.
    const loadFailed = $derived(!service && studioHistoryLoadFailed())
    const rows = $derived.by(() => {
        if (!view) return []
        const newest = view.done.at(-1)?.id
        return [
            ...view.undone.map((step) => ({ step, undone: true, revertible: false })),
            ...[...view.done].reverse().map((step) => ({ step, undone: false, revertible: step.id !== newest })),
        ]
    })

    // What the last action said: a refusal, or the note that a chat's first message could not be put back.
    let message = $state<string | null>(null)
    let root = $state<HTMLElement | undefined>()
    let retryButton = $state<HTMLButtonElement | undefined>()
    // True from a Retry click until the build settles. The click moves focus to the root before the button
    // unmounts; if the build fails again while focus is still on the root, it moves to the new Retry button.
    let retrying = false

    function retry(): void {
        root?.focus()
        retrying = true
        ensureStudioHistory()
    }

    $effect(() => {
        if (loadFailed) {
            if (retrying) {
                retrying = false
                void tick().then(() => {
                    if (root && document.activeElement === root) retryButton?.focus()
                })
            }
        } else if (service) {
            retrying = false
        }
    })

    $effect(() => {
        void historyOwner
        untrack(() => { message = null })
    })

    function run(action: (svc: OwnerHistoryService, key: OwnerKey) => StudioResult): void {
        if (!service || historyOwner === null) return
        const key = historyOwner
        const result = runDismissingConsumed(service, toasts, key, () => action(service, key))
        message = result.ok === false ? refusalText(result.reason) : result.fmNotRestored ? language.studioToastRestoredFmNotice : null
    }

    function stepText(label: StepLabel): string {
        switch (label.kind) {
            case 'field':
                return label.field === 'desc' ? language.description : label.field === 'hideChatIcon' ? language.hideChatIcon : language.note
            case 'greetingAdd': return language.studioStepGreetingAdd
            case 'greetingRemove': return language.studioStepGreetingRemove
            case 'greetingEdit': return language.studioStepGreetingEdit
            case 'restorePoint': return language.studioStepRestorePoint
            case 'revert': return language.studioStepRevert
            case 'restoreDeleted': return language.studioStepRestoreDeleted
        }
    }

    const DELETED_PREVIEW = 80

    function previewOf(value: string): string {
        return value.length <= DELETED_PREVIEW ? value : `${value.slice(0, DELETED_PREVIEW)}…`
    }

    let restoreOpener = $state<HTMLButtonElement | undefined>()
    // The sheet unmounts on Cancel, Back and Escape; focus returns to the control that opened it.
    let sheetWasOpen = false
    $effect(() => {
        const open = studioScreen.restoreSheetOpen
        if (sheetWasOpen && !open) {
            void tick().then(() => restoreOpener?.focus())
        }
        sheetWasOpen = open
    })

    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
</script>

{#if !hidden}
    <aside bind:this={root} tabindex="-1" data-part="studio-history" aria-label={language.studioHistory} class="absolute inset-y-0 end-0 z-20 flex outline-none w-full max-w-md flex-col gap-3 overflow-y-auto border-s border-darkborderc bg-darkbg p-3 text-textcolor">
        <div class="flex items-center justify-between gap-2">
            <h2 class="min-w-0 truncate text-lg font-bold">{language.studioHistory}</h2>
            <button type="button" class="flex h-11 min-w-11 items-center justify-center rounded-md hover:bg-selected cursor-pointer" aria-label={language.studioHistoryClose} data-part="studio-history-close" onclick={closeStudioHistory}>
                <XIcon size={18} />
            </button>
        </div>
        {#if view === null}
            {#if historyOwner === null}
                <p data-part="studio-history-none" class="text-sm text-textcolor2">{language.studioHistoryNone}</p>
            {:else if loadFailed}
                <p role="status" data-part="studio-history-banner" data-banner="failed" class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{language.studioBannerFailed}</p>
                <button bind:this={retryButton} type="button" class={buttonClass} data-part="studio-history-retry" onclick={retry}>{language.studioChipRetry}</button>
            {:else}
                <p data-part="studio-history-loading" class="text-sm text-textcolor2">{language.studioFormLoading}</p>
            {/if}
        {:else}
            {#if !view.editable}
                <p data-part="studio-history-loading" class="text-sm text-textcolor2">{language.studioFormLoading}</p>
            {/if}
            {#if banner}
                <p role="status" data-part="studio-history-banner" data-banner={view.banner} class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{banner}</p>
            {/if}
            <p data-part="studio-history-device-note" class="text-sm text-textcolor2">{language.studioHistoryDeviceNote}</p>
            <div class="flex gap-2">
                <button type="button" class={buttonClass} data-part="studio-history-undo" disabled={!view.editable || view.done.length === 0} onclick={() => run((svc, key) => svc.undo(key))}>{language.studioHistoryUndo}</button>
                <button type="button" class={buttonClass} data-part="studio-history-redo" disabled={!view.editable || view.undone.length === 0} onclick={() => run((svc, key) => svc.redo(key))}>{language.studioHistoryRedo}</button>
            </div>
            {#if message}
                <p role="status" data-part="studio-history-message" class="text-sm text-draculared">{message}</p>
            {/if}
            <section class="flex flex-col gap-2" aria-label={language.studioHistorySteps}>
                <h3 class="font-bold">{language.studioHistorySteps}</h3>
                {#if rows.length === 0}
                    <p data-part="studio-history-empty" class="text-sm text-textcolor2">{language.studioHistoryEmpty}</p>
                {:else}
                    <ul class="flex flex-col gap-1" data-part="studio-history-steps">
                        {#each rows as row (row.step.id)}
                            <li data-part="studio-history-step" data-step-id={row.step.id} data-undone={row.undone ? 'true' : undefined} class="flex items-center justify-between gap-2 rounded-md border border-darkborderc px-2 py-1">
                                <span class="min-w-0 break-words {row.undone ? 'text-textcolor2' : ''}">
                                    {#if row.undone}<span data-part="studio-history-undone" class="me-1 rounded border border-darkborderc px-1 text-xs">{language.studioHistoryUndone}</span>{/if}{stepText(row.step.label)}
                                </span>
                                {#if row.revertible}
                                    <button type="button" class={buttonClass} data-part="studio-history-revert" disabled={!view.editable} onclick={() => run((svc, key) => svc.revertTo(key, row.step.id))}>{language.studioHistoryRevert}</button>
                                {/if}
                            </li>
                        {/each}
                    </ul>
                {/if}
            </section>
            <section class="flex flex-col gap-2" aria-label={language.studioHistoryDeleted}>
                <h3 class="font-bold">{language.studioHistoryDeleted}</h3>
                {#if view.deleted.length === 0}
                    <p data-part="studio-history-deleted-empty" class="text-sm text-textcolor2">{language.studioHistoryDeletedEmpty}</p>
                {:else}
                    <ul class="flex flex-col gap-1" data-part="studio-history-deleted">
                        {#each [...view.deleted].reverse() as item (item.id)}
                            <li data-part="studio-history-deleted-item" data-deleted-id={item.id} class="flex items-center justify-between gap-2 rounded-md border border-darkborderc px-2 py-1">
                                <span class="min-w-0 break-words">{previewOf(item.value)}</span>
                                <button type="button" class={buttonClass} data-part="studio-history-restore-item" aria-label="{language.studioHistoryRestoreItem}: {previewOf(item.value)}" disabled={!view.editable} onclick={() => run((svc, key) => svc.restoreDeleted(key, item.id))}>{language.studioHistoryRestoreItem}</button>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </section>
            {#if view.restore}
                <section class="flex flex-col gap-2" aria-label={language.studioHistoryRestorePoint}>
                    <h3 class="font-bold">{language.studioHistoryRestorePoint}</h3>
                    <p class="text-sm text-textcolor2">{language.studioHistoryRestorePointNote}</p>
                    <div>
                        <button bind:this={restoreOpener} type="button" class={buttonClass} data-part="studio-history-restore-open" aria-haspopup="dialog" disabled={!view.editable} onclick={() => setStudioRestoreSheetOpen(true)}>{language.studioHistoryRestoreOpen}</button>
                    </div>
                </section>
            {/if}
        {/if}
    </aside>
{/if}
