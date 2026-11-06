import { CurrentTriggerIdStore, DBState, ReloadChatPointer, selIdState } from '../stores.svelte'
import { getCurrentCharacter, getCurrentChat, type character, type groupChat, type Chat, type Message, type MessageGenerationInfo } from '../storage/database.svelte'
import { withSupaRepoint } from './memory/supaResume'
import { siblingsAt } from './chatTree'
import { beginWork, originStatus, writeAt, type Origin } from './chatOrigin'
import { markCharacterForSave } from '../storage/characterSaveMarks'
import { alertConfirm, alertInput, alertSelect } from '../alert'
import { language } from '../../lang'
import { v4 as uuidv4 } from 'uuid'
import { capitalize, getUserIcon, getUserName, sleep } from '../util'
import { runLuaButtonTrigger, runLuaInteractionTrigger } from './scriptings'
import { runTrigger } from './triggers'
import { ensureModulesOrAlert } from './moduleEnsure'
import { hasModuleStubs } from './moduleRefList'
import { copyPlainText, stripThoughtsForCopy, type CopyOutcome } from '../chatCopy'
import { captureCardTheme, noteNewerPlainCopy, startCardCopy, type CardReport } from '../chatCard'
import { sayTTS } from './tts'
import { speakerSpeechText } from './ttsSpeechText'
import { getModelInfo } from '../model/modellist'
import { getFileSrc } from '../globalApi.svelte'
import { ParseMarkdown, type CbsConditions } from '../parser/parser.svelte'

export function copyMessageAsCard(options: {
    owner: object
    captureText: () => string
    report: (report: CardReport) => void
    role: () => string | null
    name: () => string
    messageGenerationInfo: () => MessageGenerationInfo | null
    idx: () => number
    getCbsCondition: () => CbsConditions
}): void {
    startCardCopy({
        owner: options.owner,
        captureText: options.captureText,
        captureCard: (copyText: string) => {
            const isUser = options.role() === 'user'
            const character = getCurrentCharacter()
            const cbsConditions = options.getCbsCondition()
            const messageIdx = options.idx()
            const root = document.documentElement
            const generationInfo = options.messageGenerationInfo()
            return {
                copyText,
                displayName: isUser ? getUserName() : options.name(),
                badge: isUser ? null : (generationInfo ? capitalize(getModelInfo(generationInfo.model).shortName) : 'AI'),
                avatarPath: (isUser ? getUserIcon() : DBState.db.characters[selIdState.selId]?.image) ?? '',
                theme: captureCardTheme((property) => root.style.getPropertyValue(property)),
                parseBody: () => ParseMarkdown(copyText, character, 'normal', messageIdx, cbsConditions),
                resolveAvatarSrc: getFileSrc,
            }
        },
        report: options.report,
    })
}

export function copyMessageText(text: string, report: (outcome: CopyOutcome) => void): void {
    const copyText = stripThoughtsForCopy(text)
    copyPlainText(copyText, report)
    noteNewerPlainCopy(copyText, report)
}

export function playMessageTTS(translated: boolean, shownRoot: HTMLElement | null, text: string, character: ReturnType<typeof getCurrentCharacter>) {
    return sayTTS(null, speakerSpeechText({ translated, shownRoot, original: stripThoughtsForCopy(text), character }))
}

export async function branchMessage(getIdx: () => number, expectedId: string | undefined, onBranch: ((index: number, expectedId: string | undefined) => void) | undefined): Promise<void> {
    await sleep(1)
    onBranch?.(getIdx(), expectedId)
}

export async function toggleMessageDisabled(getIdx: () => number, mode: 'one' | 'above'): Promise<void> {
    await sleep(1)
    const chat = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage]
    const idx = getIdx()
    const currentMessage = chat.message[idx]
    chat.message[idx].disabled = mode === 'one' ? !currentMessage.disabled : currentMessage.disabled === 'allBefore' ? false : 'allBefore'
}

export type DeleteMode = 'one' | 'from'

/** A settled delete addresses ids, never a message object that a stream may replace. */
export interface FrozenDeleteIds {
    readonly targetId: string
    readonly at: number
    readonly siblingIds: readonly string[]
    readonly rangeIds: readonly string[]
}

