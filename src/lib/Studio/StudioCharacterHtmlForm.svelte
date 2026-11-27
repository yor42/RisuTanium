<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { language } from '../../lang'
    import { readStored } from '../../ts/studio/edit/moduleNamespaceNotes'
    import { refusalText } from '../../ts/studio/edit/studioToasts'
    import type { StudioRefusal, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
    import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService, historyBannerText } from '../../ts/studio/history/studioHistoryService.svelte'
    import type { LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import { DBState } from '../../ts/stores.svelte'
    import LongTextField from './LongTextField.svelte'
    import type { PreviewSourceInput } from './LongTextPreview.svelte'

    // The 배경 HTML form of the selected character: one long-text field over the history service. Every edit goes
    // through the service, which writes the live character, marks it for saving and records the step. The character is
    // read on every render by id, never kept from mount, because a Studio write replaces the slot object. The text is
    // shown only as the field's own text and through its strict preview; it is never rendered as markup here.
    interface Props {
        chaId: string
    }

    let { chaId }: Props = $props()

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
    // A stored value that is not text reads as empty with a note; the first edit replaces it and undo puts it back.
    const read = $derived(readStored(live?.backgroundHTML, 'text'))
    const previewSource = (): PreviewSourceInput => ({ owner: live ?? null, chat: live?.chats?.[live.chatPage] ?? null, globals: DBState.db.globalChatVariables ?? {} })

    let refusal = $state<StudioRefusal | null>(null)
    function noted(result: StudioResult | null): void {
        if (result === null) return
        refusal = result.ok === false ? result.reason : null
    }

    const port: LongTextWritePort = {
        read: () => (live === undefined ? null : read.text),
        write: (value) => (service && editable ? service.editText(owner, 'backgroundHTML', value, 'typing') : null),
        closeStep: () => service?.closeOpenStep(owner),
    }

    onDestroy(() => service?.closeOpenStep(owner))
</script>

{#if live && !hidden}
    <section data-part="studio-char-html-form" data-phase={view?.phase ?? 'unused'} class="mx-auto flex w-full max-w-3xl flex-col gap-2" aria-busy={editable ? undefined : 'true'}>
        {#if banner}
            <p role="status" data-part="studio-form-banner" data-banner={view?.banner} class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{banner}</p>
        {/if}
        <LongTextField
            {port}
            part="studio-char-background"
            label={language.backgroundHTML}
            kind="advanced"
            mode="html+cbs"
            ownerLabel={live.name}
            {previewSource}
            {editable}
            busy={!editable}
            fieldClass="min-h-20 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
            onresult={noted}
        />
        {#if read.foreign !== null}
            <p data-part="studio-field-note" class="text-sm text-textcolor2">{language.studioModAdvValueForeign(read.foreign)}</p>
        {/if}
        <details data-part="studio-field-help" class="rounded-md border border-darkborderc p-2">
            <summary class="min-h-11 cursor-pointer">{language.helpBlock}</summary>
            <p class="whitespace-pre-wrap text-sm text-textcolor2">{language.help.backgroundHTML}</p>
        </details>
        <p class="text-sm text-textcolor2">{language.studioCharHtmlHint}</p>
        {#if refusal}
            <p role="alert" data-part="studio-form-refusal" class="text-sm text-draculared">{refusalText(refusal)}</p>
        {/if}
    </section>
{/if}
