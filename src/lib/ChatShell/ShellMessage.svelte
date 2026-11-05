<script lang="ts">
    import type { Message, StreamingDisplayOptimizationMode } from '../../ts/storage/database.svelte'
    import type { simpleCharacterArgument } from '../../ts/parser/parser.svelte'
    import type { TreeView } from '../../ts/process/chatTreeView'
    import ChatBody from '../ChatScreens/ChatBody.svelte'
    import StreamingView from './StreamingView.svelte'
    import { chatSurface, isChatSurfaceInstalled } from '../ChatScreens/chatSurface.svelte'
    import { language } from '../../lang'
    import { getCharImage } from '../../ts/characters'
    import { getModelInfo } from '../../ts/model/modellist'
    import { untrack } from 'svelte'

    interface Props {
        idx: number
        message: Message
        chatId?: string
        name: string
        img?: string
        character?: simpleCharacterArgument | string | null
        totalLength?: number
        firstMessage?: boolean
        isLastMemory?: boolean
        largePortrait?: boolean
        rerollIcon?: 'dynamic'
        messageGenerationInfo?: Message['generationInfo']
        role?: Message['role']
        isComment?: boolean
        disabled?: boolean
        expectedId?: string
        surface?: boolean
        streamingOptimizationMode?: StreamingDisplayOptimizationMode
        rawStreamingText?: string
        isOptimizedStreamingMessage?: boolean
        interrupted?: boolean
        deferAutoTranslate?: boolean
        streaming?: boolean
        run?: 'first' | 'middle' | 'last' | 'single'
        guiRevision?: number
        onReroll?: () => void
        unReroll?: () => void
        onStep?: (index: number, expectedId: string | undefined, direction: 'back' | 'forward') => void
        onBranch?: (index: number, expectedId: string | undefined) => void
        getTreeView?: () => TreeView | null
        getBusy?: () => boolean
    }
    let { idx, message, chatId, name, img = '', character = null, firstMessage = false,
        interrupted = message.interrupted === true, deferAutoTranslate = false, streaming = false, run = 'single', disabled = false, guiRevision = 0 }: Props = $props()
    let translated = $state(false)
    let translating = $state(false)
    let retranslate = $state(false)
    let bodyRoot = $state<HTMLElement | null>(null)
    let avatar = $state<string | null>(null)
    $effect(() => {
        let live = true
        void getCharImage(img, 'plain').then((value) => { if (live && typeof value === 'string') avatar = value })
        return () => { live = false }
    })
    const surfaceEpoch = isChatSurfaceInstalled() ? untrack(() => chatSurface.rebuildEpoch) : null
    let labelId = $derived(`shell-message-name-${idx}-${chatId ?? 'first'}`)
    let modelShortName = $derived(message.generationInfo?.model ? getModelInfo(message.generationInfo.model).shortName : '')
</script>

<article class="risu-chat" class:user={message.role === 'user'} data-part="chat-message" data-role={message.role} data-run={firstMessage ? 'single' : run} data-meta="shown" data-streaming={streaming ? '' : undefined} data-hidden={disabled ? '' : undefined} data-chat-index={idx} data-chat-id={chatId ?? ''} aria-labelledby={labelId}>
    <div data-part="chat-message-name-row">
        <div data-part="chat-message-meta">
            {#if avatar}<img data-part="chat-message-avatar" src={avatar} alt="" width="24" height="24" />{/if}
            <span data-part="chat-message-name" id={labelId}>{name}</span>
        </div>
    </div>
    <div data-part="chat-message-body" class="prose" bind:this={bodyRoot}>
        {#if streaming}
            <StreamingView text={message.data} {modelShortName} {character} />
        {:else}
            <ChatBody {character} {firstMessage} {idx} msgDisplay={message.data} {name} role={message.role}
                {bodyRoot} {modelShortName} renderRevision={guiRevision} {deferAutoTranslate}
                {surfaceEpoch} bind:translated bind:translating bind:retranslate />
        {/if}
    </div>
    {#if interrupted && !streaming}<div data-part="chat-message-interrupted" role="note">{language.messageInterrupted}</div>{/if}
</article>

<style>
    [data-part="chat-message"] { width: 100%; padding: var(--space-8) var(--space-12); color: var(--nexus-text); }
    [data-part="chat-message-name-row"] { min-height: var(--message-name-row-height); }
    [data-part="chat-message-meta"] { display: flex; align-items: center; gap: var(--message-meta-gap); color: var(--nexus-text-secondary); }
    [data-part="chat-message-meta"] img { width: var(--size-12); height: var(--size-12); border-radius: var(--radius-circle); }
    [data-part="chat-message-body"] { max-width: var(--thread-max-width); width: 100%; overflow-wrap: anywhere; }
    [data-part="chat-message"].user { border-left: var(--stroke-bold) solid var(--nexus-surface-raised); }
    [data-part="chat-message-interrupted"] { color: var(--nexus-text-secondary); font-style: italic; font-size: var(--font-size-xs); }
</style>
