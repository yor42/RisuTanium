import { describe, expect, it } from 'vitest'
import {
    LOW_POWER_MOUNT_CAP,
    MOUNT_CAP,
    afterAppend,
    capPages,
    foldLoadMorePages,
    jumpOnlyGrows,
    jumpWindow,
    mountCap,
    newestWindow,
    normalizeBottom,
    shellInitialPages,
    shellPages,
    shellWindow,
    slideNewer,
    slideOlder,
    trimHeld,
} from './mountWindow'

const CAP = 100

function windowOf(over: Partial<Parameters<typeof shellWindow>[0]>) {
    return shellWindow({ fold: -1, length: 1000, bottom: null, pages: 30, pin: null, pinnedStart: 0, holdCap: 50, ...over })
}

describe('mount cap selector', () => {
    it('U1: the cap is 100 normally and 60 in low power', () => {
        expect(MOUNT_CAP).toBe(100)
        expect(LOW_POWER_MOUNT_CAP).toBe(60)
        expect(mountCap(false)).toBe(100)
        expect(mountCap(true)).toBe(60)
    })
})

describe('settings clamps', () => {
    it('U2: shellPages clamps the additional-page step to the cap and keeps small values', () => {
        expect(shellPages(500, CAP)).toBe(100)
        expect(shellPages(30, CAP)).toBe(30)
        expect(shellPages(15, 60)).toBe(15)
        expect(shellPages(500, 60)).toBe(60)
    })

    it('U3: capPages keeps rows plus the first message within the cap', () => {
        expect(capPages(500, CAP)).toBe(99)
        expect(capPages(100, CAP)).toBe(99)
        expect(capPages(99, CAP)).toBe(99)
        expect(capPages(30, CAP)).toBe(30)
        expect(capPages(500, 60)).toBe(59)
    })

    it('U4: shellInitialPages is at most 99 at the normal cap', () => {
        expect(shellInitialPages(500, CAP)).toBe(99)
        expect(shellInitialPages(100, CAP)).toBe(99)
        expect(shellInitialPages(30, CAP)).toBe(30)
        expect(shellInitialPages(500, 60)).toBe(59)
    })
})

describe('shellWindow', () => {
    it('U5: an unslid window starts at the newest message and counts its rows', () => {
        const w = windowOf({})
        expect(w.start).toBe(999)
        expect(w.slid).toBe(false)
        expect(w.end).toBe(969)
        expect(w.firstMounted).toBe(false)
        expect(w.windowPin).toBe(969)
        expect(w.hasOlder).toBe(true)
        expect(w.count).toBe(31)
    })

    it('U5: a slid window starts at bottom and a chat that fits mounts the first message', () => {
        const slid = windowOf({ bottom: 600, pages: 99 })
        expect(slid.start).toBe(600)
        expect(slid.slid).toBe(true)
        expect(slid.end).toBe(501)
        expect(slid.count).toBe(100)

        const nearFirst = windowOf({ bottom: 50, pages: 99 })
        expect(nearFirst.firstMounted).toBe(true)
        expect(nearFirst.windowPin).toBe(-1)
        expect(nearFirst.hasOlder).toBe(false)
        expect(nearFirst.end).toBe(0)
        expect(nearFirst.count).toBe(52)

        const small = windowOf({ length: 20, pages: 30 })
        expect(small.start).toBe(19)
        expect(small.firstMounted).toBe(true)
        expect(small.count).toBe(21)
    })

    it('U5: a held pin decides the end and the first message', () => {
        const held = windowOf({ pin: 900, pinnedStart: 999 })
        expect(held.end).toBe(900)
        expect(held.firstMounted).toBe(false)
        expect(held.count).toBe(100)

        const pinnedFirst = windowOf({ pin: -1, pinnedStart: 999 })
        expect(pinnedFirst.end).toBe(0)
        expect(pinnedFirst.firstMounted).toBe(true)

        const dropped = windowOf({ pin: 900, pinnedStart: 940 })
        expect(dropped.end).toBe(969)
        expect(dropped.firstMounted).toBe(false)
    })

    it('U13: a fold ignores bottom', () => {
        const w = windowOf({ fold: 20, bottom: 600, pages: 30 })
        expect(w.start).toBe(20)
        expect(w.slid).toBe(false)
        expect(w.end).toBe(0)
    })

    it('U14: first-message rule per window kind', () => {
        const folded = windowOf({ fold: 20, length: 40, pages: 30 })
        expect(folded.firstMounted).toBe(false)
        expect(folded.windowPin).toBe(0)
        expect(folded.hasOlder).toBe(true)
        expect(windowOf({ fold: 20, length: 30, pages: 30 }).firstMounted).toBe(true)

        expect(windowOf({ length: 30, pages: 30 }).firstMounted).toBe(true)
        expect(windowOf({ length: 31, pages: 30 }).firstMounted).toBe(false)

        const slidFirst = windowOf({ bottom: 29, pages: 30 })
        expect(slidFirst.firstMounted).toBe(true)
        expect(slidFirst.windowPin).toBe(-1)
        expect(slidFirst.hasOlder).toBe(false)
        const slidNot = windowOf({ bottom: 30, pages: 30 })
        expect(slidNot.firstMounted).toBe(false)
        expect(slidNot.windowPin).toBe(0)
        expect(slidNot.hasOlder).toBe(true)
    })
})

