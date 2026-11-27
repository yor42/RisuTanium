<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { language } from '../../lang'
    import type { character } from '../../ts/storage/database.svelte'
    import { runPortraitAdd } from '../../ts/studio/assets/portraitAddFlow'
    import { createStudioToasts } from '../../ts/studio/edit/studioToasts'
    import type { OwnerHistoryService, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import type { OwnerKey } from '../../ts/studio/history/ownerPhase'
    import { getStudioHistoryService } from '../../ts/studio/history/studioHistoryService.svelte'
    import { toastHost, type ToastHost } from '../../ts/toast/toastHost.svelte'

    // The main portrait and the other photos of a character, with Add / Replace, Make main and Remove. Every change goes
    // through the history service as one step; the add runs in `runPortraitAdd`, which reports an add that did not land
    // through the app-wide toast host, so its outcome survives this section being unmounted.
    interface Props {
        owner: OwnerKey
        service: OwnerHistoryService | undefined
        live: character
        editable: boolean
        // Reports a result in the form's refusal line; true when the action landed.
        noted: (result: StudioResult | null) => boolean
        // The toast host of the remove toasts; the app's own host when absent (tests pass one on a fake clock).
        host?: ToastHost
    }

    let { owner, service, live, editable, noted, host }: Props = $props()

    const toasts = createStudioToasts({ service: getStudioHistoryService, host: untrack(() => host) })

    interface Photo {
        // The stored index in `ccAssets`; an unreadable row is still listed, and the service refuses an edit of it.
        index: number
        uri: string
        name: string
    }

    const mainPath = $derived(typeof live.image === 'string' ? live.image : '')
    const alternates = $derived.by((): Photo[] => {
        const rows: unknown = live.ccAssets
        if (!Array.isArray(rows)) return []
        return rows.map((row: unknown, index): Photo => {
            const entry = typeof row === 'object' && row !== null ? (row as { uri?: unknown; name?: unknown }) : {}
            return { index, uri: typeof entry.uri === 'string' ? entry.uri : '', name: typeof entry.name === 'string' ? entry.name : '' }
        })
    })

    // The picture URLs, one per file path, made once per path while the section is shown.
    let urls = $state<Record<string, string>>({})
    let destroyed = false
    onDestroy(() => { destroyed = true })
    $effect(() => {
        for (const path of [mainPath, ...alternates.map((photo) => photo.uri)]) {
            if (path === '' || untrack(() => urls[path] !== undefined)) continue
            untrack(() => { urls[path] = '' })
            void load(path)
        }
    })

    // The store module is loaded with the first picture, not with the form: a form with no photo never reaches it. One
    // import serves every picture of the section.
    let storeModule: Promise<typeof import('../../ts/globalApi.svelte')> | null = null
    async function load(path: string): Promise<void> {
        try {
            storeModule ??= import('../../ts/globalApi.svelte')
            const { getFileSrc } = await storeModule
            const url = await getFileSrc(path, 'whole')
            if (!destroyed) urls[path] = url
        } catch (error) {
            console.error(error)
        }
    }

    let menu = $state<'main' | number | null>(null)
    // How many PNG text notes the last landed add copied; shown under the main photo while this section is mounted.
    let pngNote = $state<number | null>(null)

    function toggleMenu(which: 'main' | number): void {
        menu = menu === which ? null : which
    }

    function onMenuKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        menu = null
    }

    async function addPhoto(): Promise<void> {
        menu = null
        if (!service || !editable) return
        pngNote = null
        // The chooser, the picture reader and the store are loaded when an add starts, so a form that only shows the
        // portrait does not pull them in. No guard waits on the chooser: some choosers never answer a cancel.
        const [{ beginPickBusy, pickFiles, readPickedFileBytes }, { readPortraitTextChunks }, { saveAsset }] = await Promise.all([
            import('../../ts/studio/assets/filePicker'),
            import('../../ts/studio/assets/portraitTextChunks'),
            import('../../ts/globalApi.svelte'),
        ])
        await runPortraitAdd(owner, {
            pickFiles: () => pickFiles('portrait'),
            readBytes: readPickedFileBytes,
            readPortraitTextChunks,
            // The classic picker's own store call: `saveImage` of the database module is this function.
            saveImage: (bytes) => saveAsset(bytes),
            service,
            toastHost: untrack(() => host) ?? toastHost,
            onLanded: (n) => {
                if (!destroyed) pngNote = n > 0 ? n : null
            },
            beginBusy: () => beginPickBusy('portrait'),
        })
    }

    function makeMain(index: number): void {
        menu = null
        if (!service || !editable) return
        pngNote = null
        noted(service.portraitMakeMain(owner, index))
    }

    function remove(target: 'main' | number): void {
        menu = null
        if (!service || !editable) return
        // Taking out the main photo promotes the first alternate, which the toast says.
        const promoted = target === 'main' && alternates.length > 0
        const result = service.portraitRemove(owner, target)
        if (!noted(result) || !result.ok) return
        pngNote = null
        if (result.stepId !== undefined) {
            toasts.postAssetAction(owner, result.stepId, promoted ? language.studioPortraitPromoted : language.studioPortraitRemoved)
        }
    }

    const itemClass = 'min-h-11 rounded px-2 text-start hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
    const moreClass = 'flex h-11 min-w-11 shrink-0 items-center justify-center rounded-md hover:bg-selected cursor-pointer'
    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
