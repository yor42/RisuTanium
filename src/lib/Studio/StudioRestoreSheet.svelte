<script lang="ts">
    import { onMount, untrack } from 'svelte'
    import { language } from '../../lang'
    import { createLiveReader, resolveLiveTarget } from '../../ts/studio/edit/studioSetters'
    import { createStudioToasts, refusalText } from '../../ts/studio/edit/studioToasts'
    import { listChangedElsewhere, type RestorePath } from '../../ts/studio/history/historyModel'
    import type { StudioRefusal } from '../../ts/studio/history/ownerHistory.svelte'
    import { getStudioHistoryService } from '../../ts/studio/history/studioHistoryService.svelte'
    import { registerStudioSheetBack } from '../../ts/studio/studioBack.svelte'
    import { placeFocusAfterHistory } from '../../ts/studio/historyFocus'
    import { readOwnerFields } from '../../ts/studio/ownerFields'
    import { selectedHistoryOwner, setStudioRestoreSheetOpen } from '../../ts/studio/studioScreen.svelte'
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

    const PATH_ORDER: readonly RestorePath[] = ['desc', 'hideChatIcon', 'note', 'alternateGreetings']

    const service = $derived(getStudioHistoryService())
    const owner = $derived(selectedHistoryOwner())
    const restore = $derived(service && owner !== null ? service.view(owner).restore : null)
    const paths = $derived(restore ? PATH_ORDER.filter((path) => restore.fields[path] !== undefined) : [])
    // Paths whose live value was changed outside Studio's history since the visit.
    const changed = $derived.by((): RestorePath[] => {
        if (!restore || owner === null) return []
        const resolved = resolveLiveTarget(owner)
        return resolved.ok ? listChangedElsewhere(restore, createLiveReader(resolved.target)) : []
    })
    // A changed path is kept unless the user chooses to overwrite it.
    let overwritten = $state<RestorePath[]>([])
    let refusal = $state<StudioRefusal | null>(null)
    let cancelButton = $state<HTMLButtonElement | undefined>()
    let layer = $state<HTMLElement | undefined>()

    onMount(() => {
        cancelButton?.focus()
    })

    function labelOf(path: RestorePath): string {
        switch (path) {
            case 'desc': return language.description
            case 'hideChatIcon': return language.hideChatIcon
            case 'note': return language.note
            case 'alternateGreetings': return language.altGreet
        }
    }

    function toggle(path: RestorePath, keep: boolean): void {
        overwritten = keep ? overwritten.filter((entry) => entry !== path) : [...overwritten, path]
    }

    function confirm(): void {
        if (!service || owner === null) return
        const keep = new Set(changed.filter((path) => !overwritten.includes(path)))
        const before = readOwnerFields(owner)
        const result = service.restore(owner, keep)
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
        {#if paths.length > 0}
            <ul class="flex flex-col gap-1" data-part="studio-restore-fields">
                {#each paths as path (path)}
                    <li data-part="studio-restore-field" data-path={path} class="flex flex-col">
                        <span class="font-bold">{labelOf(path)}</span>
                        {#if changed.includes(path)}
                            <label class="flex min-h-11 items-center gap-2 text-sm">
                                <input type="checkbox" data-part="studio-restore-keep" data-path={path} checked={!overwritten.includes(path)} onchange={(event) => toggle(path, event.currentTarget.checked)} />
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
            <button type="button" class={buttonClass} data-part="studio-restore-confirm" disabled={!restore} onclick={confirm}>{language.studioRestoreConfirm}</button>
        </div>
    </div>
</div>