export function freezeDeleteIds(chat: Chat, target: Message, mode: DeleteMode): FrozenDeleteIds | null {
    const at = chat.message.indexOf(target)
    if (at < 0 || !target.chatId) return null
    const siblingIds = siblingsAt(chat, at).map((message) => message.chatId)
    const rangeIds = mode === 'from' ? chat.message.slice(at).map((message) => message.chatId) : []
    if (siblingIds.some((id) => !id) || (mode === 'from' && rangeIds.some((id) => !id))) return null
    return Object.freeze({
        targetId: target.chatId,
        at,
        siblingIds: Object.freeze(siblingIds.map((id) => id!)),
        rangeIds: Object.freeze(rangeIds.map((id) => id!)),
    })
}

export function deleteNow(owner: character | groupChat, chat: Chat, target: Message, mode: DeleteMode): boolean {
    if (!DBState.db.characters.includes(owner) || !owner.chats.includes(chat)) return false
    const at = chat.message.indexOf(target)
    if (at < 0) return false
    withSupaRepoint(chat, () => {
        chat.message.splice(at, mode === 'one' ? 1 : chat.message.length - at)
    })
    markCharacterForSave(owner.chaId)
    return true
}

export async function requestRemove(owner: character | groupChat, chat: Chat, target: Message, { rec = false }: { rec?: boolean } = {}): Promise<boolean> {
    const confirmed = DBState.db.askRemoval ? await alertConfirm(language.removeChat) : true
    if (!confirmed) return false
    let mode: DeleteMode = 'one'
    if (DBState.db.instantRemove || rec) {
        const choice = await alertSelect([
            language.removeOnlyThisMessage,
            language.cancel,
            language.removeThisAndFollowingMessages,
        ], language.removeMessageQuestion)
        if (choice === '2') mode = 'from'
        else if (choice !== '0') return false
    }
    return deleteNow(owner, chat, target, mode)
}

/** writeAt marks a resolved owner even when identity checks refuse the splice. */
export function deleteAtSettle(origin: Origin, ids: FrozenDeleteIds, mode: DeleteMode): boolean {
    let deleted = false
    writeAt(origin, (ctx) => {
        const at = ctx.chat.message.findIndex((message) => message.chatId === ids.targetId)
        if (at < 0 || at !== ids.at) return
        const current = freezeDeleteIds(ctx.chat, ctx.chat.message[at], mode)
        if (!current) return
        if (mode === 'one') {
            if (current.siblingIds.length !== ids.siblingIds.length) return
            if (current.siblingIds.some((id) => !ids.siblingIds.includes(id))) return
        } else if (current.rangeIds.length !== ids.rangeIds.length || current.rangeIds.some((id, index) => id !== ids.rangeIds[index])) return
        withSupaRepoint(ctx.chat, () => {
            ctx.chat.message.splice(at, mode === 'one' ? 1 : ctx.chat.message.length - at)
        })
        deleted = true
    })
    return deleted
}

export async function handleButtonTriggerWithin(event: UIEvent, getIdx: () => number) {
    const currentChar = getCurrentCharacter()
    if(!currentChar || currentChar.type === 'group'){
        return
    }

    const target = event.target as HTMLElement
    const origin = target.closest('[risu-trigger], [risu-btn]')
    if (!origin) {
        return
    }

    const triggerName = origin.getAttribute('risu-trigger')
    const triggerId = origin.getAttribute('risu-id')
    const btnEvent = origin.getAttribute('risu-btn')

    const currentChat = getCurrentChat()
    // Aborted only by a delete of the chat this run writes to: the registration's
    // stop is the run's one cancel path, and the busy button does not reach it.
    const runController = new AbortController()
    const workHandle = beginWork(currentChar, currentChat, undefined, () => runController.abort())
    if (!workHandle) {
        return
    }

    let triggerResult
    try {
        // A click has no cancel of its own: a load that waits on a question waits until it is answered or the
        // chat is deleted. A failed load shows its alert and the trigger does not run.
        const modulesReady = !hasModuleStubs() || await ensureModulesOrAlert(workHandle.origin, runController.signal, { owner: currentChar, chat: currentChat })
        triggerResult = !modulesReady ? undefined :
            triggerName ?
                await runTrigger(currentChar, 'manual', {
                    chat: currentChat,
                    manualName: triggerName,
                    triggerId: triggerId || undefined,
                    origin: workHandle.origin,
                    signal: runController.signal,
                }) :
            btnEvent ?
                await runLuaButtonTrigger(currentChar, btnEvent, workHandle.origin) :
            null
    } finally {
        workHandle.end()
    }

    // A gone origin skips the reload bump; an ambiguous one still gets
    // it whenever a trigger ran, since its chat is still on screen.
    if(triggerResult && originStatus(workHandle.origin) !== 'gone') {
        ReloadChatPointer.update((v) => {
            const idx = getIdx()
            v[idx] = (v[idx] ?? 0) + 1
            return v
        })
    }
    
    if(triggerName && triggerId) {
        setTimeout(() => {
            CurrentTriggerIdStore.set(null)
        }, 100) // Small delay to allow display mode to complete
    }
}

