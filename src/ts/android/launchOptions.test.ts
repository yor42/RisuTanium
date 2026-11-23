// @vitest-environment jsdom

/**
 * The launch options (`./launchOptions`), TA2-1: the answer hook is installed only when the host can give launch options,
 * the shortcut's pack-safe request enters safe mode only for an exact boolean `true`, the touch-exploration state is handed
 * to the banner, and the warm ready hook asks again. FAKED: the safe-mode module (its own tests cover what the entry does)
 * and the host. A passing test says nothing about the Kotlin side.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const safe = vi.hoisted(() => ({ enter: vi.fn(), touch: vi.fn(), hold: vi.fn(), release: vi.fn() }))

vi.mock(import('src/ts/themePack/packSafeMode.svelte'), () => ({
    enterPackSafeMode: safe.enter,
    setBannerTouchExploration: safe.touch,
    holdPackUntilDecided: safe.hold,
    releasePackHold: safe.release,
}) as unknown as typeof import('src/ts/themePack/packSafeMode.svelte'))

import { resetLaunchOptionsForTests, settlePackDecision, startLaunchOptions } from './launchOptions'

beforeEach(() => {
    safe.enter.mockReset()
    safe.touch.mockReset()
    safe.hold.mockReset().mockReturnValue(true)
    safe.release.mockReset()
    resetLaunchOptionsForTests()
})

afterEach(() => {
    vi.useRealTimers()
    delete window.__risuTaniumLaunchOptions
    delete window.__risuTaniumPackSafeModeReady
})

function answer(value: unknown): void {
    window.__risuTaniumLaunchOptions?.(value)
}

describe('TA2-1: startLaunchOptions', () => {
    test('a host without requestLaunchOptions installs nothing and asks nothing', () => {
        startLaunchOptions({})
        startLaunchOptions(undefined)
        expect(window.__risuTaniumLaunchOptions).toBeUndefined()
        expect(window.__risuTaniumPackSafeModeReady).toBeUndefined()
    })

    test('a host with it is asked once at start, as a method', () => {
        const seen: { calls: number, receiver: unknown } = { calls: 0, receiver: null }
        const host = { requestLaunchOptions() { seen.calls += 1; seen.receiver = this } }
        startLaunchOptions(host)
        expect(seen.calls).toBe(1)
        expect(seen.receiver).toBe(host)
        expect(typeof window.__risuTaniumLaunchOptions).toBe('function')
    })

    test('the answer {packSafeMode:true} enters safe mode from the shortcut', () => {
        startLaunchOptions({ requestLaunchOptions: vi.fn() })
        answer({ packSafeMode: true, touchExploration: false })
        expect(safe.enter).toHaveBeenCalledTimes(1)
        expect(safe.enter).toHaveBeenCalledWith('shortcut')
    })

    test('a late answer, after the host was asked and boot went on, enters safe mode live', () => {
        const ask = vi.fn()
        startLaunchOptions({ requestLaunchOptions: ask })
        expect(safe.enter).not.toHaveBeenCalled()
        answer({ packSafeMode: false, touchExploration: false })
        expect(safe.enter).not.toHaveBeenCalled()
        answer({ packSafeMode: true, touchExploration: false })
        expect(safe.enter).toHaveBeenCalledTimes(1)
    })

    test.each([['"true"', 'true'], ['1', 1], ['"yes"', 'yes'], ['null', null], ['object', {}], ['array', [true]]])(
        'a packSafeMode of %s is ignored',
        (_name, value) => {
            startLaunchOptions({ requestLaunchOptions: vi.fn() })
            answer({ packSafeMode: value, touchExploration: false })
            expect(safe.enter).not.toHaveBeenCalled()
        },
    )

    test('an answer that is not an object, or has no packSafeMode, enters nothing and never throws', () => {
        startLaunchOptions({ requestLaunchOptions: vi.fn() })
        for (const value of [null, undefined, true, 'packSafeMode', 7, [], {}]) {
            expect(() => answer(value)).not.toThrow()
        }
        expect(safe.enter).not.toHaveBeenCalled()
    })

    test('the touch-exploration value is handed to the banner as the host sent it; the banner validates it', () => {
        startLaunchOptions({ requestLaunchOptions: vi.fn() })
        answer({ packSafeMode: false, touchExploration: true })
        expect(safe.touch).toHaveBeenLastCalledWith(true)
        answer({ packSafeMode: false, touchExploration: false })
        expect(safe.touch).toHaveBeenLastCalledWith(false)
    })

    test('a failure inside the safe-mode entry is logged, never thrown into the host call', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        safe.enter.mockImplementation(() => { throw new Error('entry failed') })
        startLaunchOptions({ requestLaunchOptions: vi.fn() })
        expect(() => answer({ packSafeMode: true })).not.toThrow()
        expect(error).toHaveBeenCalled()
        error.mockRestore()
        safe.enter.mockReset()
    })

    test('the warm ready hook asks the host again', () => {
        const ask = vi.fn()
        startLaunchOptions({ requestLaunchOptions: ask })
        expect(ask).toHaveBeenCalledTimes(1)
        window.__risuTaniumPackSafeModeReady?.()
        expect(ask).toHaveBeenCalledTimes(2)
    })

    test('a host that throws on the ask is the same as no host: nothing escapes', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        expect(() => startLaunchOptions({ requestLaunchOptions: () => { throw new Error('refused') } })).not.toThrow()
        expect(() => window.__risuTaniumPackSafeModeReady?.()).not.toThrow()
        error.mockRestore()
    })
})

describe('LO-1: the hold, the decision and the bounded wait', () => {
    /** Starts the module with an asking host and returns the ask's spy. */
    function startAsking(onAsk: () => void = () => { }): ReturnType<typeof vi.fn> {
        const ask = vi.fn(onAsk)
        startLaunchOptions({ requestLaunchOptions: ask })
        return ask
    }

    /** True once the settle promise has resolved, observed after the pending microtasks ran. */
    async function resolvedAfterTurn(settled: Promise<void>): Promise<boolean> {
        let done = false
        void settled.then(() => { done = true })
        for (let turn = 0; turn < 5; turn++) {
            await Promise.resolve()
        }
        return done
    }

    test('the hold is taken once, on the first call, also for a host that cannot answer', () => {
        startLaunchOptions(undefined)
        startLaunchOptions({ requestLaunchOptions: vi.fn() })
        expect(safe.hold).toHaveBeenCalledTimes(1)
    })

    test('the hold is taken before the ask, so an answer inside the ask finds it', () => {
        const order: string[] = []
        safe.hold.mockImplementation(() => { order.push('hold'); return true })
        startAsking(() => { order.push('ask') })
        expect(order).toEqual(['hold', 'ask'])
    })

    test('only an exact false releases the hold, and only an exact true enters safe mode', () => {
        startAsking()
        for (const value of ['false', 0, null, undefined, {}, [false], 'true', 1]) {
            answer({ packSafeMode: value, touchExploration: false })
        }
        answer('false')
        answer(false)
        expect(safe.release).not.toHaveBeenCalled()
        expect(safe.enter).not.toHaveBeenCalled()
        answer({ packSafeMode: false })
        expect(safe.release).toHaveBeenCalledTimes(1)
        expect(safe.enter).not.toHaveBeenCalled()
        answer({ packSafeMode: true })
        expect(safe.enter).toHaveBeenCalledTimes(1)
        expect(safe.enter).toHaveBeenCalledWith('shortcut')
        expect(safe.release).toHaveBeenCalledTimes(1)
    })

    test('nothing throws into the host when the hold, the release or the entry fail', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => { })
        safe.hold.mockImplementation(() => { throw new Error('hold failed') })
        safe.release.mockImplementation(() => { throw new Error('release failed') })
        expect(() => startAsking()).not.toThrow()
        expect(() => answer({ packSafeMode: false })).not.toThrow()
        error.mockRestore()
    })

    test('a page that was not held settles at once, whatever the host does', async () => {
        safe.hold.mockReturnValue(false)
        startAsking()
        await expect(settlePackDecision()).resolves.toBeUndefined()
        expect(safe.enter).not.toHaveBeenCalled()
    })

    test('a settle before any start settles at once', async () => {
        await expect(settlePackDecision()).resolves.toBeUndefined()
        expect(safe.enter).not.toHaveBeenCalled()
    })

    test('while held it waits for the answer, and a false ends the wait without entering safe mode', async () => {
        vi.useFakeTimers()
        startAsking()
        const settled = settlePackDecision()
        expect(await resolvedAfterTurn(settled)).toBe(false)
        answer({ packSafeMode: false, touchExploration: false })
        await settled
        expect(safe.release).toHaveBeenCalledTimes(1)
        expect(safe.enter).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })

    test('a true ends the wait and enters safe mode from the shortcut, not as no answer', async () => {
        vi.useFakeTimers()
        startAsking()
        const settled = settlePackDecision()
        answer({ packSafeMode: true, touchExploration: false })
        await settled
        expect(safe.enter.mock.calls).toEqual([['shortcut']])
    })

    test('an answer inside the ask is already decided, so the settle does not wait', async () => {
        startAsking(() => answer({ packSafeMode: false }))
        await expect(settlePackDecision()).resolves.toBeUndefined()
        expect(safe.enter).not.toHaveBeenCalled()
    })

    test('with no answer the wait ends at 2000 ms and the page enters safe mode as no answer', async () => {
        vi.useFakeTimers()
        startAsking()
        const settled = settlePackDecision()
        await vi.advanceTimersByTimeAsync(1999)
        expect(await resolvedAfterTurn(settled)).toBe(false)
        expect(safe.enter).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        await settled
        expect(safe.enter.mock.calls).toEqual([['noAnswer']])
    })

    test('a malformed answer neither releases nor wakes the wait, and still hands touch exploration on', async () => {
        vi.useFakeTimers()
        startAsking()
        const settled = settlePackDecision()
        answer({ packSafeMode: 'false', touchExploration: true })
        expect(await resolvedAfterTurn(settled)).toBe(false)
        expect(safe.release).not.toHaveBeenCalled()
        expect(safe.touch).toHaveBeenLastCalledWith(true)
        await vi.advanceTimersByTimeAsync(2000)
        await settled
        expect(safe.enter.mock.calls).toEqual([['noAnswer']])
    })

    test('no host: the settle ends at once as no answer', async () => {
        startLaunchOptions(undefined)
        await settlePackDecision()
        expect(safe.enter.mock.calls).toEqual([['noAnswer']])
    })

    test('a host that refuses the ask: the settle ends at once as no answer', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => { })
        startLaunchOptions({ requestLaunchOptions: () => { throw new Error('refused') } })
        await settlePackDecision()
        expect(safe.enter.mock.calls).toEqual([['noAnswer']])
        error.mockRestore()
    })

    test('a host without the method installs no hook and the settle ends at once as no answer', async () => {
        startLaunchOptions({})
        expect(window.__risuTaniumLaunchOptions).toBeUndefined()
        await settlePackDecision()
        expect(safe.enter.mock.calls).toEqual([['noAnswer']])
    })

    test('it never waits a second time', async () => {
        vi.useFakeTimers()
        startAsking()
        const first = settlePackDecision()
        await vi.advanceTimersByTimeAsync(2000)
        await first
        const second = settlePackDecision()
        expect(await resolvedAfterTurn(second)).toBe(true)
        expect(safe.enter.mock.calls).toEqual([['noAnswer']])
    })

    test('it never rejects, also when the entry fails', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => { })
        safe.enter.mockImplementation(() => { throw new Error('entry failed') })
        startLaunchOptions(undefined)
        await expect(settlePackDecision()).resolves.toBeUndefined()
        error.mockRestore()
    })
})

