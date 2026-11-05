import { get } from 'svelte/store'
import { DBState, selIdState } from '../stores.svelte'
import { doingChat } from '../process/index.svelte'
import { isAutoModeActive, isComposerBusy } from '../process/composerActions.svelte'
import { isWriting } from '../process/chatOrigin'
import { hasMessageEditorDrafts } from '../localDrafts'
import { translationEditLoading } from '../process/messageEditorController.svelte'
import { peek } from '../process/composerDrafts.svelte'
import { fallbackDraftForChat, pendingChatFileUploads } from '../process/composerSurface.svelte'

export type FlipBlock =
    | { kind: 'generating', reasonKey: 'chatShellFlipRefusedGenerating' }
    | { kind: 'working', reasonKey: 'chatShellFlipRefusedWorking' }
    | { kind: 'editing', reasonKey: 'chatShellFlipRefusedEditing' }
    | { kind: 'attachment', reasonKey: 'chatShellFlipRefusedAttachment' }
    | { kind: 'draft', reasonKey: 'chatShellFlipRefusedDraft' }
    | { kind: 'uploading', reasonKey: 'chatShellFlipRefusedUploading' }

export function shellFlipBlocker(): FlipBlock | null {
    if (get(doingChat) || isComposerBusy() || isAutoModeActive()) {
        return { kind: 'generating', reasonKey: 'chatShellFlipRefusedGenerating' }
    }
    const character = DBState.db.characters?.[selIdState.selId]
    const chat = character?.chats?.[character.chatPage]
    if (character && chat?.id && isWriting({ chaId: character.chaId, chatId: chat.id })) {
        return { kind: 'working', reasonKey: 'chatShellFlipRefusedWorking' }
    }
    if (hasMessageEditorDrafts() || translationEditLoading() > 0) {
        return { kind: 'editing', reasonKey: 'chatShellFlipRefusedEditing' }
    }
    const fallback = fallbackDraftForChat(chat)
    if ((character && chat?.id && peek({ chaId: character.chaId, chatId: chat.id }).fileInput.length > 0)
        || (fallback?.fileInput.length ?? 0) > 0) {
        return { kind: 'attachment', reasonKey: 'chatShellFlipRefusedAttachment' }
    }
    // The unkeyed record is what a chat without an id types into; a pending text there is unsaved work the user would not expect to lose track of.
    if (fallback && (fallback.messageInput !== '' || fallback.messageInputTranslate !== '')) {
        return { kind: 'draft', reasonKey: 'chatShellFlipRefusedDraft' }
    }
    if (pendingChatFileUploads() > 0) {
        return { kind: 'uploading', reasonKey: 'chatShellFlipRefusedUploading' }
    }
    return null
}
