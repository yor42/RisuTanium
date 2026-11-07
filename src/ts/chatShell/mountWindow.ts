import { heldPin as heldPinFor, windowEnd } from './stepHold'

// The new shell mounts at most MOUNT_CAP message articles, counting the first message. Low power counts as off until it is detected.
export const MOUNT_CAP = 100
export const LOW_POWER_MOUNT_CAP = 60

export function mountCap(lowPower: boolean): number {
    return lowPower ? LOW_POWER_MOUNT_CAP : MOUNT_CAP
}

// The additional-page step read from the settings; the stored value is never written.
export function shellPages(setting: number, cap: number): number {
    return Math.min(setting, cap)
}

// The window page count: rows plus the first message (mounted only when every row down to 0 is) stay within the cap.
export function capPages(pages: number, cap: number): number {
    return Math.min(pages, cap - 1)
}

export function shellInitialPages(setting: number, cap: number): number {
    return capPages(shellPages(setting, cap), cap)
}

// The window is the rows `start` down to `end`, plus the first message when its position (-1) is the oldest. `bottom` is the
// absolute newest mounted index while the window is slid; null means the window tracks the newest message.
export type MountState = {
    bottom: number | null
    pages: number
}

export type ShellWindowInput = {
    fold: number
    length: number
    bottom: number | null
    pages: number
    pin: number | null
    pinnedStart: number
    holdCap: number
}

export type ShellWindow = {
    start: number
    end: number
    slid: boolean
    firstMounted: boolean
    windowPin: number
    hasOlder: boolean
    // Mounted articles: the existing rows from `end` to `start`, plus the first message when it is mounted.
    count: number
}

export function shellWindow(input: ShellWindowInput): ShellWindow {
    const { fold, length, bottom, pages, pin, pinnedStart, holdCap } = input
    const slid = fold < 0 && bottom !== null && bottom < length - 1
    const start = fold >= 0 ? fold : (slid ? (bottom as number) : length - 1)
    const held = heldPinFor(pin, pinnedStart, start, holdCap)
    const end = windowEnd(start, pages, held)
    // Without a fold an unslid window gives `pages > length - 1`, which is the old `length <= pages`; a fold keeps the old formula.
    const unpinnedFirst = fold >= 0 ? length <= pages : pages > start
    const firstMounted = held !== null ? held === -1 : unpinnedFirst
    const windowPin = unpinnedFirst ? -1 : Math.max(0, start - pages)
    const rows = Math.max(0, Math.min(start, length - 1) - end + 1)
    return { start, end, slid, firstMounted, windowPin, hasOlder: !unpinnedFirst, count: rows + (firstMounted ? 1 : 0) }
}

// A stale bottom (the chat shrank to it) means the window tracks the newest message again.
export function normalizeBottom(bottom: number | null, length: number): number | null {
    return bottom !== null && bottom >= length - 1 ? null : bottom
}

// The oldest mounted position: -1 when the first message is mounted, else the oldest row index.
function oldestPosition(start: number, pages: number): number {
    return pages > start ? -1 : start - pages
}

function articleCount(start: number, oldest: number): number {
    return start - oldest + 1
}

function bottomFor(start: number, length: number): number | null {
    return start >= length - 1 ? null : start
}

function wholeCount(value: number): number {
    return Math.max(0, Math.floor(value))
}

export type AppendInput = {
    fold: number
    previousLength: number
    length: number
    bottom: number | null
    pages: number
    following: boolean
    cap: number
}

// A message appended while the reader is not following never unmounts a mounted row: the window grows while it has room, then
// freezes with the newest message unmounted. A following reader, a fold and a slid window keep their state.
export function afterAppend(input: AppendInput): MountState {
    const { fold, previousLength, length, bottom, pages, following, cap } = input
    const unchanged: MountState = { bottom, pages }
    const added = length - previousLength
    if (fold >= 0 || following || added <= 0) return unchanged
    if (bottom !== null && bottom < previousLength - 1) return unchanged
    const start = previousLength - 1
    const room = Math.max(0, cap - articleCount(start, oldestPosition(start, pages)))
    const grown = Math.min(added, room)
    if (grown < added) return { bottom: start + grown, pages: pages + grown }
    return { bottom: null, pages: pages + grown }
}

export type SlideOlderInput = {
    start: number
    length: number
    additional: number
    cap: number
    offscreenNewer: number
    editorsOpen: boolean
}

export type SlideOlderResult = MountState & { trimmedNewer: number }

