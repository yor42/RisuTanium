<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import { createStudioToasts, refusalText } from '../../ts/studio/edit/studioToasts'
    import type { StudioRefusal, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
    import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService, historyBannerText, studioHistoryLoadFailed } from '../../ts/studio/history/studioHistoryService.svelte'
    import type { LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import { DBState } from '../../ts/stores.svelte'
    import type { ToastHost } from '../../ts/toast/toastHost.svelte'
    import GreetingCards from './GreetingCards.svelte'
    import LongTextField from './LongTextField.svelte'
    import type { PreviewSourceInput } from './LongTextPreview.svelte'

    // The live edit fields of the selected character: description, hide-icon and the alternative first
    // messages. Every edit goes through the history service, which writes the live character, marks it for
    // saving and records the step. While the owner's history is still loading (or the service is still being
    // built) the fields are read-only; after a failure they are editable with a banner that says history is not
    // kept.
    interface Props {
        chaId: string
        // The toast host of the delete toasts; the app's own host when absent (tests pass one on a fake clock).
        host?: ToastHost
    }

    let { chaId, host }: Props = $props()

    const owner = characterOwnerKey(untrack(() => chaId))
    const toasts = createStudioToasts({ service: getStudioHistoryService, host: untrack(() => host) })

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
    // What the CBS preview reads: the character, the chat it is showing, and the shared variables. Read at each run.
    const previewSource = (): PreviewSourceInput => ({ owner: live ?? null, chat: live?.chats?.[live.chatPage] ?? null, globals: DBState.db.globalChatVariables ?? {} })
    // Read at every render, so a character that became private or a group shows nothing.
    const view = $derived(service ? service.view(owner) : null)
    const hidden = $derived(live === undefined || live.license === 'private' || view?.restricted === true)
    const editable = $derived(view?.editable === true)
    const greetings = $derived(live?.alternateGreetings ?? [])
    const banner = $derived(view ? historyBannerText(view.banner) : null)
    // The history service could not be loaded at all: the fields stay read-only (there is no write path) until a retry builds it.
    const loadFailed = $derived(!service && studioHistoryLoadFailed())

    let refusal = $state<StudioRefusal | null>(null)
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

    function noted(result: StudioResult): boolean {
        refusal = result.ok === false ? result.reason : null
        return result.ok
    }

    // A null result means there was no write path: the refusal line stays as it was.
    function onFieldResult(result: StudioResult | null): void {
        if (result) noted(result)
    }

    const descPort: LongTextWritePort = {
        read: () => live?.desc ?? '',
        write: (value) => (service && editable ? service.editField(owner, 'desc', value) : null),
        closeStep: () => service?.closeOpenStep(owner),
    }

    const firstMessagePort: LongTextWritePort = {
        read: () => live?.firstMessage ?? '',
        write: (value) => (service && editable ? service.editText(owner, 'firstMessage', value, 'typing') : null),
        closeStep: () => service?.closeOpenStep(owner),
    }

    function onHideIconChange(event: Event & { currentTarget: HTMLInputElement }): void {
        const field = event.currentTarget
        if (!service || !editable || !noted(service.editField(owner, 'hideChatIcon', field.checked))) {
            field.checked = live?.hideChatIcon === true
            return
        }
        // A toggle is one discrete action: it never joins the next one's step.
        service.closeOpenStep(owner)
    }

    function onRenderWhenCompleteChange(event: Event & { currentTarget: HTMLInputElement }): void {
        const field = event.currentTarget
        if (!service || !editable || !noted(service.editField(owner, 'risutanium_render_when_complete', field.checked))) {
            field.checked = live?.risutanium_render_when_complete === true
            return
        }
        // A toggle is one discrete action: it never joins the next one's step.
        service.closeOpenStep(owner)
    }

    onDestroy(() => service?.closeOpenStep(owner))
</script>

{#if live && !hidden}
    <section bind:this={root} tabindex="-1" data-part="studio-character-form" data-phase={view?.phase ?? 'unused'} class="flex flex-col gap-3 outline-none" aria-busy={editable ? undefined : 'true'}>
        {#if !editable && !loadFailed}
            <p data-part="studio-form-loading" class="text-sm text-textcolor2">{language.studioFormLoading}</p>
        {/if}
        {#if loadFailed}
            <p role="status" data-part="studio-form-banner" data-banner="failed" class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{language.studioBannerFailed}</p>
            <button bind:this={retryButton} type="button" data-part="studio-history-retry" class="min-h-11 self-start rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={retry}>{language.studioChipRetry}</button>
        {/if}
        {#if banner}
            <p role="status" data-part="studio-form-banner" data-banner={view?.banner} class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{banner}</p>
        {/if}
        <LongTextField
            port={descPort}
            part="studio-form-desc"
            label={language.description}
            kind="desc"
            mode="cbs"
            ownerLabel={live.name}
            {previewSource}
            {editable}
            busy={!editable}
            fieldClass="min-h-32 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
            onresult={onFieldResult}
        />
        <label class="flex min-h-11 items-center gap-2">
            <input
                type="checkbox"
                data-part="studio-form-hide-icon"
                disabled={!editable}
                aria-busy={editable ? undefined : 'true'}
                checked={live.hideChatIcon === true}
                onchange={onHideIconChange}
            />
            <span>{language.hideChatIcon}</span>
        </label>
        <label class="flex min-h-11 items-center gap-2">
            <input
                type="checkbox"
                data-part="studio-form-render-when-complete"
                disabled={!editable}
                aria-busy={editable ? undefined : 'true'}
                aria-describedby="studio-form-render-when-complete-hint"
                checked={live.risutanium_render_when_complete === true}
                onchange={onRenderWhenCompleteChange}
            />
            <span>{language.studioFormRenderWhenComplete}</span>
        </label>
        <p id="studio-form-render-when-complete-hint" data-part="studio-form-render-when-complete-hint" class="text-sm text-textcolor2">{language.studioFormRenderWhenCompleteHint}</p>
        <LongTextField
            port={firstMessagePort}
            part="studio-form-first-message"
            label={language.firstMessage}
            kind="firstMessage"
            mode="html+cbs"
            ownerLabel={live.name}
            {previewSource}
            {editable}
            busy={!editable}
            fieldClass="min-h-32 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
            onresult={onFieldResult}
        />
        <GreetingCards
            {owner}
            {service}
            {editable}
            {greetings}
            ownerLabel={live.name}
            {previewSource}
            {toasts}
            {noted}
            onresult={onFieldResult}
        />
        {#if refusal}
            <p role="alert" data-part="studio-form-refusal" class="text-sm text-draculared">{refusalText(refusal)}</p>
        {/if}
    </section>
{/if}
