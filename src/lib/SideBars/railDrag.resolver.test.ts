import { describe, expect, test } from 'vitest'
import { MOUSE_DRAG_THRESHOLD_PX } from './railConstants'
import { RailDrag, type PointerInfo, type RailEnv, type RailHost } from './railDrag'
import { locate, computeLayout, type Layout } from './railLayout'
import { defaultGeometry, type RailGeometry } from './railResolver'
import { resolveTarget, zoneCandidateAt, type Target } from './railTarget'
import { charKey, contentY, railItems, zonePoint } from './railTestKit'
import type { ItemRef } from './sidebarOrder'

const VIEW_H = 400
const RECT_LEFT = 10
const RECT_TOP = 20

const layout: Layout = computeLayout(railItems(['a', 'b', 'c']), new Map())

const env: RailEnv = {
    now: () => 0,
    setTimer: () => 1,
    clearTimer: () => {},
    requestFrame: () => 1,
    cancelFrame: () => {},
}

function pointer(clientX: number, clientY: number): PointerInfo {
    return { pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true, clientX, clientY }
}

function rig(geometry?: RailGeometry) {
    const targets: Target[] = []
    const dragStarts: ItemRef[] = []
    let dragEnds = 0
    let current = layout
    const host: RailHost = {
        getLayout: () => current,
        readRect: () => ({ left: RECT_LEFT, top: RECT_TOP, width: 80, height: VIEW_H }),
        getScrollTop: () => 0,
        getScrollMax: () => 0,
        setScrollTop: () => {},
        captureTake: () => {},
        captureRelease: () => {},
        onSession: () => {},
        onLift: () => {},
        onDragStart: (source) => dragStarts.push(source),
        onGhost: () => {},
        onTarget: (target) => targets.push(target),
        onDragEnd: () => {
            dragEnds++
        },
        onDrop: () => {},
        onSpringOpen: () => {},
        onTouchMenu: () => {},
    }
    const machine = new RailDrag(host, env, geometry)
    return {
        machine,
        targets,
        dragStarts,
        dragEnds: () => dragEnds,
        setLayout: (next: Layout) => {
            current = next
        },
    }
}

describe('default geometry', () => {
    // G: the default resolver is the pre-existing list functions.
    test('G: sourceAt, hasKey, zoneCandidateAt and resolveTarget equal the list functions', () => {
        const source: ItemRef = { kind: 'char', id: 'a', occurrence: 0 }
        for (const key of ['a', 'b', 'c']) {
            const y = zonePoint(layout, charKey(key), VIEW_H)
            const index = locate(layout, y)
            expect(defaultGeometry.sourceAt(layout, 0, y)).toBe(layout.items[index])
            expect(defaultGeometry.zoneCandidateAt(layout, 123, y, source)).toEqual(zoneCandidateAt(layout, y, source))
            const input = { layout, y, source, outside: false, zoneKey: null, mergeArmed: false }
            expect(defaultGeometry.resolveTarget({ ...input, x: 123 })).toEqual(resolveTarget(input))
        }
        expect(defaultGeometry.sourceAt(computeLayout([], new Map()), 0, 0)).toBeUndefined()
        expect(defaultGeometry.hasKey(layout, charKey('a'))).toBe(true)
        expect(defaultGeometry.hasKey(layout, 'missing')).toBe(false)
    })
})

describe('RailDrag with a custom geometry', () => {
    const stubTarget: Target = { kind: 'append', ref: { kind: 'folder', id: 'f', occurrence: 0 }, key: charKey('c') }

    // F: fails when the machine ignores the geometry argument.
    test('F: the geometry decides the source, the target and the source-gone check', () => {
        const calls: string[] = []
        const seen: Array<{ x: number; y: number }> = []
        let keyPresent = true
        const geometry: RailGeometry = {
            sourceAt: (l, x, y) => {
                calls.push('sourceAt')
                seen.push({ x, y })
                return l.items[l.indexByKey.get(charKey('b'))!]
            },
            hasKey: () => {
                calls.push('hasKey')
                return keyPresent
            },
            zoneCandidateAt: (_l, x, y) => {
                calls.push('zoneCandidateAt')
                seen.push({ x, y })
                return null
            },
            resolveTarget: (input) => {
                calls.push('resolveTarget')
                seen.push({ x: input.x, y: input.y })
                return stubTarget
            },
        }
        const r = rig(geometry)
        const startX = 50
        const startY = contentY(layout, charKey('a')) + RECT_TOP
        r.machine.pointerDown(pointer(startX, startY))
        expect(calls).toEqual(['sourceAt'])
        expect(seen[0]).toEqual({ x: startX - RECT_LEFT, y: startY - RECT_TOP })

        r.machine.pointerMove(pointer(startX + MOUSE_DRAG_THRESHOLD_PX + 1, startY))
        expect(r.dragStarts).toEqual([{ kind: 'char', id: 'b', occurrence: 0 }])
        expect(calls).toEqual(['sourceAt', 'zoneCandidateAt', 'resolveTarget'])
        const moveX = startX + MOUSE_DRAG_THRESHOLD_PX + 1 - RECT_LEFT
        expect(seen.slice(1)).toEqual([
            { x: moveX, y: startY - RECT_TOP },
            { x: moveX, y: startY - RECT_TOP },
        ])
        expect(r.targets).toEqual([stubTarget])

        r.machine.layoutChanged()
        expect(calls[calls.length - 3]).toBe('hasKey')
        expect(r.dragEnds()).toBe(0)

        keyPresent = false
        r.machine.layoutChanged()
        expect(r.dragEnds()).toBe(1)
        expect(r.machine.isPressed).toBe(false)
    })

    // G: omitting the argument behaves as the default geometry.
    test('G: without a geometry the machine drags from the list layout', () => {
        const r = rig()
        const startY = contentY(layout, charKey('a')) + RECT_TOP
        r.machine.pointerDown(pointer(50, startY))
        r.machine.pointerMove(pointer(50 + MOUSE_DRAG_THRESHOLD_PX + 1, startY))
        expect(r.dragStarts).toEqual([{ kind: 'char', id: 'a', occurrence: 0 }])
        expect(r.machine.isDragging).toBe(true)
    })
})
