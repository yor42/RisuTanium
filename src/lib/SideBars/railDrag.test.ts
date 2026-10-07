import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { folder } from '../../ts/storage/database.svelte'
import {
    AUTO_SCROLL_MAX_DT_MS,
    AUTO_SCROLL_MAX_PX_PER_S,
    CLICK_SUPPRESS_MS,
    LONG_PRESS_MS,
    MERGE_DWELL_MS,
    MOUSE_DRAG_THRESHOLD_PX,
    OUTSIDE_MARGIN_PX,
    SPRING_OPEN_MS,
    TOUCH_CONTEXTMENU_WINDOW_MS,
    TOUCH_SLOP_PX,
    edgeBandPx,
} from './railConstants'
import { computeLayout, type Layout } from './railLayout'
import { RailDrag, type PointerInfo, type RailEnv, type RailHost } from './railDrag'
import type { Target } from './railTarget'
import { charKey, contentY, folderKey, memberKey, outsideZonePoint, railItems, zonePoint } from './railTestKit'
import type { FolderRef, ItemRef } from './sidebarOrder'

const VIEW_H = 400
const COLUMN_X = 40

const folderOf = (id: string, data: string[]): folder => ({ id, name: id, color: '', data }) as folder

interface Drop {
    source: ItemRef
    target: Target
}

class Rig {
    layout!: Layout
    scrollTop = 0
    maxScroll = 10_000
    now = 1_000
    frameTime = 0
    timers = new Map<number, { at: number; fn: () => void }>()
    frames: Array<(t: number) => void> = []
    nextId = 1
    drops: Drop[] = []
    targets: Target[] = []
    springOpened: FolderRef[] = []
    touchMenus: FolderRef[] = []
    captured: number[] = []
    released: number[] = []
    sessions: boolean[] = []
    lifts = 0
    dragStarts = 0
    dragEnds = 0
    ghost: Array<[number, number]> = []
    machine: RailDrag
    order: Array<string | folder> = []
    open: string[] = []

    constructor(order: Array<string | folder>, open: string[] = []) {
        this.setOrder(order, open, false)
        const env: RailEnv = {
            now: () => this.now,
            setTimer: (fn, ms) => {
                const id = this.nextId++
                this.timers.set(id, { at: this.now + ms, fn })
                return id
            },
            clearTimer: (id) => {
                this.timers.delete(id)
            },
            requestFrame: (fn) => {
                this.frames.push(fn)
                return this.frames.length
            },
            cancelFrame: () => {
                this.frames = []
            },
        }
        const host: RailHost = {
            getLayout: () => this.layout,
            readRect: () => ({ left: 0, top: 0, width: 80, height: VIEW_H }),
            getScrollTop: () => this.scrollTop,
            getScrollMax: () => this.maxScroll,
            setScrollTop: (top) => {
                this.scrollTop = Math.max(0, Math.min(top, this.maxScroll))
            },
            captureTake: (id) => this.captured.push(id),
            captureRelease: (id) => this.released.push(id),
            onSession: (active) => this.sessions.push(active),
            onLift: () => {
                this.lifts++
            },
            onDragStart: () => {
                this.dragStarts++
            },
            onGhost: (x, y) => this.ghost.push([x, y]),
            onTarget: (target) => this.targets.push(target),
            onDragEnd: () => {
                this.dragEnds++
                this.targets.push({ kind: 'none' })
            },
            onDrop: (source, target) => this.drops.push({ source, target }),
            onSpringOpen: (f) => this.springOpened.push(f),
            onTouchMenu: (f) => this.touchMenus.push(f),
        }
        this.machine = new RailDrag(host, env)
    }

    setOrder(order: Array<string | folder>, open: string[] = this.open, notify = true): void {
        this.order = order
        this.open = open
        this.layout = computeLayout(railItems(order, { open }), new Map())
        if (notify) {
            this.machine.layoutChanged()
        }
    }

    get target(): Target {
        return this.targets.at(-1) ?? { kind: 'none' }
    }

    /** Advances the clock, firing timers that fall due in order. */
    advance(ms: number): void {
        const end = this.now + ms
        for (;;) {
            const due = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
            if (!due) {
                break
            }
            this.timers.delete(due[0])
            this.now = Math.max(this.now, due[1].at)
            due[1].fn()
        }
        this.now = end
    }

    /** Runs the queued animation frame callbacks `dt` ms after the previous frame. */
    frame(dt: number): void {
        this.frameTime += dt
        const pending = this.frames
        this.frames = []
        for (const fn of pending) {
            fn(this.frameTime)
        }
    }

    ptr(y: number, o: Partial<PointerInfo> = {}): PointerInfo {
        return { pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true, clientX: COLUMN_X, clientY: y, ...o }
    }

    /** Client y of the middle of an item at the current scroll position. */
    y(key: string, fraction = 0.5): number {
        return contentY(this.layout, key, fraction) - this.scrollTop
    }

    zone(key: string): number {
        return zonePoint(this.layout, key, VIEW_H, this.scrollTop)
    }

    press(key: string, o: Partial<PointerInfo> = {}): void {
        this.machine.pointerDown(this.ptr(this.y(key), o))
    }

    move(y: number, o: Partial<PointerInfo> = {}): void {
        this.machine.pointerMove(this.ptr(y, o))
    }

    release(y: number, o: Partial<PointerInfo> = {}): void {
        this.machine.pointerUp(this.ptr(y, o))
    }

    /** Presses `key` with the mouse and moves far enough to start the drag. */
    mouseDrag(key: string): void {
        this.press(key)
        this.move(this.y(key) + MOUSE_DRAG_THRESHOLD_PX)
    }

