import { describe, expect, it } from 'vitest'
import { ARM_CREEP_PX, ARM_HOLD_MS, ARM_SLACK_DP, ARM_TREMOR_PX, ARM_TREMOR_PX_MS, createSwipeGesture, createWheelSteps, meterFill, peekNeighbour, peekText, SWIPE_REST_LAG_MS, SWIPE_VELOCITY_WINDOW_MS, type SwipeOptions, type SwipeResult } from './swipeGesture'

const base: SwipeOptions = { widthPx: 300, dpPerPx: 1, index: 1, count: 3, pointerType: 'touch' }
const p = (x: number, y: number, time: number) => ({ x, y, time })

describe('T10 swipe gesture', () => {
    it('requires 10 px slop and a horizontal axis before stepping', () => {
        const swipe = createSwipeGesture(base)
        swipe.down(p(200, 0, 0))
        expect(swipe.move(p(191, 0, 20)).locked).toBe(false)
        expect(swipe.up(p(191, 0, 40)).event).toBe('none')
        swipe.down(p(200, 0, 100))
        expect(swipe.move(p(188, 30, 120)).locked).toBe(false)
        expect(swipe.up(p(0, 30, 200)).event).toBe('none')
        swipe.down(p(200, 0, 300))
        expect(swipe.move(p(180, 2, 320)).locked).toBe(true)
        expect(swipe.up(p(100, 2, 500)).event).toBe('stepNext')
    })
    it('commits a neighbour by fling but never steps past an edge', () => {
        const swipe = createSwipeGesture(base)
        swipe.down(p(100, 0, 0))
        swipe.move(p(98, 0, 40))
        swipe.move(p(80, 0, 100))
        expect(swipe.up(p(50, 0, 120)).event).toBe('stepNext')
        const first = createSwipeGesture({ ...base, index: 0 })
        first.down(p(100, 0, 0))
        first.move(p(120, 0, 100))
        expect(first.up(p(250, 0, 200)).event).toBe('none')
    })
    it('arms only after 160 dp and 300 ms of stillness, then generates on a slow release', () => {
        const swipe = createSwipeGesture({ ...base, index: 2, dpPerPx: 2 })
        swipe.down(p(200, 0, 0))
        expect(swipe.move(p(119, 0, 100)).event).toBe('none')
        expect(swipe.move(p(119, 0, 200)).progress).toBeCloseTo(0.7)
        expect(swipe.move(p(119, 0, 499)).event).toBe('none')
        expect(swipe.move(p(119, 0, 500)).event).toBe('arm')
        expect(swipe.up(p(119, 0, 600)).event).toBe('generate')
    })
    it('kills M7: a fling cannot arm, including a release after reaching the distance', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(200, 0, 0))
        expect(swipe.move(p(0, 0, 20)).event).toBe('none')
        expect(swipe.up(p(-10, 0, 30)).event).toBe('none')
    })
    it('kills M8: cancellation while armed disarms without generation', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(200, 0, 0))
        swipe.move(p(20, 0, 100))
        swipe.move(p(20, 0, 200))
        expect(swipe.move(p(20, 0, 500)).event).toBe('arm')
        expect(swipe.cancel().event).toBe('none')
        expect(swipe.up(p(20, 0, 600)).event).toBe('none')
    })
    it('rejects a fast release from an armed pull and never arms the first message', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(120, 0, 100)); swipe.move(p(120, 0, 200))
        expect(swipe.move(p(120, 0, 500)).event).toBe('arm')
        swipe.move(p(80, 0, 520)); swipe.move(p(40, 0, 550)); swipe.move(p(10, 0, 580))
        expect(swipe.up(p(0, 0, 590)).event).toBe('none')
        const first = createSwipeGesture({ ...base, index: 2, firstMessage: true })
        first.down(p(300, 0, 0)); first.move(p(120, 0, 100)); first.move(p(120, 0, 200))
        expect(first.move(p(120, 0, 500)).event).toBe('none')
        expect(first.up(p(120, 0, 600)).event).toBe('none')
    })
    it('disarms when sliding back and ignores edge, mouse and streaming starts', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(200, 0, 0)); swipe.move(p(20, 0, 100)); swipe.move(p(20, 0, 200))
        expect(swipe.move(p(20, 0, 500)).event).toBe('arm')
        expect(swipe.move(p(50, 0, 600)).progress).toBeLessThan(0.7)
        expect(swipe.up(p(50, 0, 700)).event).toBe('none')
        for (const option of [{ edge: true }, { pointerType: 'mouse' as const }, { enabled: false }]) {
            const blocked = createSwipeGesture({ ...base, index: 2, ...option })
            blocked.down(p(200, 0, 0)); blocked.move(p(0, 0, 100)); blocked.move(p(0, 0, 200))
            expect(blocked.move(p(0, 0, 500)).event).toBe('none')
            expect(blocked.up(p(0, 0, 600)).event).toBe('none')
        }
        const streaming = createSwipeGesture({ ...base, streaming: true })
        streaming.down(p(200, 0, 0)); streaming.move(p(100, 0, 100))
        expect(streaming.up(p(0, 0, 200)).event).toBe('none')
    })
    it('arms from the hold timer when the finger stops without another pointer event, and generates on release', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0))
        expect(swipe.move(p(100, 0, 100)).event).toBe('none')
        expect(swipe.tick(399).event).toBe('none')
        const armed = swipe.tick(400)
        expect(armed.event).toBe('arm')
        expect(armed.progress).toBe(1)
        expect(swipe.up(p(100, 0, 700)).event).toBe('generate')
    })
    it('does not arm from the timer before the distance, after a cancel, or where the pull cannot generate', () => {
        const short = createSwipeGesture({ ...base, index: 2 })
        short.down(p(300, 0, 0)); short.move(p(200, 0, 100))
        expect(short.tick(2000).event).toBe('none')
        const cancelled = createSwipeGesture({ ...base, index: 2 })
        cancelled.down(p(300, 0, 0)); cancelled.move(p(100, 0, 100)); cancelled.cancel()
        expect(cancelled.tick(2000).event).toBe('none')
        for (const option of [{ canGenerate: false }, { firstMessage: true }, { streaming: true }, { edge: true }]) {
            const blocked = createSwipeGesture({ ...base, index: 2, ...option })
            blocked.down(p(300, 0, 0)); blocked.move(p(100, 0, 100))
            expect(blocked.tick(2000).event).toBe('none')
            expect(blocked.up(p(100, 0, 2100)).event).toBe('none')
        }
    })
    it('reports the armed state and keeps the cue at full progress through finger jitter, so the release matches the cue', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(100, 0, 100))
        const armed = swipe.tick(400)
        expect(armed).toMatchObject({ event: 'arm', armed: true, progress: 1 })
        for (const jitter of [p(102, 0, 408), p(98, 0, 416), p(101, 0, 420)]) {
            expect(swipe.move(jitter)).toMatchObject({ event: 'none', armed: true, progress: 1 })
        }
        expect(swipe.up(p(101, 0, 900)).event).toBe('generate')
    })
    it('drops the armed state when the finger slides back under the distance', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(100, 0, 100)); swipe.tick(400)
        expect(swipe.move(p(200, 0, 600))).toMatchObject({ armed: false })
        expect(swipe.up(p(200, 0, 900)).event).toBe('none')
    })
    it('a timer arm followed by a fling release still does not generate', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(100, 0, 100))
        expect(swipe.tick(500).event).toBe('arm')
        swipe.move(p(-60, 0, 505))
        expect(swipe.up(p(-200, 0, 510)).event).toBe('none')
    })
    it('a short fast flick steps although the lift lands at the last move position a few ms later', () => {
        const swipe = createSwipeGesture(base)
        swipe.down(p(200, 0, 0)); swipe.move(p(180, 0, 10)); swipe.move(p(165, 0, 30)); swipe.move(p(150, 0, 50))
        expect(swipe.up(p(150, 0, 54)).event).toBe('stepNext')
        const back = createSwipeGesture(base)
        back.down(p(100, 0, 0)); back.move(p(120, 0, 10)); back.move(p(135, 0, 30)); back.move(p(150, 0, 50))
        expect(back.up(p(150, 0, 54)).event).toBe('stepPrev')
    })
    it('guard: a flick whose lift shares the last move time and position still steps', () => {
        const swipe = createSwipeGesture(base)
        swipe.down(p(200, 0, 0)); swipe.move(p(180, 0, 10)); swipe.move(p(165, 0, 30)); swipe.move(p(150, 0, 50))
        expect(swipe.up(p(150, 0, 50)).event).toBe('stepNext')
    })
    it('an armed pull followed by a fast flick whose lift lands at the last move position does not generate', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(100, 0, 100))
        expect(swipe.tick(500).event).toBe('arm')
        swipe.move(p(-120, 0, 505)); swipe.move(p(-200, 0, 515))
        expect(swipe.up(p(-200, 0, 519)).event).toBe('none')
    })
    it('guard: a drag that rests longer than the velocity window before the lift neither steps nor flings', () => {
        const swipe = createSwipeGesture(base)
        swipe.down(p(200, 0, 0)); swipe.move(p(170, 0, 5)); swipe.move(p(115, 0, 10))
        expect(swipe.up(p(115, 0, 95)).event).toBe('none')
    })
    it('steps on a fast flick whose moves are sparse and whose last move sits at the lift position', () => {
        const sparse = createSwipeGesture(base)
        sparse.down(p(300, 0, 0)); sparse.move(p(270, 0, 50)); sparse.move(p(220, 0, 130))
        expect(sparse.up(p(220, 0, 140)).event).toBe('stepNext')
        const batched = createSwipeGesture(base)
        batched.down(p(300, 0, 0)); batched.move(p(285, 0, 40)); batched.move(p(260, 0, 80)); batched.move(p(225, 0, 120))
        expect(batched.up(p(225, 0, 130)).event).toBe('stepNext')
        const settled = createSwipeGesture(base)
        settled.down(p(300, 0, 0)); settled.move(p(285, 0, 20)); settled.move(p(220, 0, 100)); settled.move(p(215, 0, 140))
        expect(settled.up(p(215, 0, 150)).event).toBe('stepNext')
    })
    it('steps on a fast drag of one move whose lift comes 90 ms after the press', () => {
        const swipe = createSwipeGesture(base)
        swipe.down(p(200, 0, 0)); swipe.move(p(130, 0, 50))
        expect(swipe.up(p(130, 0, 90)).event).toBe('stepNext')
    })
    it('guard: a fast burst followed by a short gap before the lift at the last move position still steps', () => {
        const swipe = createSwipeGesture(base)
        swipe.down(p(300, 0, 0))
        for (let step = 1; step <= 10; step++) swipe.move(p(300 - step * 9, 0, step * 10))
        expect(swipe.up(p(210, 0, 130)).event).toBe('stepNext')
    })
    it('guard: a long slow drag, and a fast drag, followed by a pause longer than the window, do not fling', () => {
        const slow = createSwipeGesture(base)
        slow.down(p(200, 0, 0))
        for (let step = 1; step <= 10; step++) slow.move(p(200 - step * 6, 0, step * 100))
        expect(slow.up(p(140, 0, 1000 + SWIPE_VELOCITY_WINDOW_MS + 40)).event).toBe('none')
        const fast = createSwipeGesture(base)
        fast.down(p(200, 0, 0)); fast.move(p(155, 0, 50)); fast.move(p(112, 0, 60))
        expect(fast.up(p(112, 0, 60 + SWIPE_VELOCITY_WINDOW_MS + 5)).event).toBe('none')
    })
    it('guard: an armed pull released fast after sparse moves still does not generate', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(100, 0, 100))
        expect(swipe.tick(500).event).toBe('arm')
        swipe.move(p(60, 0, 505)); swipe.move(p(-100, 0, 590))
        expect(swipe.up(p(-100, 0, 600)).event).toBe('none')
    })
    it('an armed hold followed by a short fast release does not generate although the span over the hold reads slow', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(100, 0, 100))
        for (const now of [200, 300]) expect(swipe.tick(now).event).toBe('none')
        expect(swipe.tick(400).event).toBe('arm')
        swipe.move(p(-40, 0, 505))
        expect(swipe.up(p(-100, 0, 510)).event).toBe('none')
    })
    it('an armed hold followed by a 200 px release over 30 ms (lift 431 ms after the last move) does not generate', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(100, 0, 100))
        for (const now of [200, 300]) expect(swipe.tick(now).event).toBe('none')
        expect(swipe.tick(400).event).toBe('arm')
        swipe.move(p(-20, 0, 510)); swipe.move(p(-60, 0, 520)); swipe.move(p(-100, 0, 530))
        expect(swipe.up(p(-100, 0, 531)).event).toBe('none')
    })
    it('guard: a slow deliberate release after an armed hold still generates', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(100, 0, 100))
        for (const now of [200, 300]) swipe.tick(now)
        expect(swipe.tick(400).event).toBe('arm')
        swipe.move(p(90, 0, 600))
        expect(swipe.up(p(80, 0, 700)).event).toBe('generate')
    })
    it('guard: a frequently ticked hold released at the hold position still generates', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(100, 0, 100))
        for (let now = 110; now <= 290; now += 10) swipe.tick(now)
        expect(swipe.tick(400).event).toBe('arm')
        expect(swipe.up(p(100, 0, 1000)).event).toBe('generate')
    })
    it('wheel accumulation steps once per gesture and never generates at N/N', () => {
        const wheel = createWheelSteps(1, 3)
        expect(wheel({ dx: -20, dy: 0, time: 0 })).toBe('none')
        expect(wheel({ dx: -21, dy: 0, time: 20 })).toBe('stepNext')
        expect(wheel({ dx: -80, dy: 0, time: 30 })).toBe('none')
        expect(wheel({ dx: -50, dy: 0, time: 600 })).toBe('none')
        const vertical = createWheelSteps(1, 3)
        expect(vertical({ dx: 40, dy: 21, time: 0 })).toBe('none')
        const shifted = createWheelSteps(1, 3)
        expect(shifted({ dx: 0, dy: 40, shiftKey: true, time: 0 })).toBe('stepPrev')
    })
    it('one continuous gesture steps once although the position is moved between its events', () => {
        const wheel = createWheelSteps(0, 4)
        const events: string[] = []
        for (let i = 0; i < 20; i++) {
            events.push(wheel({ dx: -15, dy: 0, time: i * 20 }))
            wheel.set(i === 0 ? 0 : 1, 4)
        }
        expect(events.filter((event) => event === 'stepNext')).toHaveLength(1)
        expect(events.filter((event) => event !== 'none' && event !== 'stepNext')).toEqual([])
    })
    it('after the position is moved the 450 ms lock still holds and a gap of 160 ms ends the gesture', () => {
        const wheel = createWheelSteps(0, 4)
        expect(wheel({ dx: -50, dy: 0, time: 1000 })).toBe('stepNext')
        wheel.set(1, 4)
        expect(wheel({ dx: -50, dy: 0, time: 1200 })).toBe('none')
        wheel.set(1, 4)
        expect(wheel({ dx: -50, dy: 0, time: 1440 })).toBe('none')
        wheel.set(1, 4)
        expect(wheel({ dx: -50, dy: 0, time: 1460 })).toBe('stepNext')
    })
    it('a position set to the last alternative never steps past it, and a single alternative never steps', () => {
        const wheel = createWheelSteps(0, 4)
        wheel.set(3, 4)
        expect(wheel({ dx: -80, dy: 0, time: 0 })).toBe('none')
        wheel.set(0, 1)
        expect(wheel({ dx: -80, dy: 0, time: 1000 })).toBe('none')
        expect(wheel({ dx: 80, dy: 0, time: 2000 })).toBe('none')
    })
})