</script>

{#snippet picture(path: string, label: string)}
    {#if urls[path]}
        <img src={urls[path]} alt={label} class="h-full w-full rounded-md object-cover" />
    {:else}
        <div aria-hidden="true" class="h-full w-full rounded-md bg-darkbutton"></div>
    {/if}
{/snippet}

<div data-part="studio-portrait" class="flex flex-col gap-3">
    <h3 class="font-bold">{language.studioPortraitMain}</h3>
    {#if mainPath !== ''}
        <div class="flex items-start gap-2">
            <div data-part="studio-portrait-main" class="w-32 shrink-0 {live.largePortrait === true ? 'aspect-[2/3]' : 'aspect-square'}">
                {@render picture(mainPath, language.studioPortraitMain)}
            </div>
            <div class="flex flex-col">
                <button
                    type="button"
                    data-part="studio-portrait-more"
                    class={moreClass}
                    aria-label={language.studioAssetRowMenu(language.studioPortraitMain)}
                    aria-haspopup="menu"
                    aria-expanded={menu === 'main'}
                    onclick={() => toggleMenu('main')}
                >⋯</button>
            </div>
        </div>
        {#if menu === 'main'}
            <div role="menu" data-part="studio-portrait-menu" tabindex="-1" class="flex flex-col rounded-md border border-darkborderc bg-darkbg p-1" onkeydown={onMenuKeydown}>
                <button type="button" role="menuitem" data-part="studio-portrait-replace" class={itemClass} disabled={!editable} onclick={addPhoto}>{language.studioPortraitReplace}</button>
                <button type="button" role="menuitem" data-part="studio-portrait-remove" class={itemClass} disabled={!editable} onclick={() => remove('main')}>{language.remove}</button>
            </div>
        {/if}
    {:else}
        <div data-part="studio-portrait-empty" class="flex flex-col items-start gap-2 rounded-md border border-dashed border-darkborderc p-3">
            <button type="button" data-part="studio-portrait-add" class={buttonClass} disabled={!editable} onclick={addPhoto}>{language.studioPortraitAdd}</button>
            <p class="text-sm text-textcolor2">{language.studioPortraitAddNote}</p>
        </div>
    {/if}
    {#if pngNote !== null}
        <p role="status" data-part="studio-portrait-png-note" class="text-sm text-textcolor2">{language.studioPngNote(pngNote)}</p>
    {/if}
    {#if alternates.length > 0}
        <h3 class="font-bold">{language.studioPortraitOthers}</h3>
        <ul class="flex flex-col gap-2">
            {#each alternates as photo (photo.index)}
                <li class="flex flex-col gap-1">
                    <div class="flex items-center gap-2">
                        <div data-part="studio-portrait-alt" data-index={photo.index} class="flex min-w-0 flex-1 items-center gap-2">
                            <div class="h-16 w-16 shrink-0">{@render picture(photo.uri, photo.name)}</div>
                            <span class="min-w-0 flex-1 truncate">{photo.name}</span>
                        </div>
                        <button
                            type="button"
                            data-part="studio-portrait-alt-more"
                            class={moreClass}
                            aria-label={language.studioAssetRowMenu(photo.name)}
                            aria-haspopup="menu"
                            aria-expanded={menu === photo.index}
                            onclick={() => toggleMenu(photo.index)}
                        >⋯</button>
                    </div>
                    {#if menu === photo.index}
                        <div role="menu" data-part="studio-portrait-menu" tabindex="-1" class="flex flex-col rounded-md border border-darkborderc bg-darkbg p-1" onkeydown={onMenuKeydown}>
                            <button type="button" role="menuitem" data-part="studio-portrait-make-main" class={itemClass} disabled={!editable} onclick={() => makeMain(photo.index)}>{language.studioPortraitMakeMain}</button>
                            <button type="button" role="menuitem" data-part="studio-portrait-alt-remove" class={itemClass} disabled={!editable} onclick={() => remove(photo.index)}>{language.remove}</button>
                        </div>
                    {/if}
                </li>
            {/each}
        </ul>
    {/if}
</div>
