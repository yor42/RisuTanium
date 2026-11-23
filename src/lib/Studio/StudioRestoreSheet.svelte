<script lang="ts">
    import { onDestroy, onMount, untrack } from 'svelte'
    import { language } from '../../lang'
    import { openStudioModuleId } from '../../ts/studio/assets/openModuleForm.svelte'
    import { liveReaderOf, resolveOwnerTarget } from '../../ts/studio/edit/ownerTargets'
    import { askRiskyTurnOn, type RiskyAsk } from '../../ts/studio/edit/riskyConfirm.svelte'
    import { resolveRiskyRefusal } from '../../ts/studio/edit/riskyReplay'
    import { createStudioToasts, refusalText } from '../../ts/studio/edit/studioToasts'
    import { fieldLabelKey } from '../../ts/studio/history/fieldAccess'
    import { listChangedElsewhere, RESTORE_PATH_ORDER, type RestorePath } from '../../ts/studio/history/historyModel'
    import type { StudioRefusal } from '../../ts/studio/history/ownerHistory.svelte'
    import { hasChatNote as hasChatNoteOf } from '../../ts/studio/history/ownerKindRules'
    import { parseOwnerKey } from '../../ts/studio/history/ownerPhase'
    import { getStudioHistoryService } from '../../ts/studio/history/studioHistoryService.svelte'
    import { registerStudioSheetBack } from '../../ts/studio/studioBack.svelte'
    import { placeFocusAfterHistory } from '../../ts/studio/historyFocus'
    import { readOwnerFields } from '../../ts/studio/ownerFields'
    import { selectedHistoryOwner, setStudioRestoreSheetOpen, studioScreen } from '../../ts/studio/studioScreen.svelte'
    import type { ToastHost } from '../../ts/toast/toastHost.svelte'

    // The restore sheet over the History panel. It exists only while it is open: it holds the toast stack back
    // and owns the innermost Back layer for exactly that long, and its destruction, by whatever close path,
    // releases both. Initial focus is Cancel. The page behind it stays usable (no inert, no focus trap).
    interface Props {
        // The toast host to hold back; the app's own host when absent.
        host?: ToastHost
    }

    let { host }: Props = $props()

    createStudioToasts({ service: getStudioHistoryService, host: untrack(() => host) }).suspendWhileMounted()
    registerStudioSheetBack()

    const service = $derived(getStudioHistoryService())
    const owner = $derived(selectedHistoryOwner())
    const restore = $derived(service && owner !== null ? service.view(owner).restore : null)
    // The note about chats applies to a character's restore point only.
    const hasChatNote = $derived(hasChatNoteOf(parseOwnerKey(owner ?? '')))
    const paths = $derived(restore ? RESTORE_PATH_ORDER.filter((path) => restore.fields[path] !== undefined) : [])
    // Paths whose live value was changed outside Studio's history since the visit.
    const changed = $derived.by((): RestorePath[] => {
        if (!restore || owner === null) return []
        // A module owner resolves only through the published open-module id, as the service resolves it; the read of that
        // id makes this derivation follow the publish.
        const resolved = resolveOwnerTarget(owner, openStudioModuleId)
        if (!resolved.ok) return []
        return listChangedElsewhere(restore, liveReaderOf(resolved.target))
    })
    // A changed path is kept unless the user chooses to overwrite it.
    let overwritten = $state<RestorePath[]>([])
    let refusal = $state<StudioRefusal | null>(null)
    let cancelButton = $state<HTMLButtonElement | undefined>()
    let layer = $state<HTMLElement | undefined>()
    let confirmButton = $state<HTMLButtonElement | undefined>()

    // Set once the sheet is gone; the questions it asked end with it.
    let destroyed = false
    const asks = new Set<RiskyAsk>()
    onDestroy(() => {
        destroyed = true
        for (const ask of [...asks]) ask.cancel()
    })

    onMount(() => {
        cancelButton?.focus()
    })

    function labelOf(path: RestorePath): string {
        return path === 'alternateGreetings' ? language.altGreet : language[fieldLabelKey(path)]
    }

    function toggle(path: RestorePath, keep: boolean): void {
        overwritten = keep ? overwritten.filter((entry) => entry !== path) : [...overwritten, path]
    }

    async function confirm(): Promise<void> {
        if (!service || owner === null) return
        const key = owner
        const svc = service
        const keepNow = (): Set<RestorePath> => new Set(changed.filter((path) => !overwritten.includes(path)))
        let before = readOwnerFields(key)
        let result = svc.restore(key, keepNow())
        if (result.ok === false && result.reason === 'riskyConfirm') {
            const visitId = studioScreen.visitId
            // The question's answer may change what is live: the retry recomputes the kept paths and reads `before` after
            // the answer, so focus goes to what the restore changed.
            const settled = await resolveRiskyRefusal(
                key,
                result,
                (confirmed) => {
                    before = readOwnerFields(key)
                    return svc.restore(key, keepNow(), { confirmed })
                },
                () => !destroyed && studioScreen.visitId === visitId && owner === key,
                (asker, paths) => {
                    const ask = askRiskyTurnOn(asker, paths)
                    asks.add(ask)
                    void ask.answer.then(() => asks.delete(ask))
                    return ask
                },
            )
            if (settled === null) {
                // Declined or cancelled: the sheet stays open with no refusal line, and focus is on its confirm button.
                if (!destroyed) confirmButton?.focus()
                return
            }
            result = settled
        }
        if (result.ok === false) {
            refusal = result.reason
            return
        }
        // The sheet unmounts with the close, so the scope is taken from it first; a restore that changed nothing
        // leaves focus to the panel's opener rule.
        const scope = layer?.closest('[data-part="studio"]') ?? null
        setStudioRestoreSheetOpen(false)
        void placeFocusAfterHistory(before, readOwnerFields(owner), () => scope, () => null)
    }

    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
