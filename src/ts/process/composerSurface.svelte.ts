import { beginWork } from './chatOrigin'
import type { character, groupChat, Chat } from '../storage/database.svelte'
import * as composerDrafts from './composerDrafts.svelte'
import type { ComposerDraftKey, ComposerDraftRecord } from './composerDrafts.svelte'
import type { InlayWriteProgress } from './files/inlays'

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

export type ChatFileAttachment = {
    readonly token: number
    readonly key: ComposerDraftKey | null
    readonly name: string
    readonly written: number
    readonly total: number
}

// Module state, so a chip outlives a composer remount like the draft it belongs to.
// The array is replaced on every change; entries keep their position.
let attachments: ChatFileAttachment[] = $state.raw([])
let nextAttachmentToken = 0

function sameDraftKey(a: ComposerDraftKey | null, b: ComposerDraftKey | null): boolean {
    if (a === null || b === null) return a === b
    return a.chaId === b.chaId && a.chatId === b.chatId
}

export function attachmentsForDraft(key: ComposerDraftKey | null): readonly ChatFileAttachment[] {
    return attachments.filter((entry) => sameDraftKey(entry.key, key))
}

// A report after the call settled is ignored, so a late store callback never brings a chip back.
export async function trackChatFileAttachment<T>(
    key: ComposerDraftKey | null,
    work: (report: (progress: InlayWriteProgress | null) => void) => Promise<T>,
): Promise<T> {
    const token = ++nextAttachmentToken
    let settled = false
    const remove = () => {
        attachments = attachments.filter((entry) => entry.token !== token)
    }
    const report = (progress: InlayWriteProgress | null) => {
        if (settled) return
        if (progress === null) {
            remove()
            return
        }
        const entry: ChatFileAttachment = { token, key, name: progress.name, written: progress.written, total: progress.total }
        attachments = attachments.some((existing) => existing.token === token)
            ? attachments.map((existing) => existing.token === token ? entry : existing)
            : [...attachments, entry]
    }
    try {
        return await work(report)
    }
    finally {
        settled = true
        remove()
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
