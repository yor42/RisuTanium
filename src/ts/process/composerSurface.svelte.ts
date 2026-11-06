import { beginWork } from './chatOrigin'
import type { character, groupChat, Chat } from '../storage/database.svelte'
import * as composerDrafts from './composerDrafts.svelte'
import type { ComposerDraftKey, ComposerDraftRecord } from './composerDrafts.svelte'

type ComposerCharacter = character | groupChat

// The unkeyed record belongs to one chat object and is shared across shell mounts.
let fallbackDraftChat: Chat | null = $state.raw(null)
let fallbackDraft: ComposerDraftRecord = $state({ messageInput: '', messageInputTranslate: '', fileInput: [] })
let pendingUploads = 0

export function fallbackDraftForChat(chat: Chat | null | undefined): ComposerDraftRecord | null {
    return chat != null && fallbackDraftChat === chat ? fallbackDraft : null
}

export function pendingChatFileUploads(): number {
    return pendingUploads
}

// A reader can report a terminal event only once to the counter, including after a failed read.
export function beginChatFileUpload(): () => void {
    pendingUploads += 1
    let settled = false
    return () => {
        if (settled) return
        settled = true
        pendingUploads -= 1
    }
}

export async function trackChatFileUpload<T>(work: () => Promise<T>): Promise<T> {
    const settle = beginChatFileUpload()
    try {
        return await work()
    }
    finally {
        settle()
    }
}

export function createComposerSurface(deps: {
    character: () => ComposerCharacter | null | undefined
    chat: () => Chat | null | undefined
}) {
    let currentDraftKey: ComposerDraftKey | null = $derived.by(() => {
        const char = deps.character()
        const chat = deps.chat()
        return char?.chaId && chat?.id ? { chaId: char.chaId, chatId: chat.id } : null
    })
    let shownDraft: ComposerDraftRecord = $derived(
        currentDraftKey
            ? composerDrafts.peek(currentDraftKey)
            : (fallbackDraftForChat(deps.chat()) ?? composerDrafts.EMPTY_DRAFT_VIEW)
    )

    // The visible key protects its record from eviction without creating a draft.
    $effect(() => {
        composerDrafts.setOnScreenKey(currentDraftKey)
    })

    function resolveDraftKeyForWrite(): ComposerDraftKey | null {
        const char = deps.character()
        const chat = deps.chat()
        if (!char || !chat) return null
        if (char.chaId && chat.id) return { chaId: char.chaId, chatId: chat.id }
        const handle = beginWork(char, chat)
        if (!handle) return null
        const key: ComposerDraftKey = { chaId: handle.origin.chaId, chatId: handle.origin.chatId }
        handle.end()
        return key
    }

    function writeDraftAt(key: ComposerDraftKey | null, update: (record: ComposerDraftRecord) => void): void {
        if (key) {
            composerDrafts.write(key, update)
            return
        }
        const chat = deps.chat() ?? null
        if (fallbackDraftChat !== chat) {
            fallbackDraftChat = chat
            fallbackDraft = { messageInput: '', messageInputTranslate: '', fileInput: [] }
        }
        update(fallbackDraft)
    }

    function writeDraft(update: (record: ComposerDraftRecord) => void): void {
        writeDraftAt(resolveDraftKeyForWrite(), update)
    }

    return {
        get currentDraftKey() { return currentDraftKey },
        get shownDraft() { return shownDraft },
        resolveDraftKeyForWrite,
        writeDraftAt,
        writeDraft,
    }
}
