// The reader is at the bottom when the end of the conversation is within this distance. The same distance clears the new-reply count,
// so there is one rule for "at the bottom" on the button and the count. It is separate from the bottom follower's sub-pixel tolerance.
export const BOTTOM_PX = 100
export const TRAVEL_MS = 260
const CUT_SCREENS = 2
const BADGE_CAP = 99

export type ScrollMetrics = Pick<HTMLElement, 'scrollHeight' | 'clientHeight' | 'scrollTop'>

export function distanceFromEnd(host: ScrollMetrics): number {
    return host.scrollHeight - host.clientHeight - host.scrollTop
}

// A window that does not mount the newest message is never at the bottom of the conversation, whatever its own rows say.
export function isAtBottom(distance: number, slid: boolean): boolean {
    return !slid && distance <= BOTTOM_PX
}

export function isFar(distance: number, viewport: number, slid: boolean): boolean {
    return slid || distance > viewport
}

export interface LatestButtonState {
    atBottom: boolean
    far: boolean
    unread: boolean
    count: number
}

export function latestButtonVisible(state: LatestButtonState): boolean {
    return !state.atBottom && (state.far || state.unread || state.count > 0)
}

export function badgeText(count: number): string {
    return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count)
}

// Replies are the character's messages; a message the reader sent never counts.
export function appendedReplies(messages: readonly { role: string }[], previousLength: number): number {
    let replies = 0
    for (let index = Math.max(0, previousLength); index < messages.length; index++) {
        if (messages[index]?.role === 'char') replies += 1
    }
    return replies
}

export interface TravelPlan {
    // The distance from the end to cut to before the glide, or null when the glide starts where the reader is.
    cutTo: number | null
    duration: number
}

export function travelPlan(input: { distance: number, viewport: number, reduced: boolean }): TravelPlan {
    if (input.reduced) return { cutTo: null, duration: 0 }
    const limit = CUT_SCREENS * input.viewport
    return { cutTo: input.distance > limit ? limit : null, duration: TRAVEL_MS }
}

export interface TravelDeps {
    requestFrame: (callback: () => void) => number
    cancelFrame: (id: number) => void
    now: () => number
    // The current position and the live end: the end is read again every frame because the content under the reader keeps growing.
    read: () => { top: number, end: number }
    write: (top: number) => void
    // Checked before every write; true ends the travel without writing.
    stop: () => boolean
}

export interface Travel {
    // `done` receives true when the travel reached the end and false when `stop` ended it. A cancelled travel never calls it.
    run: (duration: number, done: (completed: boolean) => void) => void
    cancel: () => void
}

export function createTravel(deps: TravelDeps): Travel {
    let frame: number | null = null
    let generation = 0
    function cancel(): void {
        generation += 1
        if (frame !== null) deps.cancelFrame(frame)
        frame = null
    }
    return {
        run: (duration, done) => {
            cancel()
            const mine = generation
            const from = deps.read().top
            const started = deps.now()
            const step = (): void => {
                frame = null
                if (mine !== generation) return
                if (deps.stop()) { done(false); return }
                const { end } = deps.read()
                const progress = duration > 0 ? Math.min(1, (deps.now() - started) / duration) : 1
                if (progress >= 1) {
                    deps.write(end)
                    done(true)
                    return
                }
                const eased = 1 - (1 - progress) * (1 - progress) * (1 - progress)
                deps.write(from + (end - from) * eased)
                frame = deps.requestFrame(step)
            }
            frame = deps.requestFrame(step)
        },
        cancel,
    }
}

// A jump of more than this many messages leaves a return chip behind.
export const LONG_JUMP_MESSAGES = 50

export function isLongJump(from: number, to: number): boolean {
    return Math.abs(to - from) > LONG_JUMP_MESSAGES
}

// Where a jump put the reader: the message at the top of the screen, its distance below the top edge, and whether the reader followed the newest message.
export interface JumpOrigin {
    index: number
    offset: number
    atBottom: boolean
}

// `third` puts the target's top at the upper third of the visible area; `offset` puts it that many px below the top edge (the return path).
export type JumpAlign = 'third' | { offset: number }

export type JumpStatus = 'done' | 'deferred' | 'blocked' | 'outOfRange' | 'cancelled'

export interface JumpResult {
    status: JumpStatus
    // The reader's place before the jump; null when the request did not ask for it, or when the jump did not run.
    from: JumpOrigin | null
    to: number
}

export interface JumpOptions {
    align?: JumpAlign
    recordOrigin?: boolean
}

// The scroll distance that brings `targetTop` to the line one third down the visible area. The area starts below `topInset`
// (the scroller's scroll-padding-top), so the line is `hostTop + topInset + (clientHeight - topInset) / 3`.
export function alignDelta(input: { targetTop: number, hostTop: number, clientHeight: number, topInset: number }): number {
    const line = input.hostTop + input.topInset + (input.clientHeight - input.topInset) / 3
    return input.targetTop - line
}

// A computed `scroll-padding-top` is a length, but jsdom gives '' and a browser can give 'auto'; neither is an inset.
export function parseInset(value: string): number {
    const parsed = parseFloat(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

// The first millisecond of a local calendar day from an `<input type="date">` value, or null when the text is not a real day.
export function localDayStart(value: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return null
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const date = new Date(year, month - 1, day)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
    return date.getTime()
}

export type DayTarget = { found: true, index: number } | { found: false }

// The first message stamped on or after the day. A message without a time is skipped; no such message means the day is after the last one.
export function indexForDay(messages: readonly { time?: number }[], dayStart: number): DayTarget {
    for (let index = 0; index < messages.length; index++) {
        const time = messages[index].time
        if (typeof time === 'number' && time >= dayStart) return { found: true, index }
    }
    return { found: false }
}

export function hasUntimed(messages: readonly { time?: number }[]): boolean {
    return messages.some((message) => typeof message.time !== 'number')
}

// The message index for a typed message number (1 is the first message after the greeting), or null when the text is not a number from 1 to `count`.
// Grouping commas and spaces are dropped first; every other character, a decimal point included, refuses the text.
export function parseMessageNumber(text: string, count: number): number | null {
    const digits = text.replace(/[,\s]/g, '')
    if (!/^[0-9]+$/.test(digits)) return null
    const number = Number(digits)
    return number >= 1 && number <= count ? number - 1 : null
}

const SNIPPET_CHARS = 70

export interface BookmarkEntry {
    chatId: string
    index: number
    label: string
}

export interface BookmarkSource {
    message: readonly { chatId?: string, data: string }[]
    bookmarks?: readonly string[]
    bookmarkNames?: { [chatId: string]: string }
}

// The bookmarks that still point at a message, in message order. `total` counts every resolved bookmark; `shown` is the first `limit`.
export function bookmarkEntries(chat: BookmarkSource, limit: number): { total: number, shown: BookmarkEntry[] } {
    const wanted = new Set(chat.bookmarks ?? [])
    const shown: BookmarkEntry[] = []
    let total = 0
    if (wanted.size === 0) return { total, shown }
    for (let index = 0; index < chat.message.length; index++) {
        const { chatId, data } = chat.message[index]
        if (!chatId || !wanted.has(chatId)) continue
        wanted.delete(chatId)
        total += 1
        if (shown.length < limit) shown.push({ chatId, index, label: chat.bookmarkNames?.[chatId] || data.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_CHARS) })
    }
    return { total, shown }
}
