import { writeLiveChat } from '../liveCharacterWrite'
import { markCharacterForSave } from '../storage/characterSaveMarks'
import type { Chat, Database } from '../storage/database.svelte'
import type { PromptItem } from '../process/prompt'

/**
 * What the This-chat sheet writes to the chat it was opened for.
 *
 * The note autosave, every note flush and the rename commit run after user time has passed, so they go through
 * `writeLiveChat`: the owner is found again by `chaId`, the chat by identity or else by its id, and the write lands
 * with a save mark or is refused (false) with nothing written and nothing marked. The caller tells the user about a
 * refusal and never shows a success for it. The hide-names switch is an immediate click on the displayed chat, so it
 * writes the given chat object and marks its owner.
 */

/** The address of the chat the sheet was opened for: its owner's `chaId` and the chat object. */
export type EditTarget = { chaId: string, chat: Chat }

/** Writes the author note of the live chat. */
export function writeChatNote(target: EditTarget, value: string): boolean {
    return writeLiveChat(target.chaId, target.chat, (live) => {
        live.note = value
    })
}

/** Writes the name of the live chat; `value` is a name `normalizeChatName` accepted. */
export function writeChatName(target: EditTarget, value: string): boolean {
    return writeLiveChat(target.chaId, target.chat, (live) => {
        live.name = value
    })
}

/** The name to commit for a typed one: trimmed, and null when nothing is left, so an empty name reverts. */
export function normalizeChatName(value: string): string | null {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
}

/** On writes `true`; off removes the key, so a chat that shows names holds no field (absent means shown). */
export function setChatHideNames(target: EditTarget, value: boolean): void {
    if (value) {
        target.chat.hideNames = true
    } else {
        delete target.chat.hideNames
    }
    markCharacterForSave(target.chaId)
}

/** The message count and the time of the last message (absent when the chat is empty or the message has none). */
export function chatStats(chat: Chat): { count: number, lastTime: number | undefined } {
    const messages = chat.message
    return { count: messages.length, lastTime: messages.at(-1)?.time }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** `ms` in the largest whole unit before `now` ("3 minutes ago"); a time in the future reads as now. */
export function relativeTime(ms: number, now: number, locale?: string): string {
    const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    const age = Math.max(0, now - ms)
    if (age < MINUTE) return format.format(0, 'second')
    if (age < HOUR) return format.format(-Math.floor(age / MINUTE), 'minute')
    if (age < DAY) return format.format(-Math.floor(age / HOUR), 'hour')
    if (age < 30 * DAY) return format.format(-Math.floor(age / DAY), 'day')
    if (age < 365 * DAY) return format.format(-Math.floor(age / (30 * DAY)), 'month')
    return format.format(-Math.floor(age / (365 * DAY)), 'year')
}

const jailbreakToggleToken = '{{jbtoggled}}'
const usesJailbreakToggle = (value?: string) => typeof value === 'string' && value.includes(jailbreakToggleToken)

/**
 * Whether the prompt has a jailbreak to switch: the same rule as the sidebar's toggle list. With a template, a
 * jailbreak item or `{{jbtoggled}}` in any of its text fields; without one, a non-blank jailbreak text.
 */
export function promptHasJailbreakToggle(db: Pick<Database, 'promptTemplate' | 'jailbreak'>): boolean {
    const template: PromptItem[] | undefined = db.promptTemplate
    if (!template) {
        return (db.jailbreak ?? '').trim().length > 0
    }
    return template.some((item) => {
        if (item.type === 'jailbreak') return true
        if ('text' in item && usesJailbreakToggle(item.text)) return true
        if ('innerFormat' in item && usesJailbreakToggle(item.innerFormat)) return true
        if ('defaultText' in item && usesJailbreakToggle(item.defaultText)) return true
        return false
    })
}