describe('slideOlder', () => {
    it('U6: below the cap it grows by the step without trimming', () => {
        const r = slideOlder({ bottom: null, pages: 30 }, { start: 999, length: 1000, additional: 15, cap: CAP, offscreenNewer: 0, editorsOpen: false })
        expect(r).toEqual({ bottom: null, pages: 45, trimmedNewer: 0 })
    })

    it('U6: at the cap it trims the newest off-screen rows by the growth', () => {
        const r = slideOlder({ bottom: null, pages: 99 }, { start: 999, length: 1000, additional: 15, cap: CAP, offscreenNewer: 40, editorsOpen: false })
        expect(r).toEqual({ bottom: 984, pages: 99, trimmedNewer: 15 })
    })

    it('U6: growth is bounded by the off-screen rows it may trim', () => {
        const r = slideOlder({ bottom: null, pages: 99 }, { start: 999, length: 1000, additional: 15, cap: CAP, offscreenNewer: 5, editorsOpen: false })
        expect(r).toEqual({ bottom: 994, pages: 99, trimmedNewer: 5 })
        const none = slideOlder({ bottom: null, pages: 99 }, { start: 999, length: 1000, additional: 15, cap: CAP, offscreenNewer: 0, editorsOpen: false })
        expect(none).toEqual({ bottom: null, pages: 99, trimmedNewer: 0 })
    })

    it('U6: growth stops at the cap when the window is below it and nothing may be trimmed', () => {
        const r = slideOlder({ bottom: 120, pages: 60 }, { start: 120, length: 300, additional: 100, cap: CAP, offscreenNewer: 0, editorsOpen: false })
        expect(r).toEqual({ bottom: 120, pages: 99, trimmedNewer: 0 })
    })

    it('U6: reaching the first message mounts it and keeps bottom', () => {
        const r = slideOlder({ bottom: 50, pages: 40 }, { start: 50, length: 300, additional: 100, cap: CAP, offscreenNewer: 0, editorsOpen: false })
        expect(r).toEqual({ bottom: 50, pages: 51, trimmedNewer: 0 })
        const w = windowOf({ length: 300, bottom: r.bottom, pages: r.pages })
        expect(w.firstMounted).toBe(true)
        expect(w.count).toBe(52)
    })

    it('U6: an over-cap window is trimmed before it grows', () => {
        const r = slideOlder({ bottom: null, pages: 120 }, { start: 999, length: 1000, additional: 15, cap: CAP, offscreenNewer: 30, editorsOpen: false })
        expect(r).toEqual({ bottom: 969, pages: 99, trimmedNewer: 30 })
        const short = slideOlder({ bottom: null, pages: 120 }, { start: 999, length: 1000, additional: 15, cap: CAP, offscreenNewer: 5, editorsOpen: false })
        expect(short).toEqual({ bottom: 994, pages: 115, trimmedNewer: 5 })
    })

    it('U6: never grows past the oldest row and the first message', () => {
        const r = slideOlder({ bottom: null, pages: 5 }, { start: 5, length: 6, additional: 15, cap: CAP, offscreenNewer: 0, editorsOpen: false })
        expect(r.pages).toBe(5 + 1)
        expect(r.trimmedNewer).toBe(0)
    })

    it('U7: with an editor open nothing is trimmed and growth stops at the cap', () => {
        const below = slideOlder({ bottom: null, pages: 90 }, { start: 999, length: 1000, additional: 15, cap: CAP, offscreenNewer: 50, editorsOpen: true })
        expect(below).toEqual({ bottom: null, pages: 99, trimmedNewer: 0 })
        const atCap = slideOlder({ bottom: null, pages: 99 }, { start: 999, length: 1000, additional: 15, cap: CAP, offscreenNewer: 50, editorsOpen: true })
        expect(atCap).toEqual({ bottom: null, pages: 99, trimmedNewer: 0 })
        const over = slideOlder({ bottom: null, pages: 120 }, { start: 999, length: 1000, additional: 15, cap: CAP, offscreenNewer: 50, editorsOpen: true })
        expect(over).toEqual({ bottom: null, pages: 120, trimmedNewer: 0 })
    })
})

