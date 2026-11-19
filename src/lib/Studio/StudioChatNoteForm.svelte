<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import { uniqueChatById } from '../../ts/studio/edit/studioSetters'
    import { refusalText } from '../../ts/studio/edit/studioToasts'
    import type { StudioRefusal, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { chatOwnerKey } from '../../ts/studio/history/ownerPhase'
    import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService, historyBannerText, studioHistoryLoadFailed } from '../../ts/studio/history/studioHistoryService.svelte'
    import type { LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import { DBState } from '../../ts/stores.svelte'
    import LongTextField from './LongTextField.svelte'
    import type { PreviewSourceInput } from './LongTextPreview.svelte'

    // The note of the selected character's current chat. A chat without a unique id has no history and no form:
    // its note is shown read-only with the reason.
    interface Props {
        chaId: string
        chatId: string
    }

    let { chaId, chatId }: Props = $props()
    // Names the form's root after its visible "Note" label.
    const instanceId = $props.id()
    const labelId = `${instanceId}-note-label`

    const owner = chatOwnerKey(untrack(() => chaId), untrack(() => chatId))

    const character = $derived.by(() => {
        const found = DBState.db.characters?.find((candidate) => candidate?.chaId === chaId)
        return found && found.type !== 'group' ? found : undefined
    })
    const uniqueChat = $derived(uniqueChatById(character?.chats, chatId))
    // The chat the detail stands for, whether or not it can be edited.
    const shownChat = $derived(uniqueChat ?? character?.chats?.[character.chatPage])
    const editableChat = $derived(uniqueChat !== null)
    // What the CBS preview reads: the character, the chat the detail stands for, and the shared variables. Read at each run.
    const previewSource = (): PreviewSourceInput => ({ owner: character ?? null, chat: shownChat ?? null, globals: DBState.db.globalChatVariables ?? {} })

    const service = $derived(getStudioHistoryService())
    $effect(() => {
        if (!editableChat) return
        if (service) {
            untrack(() => beginOwnerVisit(owner))
        } else {
            ensureStudioHistory()
        }
    })

    // Read at every render, so a character that became private shows nothing.
    const view = $derived(service ? service.view(owner) : null)
    const hidden = $derived(character === undefined || character.license === 'private' || view?.restricted === true)
    const editable = $derived(editableChat && view?.editable === true)
    const banner = $derived(editableChat && view ? historyBannerText(view.banner) : null)
    // The history service could not be loaded at all: the note stays read-only (there is no write path) until a retry builds it.
    const loadFailed = $derived(editableChat && !service && studioHistoryLoadFailed())

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

    // A null result means there was no write path; the note then clears the refusal line like an accepted write.
    function onFieldResult(result: StudioResult | null): void {
        refusal = result && result.ok === false ? result.reason : null
    }

    const notePort: LongTextWritePort = {
        read: () => shownChat?.note ?? '',
        write: (value) => (service && editable ? service.editField(owner, 'note', value) : null),
        closeStep: () => service?.closeOpenStep(owner),
    }

    onDestroy(() => service?.closeOpenStep(owner))
</script>

{#if shownChat && !hidden}
    <section bind:this={root} tabindex="-1" aria-labelledby={labelId} data-part="studio-chat-note-form" data-phase={editableChat ? (view?.phase ?? 'unused') : 'readonly'} class="flex flex-col gap-3 outline-none" aria-busy={editable || !editableChat ? undefined : 'true'}>
        {#if editableChat && !editable && !loadFailed}
            <p data-part="studio-form-loading" class="text-sm text-textcolor2">{language.studioFormLoading}</p>
        {/if}
        {#if loadFailed}
            <p role="status" data-part="studio-form-banner" data-banner="failed" class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{language.studioBannerFailed}</p>
            <button bind:this={retryButton} type="button" data-part="studio-history-retry" class="min-h-11 self-start rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={retry}>{language.studioChipRetry}</button>
        {/if}
        {#if !editableChat}
            <p data-part="studio-form-readonly-reason" class="text-sm text-textcolor2">{language.studioRefusalNoUniqueChat}</p>
        {/if}
        {#if banner}
            <p role="status" data-part="studio-form-banner" data-banner={view?.banner} class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{banner}</p>
        {/if}
        <LongTextField
            port={notePort}
            part="studio-form-note"
            label={language.note}
            {labelId}
            kind="note"
            mode="cbs"
            ownerLabel={character?.name}
            {previewSource}
            {editable}
            busy={!(editable || !editableChat)}
            fieldClass="min-h-32 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
            onresult={onFieldResult}
        />
        {#if refusal}
            <p role="alert" data-part="studio-form-refusal" class="text-sm text-draculared">{refusalText(refusal)}</p>
        {/if}
    </section>
{/if}