describe('swipe feedback helpers (CHORE-727)', () => {
    it('fills the meter continuously, in quarter steps where motion is reduced or power is low, and full when armed', () => {
        expect(meterFill(0.35, false, false)).toBeCloseTo(0.35)
        expect(meterFill(0.35, false, true)).toBe(0.25)
        expect(meterFill(0.74, false, true)).toBe(0.5)
        expect(meterFill(0.99, false, true)).toBe(0.75)
        expect(meterFill(0.2, true, false)).toBe(1)
        expect(meterFill(0.2, true, true)).toBe(1)
        expect(meterFill(-1, false, false)).toBe(0)
        expect(meterFill(3, false, false)).toBe(1)
    })
    it('names the neighbour a drag reveals by its 1-based position, and none past an end or while streaming', () => {
        expect(peekNeighbour(-30, 2, 3, false)).toBe(3)
        expect(peekNeighbour(30, 2, 3, false)).toBe(1)
        expect(peekNeighbour(30, 1, 3, false)).toBeNull()
        expect(peekNeighbour(-30, 3, 3, false)).toBeNull()
        expect(peekNeighbour(-30, 2, 3, true)).toBeNull()
        expect(peekNeighbour(0, 2, 3, false)).toBeNull()
    })
    it('reduces a raw message to plain text: no macros, tags or markdown marks, whitespace collapsed, bounded', () => {
        expect(peekText('**Hello** {{char}} <img src=x onerror="alert(1)">there\n\n# Title `code` > quote')).toBe('Hello there Title code quote')
        expect(peekText('{{#if {{getvar::x}}}}a{{/if}} b')).toBe('a b')
        expect(peekText('x'.repeat(500))).toHaveLength(200)
        expect(peekText('')).toBe('')
        expect(peekText(`${'{{'.repeat(5000)}x${'}}'.repeat(5000)}`).length).toBeLessThanOrEqual(200)
    })
})
// Release after a rest, tremor tolerance and disarm slack.