describe('slideNewer', () => {
    it('U8: at the cap it trims the oldest off-screen rows by the growth', () => {
        const r = slideNewer({ bottom: 600, pages: 99 }, { start: 600, length: 1000, additional: 15, cap: CAP, offscreenOlder: 50, editorsOpen: false })
        expect(r).toEqual({ bottom: 615, pages: 99, trimmedOlder: 15 })
    })

    it('U8: below the cap it grows without trimming and holds when nothing may be trimmed', () => {
        const below = slideNewer({ bottom: 200, pages: 30 }, { start: 200, length: 1000, additional: 15, cap: CAP, offscreenOlder: 0, editorsOpen: false })
        expect(below).toEqual({ bottom: 215, pages: 45, trimmedOlder: 0 })
        const stuck = slideNewer({ bottom: 600, pages: 99 }, { start: 600, length: 1000, additional: 15, cap: CAP, offscreenOlder: 0, editorsOpen: false })
        expect(stuck).toEqual({ bottom: 600, pages: 99, trimmedOlder: 0 })
    })

    it('U8: trimming reaches the first message first', () => {
        const r = slideNewer({ bottom: 50, pages: 99 }, { start: 50, length: 1000, additional: 60, cap: CAP, offscreenOlder: 20, editorsOpen: false })
        expect(r).toEqual({ bottom: 110, pages: 99, trimmedOlder: 12 })
        const w = windowOf({ bottom: r.bottom, pages: r.pages })
        expect(w.firstMounted).toBe(false)
        expect(w.count).toBe(100)
    })

    it('U9: bottom returns to null when the newest message is reached', () => {
        const r = slideNewer({ bottom: 990, pages: 99 }, { start: 990, length: 1000, additional: 15, cap: CAP, offscreenOlder: 50, editorsOpen: false })
        expect(r).toEqual({ bottom: null, pages: 99, trimmedOlder: 9 })
    })

    it('U9: an over-cap window is trimmed before it grows', () => {
        const r = slideNewer({ bottom: 600, pages: 120 }, { start: 600, length: 1000, additional: 15, cap: CAP, offscreenOlder: 30, editorsOpen: false })
        expect(r).toEqual({ bottom: 609, pages: 99, trimmedOlder: 30 })
    })

    it('U7: with an editor open nothing is trimmed and growth stops at the cap', () => {
        const below = slideNewer({ bottom: 600, pages: 90 }, { start: 600, length: 1000, additional: 15, cap: CAP, offscreenOlder: 50, editorsOpen: true })
        expect(below).toEqual({ bottom: 609, pages: 99, trimmedOlder: 0 })
        const atCap = slideNewer({ bottom: 600, pages: 99 }, { start: 600, length: 1000, additional: 15, cap: CAP, offscreenOlder: 50, editorsOpen: true })
        expect(atCap).toEqual({ bottom: 600, pages: 99, trimmedOlder: 0 })
    })
})

