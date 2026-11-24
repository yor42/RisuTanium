<script lang="ts">
    import { onDestroy, untrack, type Snippet } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import { DISPLAY_SEGMENTS, readDisplaySegment, writeDisplaySegment, type DisplaySegment } from '../../ts/studio/displaySegment'
    import { refusalText } from '../../ts/studio/edit/studioToasts'
    import type { SetPath } from '../../ts/studio/history/fieldRegistry'
    import { registerFieldReveal } from '../../ts/studio/historyFocus'
    import type { StudioRefusal, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
    import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService, historyBannerText } from '../../ts/studio/history/studioHistoryService.svelte'
    import { DBState } from '../../ts/stores.svelte'
    import StudioAssetList, { type EnabledModuleAssets } from './assets/StudioAssetList.svelte'
    import StudioDisplayScreen, { type ScreenFill } from './StudioDisplayScreen.svelte'

    // The Display form of the selected character: three segments (portrait, screen, assets) over one history service.
    // Every edit goes through the service, which writes the live character, marks it for saving and records the step.
    // The segment shown is remembered per character on this device (displaySegment.ts).
    interface Props {
        chaId: string
        enabledModules: () => EnabledModuleAssets[]
    }

    let { chaId, enabledModules }: Props = $props()

    const owner = characterOwnerKey(untrack(() => chaId))

    const service = $derived(getStudioHistoryService())
    $effect(() => {
        if (service) {
            untrack(() => beginOwnerVisit(owner))
        } else {
            ensureStudioHistory()
        }
    })

    const live = $derived.by(() => {
        const found = DBState.db.characters?.find((candidate) => candidate?.chaId === chaId)
        return found && found.type !== 'group' ? found : undefined
    })
    const view = $derived(service ? service.view(owner) : null)
    const hidden = $derived(live === undefined || live.license === 'private' || view?.restricted === true)
    const editable = $derived(view?.editable === true)
    const banner = $derived(view ? historyBannerText(view.banner) : null)

    let refusal = $state<StudioRefusal | null>(null)
    function noted(result: StudioResult | null): boolean {
        if (result === null) return false
        refusal = result.ok === false ? result.reason : null
        return result.ok
    }
    function onFieldResult(result: StudioResult | null): void {
        if (result) noted(result)
    }

    // ------------------------------------------------------------ segments
    let segment = $state<DisplaySegment>(untrack(() => readDisplaySegment(chaId)))
    let tabs = $state<Partial<Record<DisplaySegment, HTMLButtonElement>>>({})

    function choose(next: DisplaySegment): void {
        segment = next
        writeDisplaySegment(chaId, next)
    }
    function segmentOf(path: SetPath): DisplaySegment | null {
        switch (path) {
            case 'hideChatIcon':
            case 'largePortrait':
                return 'photo'
            case 'viewScreen':
            case 'inlayViewScreen':
            case 'newGenData.prompt':
            case 'newGenData.negative':
            case 'newGenData.instructions':
            case 'newGenData.emotionInstructions':
                return 'screen'
            case 'prebuiltAssetCommand':
            case 'prebuiltAssetStyle':
                return 'assets'
            default:
                return null
        }
    }
    // A history focus on a path of a segment that is not shown selects that segment, so its field is mounted.
    $effect(() => registerFieldReveal(async (path) => {
        const target = segmentOf(path)
        if (target === null || target === segment) return
        choose(target)
        await afterFlush()
    }))

    function onTabKeydown(event: KeyboardEvent, current: DisplaySegment): void {
        const at = DISPLAY_SEGMENTS.indexOf(current)
        let next = at
        if (event.key === 'ArrowRight') next = (at + 1) % DISPLAY_SEGMENTS.length
        else if (event.key === 'ArrowLeft') next = (at + DISPLAY_SEGMENTS.length - 1) % DISPLAY_SEGMENTS.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = DISPLAY_SEGMENTS.length - 1
        else return
        event.preventDefault()
        choose(DISPLAY_SEGMENTS[next])
        tabs[DISPLAY_SEGMENTS[next]]?.focus()
    }

    const hasMainImage = $derived(typeof live?.image === 'string' && live.image !== '')
    const photoCount = $derived((hasMainImage ? 1 : 0) + (Array.isArray(live?.ccAssets) ? live.ccAssets.length : 0))
    const assetCount = $derived(Array.isArray(live?.additionalAssets) ? live.additionalAssets.length : 0)
    function labelOf(id: DisplaySegment): string {
        switch (id) {
            case 'photo': return language.studioDisplaySegPhoto(photoCount)
            case 'screen': return language.studioDisplaySegScreen
            case 'assets': return language.studioDisplaySegAssets(assetCount)
        }
    }

    // ------------------------------------------------------------ writes
    function onFlagChange(path: 'hideChatIcon' | 'largePortrait' | 'prebuiltAssetCommand', event: Event & { currentTarget: HTMLInputElement }): void {
        const box = event.currentTarget
        if (!service || !editable || !noted(service.editField(owner, path, box.checked))) {
            box.checked = live?.[path] === true
            return
        }
        // A switch is one discrete action: it never joins the next one's step.
        service.closeOpenStep(owner)
    }

    function onStyleChange(event: Event & { currentTarget: HTMLSelectElement }): void {
        const select = event.currentTarget
        if (!service || !editable || !noted(service.editText(owner, 'prebuiltAssetStyle', select.value, 'single'))) {
            select.value = live?.prebuiltAssetStyle === 'dynamic' ? 'dynamic' : ''
            return
        }
        service.closeOpenStep(owner)
    }

    // What the last mode switch filled, in memory only; it belongs to this visit of the form.
    let fill = $state<ScreenFill | null>(null)

    onDestroy(() => service?.closeOpenStep(owner))

    const idBase = $props.id()
    const rowClass = 'flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-md border border-darkborderc p-2'
    const inputClass = 'min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor'
