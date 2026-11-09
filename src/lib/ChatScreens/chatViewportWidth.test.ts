// @vitest-environment happy-dom

/**
 * `viewportWidthThisTask` reads the window width once per task: reads in one task share one live read, and the next
 * task sees a changed width.
 *
 * Labels: G = guard (passes before and after; the module is new, so these pin the new rule).
 */
import { afterEach, describe, expect, test } from 'vitest'
import { viewportWidthThisTask } from './chatViewportWidth'

let reads = 0
let width = 800

function countWidthReads() {
    reads = 0
    Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        get: () => {
            reads += 1
            return width
        },
    })
}

afterEach(async () => {
    // Lets the cache of the finished test drop before the next one starts.
    await Promise.resolve()
    Reflect.deleteProperty(window, 'innerWidth')
})

describe('the width read once per task', () => {
    test('G T6: two reads in one task make one live read', () => {
        width = 800
        countWidthReads()

        const first = viewportWidthThisTask()
        const second = viewportWidthThisTask()

        expect([first, second]).toEqual([800, 800])
        expect(reads).toBe(1)
    })

    test('G T6: a width change is not seen inside the task but is seen in the next task', async () => {
        width = 800
        countWidthReads()
        expect(viewportWidthThisTask()).toBe(800)

        width = 300
        expect(viewportWidthThisTask()).toBe(800)

        await Promise.resolve()
        expect(viewportWidthThisTask()).toBe(300)
        expect(reads).toBe(2)
    })
})
