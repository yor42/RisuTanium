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
    if ((character && chat?.id && peek({ chaId: character.chaId, chatId: chat.id }).fileInput.length > 0)
        || (fallbackDraftForChat(chat)?.fileInput.length ?? 0) > 0) {
        return { kind: 'attachment', reasonKey: 'chatShellFlipRefusedAttachment' }
    }
    if (pendingChatFileUploads() > 0) {
        return { kind: 'uploading', reasonKey: 'chatShellFlipRefusedUploading' }
    }
    return null
}