type Row = [number, number, number]
type Gesture = ReturnType<typeof createSwipeGesture>
interface PullLog { armAt: number | null; progress: number[]; last: SwipeResult | null }

// Recorded touch pulls: [ms after down, x, y]; row 0 is the pointerdown. PULL_327 ends with the lift (last row).
const PULL_327: [number, number, number][] = [
    [0, 327.96, 317.92],
    [41, 327.66, 317.71],
    [91, 327.35, 317.71],
    [141.2, 326.4, 317.82],
    [174.5, 324.59, 318.23],
    [191.3, 322.1, 318.75],
    [208, 316.8, 320.1],
    [224.8, 312.99, 320.81],
    [241.4, 309.93, 321.64],
    [258.1, 307.27, 322.26],
    [274.7, 305.01, 323.08],
    [291.5, 302.8, 323.49],
    [308.1, 300.44, 324.22],
    [324.9, 298.48, 324.73],
    [341.6, 296.32, 325.25],
    [358.2, 294.06, 325.66],
    [374.9, 292, 326.28],
    [391.6, 290.24, 326.8],
    [408.3, 288.43, 327.11],
    [425, 286.72, 327.52],
    [441.7, 285.67, 327.62],
    [458.5, 284.26, 327.93],
    [475.2, 282.91, 328.35],
    [491.8, 281.45, 328.76],
    [508.6, 280.09, 329.07],
    [525.2, 278.84, 329.38],
    [542, 277.53, 329.59],
    [558.6, 276.08, 329.79],
    [575.3, 274.37, 330.2],
    [592, 272.21, 330.62],
    [608.8, 270.2, 330.93],
    [625.5, 268.34, 331.03],
    [642.2, 266.48, 331.24],
    [658.9, 264.43, 331.44],
    [675.6, 262.11, 331.65],
    [692.3, 259.35, 331.96],
    [708.9, 256.64, 332.17],
    [725.8, 254.03, 332.37],
    [742.4, 251.67, 332.58],
    [759.2, 249.66, 332.79],
    [775.9, 248.05, 332.99],
    [792.5, 247, 332.99],
    [809.2, 246.04, 332.99],
    [825.9, 244.99, 333.2],
    [842.7, 243.73, 333.3],
    [859.3, 242.23, 333.51],
    [876.1, 240.52, 333.71],
    [892.9, 238.81, 333.82],
    [909.5, 237.81, 334.02],
    [926.1, 236.6, 334.13],
    [942.9, 235.25, 334.33],
    [959.6, 233.84, 334.64],
    [976.3, 232.53, 334.85],
    [993, 231.53, 335.06],
    [1009.7, 230.73, 335.16],
    [1026.5, 229.92, 335.26],
    [1043.1, 228.87, 335.47],
    [1059.9, 227.31, 335.78],
    [1076.5, 225.25, 335.99],
    [1093.3, 223.19, 336.3],
    [1110, 221.03, 336.61],
    [1126.7, 219.17, 336.71],
    [1143.4, 217.87, 336.92],
    [1160.1, 216.91, 336.92],
    [1176.7, 215.91, 337.12],
    [1193.5, 213.95, 337.33],
    [1210.2, 211.69, 337.43],
    [1226.9, 209.48, 337.64],
    [1243.6, 207.07, 337.74],
    [1260.3, 204.16, 338.05],
    [1277, 200.49, 338.46],
    [1293.7, 196.93, 338.88],
    [1310.4, 193.41, 339.29],
    [1327, 189.94, 339.81],
    [1343.8, 186.43, 340.12],
    [1360.6, 183.42, 340.53],
    [1377.2, 180.9, 340.63],
    [1394, 178.44, 340.84],
    [1410.7, 176.23, 341.04],
    [1427.3, 173.82, 341.25],
    [1444.1, 171.46, 341.35],
    [1460.8, 169.5, 341.56],
    [1477.5, 167.54, 341.66],
    [1494.2, 165.84, 341.77],
    [1511, 163.68, 341.87],
    [1527.6, 162.17, 342.08],
    [1544.3, 160.71, 342.08],
    [1561, 159.21, 342.18],
    [1577.7, 157.3, 342.28],
    [1594.4, 155.14, 342.49],
    [1611.1, 152.83, 342.49],
    [1627.8, 150.87, 342.7],
    [1644.5, 149.01, 342.7],
    [1661.2, 147.3, 342.7],
    [1677.9, 145.75, 342.7],
    [1694.7, 144.64, 342.7],
    [1711.4, 143.99, 342.7],
    [1728.1, 143.69, 342.7],
    [1744.8, 143.29, 342.7],
    [1761.5, 142.53, 342.7],
    [1778.2, 141.93, 342.7],
    [1803.3, 141.18, 342.49],
    [1811.6, 140.93, 342.49],
    [1828.3, 140.32, 342.28],
    [1845, 139.37, 342.18],
    [1861.8, 138.42, 341.97],
    [1878.4, 137.51, 341.66],
    [1895.2, 137.11, 341.46],
    [1920.3, 136.71, 341.46],
    [1937, 136.59, 341.25],
    [1945.3, 136.61, 341.25],
    [2112.3, 128.82, 341.91],
    [2129.1, 104, 344.83],
    [2145.8, 62.2, 351.95],
    [2162.3, 18.95, 357.94],
    [2179.1, 18.68, 357.98],
    [2187.8, 18.68, 357.98],
]
const PULL_328_HOLD: [number, number, number][] = [
    [0, 321.83, 310.69],
    [41.7, 322.43, 310.9],
    [66.6, 322.43, 311.11],
    [116.8, 319.77, 312.04],
    [150.2, 304.31, 315.33],
    [167, 297.77, 317.01],
    [183.6, 292.15, 318.48],
    [200.3, 287.08, 320.4],
    [217, 282.81, 321.84],
    [233.6, 279.64, 322.67],
    [250.2, 276.93, 323.08],
    [267.1, 274.92, 323.39],
    [283.7, 272.56, 323.91],
    [300.4, 270.15, 324.63],
    [317.1, 268.24, 325.15],
    [333.8, 266.58, 325.35],
    [350.4, 265.08, 325.46],
    [367.2, 263.82, 325.46],
    [383.9, 263.07, 325.35],
    [434, 260.66, 325.66],
    [467.4, 254.48, 326.49],
    [500.8, 246.19, 327.73],
    [517.6, 241.77, 328.24],
    [534.3, 236.8, 328.86],
    [550.9, 231.63, 329.38],
    [567.6, 227.21, 329.69],
    [584.3, 224.8, 329.69],
    [601, 223.59, 329.69],
    [617.7, 222.49, 329.48],
    [634.5, 221.43, 329.38],
    [651.2, 219.78, 329.28],
    [667.8, 217.87, 329.07],
    [684.5, 215.46, 328.76],
    [701.2, 212.19, 328.35],
    [717.9, 207.52, 326.8],
    [734.8, 201.57, 325.76],
    [751.3, 194.68, 325.02],
    [768.2, 188.28, 323.89],
    [784.8, 182.64, 323.18],
    [801.5, 177.74, 322.46],
    [818.2, 173.42, 321.84],
    [834.9, 169.85, 321.43],
    [851.5, 167.04, 321.22],
    [868.3, 165.33, 321.02],
    [885, 163.63, 320.91],
    [901.7, 162.22, 320.81],
    [918.5, 160.66, 320.6],
    [935.1, 158.6, 320.4],
    [951.9, 156.04, 320.09],
    [968.5, 153.38, 319.88],
    [985.3, 150.22, 319.57],
    [1002, 147.46, 319.57],
    [1018.7, 144.79, 319.57],
    [1035.4, 142.28, 319.67],
    [1052.1, 140.07, 319.78],
    [1068.8, 138.62, 319.88],
    [1085.5, 137.91, 319.98],
    [1102.3, 137.81, 319.98],
    [1144.2, 137.41, 320.19],
    [1160.9, 137.31, 320.19],
    [1211, 136.73, 320.19],
    [1219.1, 135.6, 320.19],
    [1235.8, 133.39, 320.19],
    [1252.5, 130.88, 320.4],
    [1269.3, 129.43, 320.71],
    [1286, 128.52, 320.91],
    [1302.7, 127.92, 321.02],
    [1319.4, 127.37, 321.02],
    [1344.7, 127.27, 321.02],
    [1361.2, 127.31, 321.02],
    [1369.6, 127.27, 321.02],
    [1402.9, 126.6, 321.02],
    [1419.6, 126.26, 321.12],
    [1436.4, 125.66, 321.22],
    [1469.7, 125.36, 321.43],
    [1503.2, 125.08, 321.82],
    [1519.9, 124.91, 321.95],
    [1536.5, 124.8, 321.74],
    [1553.2, 123.65, 321.95],
]
const PULL_329_HOLD: [number, number, number][] = [
    [0, 334.29, 319.57],
    [24.3, 334.19, 319.36],
    [49.5, 334.29, 319.36],
    [74.6, 334.19, 319.16],
    [133, 333.88, 319.16],
    [183.2, 333.68, 319.16],
    [224.9, 333.39, 319.36],
    [241.5, 333.38, 319.36],
    [300, 333.08, 319.36],
    [325, 332.52, 319.57],
    [341.7, 331.98, 319.67],
    [358.4, 329.84, 319.88],
    [375.1, 324.38, 320.82],
    [391.8, 320.32, 321.74],
    [408.5, 317.21, 322.57],
    [425.2, 314.8, 322.77],
    [441.9, 312.34, 323.6],
    [458.5, 309.22, 324.32],
    [475.2, 306.16, 325.15],
    [492, 302.9, 325.97],
    [508.7, 299.83, 326.9],
    [525.3, 296.57, 327.31],
    [542.1, 293.76, 328.04],
    [558.8, 290.94, 328.86],
    [575.5, 288.03, 329.69],
    [592.2, 284.82, 330.41],
    [608.9, 280.95, 331.34],
    [625.6, 275.88, 332.06],
    [642.4, 269.87, 333],
    [658.9, 263.12, 333.84],
    [675.6, 256.69, 334.67],
    [692.5, 251.02, 335.78],
    [709.2, 245.64, 336.71],
    [725.9, 240.77, 337.43],
    [742.6, 236.2, 337.84],
    [759.3, 232.48, 338.26],
    [776, 229.42, 338.36],
    [792.7, 226.31, 338.67],
    [809.4, 222.39, 338.88],
    [826.1, 217.92, 339.29],
    [842.8, 212.75, 339.6],
    [859.5, 207.37, 339.91],
    [876.3, 201.47, 340.12],
    [892.9, 194.88, 340.43],
    [909.6, 188.67, 340.53],
    [926.3, 182.97, 340.63],
    [943.1, 177.84, 340.84],
    [959.7, 173.17, 340.84],
    [976.5, 169.45, 340.84],
    [993.1, 166.34, 340.84],
    [1009.8, 163.43, 340.84],
    [1026.6, 160.46, 340.63],
    [1043.3, 157.8, 340.53],
    [1059.9, 155.84, 340.43],
    [1076.7, 153.93, 340.22],
    [1093.4, 151.37, 340.12],
    [1110.1, 148.16, 340.01],
    [1126.8, 144.84, 339.81],
    [1143.6, 141.28, 339.6],
    [1160.3, 137.86, 339.39],
    [1176.9, 135, 339.29],
    [1193.7, 132.19, 339.19],
    [1210.4, 129.48, 339.39],
    [1227.1, 126.46, 339.5],
    [1243.8, 123.8, 339.6],
    [1260.6, 120.74, 339.81],
    [1277.3, 117.32, 339.81],
    [1293.9, 113.45, 339.81],
    [1310.7, 109.59, 339.5],
    [1327.4, 105.57, 339.08],
    [1344.1, 102, 338.67],
    [1360.8, 98.89, 338.26],
    [1377.5, 96.73, 337.84],
    [1394.2, 95.68, 337.64],
]