</script>

{#snippet flagRow(label: string, control: Snippet)}
    <label class={rowClass}>
        <span class="min-w-0 flex-1 font-bold">{label}</span>
        {@render control()}
    </label>
{/snippet}

<!-- One control snippet per switch: each part name is a literal, which the theme-pack part reader requires. -->
{#snippet hideIconControl()}
    <input type="checkbox" role="switch" data-part="studio-display-hide-icon" aria-label={language.hideChatIcon} disabled={!editable} aria-busy={editable ? undefined : 'true'} checked={live?.hideChatIcon === true} onchange={(event) => onFlagChange('hideChatIcon', event)} />
{/snippet}
{#snippet largePortraitControl()}
    <input type="checkbox" role="switch" data-part="studio-display-large-portrait" aria-label={language.largePortrait} disabled={!editable} aria-busy={editable ? undefined : 'true'} checked={live?.largePortrait === true} onchange={(event) => onFlagChange('largePortrait', event)} />
{/snippet}
{#snippet assetCommandControl()}
    <input type="checkbox" role="switch" data-part="studio-display-prebuilt-asset-command" aria-label={language.insertAssetPrompt} disabled={!editable} aria-busy={editable ? undefined : 'true'} checked={live?.prebuiltAssetCommand === true} onchange={(event) => onFlagChange('prebuiltAssetCommand', event)} />
{/snippet}

{#if live && !hidden}
    <section data-part="studio-display-form" data-phase={view?.phase ?? 'unused'} class="flex flex-col gap-3" aria-busy={editable ? undefined : 'true'}>
        {#if banner}
            <p role="status" data-part="studio-form-banner" data-banner={view?.banner} class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{banner}</p>
        {/if}
        <div role="tablist" data-part="studio-segments" aria-label={language.studioKindDisplay} class="flex flex-wrap gap-2">
            {#each DISPLAY_SEGMENTS as id (id)}
                <button
                    type="button"
                    role="tab"
                    data-part="studio-segment"
                    data-seg={id}
                    aria-selected={segment === id}
                    tabindex={segment === id ? 0 : -1}
                    bind:this={tabs[id]}
                    class="min-h-11 rounded-md border border-darkborderc px-3 text-textcolor {segment === id ? 'bg-selected' : 'bg-darkbg'}"
                    onclick={() => choose(id)}
                    onkeydown={(event) => onTabKeydown(event, id)}
                >{labelOf(id)}</button>
            {/each}
        </div>

        <div role="tabpanel" data-part="studio-display-panel" data-seg="photo" hidden={segment !== 'photo'} class="flex flex-col gap-3">
            {#if segment === 'photo'}
                {@render flagRow(language.hideChatIcon, hideIconControl)}
                {#if hasMainImage}
                    {@render flagRow(language.largePortrait, largePortraitControl)}
                {/if}
            {/if}
        </div>

        <div role="tabpanel" data-part="studio-display-panel" data-seg="screen" hidden={segment !== 'screen'} class="flex flex-col gap-3">
            {#if segment === 'screen'}
                <StudioDisplayScreen {chaId} {owner} {service} {live} {editable} {fill} onfill={(next) => { fill = next }} {noted} onresult={onFieldResult} />
            {/if}
        </div>

        <div role="tabpanel" data-part="studio-display-panel" data-seg="assets" hidden={segment !== 'assets'} class="flex flex-col gap-3">
            {#if segment === 'assets' && DBState.db.newImageHandlingBeta}
                {@render flagRow(language.insertAssetPrompt, assetCommandControl)}
                <div class="flex flex-col gap-1">
                    <label id="{idBase}-style-label" for="{idBase}-style" class="font-bold">{language.assetStyle}</label>
                    <select
                        id="{idBase}-style"
                        aria-labelledby="{idBase}-style-label"
                        aria-describedby="{idBase}-style-label"
                        data-part="studio-display-prebuilt-asset-style"
                        class={inputClass}
                        disabled={!editable}
                        aria-busy={editable ? undefined : 'true'}
                        value={live.prebuiltAssetStyle === 'dynamic' ? 'dynamic' : ''}
                        onchange={onStyleChange}
                    >
                        <option value="">{language.static}</option>
                        <option value="dynamic">{language.dynamic}</option>
                    </select>
                </div>
            {/if}
            <StudioAssetList {chaId} {enabledModules} />
        </div>

        {#if refusal}
            <p role="alert" data-part="studio-form-refusal" class="text-sm text-draculared">{refusalText(refusal)}</p>
        {/if}
    </section>
{/if}
