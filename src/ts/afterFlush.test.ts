// @vitest-environment happy-dom

/**
 * `afterFlush` under the async scheduler the app ships: it resolves from microtasks alone, so before the first animation
 * frame, with the pending Svelte update committed, in every call shape the app uses (handler, effect, teardown, nothing
 * pending). Svelte's own `tick()` is the contrast: it needs a frame or a timer. The same cases run under jsdom in
 * `afterFlush.jsdom.test.ts`. Real timers, as the first-frame harness requires.
 *
 * Labels: NEW-RULE = the helper's own contract (imports the helper, so not a reproducer); CONTRAST = shows why the helper exists.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { afterFlush } from './afterFlush'
import AfterFlushFixture from './tests/AfterFlushFixture.svelte'
import { drainMicrotasks, installFrameQueue, readAtFirstFrame, runFrame, uninstallFrameQueue } from './tests/firstFrame.test-helpers'

interface FixtureExports {
    closeLayer(): void
    showThenWait(): Promise<void>
    waitIdle(): Promise<void>
    triggerEffect(): void
}

let app: FixtureExports | null = null
let recorded: Array<[string, string]> = []

function mountFixture(): FixtureExports {
    recorded = []
    const target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(AfterFlushFixture, { target, props: { record: (label, value) => { recorded.push([label, value]) } } }) as unknown as FixtureExports
    flushSync()
    return app
}

afterEach(async () => {
    uninstallFrameQueue()
    if (app) {
        await unmount(app as never)
        app = null
    }
    document.body.replaceChildren()
})

describe('afterFlush before the first frame', () => {
    test('NEW-RULE a pending update is committed when the helper resolves, before the first frame', async () => {
        const fixture = mountFixture()
        installFrameQueue()
        const waited = fixture.showThenWait()
        let resolved = false
        void waited.then(() => { resolved = true })
        const shownAtFirstFrame = readAtFirstFrame(() => document.querySelector('[data-part="shown"]') !== null)
        await drainMicrotasks()
        expect(resolved).toBe(true)
        runFrame()
        expect(await shownAtFirstFrame).toBe(true)
        expect(recorded).toEqual([['handler', 'shown']])
    })

    test('NEW-RULE with nothing pending it still resolves from microtasks alone', async () => {
        const fixture = mountFixture()
        installFrameQueue()
        let resolved = false
        void fixture.waitIdle().then(() => { resolved = true })
        await drainMicrotasks()
        expect(resolved).toBe(true)
    })

    test('NEW-RULE a focus move behind it lands before the first frame', async () => {
        const fixture = mountFixture()
        document.querySelector<HTMLInputElement>('[data-part="layer"]')!.focus()
        installFrameQueue()
        fixture.closeLayer()
        const focusAtFirstFrame = readAtFirstFrame(() => document.activeElement?.getAttribute('data-part'))
        await drainMicrotasks()
        runFrame()
        expect(await focusAtFirstFrame).toBe('opener')
    })

    test('NEW-RULE it is legal inside an effect: the effect\'s own write is committed when it resolves', async () => {
        const fixture = mountFixture()
        installFrameQueue()
        fixture.triggerEffect()
        flushSync()
        await drainMicrotasks()
        expect(recorded).toEqual([['effect', 'marked']])
    })

    test('NEW-RULE it is legal in a teardown: it resolves after the teardown stack has unwound', async () => {
        mountFixture()
        installFrameQueue()
        const current = app!
        app = null
        expect(() => { void unmount(current as never) }).not.toThrow()
        await drainMicrotasks()
        expect(recorded).toEqual([['destroy', 'resolved']])
    })

    test('CONTRAST svelte tick() has not resolved after the same microtasks and needs the frame', async () => {
        installFrameQueue()
        let ticked = false
        void tick().then(() => { ticked = true })
        await drainMicrotasks()
        expect(ticked).toBe(false)
        runFrame()
        await drainMicrotasks()
        expect(ticked).toBe(true)
    })

    test('NEW-RULE the helper resolves although tick() is still waiting on the frame', async () => {
        installFrameQueue()
        let ticked = false
        let flushed = false
        void tick().then(() => { ticked = true })
        void afterFlush().then(() => { flushed = true })
        await drainMicrotasks()
        expect(flushed).toBe(true)
        expect(ticked).toBe(false)
    })
})