// The host's poll: while the cue fills it ticks shortly before the next frame, otherwise it re-checks every hold period,
// and it stops once armed. A due tick runs before the next event.
function replayPull(swipe: Gesture, rows: Row[], until: number = rows[rows.length - 1][0]): PullLog {
    const log: PullLog = { armAt: null, progress: [], last: null }
    let due: number | null = null
    const note = (time: number, result: SwipeResult): void => {
        log.progress.push(result.progress)
        log.last = result
        if (result.event === 'arm' && log.armAt === null) log.armAt = time
        due = result.armed ? null : result.progress >= 0.7 ? time + Math.max(1, Math.min(16, Math.floor((1 - result.progress) / 0.3 * ARM_HOLD_MS))) : time + ARM_HOLD_MS
    }
    const runDue = (before: number): void => {
        while (due !== null && due <= before) {
            const time: number = due
            note(time, swipe.tick(time))
        }
    }
    rows.forEach(([time, x, y], index) => {
        if (index === 0) { swipe.down(p(x, y, time)); return }
        runDue(time)
        note(time, swipe.move(p(x, y, time)))
    })
    runDue(until)
    return log
}

// After the cue has reached 0.75 the fill may rise but never fall back.
function fillNeverFalls(progress: number[]): boolean {
    let top = 0
    for (const value of progress) {
        if (top >= 0.75 && value < top - 1e-9) return false
        top = Math.max(top, value)
    }
    return true
}

