<script lang="ts">
    import { onDestroy, tick, untrack } from 'svelte'
    import { language } from '../../lang'
    import { createStudioToasts, refusalText } from '../../ts/studio/edit/studioToasts'
    import type { StudioRefusal, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
    import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService, historyBannerText, studioHistoryLoadFailed } from '../../ts/studio/history/studioHistoryService.svelte'
    import { DBState } from '../../ts/stores.svelte'
    import type { ToastHost } from '../../ts/toast/toastHost.svelte'

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
                void tick().then(() => {
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

    function onFocus(event: FocusEvent & { currentTarget: HTMLTextAreaElement }): void {
        // The value the field had when it was focused: the browser's own undo owns the field until it is back here.
        event.currentTarget.dataset.studioFocusValue = event.currentTarget.value
    }

    function onBlur(): void {
        service?.closeOpenStep(owner)
    }

    function onDescInput(event: Event & { currentTarget: HTMLTextAreaElement }): void {
        const field = event.currentTarget
        if (!service || !editable || !noted(service.editField(owner, 'desc', field.value))) {
            field.value = live?.desc ?? ''
        }
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

    function onGreetingInput(index: number, event: Event & { currentTarget: HTMLTextAreaElement }): void {
        const field = event.currentTarget
        if (!service || !editable || !noted(service.greetingEdit(owner, index, field.value))) {
            field.value = greetings[index] ?? ''
        }
    }

    function greetingInputs(): HTMLElement[] {
        return root ? Array.from(root.querySelectorAll<HTMLElement>('[data-part="studio-greeting-input"]')) : []
    }

    async function addGreeting(): Promise<void> {
        if (!service || !editable || !noted(service.greetingAdd(owner))) return
        await tick()
        greetingInputs().at(-1)?.focus()
    }

    async function deleteGreeting(index: number): Promise<void> {
        if (!service || !editable || !noted(service.greetingDelete(owner, index))) return
        const op = service.view(owner).done.at(-1)?.ops.find((candidate) => candidate.op === 'listRemove')
        if (op?.op === 'listRemove') toasts.postDeleted(owner, op.deletedId)
        await tick()
        // Focus goes to the row that took the place, else the one before it, else the add button.
        const rows = greetingInputs()
        const next = rows[index] ?? rows[index - 1] ?? root?.querySelector<HTMLElement>('[data-part="studio-greeting-add"]')
        next?.focus()
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
        <label class="flex flex-col gap-1">
            <span class="font-bold">{language.description}</span>
            <textarea
                data-part="studio-form-desc"
                class="min-h-32 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
                readonly={!editable}
                aria-busy={editable ? undefined : 'true'}
                value={live.desc ?? ''}
                onfocus={onFocus}
                onblur={onBlur}
                oninput={onDescInput}
            ></textarea>
        </label>
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
        <div class="flex flex-col gap-2" data-part="studio-form-greetings">
            <div class="flex items-center justify-between gap-2">
                <span class="font-bold">{language.altGreet}</span>
                <button
                    type="button"
                    data-part="studio-greeting-add"
                    class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer"
                    disabled={!editable}
                    aria-busy={editable ? undefined : 'true'}
                    onclick={addGreeting}
                >{language.add}</button>
            </div>
            {#if greetings.length === 0}
                <p class="text-sm text-textcolor2">{language.studioGreetingsEmpty}</p>
            {/if}
            {#each greetings as greeting, index (index)}
                <div class="flex items-start gap-2" data-part="studio-greeting-row">
                    <textarea
                        data-part="studio-greeting-input"
                        data-index={index}
                        class="min-h-20 min-w-0 flex-1 rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
                        aria-label={`${language.altGreet} ${index + 1}`}
                        readonly={!editable}
                        aria-busy={editable ? undefined : 'true'}
                        value={greeting}
                        onfocus={onFocus}
                        onblur={onBlur}
                        oninput={(event) => onGreetingInput(index, event)}
                    ></textarea>
                    <button
                        type="button"
                        data-part="studio-greeting-delete"
                        class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer"
                        aria-label={`${language.studioGreetingDelete} ${index + 1}`}
                        disabled={!editable}
                        onclick={() => deleteGreeting(index)}
                    >{language.remove}</button>
                </div>
            {/each}
        </div>
        {#if refusal}
            <p role="alert" data-part="studio-form-refusal" class="text-sm text-draculared">{refusalText(refusal)}</p>
        {/if}
    </section>
{/if}
