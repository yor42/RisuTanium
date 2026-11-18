<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { XIcon } from '@lucide/svelte'
    import { alertError } from '../../ts/alert'
    import { language } from '../../lang'
    import { uniqueChatById } from '../../ts/studio/edit/studioSetters'
    import { createStudioToasts, listReasonText, refusalTextOf, runDismissingConsumed } from '../../ts/studio/edit/studioToasts'
    import type { StepLabel } from '../../ts/studio/history/historyModel'
    import type { OwnerHistoryService, ReplayDesc, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { parseOwnerKey, type OwnerKey } from '../../ts/studio/history/ownerPhase'
    import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService, historyBannerText, studioHistoryLoadFailed } from '../../ts/studio/history/studioHistoryService.svelte'
    import { closeStudioHistory } from '../../ts/studio/studioBack.svelte'
    import { focusLost, placeFocusAfterHistory } from '../../ts/studio/historyFocus'
    import { readOwnerFields, type OwnerFields } from '../../ts/studio/ownerFields'
    import { selectedHistoryOwner, setStudioNotRestoredNotice, setStudioRestoreSheetOpen, studioScreen } from '../../ts/studio/studioScreen.svelte'
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

    // Set once the panel is gone: a replay that settles after that has no panel to show its outcome in, and its focus
    // placement would fall back to the whole document.
    let destroyed = false
    onDestroy(() => { destroyed = true })

    const toasts = createStudioToasts({ service: getStudioHistoryService, host: untrack(() => host) })

    const service = $derived(getStudioHistoryService())
    const owner = $derived(selectedHistoryOwner())
    const bound = $derived(DBState.db.characters?.find((candidate) => candidate?.chaId === studioScreen.chaId))
    const parsedOwner = $derived(owner === null ? null : parseOwnerKey(owner))
    // A module's history is the module's own: the bound character being private or a group does not hide it, as it
    // does not stop Ctrl+Z from replaying it.
    const moduleOwner = $derived(parsedOwner?.kind === 'module')
    const hiddenCharacter = $derived(!moduleOwner && (bound === undefined || bound.type === 'group' || bound.license === 'private'))
    // A chat without a unique id has no history.
    const historyOwner = $derived.by((): OwnerKey | null => {
        if (owner === null || parsedOwner === null) return null
        if (parsedOwner.kind === 'module') return owner
        if (bound === undefined || bound.type === 'group') return null
        return parsedOwner.kind === 'chat' && uniqueChatById(bound.chats, parsedOwner.chatId) === null ? null : owner
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
                void afterFlush().then(() => {
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

    // A deleted item's restore is text-only and runs at once.
    function run(action: (svc: OwnerHistoryService, key: OwnerKey) => StudioResult): void {
        if (!service || historyOwner === null) return
        const key = historyOwner
        const before = readOwnerFields(key)
        const result = runDismissingConsumed(service, toasts, key, () => action(service, key))
        showOutcome(key, result, before)
    }

    // Undo, redo and revert run in the service's replay queue, which may ask whether asset files are still there first, so
    // the outcome arrives later. The fields are read inside the replay's own synchronous segment.
    async function replayAction(desc: ReplayDesc): Promise<void> {
        if (!service || historyOwner === null) return
        const key = historyOwner
        const svc = service
        const read: { before: OwnerFields | null } = { before: null }
        let result: StudioResult
        try {
            result = await svc.replay(key, desc, (apply) => {
                read.before = readOwnerFields(key)
                return runDismissingConsumed(svc, toasts, key, apply)
            })
        } catch (error) {
            // A rejected replay may already have landed its write; the error is shown, whatever became of the panel.
            alertError(error instanceof Error ? error : String(error))
            return
        }
        if (destroyed) return
        // The panel may have moved to another owner meanwhile: its message belongs to this one.
        if (historyOwner !== key) return
        showOutcome(key, result, read.before, desc.kind === 'undo')
    }

    // `undone` is true for an Undo only: the places a merge undo left as they were go to the Studio notice, whose Show lists
    // them; a redo or a revert of a merge says nothing of its own about them.
    function showOutcome(key: OwnerKey, result: StudioResult, before: OwnerFields | null, undone = false): void {
        if (result.ok === false) {
            message = refusalTextOf(result)
            return
        }
        const goneFile = result.goneRows !== undefined && result.goneRows.length > 0
        if (undone && !goneFile && result.notRestored !== undefined && result.notRestored.length > 0) {
            setStudioNotRestoredNotice(key, language.studioAssetNotRestored(result.notRestored.length), result.notRestored)
        }
        const notes: string[] = []
        if (goneFile && result.goneRows !== undefined) notes.push(language.studioAssetFileGone(result.goneName ?? result.goneRows[0]))
        if (result.already === 'undo') notes.push(language.studioHistoryAlreadyUndone)
        else if (result.already === 'redo') notes.push(language.studioHistoryAlreadyRedone)
        else if (result.dropped) notes.push(language.studioHistoryStepDropped)
        if (result.listSkipped !== undefined && result.listSkipped > 0) notes.push(language.studioHistoryRevertListSkipped)
        const reason = listReasonText(result.listReason)
        if (reason !== null) notes.push(reason)
        if (result.pairSkipped !== undefined && result.pairSkipped > 0) notes.push(language.studioHistoryRevertPairSkipped)
        if (result.fmNotRestored) notes.push(language.studioToastRestoredFmNotice)
        message = notes.length > 0 ? notes.join(' ') : null
        void placeFocusAfterHistory(before, readOwnerFields(key), () => root?.closest('[data-part="studio"]') ?? null, () => root)
    }

    function stepText(label: StepLabel): string {
        switch (label.kind) {
            case 'field':
                switch (label.field) {
                    case 'desc': return language.description
                    case 'firstMessage': return language.firstMessage
                    case 'exampleMessage': return language.exampleMessage
                    case 'customModuleToggle': return language.customPromptTemplateToggle
                    case 'hideChatIcon': return language.hideChatIcon
                    case 'risutanium_render_when_complete': return language.studioFormRenderWhenComplete
                    case 'note': return language.note
                }
            case 'greetingAdd': return language.studioStepGreetingAdd
            case 'greetingRemove': return language.studioStepGreetingRemove
            case 'greetingEdit': return language.studioStepGreetingEdit
            case 'greetingMove': return language.studioStepGreetingMove
            case 'greetingSwap': return language.studioStepGreetingSwap
            case 'greetingAddMany': return language.studioStepGreetingAddMany(label.count)
            case 'restorePoint': return language.studioStepRestorePoint
            case 'revert': return language.studioStepRevert
            case 'restoreDeleted': return language.studioStepRestoreDeleted
            // A delete of several rows has no name to show: it says how many.
            case 'assetDelete': return label.name === null ? language.studioStepAssetDeleteMany(label.count) : language.studioStepAssetDeleteOne(label.name)
            case 'assetRename': return language.studioStepAssetRename(label.from, label.to)
            case 'assetRemoveExtras': return language.studioStepAssetRemoveExtras(label.count, label.name)
            case 'assetMerge': return language.studioStepAssetMerge(label.from, label.to)
            // A move to no folder has no folder name to show.
            case 'assetMove': return language.studioStepAssetMove(label.count, label.folder ?? language.studioAssetNoFolder)
            case 'folderRename': return language.studioStepFolderRename(label.from, label.to)
            case 'folderDelete': return language.studioStepFolderDelete(label.name)
            case 'assetAdd': return language.studioStepAssetAdd(label.count)
            case 'folderCreate': return language.studioStepFolderCreate(label.name)
            case 'folderReorder': return language.studioStepFolderReorder
        }
    }

    const DELETED_PREVIEW = 80

    function previewOf(value: string): string {
        return value.length <= DELETED_PREVIEW ? value : `${value.slice(0, DELETED_PREVIEW)}…`
    }

    let restoreOpener = $state<HTMLButtonElement | undefined>()
    // The sheet unmounts on Cancel, Back and Escape; focus returns to the control that opened it unless focus
    // already sits somewhere live (a Confirm that moved it to a changed field, or Escape from outside the sheet).
    let sheetWasOpen = false
    $effect(() => {
        const open = studioScreen.restoreSheetOpen
        if (sheetWasOpen && !open) {
            void afterFlush().then(() => { if (focusLost()) restoreOpener?.focus() })
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
                <button type="button" class={buttonClass} data-part="studio-history-undo" disabled={!view.editable || view.done.length === 0} onclick={() => void replayAction({ kind: 'undo' })}>{language.studioHistoryUndo}</button>
                <button type="button" class={buttonClass} data-part="studio-history-redo" disabled={!view.editable || view.undone.length === 0} onclick={() => void replayAction({ kind: 'redo' })}>{language.studioHistoryRedo}</button>
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
                                    <button type="button" class={buttonClass} data-part="studio-history-revert" disabled={!view.editable} onclick={() => void replayAction({ kind: 'revert', stepId: row.step.id })}>{language.studioHistoryRevert}</button>
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