    /** Lifts `key` with a long touch press. */
    touchLift(key: string): void {
        this.press(key, { pointerType: 'touch' })
        this.advance(LONG_PRESS_MS)
    }
}

const A = charKey('A')
const B = charKey('B')
const C = charKey('C')
const D = charKey('D')
const refOf = (id: string): ItemRef => ({ kind: 'char', id, occurrence: 0 })

let rig: Rig

function gapAfterOf(t: Target): string | null | undefined {
    return t.kind === 'gap' ? (t.gap.after ? t.gap.after.id : null) : undefined
}

describe('mouse drag', () => {
    beforeEach(() => {
        rig = new Rig(['A', 'B', 'C', 'D'])
    })

    test('a move below the threshold starts nothing and takes no capture; the threshold starts the drag', () => {
        rig.press(C)
        rig.move(rig.y(C) + MOUSE_DRAG_THRESHOLD_PX - 1)
        expect(rig.machine.isDragging).toBe(false)
        expect(rig.captured).toEqual([])
        rig.move(rig.y(C) + MOUSE_DRAG_THRESHOLD_PX)
        expect(rig.machine.isDragging).toBe(true)
        expect(rig.captured).toEqual([1])
        expect(rig.dragStarts).toBe(1)
        expect(rig.lifts).toBe(0)
    })

    test('a press takes no capture, so a plain click reaches the row', () => {
        rig.press(C)
        rig.release(rig.y(C))
        expect(rig.captured).toEqual([])
        expect(rig.machine.consumeClick()).toBe(false)
    })

    test('dropping between A and B reorders', () => {
        rig.mouseDrag(C)
        rig.move(rig.y(A, 1) + 8)
        rig.release(rig.y(A, 1) + 8)
        expect(rig.drops).toHaveLength(1)
        expect(rig.drops[0].source).toEqual(refOf('C'))
        expect(gapAfterOf(rig.drops[0].target)).toBe('A')
        expect(rig.released).toEqual([1])
        expect(rig.dragEnds).toBe(1)
    })

    test('Escape ends the drag with no write and consumes the key', () => {
        rig.mouseDrag(C)
        rig.move(rig.y(A, 1) + 8)
        expect(rig.machine.keyDown('Escape')).toBe(true)
        expect(rig.drops).toEqual([])
        expect(rig.dragEnds).toBe(1)
        expect(rig.machine.isDragging).toBe(false)
        expect(rig.sessions.at(-1)).toBe(false)
    })

    test('keys are not consumed when no drag is running', () => {
        expect(rig.machine.keyDown('Escape')).toBe(false)
        rig.press(C)
        expect(rig.machine.keyDown('Escape')).toBe(false)
    })

    test('a middle or right button press and a non-primary pointer start nothing', () => {
        rig.press(C, { button: 1 })
        rig.press(C, { button: 2 })
        rig.press(C, { isPrimary: false })
        expect(rig.machine.isPressed).toBe(false)
        expect(rig.sessions).toEqual([])
    })

    test('a press on a gap or the plus block starts nothing', () => {
        rig.machine.pointerDown(rig.ptr(rig.layout.offsets[0] + 4))
        expect(rig.machine.isPressed).toBe(false)
        rig.machine.pointerDown(rig.ptr(rig.layout.total - 4))
        expect(rig.machine.isPressed).toBe(false)
    })

    test('a second pointer during a drag is ignored', () => {
        rig.mouseDrag(C)
        rig.machine.pointerDown(rig.ptr(rig.y(A), { pointerId: 2, pointerType: 'touch' }))
        rig.machine.pointerMove(rig.ptr(rig.y(B), { pointerId: 2 }))
        expect(rig.machine.isDragging).toBe(true)
        rig.machine.pointerUp(rig.ptr(rig.y(B), { pointerId: 2 }))
        expect(rig.machine.isDragging).toBe(true)
        expect(rig.drops).toEqual([])
    })
})

describe('targets and no-ops', () => {
    beforeEach(() => {
        rig = new Rig(['A', 'B', 'C', 'D'])
    })

    test('release on either gap next to the dragged row, or on its own row, writes nothing', () => {
        for (const y of [rig.y(C, 0) - 3, rig.y(C, 1) + 3, rig.y(C)]) {
            rig.mouseDrag(C)
            rig.move(y)
            expect(rig.target.kind === 'gap' ? rig.target.noop : true).toBe(true)
            rig.release(y)
        }
        expect(rig.drops).toEqual([])
    })

    test('the first release below the last row picks the gap after the last entry', () => {
        rig.mouseDrag(A)
        rig.move(rig.layout.total - 6)
        rig.release(rig.layout.total - 6)
        expect(gapAfterOf(rig.drops[0].target)).toBe('D')
    })

    test('above the first row picks the first gap', () => {
        rig.mouseDrag(D)
        rig.move(-20)
        rig.release(-20)
        expect(gapAfterOf(rig.drops[0].target)).toBeNull()
    })
})