// A pull to 165 dp at 100 ms, then constant creep of `stepPx` per `everyMs`, host-polled.
function creepRows(stepPx: number, everyMs: number, endMs: number): Row[] {
    const rows: Row[] = [[0, 300, 0], [100, 135, 0]]
    for (let k = 1; 100 + k * everyMs <= endMs; k++) rows.push([100 + k * everyMs, 135 - k * stepPx, 0])
    return rows
}

describe('round 3 W2: release after a rest (lag rule)', () => {
    const last: SwipeOptions = { ...base, widthPx: 379, index: 2, canGenerate: true }
    it('uses the constants of the lag rule', () => {
        expect(SWIPE_REST_LAG_MS).toBe(34)
        expect(SWIPE_VELOCITY_WINDOW_MS).toBe(80)
    })
    // reproducer
    it('T-W2-327: an armed hold, a rest with no events, then a 110 px flick over 50 ms does not generate', () => {
        const swipe = createSwipeGesture(last)
        const log = replayPull(swipe, PULL_327.slice(0, -1))
        expect(log.armAt).not.toBeNull()
        const [time, x, y] = PULL_327[PULL_327.length - 1]
        expect(swipe.up(p(x, y, time)).event).toBe('none')
    })
    // reproducer
    it('T-SW-LAG40: an armed pull whose anchor is 40 ms older than the window start reads over the window and does not generate', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(100, 0, 100))
        expect(swipe.tick(400).event).toBe('arm')
        for (const [x, time] of [[95, 1010], [90, 1020], [80, 1070], [60, 1100], [40, 1130]]) swipe.move(p(x, 0, time))
        expect(swipe.up(p(40, 0, 1140)).event).toBe('none')
    })
    // guard
    it('G-SW-LAG30: an armed pull whose anchor is 30 ms older than the window start keeps the true span and generates', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(100, 0, 100))
        expect(swipe.tick(400).event).toBe('arm')
        for (const [x, time] of [[95, 1010], [90, 1020], [80, 1060], [60, 1090], [40, 1120]]) swipe.move(p(x, 0, time))
        expect(swipe.up(p(40, 0, 1130)).event).toBe('generate')
    })
    // guard
    it('G-SW-DENSE: an armed pull released from a dense 16.7 ms stream at 0.45 px/ms reads 0.45 and generates', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(100, 0, 100))
        expect(swipe.tick(400).event).toBe('arm')
        for (let k = 1; k <= 12; k++) swipe.move(p(100 - 0.45 * (16.7 * k), 0, 400 + 16.7 * k))
        expect(swipe.up(p(100 - 0.45 * 213, 0, 613)).event).toBe('generate')
    })
    // guard
    it('G-SHORT: a drag shorter than the window keeps its own span', () => {
        const swipe = createSwipeGesture(base)
        swipe.down(p(200, 0, 0)); swipe.move(p(180, 0, 10)); swipe.move(p(165, 0, 20)); swipe.move(p(160, 0, 30))
        expect(swipe.up(p(160, 0, 34)).event).toBe('stepNext')
    })
    // guard
    it('G-ARMLIFT: an armed hold, a 300 ms rest, one 3 px move and a lift 20 ms later still generates', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(100, 0, 100))
        expect(swipe.tick(400).event).toBe('arm')
        swipe.move(p(97, 0, 700))
        expect(swipe.up(p(97, 0, 720)).event).toBe('generate')
    })
    // guard (boundary): a lag of exactly the rest lag keeps the true span; one millisecond more reads over the window.
    it('G-SW-LAG-EDGE: a lag of exactly 34 ms keeps the true span, 35 ms reads over the window', () => {
        const release = (liftAt: number): SwipeResult => {
            const swipe = createSwipeGesture(base)
            swipe.down(p(300, 0, 0)); swipe.move(p(255, 0, 100))
            return swipe.up(p(250, 0, liftAt))
        }
        expect(release(114).event).toBe('none')
        expect(release(115).event).toBe('stepNext')
    })
})