describe('newest and jump windows', () => {
    it('U10: newestWindow tracks the newest message with a clamped page count', () => {
        expect(newestWindow(500, CAP)).toEqual({ bottom: null, pages: 99 })
        expect(newestWindow(30, CAP)).toEqual({ bottom: null, pages: 30 })
    })

    it('U11: a nearby jump keeps an unslid window as today, capped', () => {
        expect(jumpWindow(980, 1000, 30, CAP)).toEqual({ bottom: null, pages: 30 })
        expect(jumpWindow(960, 1000, 30, CAP)).toEqual({ bottom: null, pages: 45 })
        expect(jumpWindow(906, 1000, 30, CAP)).toEqual({ bottom: null, pages: 99 })
        expect(jumpWindow(980, 1000, 150, CAP)).toEqual({ bottom: null, pages: 99 })
        expect(jumpWindow(5, 40, 30, CAP)).toEqual({ bottom: null, pages: 40 })
    })

    it('U11: a far jump slides the window around the target', () => {
        expect(jumpWindow(10, 1000, 30, CAP)).toEqual({ bottom: 60, pages: 99 })
        expect(jumpWindow(905, 1000, 30, CAP)).toEqual({ bottom: 955, pages: 99 })
        const r = jumpWindow(10, 1000, 30, CAP)
        const w = windowOf({ bottom: r.bottom, pages: r.pages })
        expect(w.count).toBeLessThanOrEqual(CAP)
        expect(w.end).toBeLessThanOrEqual(7)
        expect(w.start).toBeGreaterThanOrEqual(10)
    })
})

describe('trimHeld', () => {
    it('U12: trims the newest off-screen rows first, then the oldest, down to the cap', () => {
        const r = trimHeld({ start: 999, pages: 149, length: 1000, cap: CAP, offscreenNewer: 30, offscreenOlder: 100, editorsOpen: false })
        expect(r).toEqual({ bottom: 969, pages: 99, trimmedNewer: 30, trimmedOlder: 20 })
    })

    it('U12: older rows alone when no newer row is off-screen; the window stays unslid', () => {
        const r = trimHeld({ start: 999, pages: 149, length: 1000, cap: CAP, offscreenNewer: 0, offscreenOlder: 100, editorsOpen: false })
        expect(r).toEqual({ bottom: null, pages: 99, trimmedNewer: 0, trimmedOlder: 50 })
    })

    it('U12: it stops trimming when the off-screen rows run out', () => {
        const r = trimHeld({ start: 999, pages: 149, length: 1000, cap: CAP, offscreenNewer: 10, offscreenOlder: 10, editorsOpen: false })
        expect(r).toEqual({ bottom: 989, pages: 129, trimmedNewer: 10, trimmedOlder: 10 })
    })

    it('U12: a window at or below the cap is unchanged', () => {
        const r = trimHeld({ start: 999, pages: 99, length: 1000, cap: CAP, offscreenNewer: 50, offscreenOlder: 50, editorsOpen: false })
        expect(r).toEqual({ bottom: null, pages: 99, trimmedNewer: 0, trimmedOlder: 0 })
    })

    it('U12: an open editor keeps the whole held window', () => {
        const r = trimHeld({ start: 999, pages: 149, length: 1000, cap: CAP, offscreenNewer: 30, offscreenOlder: 100, editorsOpen: true })
        expect(r).toEqual({ bottom: null, pages: 149, trimmedNewer: 0, trimmedOlder: 0 })
    })

    it('U12: the first message is trimmed first on the old side and kept when only newer rows go', () => {
        const older = trimHeld({ start: 120, pages: 148, length: 300, cap: CAP, offscreenNewer: 0, offscreenOlder: 40, editorsOpen: false })
        expect(older).toEqual({ bottom: 120, pages: 99, trimmedNewer: 0, trimmedOlder: 22 })
        const newer = trimHeld({ start: 120, pages: 148, length: 300, cap: CAP, offscreenNewer: 22, offscreenOlder: 0, editorsOpen: false })
        expect(newer).toEqual({ bottom: 98, pages: 126, trimmedNewer: 22, trimmedOlder: 0 })
        const w = windowOf({ length: 300, bottom: newer.bottom, pages: newer.pages })
        expect(w.firstMounted).toBe(true)
        expect(w.count).toBe(100)
    })
})