// Reading back: older rows mount, the newest fully off-screen rows unmount to stay within the cap. A window above the cap is
// trimmed before it grows. While an editor is open nothing unmounts, so growth stops at the cap.
export function slideOlder(state: MountState, input: SlideOlderInput): SlideOlderResult {
    const { start, length, additional, cap, editorsOpen } = input
    const trimmable = editorsOpen ? 0 : wholeCount(input.offscreenNewer)
    const oldest = oldestPosition(start, state.pages)
    const count = articleCount(start, oldest)
    const available = oldest >= 0 ? oldest + 1 : 0
    const excess = Math.min(trimmable, Math.max(0, count - cap))
    const afterExcess = count - excess
    const room = Math.max(0, cap - afterExcess) + (trimmable - excess)
    const grown = Math.min(wholeCount(additional), available, room)
    const trimmed = excess + Math.min(trimmable - excess, Math.max(0, afterExcess + grown - cap))
    const newStart = start - trimmed
    const newOldest = oldest >= 0 ? Math.max(-1, oldest - grown) : -1
    const pages = newOldest === -1 ? state.pages - trimmed + grown : newStart - newOldest
    return { bottom: bottomFor(newStart, length), pages, trimmedNewer: trimmed }
}

export type SlideNewerInput = {
    start: number
    length: number
    additional: number
    cap: number
    offscreenOlder: number
    editorsOpen: boolean
}

export type SlideNewerResult = MountState & { trimmedOlder: number }

// Reading forward: newer rows mount, the oldest fully off-screen articles (the first message counts as the oldest) unmount.
export function slideNewer(state: MountState, input: SlideNewerInput): SlideNewerResult {
    const { start, length, additional, cap, editorsOpen } = input
    const trimmable = editorsOpen ? 0 : wholeCount(input.offscreenOlder)
    const oldest = oldestPosition(start, state.pages)
    const count = articleCount(start, oldest)
    const available = Math.max(0, length - 1 - start)
    const excess = Math.min(trimmable, Math.max(0, count - cap))
    const afterExcess = count - excess
    const room = Math.max(0, cap - afterExcess) + (trimmable - excess)
    const grown = Math.min(wholeCount(additional), available, room)
    const trimmed = excess + Math.min(trimmable - excess, Math.max(0, afterExcess + grown - cap))
    const newStart = start + grown
    const newOldest = oldest + trimmed
    const pages = newOldest === -1 ? state.pages + grown : newStart - newOldest
    return { bottom: bottomFor(newStart, length), pages, trimmedOlder: trimmed }
}

export function newestWindow(initialPages: number, cap: number): MountState {
    return { bottom: null, pages: capPages(initialPages, cap) }
}

// A jump to `index` keeps today's window (every row from the target to the newest, plus a margin) when that fits under the cap,
// else slides the window to sit around the target.
export function jumpWindow(index: number, length: number, pages: number, cap: number): MountState {
    const needed = length - index + 5
    if (needed <= cap - 1) return { bottom: null, pages: capPages(Math.max(pages, needed), cap) }
    return { bottom: Math.min(length - 1, index + Math.floor(cap / 2)), pages: cap - 1 }
}

// A jump that leaves the newest message mounted and never moves the window off it only mounts more rows. Any other jump (from a slid
// window, or one that slides the window) unmounts rows. Under a fold the window never slides, so only its page count grows.
// A window above the cap (kept by a step hold) is also shrunk by the cap on the page count, so the jump must not lower `pages`.
export function jumpOnlyGrows(slid: boolean, folded: boolean, jumped: MountState, pages: number): boolean {
    return !slid && (folded || jumped.bottom === null) && jumped.pages >= pages
}

// The page count after a load-more click under a fold. While an editor is open nothing unmounts, so an over-cap window keeps its pages.
export function foldLoadMorePages(pages: number, folded: number, cap: number, editorsOpen: boolean): number {
    const next = capPages(pages + folded + 1, cap)
    return editorsOpen ? Math.max(pages, next) : next
}

export type TrimHeldInput = {
    start: number
    pages: number
    length: number
    cap: number
    offscreenNewer: number
    offscreenOlder: number
    editorsOpen: boolean
}

export type TrimHeldResult = MountState & { trimmedNewer: number, trimmedOlder: number }

// The commit trim after a step hold: down to the cap by unmounting the newest off-screen rows first, then the oldest. It stops
// when the off-screen rows run out, and does nothing while an editor is open.
export function trimHeld(input: TrimHeldInput): TrimHeldResult {
    const { start, pages, length, cap, editorsOpen } = input
    const oldest = oldestPosition(start, pages)
    const excess = editorsOpen ? 0 : Math.max(0, articleCount(start, oldest) - cap)
    const trimmedNewer = Math.min(excess, wholeCount(input.offscreenNewer))
    const trimmedOlder = Math.min(excess - trimmedNewer, wholeCount(input.offscreenOlder))
    const newStart = start - trimmedNewer
    const newOldest = oldest + trimmedOlder
    const newPages = newOldest === -1 ? pages - trimmedNewer : newStart - newOldest
    return { bottom: bottomFor(newStart, length), pages: newPages, trimmedNewer, trimmedOlder }
}
