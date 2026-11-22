// @vitest-environment jsdom

/**
 * The cue of an import Undo's result toast (#246 S1b): `reportUndo` through the real toast host, with the app-wide
 * `ToastHost.svelte` installing the sink, against the fake Web Audio of `uiSound.testKit.ts` installed before import.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { installFakeAudio, warmUiSounds, type FakeAudio } from './uiSound/uiSound.testKit'

vi.mock('./caughtErrors', () => ({ recordCaughtError: vi.fn() }))
// The real stores module starts the parser's selected-asset effect, which needs the whole app's stores.
vi.mock('./stores.svelte', () => ({ DBState: { db: {} } }))

let reportUndo: typeof import('./importUndo').reportUndo
let toastHostModule: typeof import('./toast/toastHost.svelte')
let ToastHostView: typeof import('../lib/Nexus/pattern/ToastHost.svelte').default
let audio: FakeAudio
let app: ReturnType<typeof mount> | null = null

const cueOf = (url: string): string => url.match(/\/(scifi|studio)\/([\w-]+)\.mp3$/)?.slice(1).join('/') ?? url

beforeAll(async () => {
    audio = installFakeAudio()
    vi.useFakeTimers({ toFake: ['performance'] })
    reportUndo = (await import('./importUndo')).reportUndo
    toastHostModule = await import('./toast/toastHost.svelte')
    ToastHostView = (await import('../lib/Nexus/pattern/ToastHost.svelte')).default
})

afterAll(() => {
    vi.useRealTimers()
    audio.uninstall()
})

beforeEach(async () => {
    localStorage.clear()
    audio.endVoices()
    audio.started.length = 0
    vi.advanceTimersByTime(10000)
    await warmUiSounds()
    toastHostModule.resetToastHostForTests()
    const target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ToastHostView, { target, props: {} })
    flushSync()
})

afterEach(() => {
    if (app) unmount(app)
    app = null
    toastHostModule.setToastSoundSink(null)
    toastHostModule.resetToastHostForTests()
})

describe('T13 reportUndo cues', () => {
    test('reproducer (T13): a successful Undo plays the undo cue', () => {
        reportUndo({ trashed: 1, removed: 0, missing: 0 })
        expect(toastHostModule.toastHost.visible).toHaveLength(1)
        expect(audio.startedUrls().map(cueOf)).toEqual(['scifi/undo'])
    })

    test('guard: a refused Undo keeps the warning cue', () => {
        reportUndo({ refused: true })
        expect(toastHostModule.toastHost.visible).toHaveLength(1)
        expect(audio.startedUrls().map(cueOf)).toEqual(['scifi/warning'])
    })
})
