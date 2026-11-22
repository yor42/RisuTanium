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

const safe = vi.hoisted(() => ({ enter: vi.fn(), touch: vi.fn() }))

vi.mock(import('src/ts/themePack/packSafeMode.svelte'), () => ({
    enterPackSafeMode: safe.enter,
    setBannerTouchExploration: safe.touch,
}) as unknown as typeof import('src/ts/themePack/packSafeMode.svelte'))

import { startLaunchOptions } from './launchOptions'

beforeEach(() => {
    safe.enter.mockReset()
    safe.touch.mockReset()
})

afterEach(() => {
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