describe('jumpOnlyGrows', () => {
    it('allows a jump that keeps the window on the newest message', () => {
        expect(jumpOnlyGrows(false, false, { bottom: null, pages: 60 }, 30)).toBe(true)
    })
    it('refuses a jump that slides the window', () => {
        expect(jumpOnlyGrows(false, false, { bottom: 560, pages: 99 }, 30)).toBe(false)
    })
    it('refuses any jump from a slid window, even one that returns to the newest message', () => {
        expect(jumpOnlyGrows(true, false, { bottom: null, pages: 60 }, 30)).toBe(false)
    })
    it('allows a jump under a fold, where the window never slides', () => {
        expect(jumpOnlyGrows(false, true, { bottom: 560, pages: 99 }, 30)).toBe(true)
    })
    it('refuses a jump that would lower the page count of a window above the cap', () => {
        expect(jumpOnlyGrows(false, false, { bottom: null, pages: 99 }, 120)).toBe(false)
        expect(jumpOnlyGrows(false, true, { bottom: null, pages: 99 }, 120)).toBe(false)
    })
    it('allows a jump that keeps the page count of a window above the cap', () => {
        expect(jumpOnlyGrows(false, false, { bottom: null, pages: 120 }, 120)).toBe(true)
    })
})

describe('foldLoadMorePages', () => {
    it('adds the folded rows and caps at the window page limit when no editor is open', () => {
        expect(foldLoadMorePages(30, 20, CAP, false)).toBe(51)
        expect(foldLoadMorePages(90, 20, CAP, false)).toBe(99)
        expect(foldLoadMorePages(120, 20, CAP, false)).toBe(99)
    })
    it('never lowers the page count while an editor is open', () => {
        expect(foldLoadMorePages(120, 20, CAP, true)).toBe(120)
        expect(foldLoadMorePages(30, 20, CAP, true)).toBe(51)
    })
})

describe('normalizeBottom', () => {
    it('U15: bottom at or past the newest message becomes null', () => {
        expect(normalizeBottom(600, 1000)).toBe(600)
        expect(normalizeBottom(998, 1000)).toBe(998)
        expect(normalizeBottom(999, 1000)).toBeNull()
        expect(normalizeBottom(1200, 1000)).toBeNull()
        expect(normalizeBottom(null, 1000)).toBeNull()
    })
})

describe('afterAppend', () => {
    const base = { fold: -1, previousLength: 200, length: 201, bottom: null, pages: 30, following: false, cap: CAP }

    it('U16: a following reader, a fold and a slid window are unchanged', () => {
        expect(afterAppend({ ...base, following: true })).toEqual({ bottom: null, pages: 30 })
        expect(afterAppend({ ...base, fold: 20 })).toEqual({ bottom: null, pages: 30 })
        expect(afterAppend({ ...base, previousLength: 1000, length: 1001, bottom: 600, pages: 99 })).toEqual({ bottom: 600, pages: 99 })
    })

    it('U16: a window with room grows by the number of added messages', () => {
        expect(afterAppend(base)).toEqual({ bottom: null, pages: 31 })
        expect(afterAppend({ ...base, length: 203 })).toEqual({ bottom: null, pages: 33 })
    })

    it('U16: a stale bottom at the newest message counts as unslid', () => {
        expect(afterAppend({ ...base, bottom: 199 })).toEqual({ bottom: null, pages: 31 })
    })

    it('U16: partial room grows then freezes the window below the new messages', () => {
        const full = afterAppend({ ...base, previousLength: 1000, length: 1001, pages: 99 })
        expect(full).toEqual({ bottom: 999, pages: 99 })
        const partial = afterAppend({ ...base, previousLength: 1000, length: 1003, pages: 98 })
        expect(partial).toEqual({ bottom: 1000, pages: 99 })
    })

    it('U16: the first message stays mounted while the window grows or freezes', () => {
        const grown = afterAppend({ ...base, previousLength: 20, length: 22 })
        expect(grown).toEqual({ bottom: null, pages: 32 })
        expect(windowOf({ length: 22, bottom: grown.bottom, pages: grown.pages }).firstMounted).toBe(true)

        const frozen = afterAppend({ ...base, previousLength: 98, length: 101, pages: 99 })
        expect(frozen).toEqual({ bottom: 98, pages: 100 })
        const w = windowOf({ length: 101, bottom: frozen.bottom, pages: frozen.pages })
        expect(w.firstMounted).toBe(true)
        expect(w.count).toBe(100)
    })

    it('U16: no added message changes nothing', () => {
        expect(afterAppend({ ...base, length: 200 })).toEqual({ bottom: null, pages: 30 })
    })
})