describe('round 3 MC-1570: tremor tolerance with a cumulative bound', () => {
    const last: SwipeOptions = { ...base, widthPx: 379, index: 2, canGenerate: true }
    it('uses the constants of the tremor and slack rules', () => {
        expect(ARM_TREMOR_PX).toBe(4)
        expect(ARM_TREMOR_PX_MS).toBe(0.3)
        expect(ARM_SLACK_DP).toBe(8)
        expect(ARM_CREEP_PX).toBe(56)
    })
    // reproducer
    it('T-TR-328: the real hold keeps its fill and arms before 1250 ms', () => {
        const log = replayPull(createSwipeGesture(last), PULL_328_HOLD, 2400)
        expect(log.armAt).not.toBeNull()
        expect(log.armAt).toBeLessThanOrEqual(1250)
        expect(fillNeverFalls(log.progress)).toBe(true)
    })
    // reproducer
    it('T-CREEP-329: the real hold that drifted 49 px arms at about 1260 ms with no drop', () => {
        const log = replayPull(createSwipeGesture(last), PULL_329_HOLD, 2400)
        expect(log.armAt).not.toBeNull()
        expect(log.armAt).toBeLessThanOrEqual(1270)
        expect(fillNeverFalls(log.progress)).toBe(true)
    })
    // reproducer
    it('T-TR-ONE: a single 3 px event at 0.18 px/ms does not restart the hold', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(135, 0, 100))
        for (let time = 116; time <= 230; time += 16) swipe.tick(time)
        const before = swipe.move(p(135, 0, 240)).progress
        expect(swipe.move(p(132, 0, 256.7)).progress).toBeGreaterThanOrEqual(before)
        for (let time = 273; time < 400; time += 16) expect(swipe.tick(time).event).toBe('none')
        expect(swipe.tick(399).event).toBe('none')
        expect(swipe.tick(400).event).toBe('arm')
    })
    // reproducer
    it('T-CREEP-017: creep at 0.17 px/ms with 2.8 px events arms 300 ms after the pull', () => {
        const log = replayPull(createSwipeGesture({ ...base, index: 2 }), creepRows(2.84, 16.7, 1100))
        expect(log.armAt).not.toBeNull()
        expect(log.armAt).toBeGreaterThanOrEqual(400)
        expect(log.armAt).toBeLessThanOrEqual(410)
    })
    // reproducer
    it('T-WOBBLE: a 2 px wobble every 8.3 ms around 165 dp arms', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(135, 0, 100))
        let armAt: number | null = null
        for (let k = 1; k <= 60; k++) {
            const time = 100 + 8.3 * k
            if (swipe.move(p(k % 2 === 1 ? 137 : 135, 0, time)).event === 'arm' && armAt === null) armAt = time
        }
        expect(armAt).not.toBeNull()
        expect(armAt).toBeGreaterThanOrEqual(400)
        expect(armAt).toBeLessThanOrEqual(420)
    })
    // guard
    it('G-TR-STEP: a 5 px event at 0.299 px/ms is a deliberate move and resets the fill', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(135, 0, 100)); swipe.move(p(135, 0, 150))
        expect(swipe.move(p(130, 0, 166.7)).progress).toBeCloseTo(0.7)
    })
    // guard
    it('G-TR-CAP: sustained 0.31 px/ms motion in 2.6 px events holds the fill at 70 % and never arms', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(135, 0, 100))
        for (let k = 1; k <= 48; k++) {
            const result = swipe.move(p(135 - 2.6 * k, 0, 100 + 8.3 * k))
            expect(result.event).toBe('none')
            expect(result.progress).toBeCloseTo(0.7)
        }
    })
    // reproducer
    it('T-CREEP-ANCHOR: after a deliberate move restarts the hold, the creep bound is measured from the new hold', () => {
        const rows: Row[] = [[0, 300, 0], [100, 135, 0], [150, 135, 0], [170, 35, 0]]
        for (let k = 1; 170 + k * 16.7 <= 1100; k++) rows.push([170 + k * 16.7, 35 - k * 2.84, 0])
        const log = replayPull(createSwipeGesture({ ...base, index: 2 }), rows)
        expect(log.armAt).not.toBeNull()
        expect(log.armAt).toBeLessThanOrEqual(480)
    })
    // guard
    it('G-TR-CREEP: creep at 0.1 px/ms arms 300 ms after entry', () => {
        const log = replayPull(createSwipeGesture({ ...base, index: 2 }), creepRows(1.67, 16.7, 1100))
        expect(log.armAt).not.toBeNull()
        expect(log.armAt).toBeGreaterThanOrEqual(400)
        expect(log.armAt).toBeLessThanOrEqual(420)
    })
    // guard
    it('G-CREEP-020: creep at 0.2 px/ms (60 Hz) does not arm and a lift at the end gives nothing', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        const log = replayPull(swipe, creepRows(3.34, 16.7, 1100))
        expect(log.armAt).toBeNull()
        expect(swipe.up(p(135 - 3.34 * 60, 0, 1101)).event).toBe('none')
    })
    // guard
    it('G-CREEP-029: creep at 0.29 px/ms (120 Hz) does not arm', () => {
        const log = replayPull(createSwipeGesture({ ...base, index: 2 }), creepRows(2.41, 8.3, 1100))
        expect(log.armAt).toBeNull()
    })
    // reproducer
    it('T-WB-ARMED: wobbling to 158 dp after arming at 161 keeps the cue armed and the lift generates', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(139, 0, 100))
        expect(swipe.tick(400).event).toBe('arm')
        for (const [x, time] of [[141, 417], [142, 434], [140, 451], [141, 468]]) expect(swipe.move(p(x, 0, time))).toMatchObject({ armed: true, progress: 1 })
        expect(swipe.up(p(141, 0, 600)).event).toBe('generate')
    })
    // reproducer
    it('T-WB-LIFT155: a lift at 155 dp after arming at 161 generates', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(139, 0, 100))
        expect(swipe.tick(400).event).toBe('arm')
        swipe.move(p(143, 0, 416.7)); swipe.move(p(145, 0, 433.4))
        expect(swipe.up(p(145, 0, 633.4)).event).toBe('generate')
    })
    // reproducer
    it('T-WB-HOLD: a hold that dips to 158 dp keeps filling and arms from the timer', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0))
        const fills = [swipe.move(p(135, 0, 100)).progress, swipe.move(p(138, 0, 200)).progress, swipe.move(p(141, 0, 216.7)).progress, swipe.move(p(142, 0, 233.4)).progress]
        for (const fill of fills.slice(1)) expect(fill).toBeGreaterThanOrEqual(0.7)
        for (let time = 250; time < 500; time += 50) expect(swipe.tick(time)).toMatchObject({ event: 'none', armed: false })
        expect(swipe.tick(500).event).toBe('arm')
    })
    // guard
    it('G-WB-ENTRY: a pull that only reaches 155 dp never shows the hold and never arms', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0))
        expect(swipe.move(p(145, 0, 100)).progress).toBeLessThan(0.7)
        for (let time = 116; time <= 2000; time += 16) expect(swipe.tick(time)).toMatchObject({ event: 'none', armed: false })
        expect(swipe.up(p(145, 0, 2100)).event).toBe('none')
    })
    // guard
    it('G-WB-SLIDE: sliding from armed at 165 dp to 150 dp disarms and the lift generates nothing', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(135, 0, 100))
        expect(swipe.tick(400).event).toBe('arm')
        expect(swipe.move(p(150, 0, 500))).toMatchObject({ armed: false })
        expect(swipe.up(p(150, 0, 700)).event).toBe('none')
    })
    // guard (boundary): a hold at 135 begun by a still event; each case lands one move on the edge of one tremor condition.
    function holdAt135(): ReturnType<typeof createSwipeGesture> {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(135, 0, 100)); swipe.move(p(135, 0, 150))
        return swipe
    }
    it('G-CREEP-EDGE: a drift of exactly 56 px from the hold start is still tremor, a quicker move past it resets the hold', () => {
        const swipe = holdAt135()
        let last = swipe.move(p(131, 0, 164))
        for (let k = 2; k <= 14; k++) last = swipe.move(p(135 - 4 * k, 0, 150 + 14 * k))
        expect(last.progress).toBeCloseTo(0.7 + 0.3 * 196 / 300, 5)
        expect(swipe.move(p(135 - 59, 0, 150 + 14 * 14 + 14)).progress).toBeCloseTo(0.7, 5)
    })
    it('G-TREMOR-STEP-EDGE: a step of exactly 4 px at a tremor speed does not restart the hold', () => {
        expect(holdAt135().move(p(131, 0, 164)).progress).toBeCloseTo(0.7 + 0.3 * 14 / 300, 5)
    })
    it('G-TREMOR-SPEED-EDGE: a 3 px step at exactly 0.3 px/ms restarts the hold', () => {
        expect(holdAt135().move(p(132, 0, 160)).progress).toBeCloseTo(0.7, 5)
    })
    // guard: the hold zone belongs to one gesture; a later pull that only peaks between the slack floor and the arm distance never holds.
    it('G-WB-ENTRY-REUSED: on a reused instance a slow pull to 155 dp after a pull into the zone never arms', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(145, 0, 100))
        swipe.up(p(145, 0, 200))
        swipe.down(p(300, 0, 1000)); swipe.move(p(135, 0, 1100))
        swipe.up(p(135, 0, 1200))
        swipe.down(p(300, 0, 2000))
        expect(swipe.move(p(145, 0, 2100)).progress).toBeLessThan(0.7)
        for (let time = 2116; time <= 7100; time += 16) expect(swipe.tick(time)).toMatchObject({ event: 'none', armed: false })
        expect(swipe.up(p(145, 0, 7200)).event).toBe('none')
    })
    // reproducer-shaped guard: with no host tick between events, the move path alone must restart the creep anchor.
    it('G-CREEP-ANCHOR-120HZ: after a deliberate move restarts the hold, 8.3 ms events alone measure the creep bound from the new hold', () => {
        const swipe = createSwipeGesture({ ...base, index: 2 })
        swipe.down(p(300, 0, 0)); swipe.move(p(135, 0, 100)); swipe.move(p(135, 0, 150)); swipe.move(p(35, 0, 170))
        let armAt: number | null = null
        for (let k = 1; 170 + k * 8.3 <= 1100; k++) {
            const time = 170 + k * 8.3
            if (swipe.move(p(35 - k * 1.41, 0, time)).event === 'arm' && armAt === null) armAt = time
        }
        expect(armAt).not.toBeNull()
        expect(armAt).toBeLessThanOrEqual(490)
    })
})
