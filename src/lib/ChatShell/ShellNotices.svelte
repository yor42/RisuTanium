<script lang="ts">
    import { DBState, selIdState } from '../../ts/stores.svelte'
    import { isComposerBusyIn } from '../../ts/process/composerActions.svelte'
    import { aiLawApplies } from '../../ts/globalApi.svelte'
    import { coldStorageHeader, preLoadChat, retryLegacyColdChatLoad } from '../../ts/process/coldstorage.svelte'
    import { coldChatNoticeText, legacyRetryStateFor, legacyRetryView, matchColdStorageLoadErrorKey, type LegacyRetryState } from '../../ts/process/coldstorageData'
    import { getPageStorageMode } from '../../ts/storage/pageStorageMode'
    import { language } from '../../lang'
    import CreatorQuote from '../ChatScreens/CreatorQuote.svelte'

    let character = $derived(DBState.db.characters[selIdState.selId])
    let chat = $derived(character?.chats?.[character.chatPage])
    let first = $derived(chat?.message?.[0])
    let errorKey = $derived(matchColdStorageLoadErrorKey(first?.data))
    let retryState: Record<string, LegacyRetryState> = $state({})
    let stateKey = $derived(`${character?.chaId ?? ''}::${errorKey ?? ''}`)
    // Only work in the shown chat holds the retry; a reply written elsewhere does not.
    let shownBusy = $derived(character?.chaId && chat?.id ? isComposerBusyIn({ chaId: character.chaId, chatId: chat.id }) : false)

    async function retry(): Promise<void> {
        if (!character || !errorKey) return
        const key = stateKey
        retryState[key] = 'pending'
        try {
            const result = await retryLegacyColdChatLoad(selIdState.selId, character.chatPage)
            const state = legacyRetryStateFor(result)
            if (state) retryState[key] = state
            else delete retryState[key]
        } catch (error) {
            console.error('Cold storage retry failed:', error)
            retryState[key] = 'retryFailed'
        }
    }
</script>

{#if first?.data?.startsWith(coldStorageHeader) && character}
    {#await preLoadChat(selIdState.selId, character.chatPage)}
        <p data-part="chat-cold-loading" role="status">{language.loadingChatData}</p>
    {:then result}
        {@const notice = coldChatNoticeText(result, first?.data?.slice(coldStorageHeader.length) ?? '')}
        {#if notice !== null}<p data-part="chat-cold-notice" role="status">{notice}</p>{/if}
    {/await}
{:else}
    {#if errorKey}
        {@const view = legacyRetryView(retryState[stateKey], getPageStorageMode().kind === 'store2')}
        <div data-part="chat-legacy-cold-notice" role="status">
            <p>{view.text}</p>
            {#if view.detail !== null}<p>{view.detail}</p>{/if}
            {#if view.showRetry}<button disabled={retryState[stateKey] === 'pending' || shownBusy} onclick={() => void retry()}>{language.errors.coldStorageLegacyChatRetryButton}</button>{/if}
        </div>
    {/if}
    {#if chat?.message?.length === 0 && aiLawApplies()}
        <p data-part="chat-ai-law-notice" role="status">{language.aiGenerationWarning}</p>
    {/if}
    {#if character && chat?.message?.length === 0 && character.type !== 'group' && !character.removedQuotes && character.creatorNotes?.length >= 2}
        <CreatorQuote quote={character.creatorNotes} onRemove={() => { character.removedQuotes = true; DBState.db.characters[selIdState.selId] = character }} />
    {/if}
{/if}

<style>
    [data-part="chat-cold-loading"], [data-part="chat-cold-notice"], [data-part="chat-legacy-cold-notice"], [data-part="chat-ai-law-notice"] { margin: var(--space-12) auto; padding: var(--space-7) var(--space-12); max-width: var(--sheet-width-wide); text-align: center; color: var(--nexus-text-secondary); }
    [data-part="chat-legacy-cold-notice"] button { min-height: var(--size-touch); color: var(--nexus-text); }
</style>