describe('merge dwell', () => {
    beforeEach(() => {
        rig = new Rig(['A', 'B', 'C', 'D'])
    })

    test('resting in a character centre zone merges only after the dwell; the line shows until then', () => {
        rig.mouseDrag(C)
        rig.move(rig.zone(B))
        expect(rig.target.kind).toBe('gap')
        rig.advance(MERGE_DWELL_MS - 1)
        expect(rig.target.kind).toBe('gap')
        rig.advance(1)
        expect(rig.target).toMatchObject({ kind: 'merge', key: B })
        rig.release(rig.zone(B))
        expect(rig.drops).toHaveLength(1)
        expect(rig.drops[0].target).toMatchObject({ kind: 'merge', key: B })
    })

    test('releasing before the dwell drops into the nearest gap and never merges', () => {
        rig.mouseDrag(C)
        rig.move(rig.zone(B))
        rig.advance(MERGE_DWELL_MS - 1)
        rig.release(rig.zone(B))
        expect(rig.drops).toHaveLength(1)
        expect(rig.drops[0].target.kind).toBe('gap')
    })

    test('leaving and returning restarts the dwell from zero', () => {
        rig.mouseDrag(C)
        rig.move(rig.zone(B))
        rig.advance(MERGE_DWELL_MS - 50)
        rig.move(rig.y(B, 1) + 8)
        rig.advance(100)
        rig.move(rig.zone(B))
        rig.advance(MERGE_DWELL_MS - 1)
        expect(rig.target.kind).toBe('gap')
        rig.advance(1)
        expect(rig.target.kind).toBe('merge')
    })

    test('a pointer parked in the bottom edge band never arms, and arms after moving out into a zone', () => {
        rig = new Rig(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
        const row = charKey('F')
        const bandY = VIEW_H - 5
        // the centre zone of F reaches into the band at this scroll position
        rig.scrollTop = rig.y(row) - bandY
        rig.mouseDrag(charKey('A'))
        rig.move(bandY)
        rig.advance(MERGE_DWELL_MS * 3)
        expect(rig.target.kind).toBe('gap')
        expect(rig.machine.isDragging).toBe(true)
        rig.scrollTop = 0
        rig.move(rig.zone(B))
        rig.advance(MERGE_DWELL_MS - 1)
        expect(rig.target.kind).toBe('gap')
        rig.advance(1)
        expect(rig.target.kind).toBe('merge')
    })

    test('a wheel that slides another row under a stationary pointer clears the timer and does not arm', () => {
        rig.mouseDrag(D)
        rig.move(rig.zone(B))
        rig.advance(MERGE_DWELL_MS / 2)
        rig.scrollTop = rig.layout.offsets[rig.layout.indexByKey.get(C)!] - rig.layout.offsets[rig.layout.indexByKey.get(B)!]
        rig.machine.scrolled()
        rig.advance(MERGE_DWELL_MS * 2)
        expect(rig.target.kind).toBe('gap')
    })

    test('the same row staying under the pointer after a small scroll keeps the dwell', () => {
        rig.mouseDrag(D)
        rig.move(rig.zone(B))
        rig.scrollTop = 2
        rig.machine.scrolled()
        rig.advance(MERGE_DWELL_MS)
        expect(rig.target.kind).toBe('merge')
    })

    test('an armed merge ends when the row scrolls away from the pointer', () => {
        rig.mouseDrag(D)
        rig.move(rig.zone(B))
        rig.advance(MERGE_DWELL_MS)
        expect(rig.target.kind).toBe('merge')
        rig.scrollTop = 60
        rig.machine.scrolled()
        expect(rig.target.kind).toBe('gap')
        rig.release(rig.zone(B))
        expect(rig.drops[0].target.kind).toBe('gap')
    })

    test('moving the pointer by one pixel after the row changed does not re-arm until it leaves and re-enters a zone', () => {
        rig.mouseDrag(D)
        const pointerY = rig.zone(B)
        rig.move(pointerY)
        rig.scrollTop = rig.layout.offsets[rig.layout.indexByKey.get(C)!] - rig.layout.offsets[rig.layout.indexByKey.get(B)!]
        rig.machine.scrolled()
        rig.move(pointerY + 1)
        rig.advance(MERGE_DWELL_MS * 2)
        expect(rig.target.kind).toBe('gap')
        rig.move(rig.y(C, 1) + 10)
        rig.move(rig.zone(B))
        rig.advance(MERGE_DWELL_MS)
        expect(rig.target.kind).toBe('merge')
    })
})

describe('closed and open folders', () => {
    beforeEach(() => {
        rig = new Rig(['A', folderOf('f1', ['B', 'C']), 'D', folderOf('f2', ['E'])])
    })
    const F1 = folderKey('f1')
    const F2 = folderKey('f2')

    test('entering the folder centre zone shows the append highlight at once and a release appends', () => {
        rig.mouseDrag(A)
        rig.move(rig.zone(F1))
        expect(rig.target).toMatchObject({ kind: 'append', key: F1 })
        rig.release(rig.zone(F1))
        expect(rig.drops[0].target).toMatchObject({ kind: 'append', key: F1 })
    })

    test('a release on the folder row outside its centre zone drops into the nearest gap', () => {
        rig.mouseDrag(A)
        rig.move(outsideZonePoint(rig.layout, F1, 'upper'))
        expect(rig.target.kind).toBe('gap')
        rig.release(outsideZonePoint(rig.layout, F1, 'lower'))
        expect(rig.drops[0].target.kind).toBe('gap')
    })

    test('a pause opens a closed folder, after which a member gap is a target', () => {
        rig.mouseDrag(A)
        rig.move(rig.zone(F1))
        rig.advance(SPRING_OPEN_MS - 1)
        expect(rig.springOpened).toEqual([])
        rig.advance(1)
        expect(rig.springOpened).toEqual([{ kind: 'folder', id: 'f1', occurrence: 0 }])
        rig.setOrder(rig.order, ['f1'])
        expect(rig.target).toMatchObject({ kind: 'append', key: F1 })
        const secondMemberGapY = rig.y(memberKey('f1', 'C'), 1) + 8
        rig.move(secondMemberGapY)
        expect(rig.target).toMatchObject({ kind: 'gap', gap: { in: 'folder', after: { id: 'C' } } })
        rig.release(secondMemberGapY)
        expect(rig.drops[0].target).toMatchObject({ kind: 'gap', gap: { in: 'folder', after: { id: 'C' } } })
    })

    test('an open folder keeps its append highlight in its own centre zone', () => {
        rig.setOrder(rig.order, ['f1'])
        rig.mouseDrag(A)
        rig.move(rig.zone(F1))
        expect(rig.target).toMatchObject({ kind: 'append', key: F1 })
        rig.advance(SPRING_OPEN_MS * 2)
        expect(rig.springOpened).toEqual([])
        expect(rig.target).toMatchObject({ kind: 'append', key: F1 })
    })

    test('leaving the zone before the pause never opens the folder', () => {
        rig.mouseDrag(A)
        rig.move(rig.zone(F1))
        rig.advance(SPRING_OPEN_MS - 10)
        rig.move(outsideZonePoint(rig.layout, F1, 'upper'))
        rig.advance(SPRING_OPEN_MS)
        expect(rig.springOpened).toEqual([])
    })

    test('an auto-scroll that carries a folder zone under the parked pointer shows no highlight', () => {
        rig = new Rig(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', folderOf('f2', ['E2'])])
        const bandY = VIEW_H - 4
        rig.scrollTop = rig.y(F2) - bandY
        rig.mouseDrag(A)
        rig.move(bandY)
        rig.frame(16)
        rig.frame(16)
        expect(rig.target.kind).toBe('gap')
        rig.release(bandY)
        expect(rig.drops[0].target.kind).toBe('gap')
    })

    test('a wheel that slides a folder zone under a stationary pointer shows no highlight until the pointer re-enters it', () => {
        rig.mouseDrag(A)
        rig.move(rig.zone(D))
        rig.scrollTop = rig.layout.offsets[rig.layout.indexByKey.get(F2)!] - rig.layout.offsets[rig.layout.indexByKey.get(D)!]
        rig.machine.scrolled()
        expect(rig.target.kind).toBe('gap')
        rig.move(rig.zone(F2) + 1)
        expect(rig.target.kind).toBe('gap')
        rig.move(rig.y(F2, 1) + 10)
        rig.move(rig.zone(F2))
        expect(rig.target).toMatchObject({ kind: 'append', key: F2 })
    })

    test('opening a folder above shifts another folder under a stationary pointer without highlighting it', () => {
        rig = new Rig([folderOf('f0', ['X']), folderOf('f1', ['Y']), 'A', 'B'])
        const shifted = computeLayout(railItems(rig.order, { open: ['f0'] }), new Map())
        const pointerY = zonePoint(shifted, folderKey('f1'), VIEW_H)
        rig.mouseDrag(charKey('B'))
        rig.move(pointerY)
        expect(rig.target.kind).toBe('gap')
        rig.setOrder(rig.order, ['f0'])
        expect(rig.target.kind).toBe('gap')
        rig.move(pointerY + 1)
        expect(rig.target.kind).toBe('gap')
        rig.move(outsideZonePoint(rig.layout, folderKey('f1'), 'lower'))
        rig.move(pointerY)
        expect(rig.target).toMatchObject({ kind: 'append', key: folderKey('f1') })
        rig.release(pointerY)
        expect(rig.drops[0].target).toMatchObject({ kind: 'append', key: folderKey('f1') })
    })

    test('opening a folder above never arms a merge on the character that arrives under the pointer', () => {
        rig.mouseDrag(A)
        rig.move(rig.zone(D))
        rig.setOrder(rig.order, ['f1'])
        rig.advance(MERGE_DWELL_MS * 2)
        expect(rig.target.kind).toBe('gap')
    })
    test('a folder source never highlights, merges or opens a folder', () => {
        rig.mouseDrag(F1)
        rig.move(rig.zone(D))
        rig.advance(MERGE_DWELL_MS * 3)
        expect(rig.target.kind).toBe('gap')
        rig.move(rig.zone(F2))
        rig.advance(SPRING_OPEN_MS * 2)
        expect(rig.target.kind).toBe('gap')
        expect(rig.springOpened).toEqual([])
        rig.release(rig.zone(F2))
        const target = rig.drops[0].target
        expect(target.kind === 'gap' && target.gap.in).toBe('top')
    })
})

describe('members', () => {
    beforeEach(() => {
        rig = new Rig([folderOf('f1', ['A', 'B']), folderOf('f2', ['D']), 'C'], ['f1'])
    })
    const F1 = folderKey('f1')
    const MA = memberKey('f1', 'A')
    const MB = memberKey('f1', 'B')

    test('a member over its own folder row resolves to the nearest gap, never an append', () => {
        rig.mouseDrag(MA)
        rig.move(rig.zone(F1))
        expect(rig.target.kind).toBe('gap')
        rig.advance(MERGE_DWELL_MS + SPRING_OPEN_MS)
        expect(rig.target.kind).toBe('gap')
    })

    test('a member dropped on a top-level gap leaves its folder', () => {
        rig.mouseDrag(MB)
        const y = rig.y(C, 1) + 8
        rig.move(y)
        rig.release(y)
        expect(rig.drops[0].source).toMatchObject({ kind: 'member', id: 'B' })
        expect(rig.drops[0].target).toMatchObject({ kind: 'gap', gap: { in: 'top', after: { id: 'C' } } })
    })

    test('a top-level character dropped between members targets a folder gap and member rows never highlight', () => {
        rig.mouseDrag(C)
        rig.move(rig.zone(MB))
        rig.advance(MERGE_DWELL_MS * 3)
        expect(rig.target).toMatchObject({ kind: 'gap', gap: { in: 'folder' } })
        rig.release(rig.zone(MB))
        expect(rig.drops[0].target).toMatchObject({ kind: 'gap', gap: { in: 'folder' } })
    })

    test('a member over another folder row appends to it', () => {
        rig.mouseDrag(MA)
        rig.move(rig.zone(folderKey('f2')))
        expect(rig.target).toMatchObject({ kind: 'append', key: folderKey('f2') })
    })
})

describe('outside the column', () => {
    beforeEach(() => {
        rig = new Rig(['A', 'B', 'C', 'D'])
    })

    test('beyond the margin the target is none and a release writes nothing', () => {
        rig.mouseDrag(C)
        rig.machine.pointerMove(rig.ptr(rig.y(B), { clientX: 80 + OUTSIDE_MARGIN_PX + 1 }))
        expect(rig.target.kind).toBe('none')
        rig.machine.pointerUp(rig.ptr(rig.y(B), { clientX: 80 + OUTSIDE_MARGIN_PX + 1 }))
        expect(rig.drops).toEqual([])
    })

    test('within the margin the drag still has targets, on both sides', () => {
        rig.mouseDrag(C)
        rig.machine.pointerMove(rig.ptr(rig.y(B, 0.9), { clientX: 80 + OUTSIDE_MARGIN_PX }))
        expect(rig.target.kind).toBe('gap')
        rig.machine.pointerMove(rig.ptr(rig.y(B, 0.9), { clientX: -OUTSIDE_MARGIN_PX }))
        expect(rig.target.kind).toBe('gap')
        rig.machine.pointerMove(rig.ptr(rig.y(B, 0.9), { clientX: -OUTSIDE_MARGIN_PX - 1 }))
        expect(rig.target.kind).toBe('none')
    })

    test('an armed merge ends when the pointer leaves the column', () => {
        rig.mouseDrag(D)
        rig.move(rig.zone(B))
        rig.advance(MERGE_DWELL_MS)
        expect(rig.target.kind).toBe('merge')
        rig.machine.pointerMove(rig.ptr(rig.zone(B), { clientX: 400 }))
        expect(rig.target.kind).toBe('none')
    })

    test('auto-scroll stops while outside the column', () => {
        rig = new Rig(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
        rig.mouseDrag(A)
        rig.move(VIEW_H - 2)
        rig.frame(16)
        rig.frame(16)
        const scrolled = rig.scrollTop
        expect(scrolled).toBeGreaterThan(0)
        rig.machine.pointerMove(rig.ptr(VIEW_H - 2, { clientX: 400 }))
        rig.frame(16)
        rig.frame(16)
        expect(rig.scrollTop).toBe(scrolled)
        expect(rig.frames).toEqual([])
    })
})

describe('auto-scroll and keys', () => {
    beforeEach(() => {
        rig = new Rig(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
        rig.scrollTop = 100
    })

    test('the speed ramps with the depth into the band and is time based', () => {
        const band = edgeBandPx(VIEW_H)
        rig.mouseDrag(charKey('C'))
        rig.move(VIEW_H - band / 2)
        rig.frame(16)
        const start = rig.scrollTop
        rig.frame(20)
        const half = rig.scrollTop - start
        expect(half).toBeGreaterThanOrEqual(Math.floor((AUTO_SCROLL_MAX_PX_PER_S / 2) * 0.02) - 1)
        expect(half).toBeLessThanOrEqual(Math.ceil((AUTO_SCROLL_MAX_PX_PER_S / 2) * 0.02) + 1)
        rig.move(VIEW_H)
        rig.frame(16)
        const before = rig.scrollTop
        rig.frame(20)
        const full = rig.scrollTop - before
        expect(full).toBeGreaterThan(half)
    })

    test('the top band scrolls up and the middle of the viewport does not scroll', () => {
        rig.mouseDrag(charKey('C'))
        rig.move(2)
        rig.frame(16)
        rig.frame(16)
        expect(rig.scrollTop).toBeLessThan(100)
        const top = rig.scrollTop
        rig.move(VIEW_H / 2)
        expect(rig.frames).toEqual([])
        rig.frame(16)
        expect(rig.scrollTop).toBe(top)
    })

    test('a long gap between frames never jumps further than the clamp', () => {
        rig.mouseDrag(charKey('C'))
        rig.move(VIEW_H)
        rig.frame(16)
        const before = rig.scrollTop
        rig.frame(5000)
        expect(rig.scrollTop - before).toBeLessThanOrEqual(Math.ceil((AUTO_SCROLL_MAX_PX_PER_S * AUTO_SCROLL_MAX_DT_MS) / 1000))
    })

    test('leaving the band stops the loop and a drop cancels a queued frame', () => {
        rig.mouseDrag(charKey('C'))
        rig.move(VIEW_H)
        expect(rig.frames).toHaveLength(1)
        rig.move(VIEW_H / 2)
        expect(rig.frames).toEqual([])
        rig.move(VIEW_H)
        rig.release(VIEW_H)
        expect(rig.frames).toEqual([])
    })

    test('the hit test runs again each frame, so the target follows the scrolling list', () => {
        rig.mouseDrag(charKey('C'))
        rig.move(VIEW_H - 3)
        const first = rig.target
        for (let i = 0; i < 12; i++) {
            rig.frame(16)
        }
        expect(rig.target).not.toEqual(first)
    })

    test('PageDown, PageUp, Home and End scroll the container, and the target follows', () => {
        rig.mouseDrag(charKey('C'))
        rig.move(rig.y(charKey('C'), 1) + 8)
        const target = rig.target
        expect(rig.machine.keyDown('PageDown')).toBe(true)
        expect(rig.scrollTop).toBeGreaterThan(100)
        expect(rig.target).not.toEqual(target)
        expect(rig.machine.keyDown('PageUp')).toBe(true)
        expect(rig.machine.keyDown('Home')).toBe(true)
        expect(rig.scrollTop).toBe(0)
        expect(rig.machine.keyDown('End')).toBe(true)
        expect(rig.scrollTop).toBe(rig.maxScroll)
        expect(rig.machine.keyDown('a')).toBe(false)
    })
})

describe('edge bands that cannot scroll are inert', () => {
    test('the first character can be merge-targeted at its centre inside the top band at scrollTop 0', () => {
        rig = new Rig(['A', 'B', 'C', 'D'])
        expect(rig.y(A)).toBeLessThan(edgeBandPx(VIEW_H))
        rig.mouseDrag(D)
        rig.move(rig.y(A))
        expect(rig.frames).toEqual([])
        rig.advance(MERGE_DWELL_MS)
        expect(rig.target).toMatchObject({ kind: 'merge', key: A })
    })

    test('the top band scrolls again once the container has scrolled', () => {
        rig = new Rig(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
        rig.scrollTop = 50
        rig.mouseDrag(D)
        rig.move(2)
        expect(rig.frames).toHaveLength(1)
    })

    test('a folder whose centre zone lies in the bottom band is appended to while the container is at its maximum scroll', () => {
        rig = new Rig(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', folderOf('f1', ['X'])])
        const F = folderKey('f1')
        const bandY = VIEW_H - 5
        rig.scrollTop = contentY(rig.layout, F) - bandY
        rig.maxScroll = rig.scrollTop
        rig.mouseDrag(A)
        rig.move(bandY)
        expect(rig.frames).toEqual([])
        expect(rig.target).toMatchObject({ kind: 'append', key: F })
        rig.release(bandY)
        expect(rig.drops[0].target).toMatchObject({ kind: 'append', key: F })
    })

    test('the same zone in the bottom band does not highlight while the container can still scroll down', () => {
        rig = new Rig(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', folderOf('f1', ['X'])])
        const F = folderKey('f1')
        const bandY = VIEW_H - 5
        rig.scrollTop = contentY(rig.layout, F) - bandY
        rig.mouseDrag(A)
        rig.move(bandY)
        expect(rig.target.kind).toBe('gap')
    })

    test('a band that turns inert under a parked pointer does not arm the row that appears there', () => {
        rig = new Rig(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', folderOf('f1', ['X'])])
        const F = folderKey('f1')
        const bandY = VIEW_H - 5
        rig.scrollTop = contentY(rig.layout, F) - bandY - 40
        rig.mouseDrag(A)
        rig.move(bandY)
        rig.scrollTop += 40
        rig.maxScroll = rig.scrollTop
        rig.machine.scrolled()
        expect(rig.frames).toEqual([])
        expect(rig.target.kind).toBe('gap')
        rig.advance(SPRING_OPEN_MS * 2)
        expect(rig.springOpened).toEqual([])
    })

    test('auto-scroll stops once the maximum is reached', () => {
        rig = new Rig(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
        rig.maxScroll = 30
        rig.mouseDrag(A)
        rig.move(VIEW_H - 3)
        for (let i = 0; i < 20; i++) {
            rig.frame(16)
        }
        expect(rig.scrollTop).toBe(30)
        expect(rig.frames).toEqual([])
    })

    test('a list that fits has no band in either direction', () => {
        rig = new Rig(['A', 'B', 'C'])
        rig.maxScroll = 0
        rig.mouseDrag(C)
        rig.move(VIEW_H - 3)
        rig.move(2)
        expect(rig.frames).toEqual([])
        rig.move(rig.y(A))
        rig.advance(MERGE_DWELL_MS)
        expect(rig.target).toMatchObject({ kind: 'merge', key: A })
    })
})
describe('touch', () => {
    beforeEach(() => {
        rig = new Rig(['A', 'B', folderOf('f1', ['C']), 'D'])
    })

    test('a long-press lifts the row, takes capture, vibrates once and the touch move is held', () => {
        rig.press(B, { pointerType: 'touch' })
        expect(rig.machine.isDragging).toBe(false)
        expect(rig.machine.shouldPreventTouchMove()).toBe(false)
        rig.advance(LONG_PRESS_MS)
        expect(rig.machine.isDragging).toBe(true)
        expect(rig.captured).toEqual([1])
        expect(rig.lifts).toBe(1)
        expect(rig.machine.shouldPreventTouchMove()).toBe(true)
    })

    test('moving past the slop before the long-press leaves the scroll to the browser', () => {
        rig.press(B, { pointerType: 'touch' })
        rig.move(rig.y(B) + TOUCH_SLOP_PX, { pointerType: 'touch' })
        rig.advance(LONG_PRESS_MS * 2)
        expect(rig.machine.isDragging).toBe(false)
        expect(rig.machine.isPressed).toBe(false)
        expect(rig.captured).toEqual([])
        expect(rig.lifts).toBe(0)
    })

    test('a small drift inside the slop keeps the long-press pending', () => {
        rig.press(B, { pointerType: 'touch' })
        rig.move(rig.y(B) + TOUCH_SLOP_PX - 1, { pointerType: 'touch' })
        rig.advance(LONG_PRESS_MS)
        expect(rig.machine.isDragging).toBe(true)
    })

    test('a native scroll that cancels the pointer before the long-press ends the press', () => {
        rig.press(B, { pointerType: 'touch' })
        rig.machine.pointerCancel(rig.ptr(rig.y(B), { pointerType: 'touch' }))
        rig.advance(LONG_PRESS_MS * 2)
        expect(rig.machine.isDragging).toBe(false)
    })

    test('a lifted row dropped on a gap reorders', () => {
        rig.touchLift(B)
        rig.move(rig.y(D, 1) + 8, { pointerType: 'touch' })
        rig.release(rig.y(D, 1) + 8, { pointerType: 'touch' })
        expect(rig.drops).toHaveLength(1)
        expect(gapAfterOf(rig.drops[0].target)).toBe('D')
    })

    test('releasing a lifted folder without moving asks the host for the folder menu and writes nothing', () => {
        rig.touchLift(folderKey('f1'))
        rig.release(rig.y(folderKey('f1')), { pointerType: 'touch' })
        expect(rig.touchMenus).toEqual([{ kind: 'folder', id: 'f1', occurrence: 0 }])
        expect(rig.drops).toEqual([])
    })

    test('releasing a lifted folder after moving beyond the slop does not open the menu', () => {
        rig.touchLift(folderKey('f1'))
        rig.move(rig.y(folderKey('f1')) + TOUCH_SLOP_PX + 2, { pointerType: 'touch' })
        rig.release(rig.y(folderKey('f1')), { pointerType: 'touch' })
        expect(rig.touchMenus).toEqual([])
    })

    test('releasing a lifted character without moving selects nothing and opens no menu', () => {
        rig.touchLift(B)
        rig.release(rig.y(B), { pointerType: 'touch' })
        expect(rig.touchMenus).toEqual([])
        expect(rig.drops).toEqual([])
        expect(rig.machine.consumeClick()).toBe(true)
    })

    test('a pen uses the touch thresholds', () => {
        rig.press(B, { pointerType: 'pen' })
        rig.advance(LONG_PRESS_MS)
        expect(rig.machine.isDragging).toBe(true)
        expect(rig.lifts).toBe(1)
    })

    test('a mouse never long-press lifts', () => {
        rig.press(B)
        rig.advance(LONG_PRESS_MS * 3)
        expect(rig.machine.isDragging).toBe(false)
    })
})

describe('touch context menu window', () => {
    beforeEach(() => {
        rig = new Rig(['A', 'B'])
    })

    test('no touch pointer and none recently: a contextmenu is not touch-originated', () => {
        expect(rig.machine.isTouchContextMenu()).toBe(false)
    })

    test('while a touch pointer is down, even on a gap that starts no drag', () => {
        rig.machine.pointerDown(rig.ptr(rig.layout.offsets[0] + 4, { pointerType: 'touch' }))
        expect(rig.machine.isTouchContextMenu()).toBe(true)
    })

    test('after the gesture ends the window stays open for TOUCH_CONTEXTMENU_WINDOW_MS', () => {
        rig.press(A, { pointerType: 'touch' })
        rig.release(rig.y(A), { pointerType: 'touch' })
        rig.advance(100)
        expect(rig.machine.isTouchContextMenu()).toBe(true)
        rig.advance(TOUCH_CONTEXTMENU_WINDOW_MS - 100 - 1)
        expect(rig.machine.isTouchContextMenu()).toBe(true)
        rig.advance(101)
        expect(rig.machine.isTouchContextMenu()).toBe(false)
    })

    test('a pointercancel also closes the touch and opens the window', () => {
        rig.press(A, { pointerType: 'touch' })
        rig.machine.pointerCancel(rig.ptr(rig.y(A), { pointerType: 'touch' }))
        expect(rig.machine.isTouchContextMenu()).toBe(true)
        rig.advance(TOUCH_CONTEXTMENU_WINDOW_MS + 100)
        expect(rig.machine.isTouchContextMenu()).toBe(false)
    })

    test('a mouse press and release never open the window', () => {
        rig.press(A)
        rig.release(rig.y(A))
        expect(rig.machine.isTouchContextMenu()).toBe(false)
    })

    test.each(['', 'pen'])('a %j pointer is guarded while down and for the window after it ends', (pointerType) => {
        rig.press(A, { pointerType })
        expect(rig.machine.isTouchContextMenu()).toBe(true)
        rig.advance(LONG_PRESS_MS + 100)
        expect(rig.machine.isTouchContextMenu()).toBe(true)
        rig.release(rig.y(A), { pointerType })
        rig.advance(TOUCH_CONTEXTMENU_WINDOW_MS - 1)
        expect(rig.machine.isTouchContextMenu()).toBe(true)
        rig.advance(2)
        expect(rig.machine.isTouchContextMenu()).toBe(false)
    })

    test('a mouse press held past the long-press delay stays unguarded', () => {
        rig.press(A, { pointerType: 'mouse' })
        rig.advance(LONG_PRESS_MS + 100)
        expect(rig.machine.isTouchContextMenu()).toBe(false)
    })

    test('blur forgets a touch pointer whose end was never seen', () => {
        rig.press(A, { pointerType: 'touch' })
        rig.machine.interrupt()
        rig.advance(TOUCH_CONTEXTMENU_WINDOW_MS + 1)
        expect(rig.machine.isTouchContextMenu()).toBe(false)
    })
})

describe('click suppression', () => {
    beforeEach(() => {
        rig = new Rig(['A', 'B', 'C'])
    })

    test('the click after a completed drag is swallowed once', () => {
        rig.mouseDrag(C)
        rig.move(rig.y(A, 1) + 8)
        rig.release(rig.y(A, 1) + 8)
        expect(rig.machine.consumeClick()).toBe(true)
        expect(rig.machine.consumeClick()).toBe(false)
    })

    test('a tap CLICK_SUPPRESS_MS after a long-press drag is not swallowed', () => {
        rig.touchLift(B)
        rig.release(rig.y(B), { pointerType: 'touch' })
        rig.advance(CLICK_SUPPRESS_MS + 100)
        expect(rig.machine.consumeClick()).toBe(false)
    })

    test('the next pointerdown disarms it', () => {
        rig.touchLift(B)
        rig.release(rig.y(B), { pointerType: 'touch' })
        rig.press(A)
        expect(rig.machine.consumeClick()).toBe(false)
    })

    test('a cancelled drag also swallows the click that may follow', () => {
        rig.mouseDrag(C)
        rig.machine.keyDown('Escape')
        expect(rig.machine.consumeClick()).toBe(true)
    })

    test('a press that never became a drag arms nothing', () => {
        rig.press(C)
        rig.release(rig.y(C))
        expect(rig.machine.consumeClick()).toBe(false)
    })

    test('a touch tap that ended before the long-press arms nothing', () => {
        rig.press(C, { pointerType: 'touch' })
        rig.release(rig.y(C), { pointerType: 'touch' })
        expect(rig.machine.consumeClick()).toBe(false)
    })
})

describe('cancel paths', () => {
    beforeEach(() => {
        rig = new Rig(['A', 'B', 'C'])
    })

    const dragging = () => {
        rig.mouseDrag(C)
        rig.move(rig.y(A, 1) + 8)
        expect(rig.machine.isDragging).toBe(true)
    }

    const ended = () => {
        expect(rig.drops).toEqual([])
        expect(rig.machine.isDragging).toBe(false)
        expect(rig.machine.isPressed).toBe(false)
        expect(rig.dragEnds).toBe(1)
        expect(rig.sessions.at(-1)).toBe(false)
        expect(rig.frames).toEqual([])
        // only the one-shot click suppression may remain, and it expires without effect
        expect(rig.timers.size).toBeLessThanOrEqual(1)
        rig.advance(MERGE_DWELL_MS + SPRING_OPEN_MS + LONG_PRESS_MS)
        expect(rig.timers.size).toBe(0)
        expect(rig.springOpened).toEqual([])
        expect(rig.drops).toEqual([])
    }

    test('pointercancel', () => {
        dragging()
        rig.machine.pointerCancel(rig.ptr(0))
        ended()
    })

    test('lost pointer capture during the drag', () => {
        dragging()
        rig.machine.lostCapture({ pointerId: 1 })
        ended()
    })

    test('window blur or the page going hidden', () => {
        dragging()
        rig.machine.interrupt()
        ended()
    })

    test('destroy', () => {
        dragging()
        rig.machine.destroy()
        ended()
    })

    test('lostpointercapture after a drop or a cancel is a no-op', () => {
        dragging()
        rig.release(rig.y(A, 1) + 8)
        const dropsAfter = rig.drops.length
        rig.machine.lostCapture({ pointerId: 1 })
        expect(rig.drops).toHaveLength(dropsAfter)
        expect(rig.dragEnds).toBe(1)
    })

    test('a pending timer of an armed zone is cleared by every end', () => {
        rig.mouseDrag(C)
        rig.move(rig.zone(B))
        expect(rig.timers.size).toBeGreaterThan(0)
        rig.machine.interrupt()
        rig.advance(MERGE_DWELL_MS + SPRING_OPEN_MS)
        expect(rig.target.kind).toBe('none')
        expect(rig.springOpened).toEqual([])
        expect(rig.timers.size).toBe(0)
    })

    test('destroy during a pending long-press clears its timer', () => {
        rig.press(B, { pointerType: 'touch' })
        rig.machine.destroy()
        expect(rig.timers.size).toBe(0)
        rig.advance(LONG_PRESS_MS * 2)
        expect(rig.machine.isDragging).toBe(false)
        expect(rig.lifts).toBe(0)
    })

    test('a drag whose source leaves the order ends with no write', () => {
        dragging()
        rig.setOrder(['A', 'B'])
        ended()
    })

    test('a press whose source leaves the order is dropped', () => {
        rig.press(C)
        rig.setOrder(['A', 'B'])
        rig.move(rig.y(A) + 20)
        expect(rig.machine.isDragging).toBe(false)
    })

    test('the layout changing under a live drag keeps it alive and re-evaluates', () => {
        dragging()
        rig.setOrder(['A', 'B', 'C', 'D'])
        expect(rig.machine.isDragging).toBe(true)
    })

    test('the session callback is balanced across a drop', () => {
        dragging()
        rig.release(rig.y(A, 1) + 8)
        expect(rig.sessions).toEqual([true, false])
    })

    test('a drop that throws still ends the drag and releases everything', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const original = rig.drops.push.bind(rig.drops)
        rig.drops.push = () => {
            throw new Error('write failed')
        }
        dragging()
        rig.release(rig.y(A, 1) + 8)
        rig.drops.push = original
        expect(rig.machine.isDragging).toBe(false)
        expect(rig.dragEnds).toBe(1)
        expect(rig.sessions.at(-1)).toBe(false)
        spy.mockRestore()
    })
})

describe('source identity', () => {
    test('the source of a duplicate character is the occurrence pressed', () => {
        rig = new Rig(['A', 'B', 'A'])
        rig.mouseDrag(charKey('A', 1))
        rig.move(2)
        rig.release(2)
        expect(rig.drops[0].source).toEqual({ kind: 'char', id: 'A', occurrence: 1 })
        expect(gapAfterOf(rig.drops[0].target)).toBeNull()
    })
})