</script>

<div bind:this={layer} data-part="studio-restore-layer" class="absolute inset-0 z-30 flex items-end justify-center bg-black/40 p-3 sm:items-center">
    <div role="dialog" aria-labelledby="studio-restore-title" data-part="studio-restore-sheet" class="flex max-h-full w-full max-w-md flex-col gap-3 overflow-y-auto rounded-md border border-darkborderc bg-darkbg p-4 text-textcolor">
        <h2 id="studio-restore-title" class="text-lg font-bold">{language.studioRestoreTitle}</h2>
        <p class="text-sm text-textcolor2">{language.studioRestoreBody}</p>
        {#if hasChatNote}
            <p data-part="studio-restore-chat-note" class="text-sm text-textcolor2">{language.studioRestoreChatNote}</p>
        {/if}
        {#if paths.length > 0}
            <ul class="flex flex-col gap-1" data-part="studio-restore-fields">
                {#each paths as path (path)}
                    <li data-part="studio-restore-field" data-path={path} class="flex flex-col">
                        <span class="font-bold">{labelOf(path)}</span>
                        {#if changed.includes(path)}
                            <label class="flex min-h-11 items-center gap-2 text-sm">
                                <input type="checkbox" aria-label={language.studioRestoreKeep} data-part="studio-restore-keep" data-path={path} checked={!overwritten.includes(path)} onchange={(event) => toggle(path, event.currentTarget.checked)} />
                                <span>{language.studioRestoreKeep}</span>
                            </label>
                        {/if}
                    </li>
                {/each}
            </ul>
        {/if}
        {#if refusal}
            <p role="alert" data-part="studio-restore-refusal" class="text-sm text-draculared">{refusalText(refusal)}</p>
        {/if}
        <div class="flex justify-end gap-2">
            <button bind:this={cancelButton} type="button" class={buttonClass} data-part="studio-restore-cancel" onclick={() => setStudioRestoreSheetOpen(false)}>{language.cancel}</button>
            <button bind:this={confirmButton} type="button" class={buttonClass} data-part="studio-restore-confirm" disabled={!restore} onclick={() => void confirm()}>{language.studioRestoreConfirm}</button>
        </div>
    </div>
</div>
