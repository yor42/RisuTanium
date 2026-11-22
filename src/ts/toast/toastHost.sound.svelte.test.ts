// @vitest-environment jsdom

/**
 * The toast host's cues (#246 S1b): the `sound` option of `createToastHost`, the cue of a plain toast, the undo outcome
 * cue, and the singleton's sink as the app-wide `ToastHost.svelte` installs it. The singleton runs against the fake Web
 * Audio of `uiSound.testKit.ts`, installed before the modules are imported.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ToastClock, ToastCue, UndoAction } from './toastHost.svelte'
import { installFakeAudio, warmUiSounds, type FakeAudio } from '../uiSound/uiSound.testKit'

vi.mock('../caughtErrors', () => ({ recordCaughtError: vi.fn() }))

let toastHostModule: typeof import('./toastHost.svelte')
let ToastHostView: typeof import('../../lib/Nexus/pattern/ToastHost.svelte').default
let studioOpen: typeof import('../studio/studioOpen').studioOpen
let audio: FakeAudio

beforeAll(async () => {
    audio = installFakeAudio()
    vi.useFakeTimers({ toFake: ['performance'] })
    toastHostModule = await import('./toastHost.svelte')
    ToastHostView = (await import('../../lib/Nexus/pattern/ToastHost.svelte')).default
    studioOpen = (await import('../studio/studioOpen')).studioOpen
})

afterAll(() => {
    vi.useRealTimers()
    audio.uninstall()
})

function fakeClock(): ToastClock & { advance(ms: number): void } {
    let time = 0
    let nextKey = 1
    const timers = new Map<number, { at: number, run: () => void }>()
    return {
        now: () => time,
        after(ms, run) {
            const key = nextKey++
            timers.set(key, { at: time + ms, run })
            return () => { timers.delete(key) }
        },
        advance(ms) {
            const target = time + ms
            for (;;) {
                let next: [number, { at: number, run: () => void }] | null = null
                for (const entry of timers) {
                    if (entry[1].at <= target && (next === null || entry[1].at < next[1].at)) {
                        next = entry
                    }
                }
                if (next === null) {
                    break
                }
                timers.delete(next[0])
                time = next[1].at
                next[1].run()
            }
            time = target
        },
    }
}

function withSpy(config?: { maxVisible?: number, stickyCap?: number }) {
    const clock = fakeClock()
    const sound = vi.fn<(cue: ToastCue) => void>()
    const host = toastHostModule.createToastHost({ clock, config, sound })
    return { clock, sound, host }
}

const cueOf = (url: string): string => url.match(/\/(scifi|studio)\/([\w-]+)\.mp3$/)?.slice(1).join('/') ?? url

describe('T10 the sound option plays the kind of each plain toast when it becomes visible', () => {
    test('reproducer (T10): info, success, warning and error each play their own cue once', () => {
        const { host, sound } = withSpy()
        host.post({ kind: 'info', text: 'i' })
        host.post({ kind: 'success', text: 's' })
        host.post({ kind: 'warning', text: 'w' })
        expect(sound.mock.calls.map((call) => call[0])).toEqual(['info', 'success', 'warning'])
        host.reset()
        sound.mockClear()
        host.post({ kind: 'error', text: 'e' })
        host.post({ text: 'default kind is info' })
        expect(sound.mock.calls.map((call) => call[0])).toEqual(['error', 'info'])
    })

    test('reproducer (T10): a queued sticky toast plays on release, not when posted', () => {
        const { host, sound, clock } = withSpy({ maxVisible: 3, stickyCap: 2 })
        host.post({ kind: 'error', text: 'e1' })
        host.post({ kind: 'error', text: 'e2' })
        sound.mockClear()
        host.post({ kind: 'warning', text: 'queued' })
        expect(host.count().queued).toBe(1)
        expect(sound).not.toHaveBeenCalled()
        host.dismiss(host.visible[0].id)
        expect(host.count().queued).toBe(0)
        expect(sound.mock.calls.map((call) => call[0])).toEqual(['warning'])
        clock.advance(1)
    })

    test('a throwing sound never disturbs the toast', () => {
        const clock = fakeClock()
        const host = toastHostModule.createToastHost({ clock, sound: () => { throw new Error('speaker') } })
        const id = host.post({ kind: 'info', text: 'still shown' })
        expect(id).not.toBe(toastHostModule.NO_TOAST)
        expect(host.visible.map((toast) => toast.text)).toEqual(['still shown'])
    })
})

describe('T11 silent toasts', () => {
    test('guard: cue null is silent', () => {
        const { host, sound } = withSpy()
        host.post({ kind: 'error', text: 'quiet', cue: null })
        expect(host.visible).toHaveLength(1)
        expect(sound).not.toHaveBeenCalled()
    })

    test('reproducer (T11): an explicit cue overrides the kind', () => {
        const { host, sound } = withSpy()
        host.post({ kind: 'info', text: 'restored', cue: 'undo' })
        expect(sound.mock.calls.map((call) => call[0])).toEqual(['undo'])
    })

    test('guard (MC-3566): the undo-offer toast is silent when it shows', () => {
        const { host, sound } = withSpy()
        host.postUndo({ text: 'Removed', actionLabel: 'Undo', action: { id: 'a', run: () => ({ ok: true, text: 'Back' }), failedText: 'FAILED' } })
        expect(host.visible).toHaveLength(1)
        expect(sound).not.toHaveBeenCalled()
    })
})

describe('T12 the undo outcome cue', () => {
    function offer(host: ReturnType<typeof withSpy>['host'], run: UndoAction['run']) {
        const id = host.postUndo({ text: 'Removed', actionLabel: 'Undo', action: { id: 'a', run, failedText: 'FAILED' } })
        return id
    }

    test('reproducer (T12): a successful run plays undo', async () => {
        const { host, sound } = withSpy()
        const id = offer(host, () => ({ ok: true, text: 'Restored' }))
        await host.activate(id)
        expect(sound.mock.calls.map((call) => call[0])).toEqual(['undo'])
    })

    test('reproducer (T12): a refusal, a throw and an invalid outcome play warning', async () => {
        for (const run of [
            () => ({ ok: false, text: 'Cannot', after: 'close' as const }),
            () => { throw new Error('boom') },
            () => ({ nothing: true }) as never,
        ]) {
            const { host, sound } = withSpy()
            const id = offer(host, run)
            await host.activate(id)
            expect(sound.mock.calls.map((call) => call[0])).toEqual(['warning'])
        }
    })

    test('reproducer (T12): a run that times out plays warning once and its late result is silent', async () => {
        const { host, sound, clock } = withSpy()
        let finish: (value: { ok: true, text: string }) => void = () => {}
        const id = offer(host, () => new Promise((resolve) => { finish = resolve }))
        const running = host.activate(id)
        clock.advance(toastHostModule.DEFAULT_TOAST_CONFIG.undoRunTimeoutMs)
        await running
        expect(sound.mock.calls.map((call) => call[0])).toEqual(['warning'])
        finish({ ok: true, text: 'too late' })
        await Promise.resolve()
        expect(sound).toHaveBeenCalledTimes(1)
    })

    test('reproducer (T12): the cue plays even when the toast ended while the run was pending', async () => {
        const { host, sound } = withSpy()
        let finish: (value: { ok: true, text: string }) => void = () => {}
        const id = offer(host, () => new Promise((resolve) => { finish = resolve }))
        const running = host.activate(id)
        host.dismiss(id)
        finish({ ok: true, text: 'Restored' })
        await running
        expect(sound.mock.calls.map((call) => call[0])).toEqual(['undo'])
    })
})

describe('the singleton sink installed by ToastHost.svelte', () => {
    let apps: ReturnType<typeof mount>[] = []
    let nodes: HTMLElement[] = []

    function mountView(props: Record<string, unknown> = {}) {
        const target = document.createElement('div')
        document.body.appendChild(target)
        nodes.push(target)
        const app = mount(ToastHostView, { target, props })
        apps.push(app)
        flushSync()
        return app
    }

    beforeEach(async () => {
        localStorage.clear()
        audio.endVoices()
        audio.started.length = 0
        vi.advanceTimersByTime(10000)
        await warmUiSounds()
        toastHostModule.resetToastHostForTests()
        studioOpen.set(false)
    })

    afterEach(() => {
        for (const app of apps) unmount(app)
        for (const node of nodes) node.remove()
        apps = []
        nodes = []
        toastHostModule.setToastSoundSink(null)
        toastHostModule.resetToastHostForTests()
        studioOpen.set(false)
    })

    test('reproducer (T16): a plain toast plays the sci-fi info cue, and the Studio one while Studio is open', async () => {
        mountView()
        toastHostModule.postToast({ kind: 'info', text: 'one' })
        expect(audio.startedUrls().map(cueOf)).toEqual(['scifi/info'])
        vi.advanceTimersByTime(1000)
        studioOpen.set(true)
        // A cue plays only once its pack is decoded, which the first gesture after Studio opens does.
        await warmUiSounds()
        toastHostModule.postToast({ kind: 'info', text: 'two' })
        expect(audio.startedUrls().map(cueOf)).toEqual(['scifi/info', 'studio/info'])
    })

    test('guard (T17): the switch off silences the toast cue', () => {
        localStorage.setItem('risutanium.uiSounds', '0')
        mountView()
        toastHostModule.postToast({ kind: 'info', text: 'quiet' })
        expect(audio.started).toEqual([])
    })

    test('a view of the singleton installs the sink and clears it on destroy', () => {
        expect(toastHostModule.currentToastSoundSink()).toBeNull()
        const app = mountView()
        expect(toastHostModule.currentToastSoundSink()).not.toBeNull()
        unmount(app)
        apps = []
        expect(toastHostModule.currentToastSoundSink()).toBeNull()
    })

    test('destroy leaves a sink somebody else installed since', () => {
        const app = mountView()
        const other = vi.fn()
        toastHostModule.setToastSoundSink(other)
        unmount(app)
        apps = []
        expect(toastHostModule.currentToastSoundSink()).toBe(other)
    })

    test('a view of a harness-owned host installs no sink', () => {
        const host = toastHostModule.createToastHost({ clock: fakeClock() })
        mountView({ host })
        expect(toastHostModule.currentToastSoundSink()).toBeNull()
        host.post({ kind: 'info', text: 'private' })
        expect(audio.started).toEqual([])
    })
})