describe('TA2-3: the shortcut configuration (static, over the repository files)', () => {
    const androidApp = 'src-tauri/gen/android/app/src/main'
    const read = (path: string): string => readFileSync(resolve(process.cwd(), androidApp, path), 'utf8')

    test('shortcuts.xml targets the trampoline with the pack-safe action, never MainActivity', () => {
        const shortcuts = read('res/xml/shortcuts.xml')
        expect(shortcuts).toContain('android:action="io.github.yor42.risutanium.action.START_WITHOUT_THEME_PACK"')
        expect(shortcuts).toContain('android:targetClass="io.github.yor42.risutanium.PackSafeLaunchActivity"')
        expect(shortcuts).not.toContain('MainActivity')
        expect(shortcuts).toContain('@string/shortcut_no_pack_short')
        expect(shortcuts).toContain('@string/shortcut_no_pack_long')
    })

    test('the manifest declares the trampoline as a no-display, no-history activity of its own task, and the shortcuts meta-data on MainActivity', () => {
        const manifest = read('AndroidManifest.xml')
        const trampoline = manifest.match(/<activity\s[^>]*android:name="\.PackSafeLaunchActivity"[^>]*>/)?.[0] ?? ''
        expect(trampoline).toContain('android:theme="@android:style/Theme.NoDisplay"')
        expect(trampoline).toContain('android:taskAffinity=""')
        expect(trampoline).toContain('android:excludeFromRecents="true"')
        expect(trampoline).toContain('android:noHistory="true"')
        expect(trampoline).toContain('android:exported="true"')
        const main = manifest.slice(manifest.indexOf('android:name=".MainActivity"'), manifest.indexOf('</activity>'))
        expect(main).toContain('<meta-data android:name="android.app.shortcuts" android:resource="@xml/shortcuts" />')
    })

    test('both string files carry the two labels', () => {
        for (const file of ['res/values/strings.xml', 'res/values-ko/strings.xml']) {
            const strings = read(file)
            expect(strings, file).toContain('name="shortcut_no_pack_short"')
            expect(strings, file).toContain('name="shortcut_no_pack_long"')
        }
    })
})