export async function handleFormTriggerWithin(event: SubmitEvent, getIdx: () => number) {
    // Regardless of attribute presence, prevent undesirable site exits via form submission
    event.preventDefault()

    const currentChar = getCurrentCharacter()
    if(!currentChar || currentChar.type === 'group'){
        return
    }

    const target = event.target as HTMLFormElement
    const formEvent = target.getAttribute('risu-form')

    if (!formEvent) {
        return
    }

    const data: Record<string, FormDataEntryValue | FormDataEntryValue[]> = Object.create(null)
    for (const [key, value] of new FormData(target, event.submitter)) {
        if (Object.hasOwn(data, key)) {
            if (Array.isArray(data[key])) {
                data[key].push(value)
            } else {
                data[key] = [data[key], value]
            }
        } else {
            data[key] = value
        }
    }

    // Same origin discipline as the button path: the run writes to the chat it
    // started in, so a chat switch during the Lua await never replaces the
    // chat on screen.
    const currentChat = getCurrentChat()
    const runController = new AbortController()
    const workHandle = beginWork(currentChar, currentChat, undefined, () => runController.abort())
    if (!workHandle) {
        return
    }

    let triggerResult
    try {
        const modulesReady = !hasModuleStubs() || await ensureModulesOrAlert(workHandle.origin, runController.signal, { owner: currentChar, chat: currentChat })
        if (modulesReady) {
            triggerResult = await runLuaInteractionTrigger('form', currentChar, formEvent, { data }, workHandle.origin)
        }
    } finally {
        workHandle.end()
    }

    if(triggerResult && originStatus(workHandle.origin) !== 'gone') {
        ReloadChatPointer.update((v) => {
            const idx = getIdx()
            v[idx] = (v[idx] ?? 0) + 1
            return v
        })
    }
}


export async function toggleBookmark(idx: number, name: string) {
    const chat = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage];
    
    if(!chat.message[idx]) return;

    let messageId = chat.message[idx]?.chatId;
    const messageContent = chat.message[idx]?.data;

    if (!messageId) {
        messageId = uuidv4();
        chat.message[idx].chatId = messageId;
    }

    chat.bookmarks ??= [];
    chat.bookmarkNames ??= {};

    const bookmarkIndex = chat.bookmarks.indexOf(messageId);

    if (bookmarkIndex > -1) {
        chat.bookmarks.splice(bookmarkIndex, 1);
        delete chat.bookmarkNames[messageId];
    } else {
        chat.bookmarks.push(messageId);

        const msgSender = chat.message[idx]?.role === 'user' ? getUserName() : name;
        const newName= await alertInput(language.bookmarkAskNameOrDefault, [], chat.bookmarkNames[messageId] || '');

        if (newName && newName.trim() !== '') {
            chat.bookmarkNames[messageId] = newName;
        } else {
            let defaultName;

            const blacklist = ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', '-', '=', '[', ']', '{', '}', '|', ';', ':', '"', "'", ',', '.', '<', '>', '/', '?'];
            let lines = messageContent.split('\n');
            lines = lines.splice(Math.floor(lines.length * 0.5));
            for (const line of lines) {
                if (line && !blacklist.some(char => line.startsWith(char))) {
                    defaultName = line.trim().slice(0, 50) + '...';
                    break;
                }
            }
            if (!defaultName) {
                defaultName = messageContent.slice(0, 50) + '...';
            }
            chat.bookmarkNames[messageId] = msgSender + '| ' + defaultName;
        }
    }

    chat.bookmarks = [...chat.bookmarks];
}
