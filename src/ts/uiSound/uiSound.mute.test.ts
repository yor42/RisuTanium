// @vitest-environment happy-dom

/**
 * The TalkBack mute (#246 S2, MC-3328): the facade plays nothing while the Android host reports touch exploration on,
 * plays again when it reports off without a reload, and is never muted without a host or by an unusable value. The host
 * is a fake channel shaped like the injected object and the sound is observed on the fake Web Audio of `uiSound.testKit.ts`,
 * installed before the facade is imported.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { createHostChannelFake } from '../android/hostChannelFake'
import { installFakeAudio, warmUiSounds, flushMicrotasks, type FakeAudio } from './uiSound.testKit'

let facade: typeof import('./uiSound')
let bridge: typeof import('../android/hostBridge')
let audio: FakeAudio

beforeAll(async () => {
    audio = installFakeAudio()
    vi.useFakeTimers({ toFake: ['performance'] })
    facade = await import('./uiSound')
    bridge = await import('../android/hostBridge')
})

afterAll(() => {
    vi.useRealTimers()
    audio.uninstall()
})

beforeEach(async () => {
    localStorage.clear()
    // The player drops a repeat of a cue inside its debounce window.
    vi.advanceTimersByTime(10_000)
    await warmUiSounds()
})

afterEach(() => {
    delete window.__risuTaniumHost
    delete window.__risuTaniumAccessibility
    bridge.connectHostBridge()
})

async function play(): Promise<number> {
    const before = audio.started.length
    vi.advanceTimersByTime(10_000)
    facade.playUiSound('info')
    await flushMicrotasks()
    return audio.started.length - before
}

describe('UI sounds while TalkBack is on', () => {
    // T24: reproducer; the unmute half fails when the facade never mutes, the mute half when it never unmutes.
    test('a pushed true silences the cues, a pushed false brings them back, a non-boolean changes nothing', async () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        bridge.connectHostBridge()
        expect(await play()).toBe(1)

        fake.deliver('{"event":"touchExploration","enabled":true}')
        expect(await play()).toBe(0)
        expect(facade.uiSoundsMutedByTalkBack()).toBe(true)

        fake.deliver('{"event":"touchExploration","enabled":"false"}')
        expect(await play()).toBe(0)

        fake.deliver('{"event":"touchExploration","enabled":false}')
        expect(await play()).toBe(1)
        expect(facade.uiSoundsMutedByTalkBack()).toBe(false)
    })

    // T25 at the facade: the separate object mutes too, read per play.
    test('the separate object mutes while it answers true and unmutes when it answers false', async () => {
        let on = true
        window.__risuTaniumAccessibility = { touchExploration: () => on }
        expect(await play()).toBe(0)
        on = false
        expect(await play()).toBe(1)
    })

    // Guards: off Android, or with an unusable answer, the cues are never muted.
    test('guard: no host and an unusable answer never mute', async () => {
        expect(await play()).toBe(1)
        window.__risuTaniumAccessibility = { touchExploration: () => 'yes' }
        expect(await play()).toBe(1)
    })
})
