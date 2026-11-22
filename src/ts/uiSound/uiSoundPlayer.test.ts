import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import {
    IDLE_SUSPEND_MS,
    RESUME_WINDOW_MS,
    SAME_CUE_DEBOUNCE_MS,
    UI_SOUND_CUES,
    UI_SOUND_GAIN,
    createUiSoundPlayer,
    type UiSoundCue,
    type UiSoundPack,
    type UiSoundPlayer,
} from './uiSoundPlayer'
import { createManualClock, flushMicrotasks, installFakeAudio, type FakeAudio, type ManualClock } from './uiSound.testKit'

let audio: FakeAudio
let clock: ManualClock
let state: { enabled: boolean; muted: boolean; pack: UiSoundPack }
let warn: MockInstance<typeof console.warn>

const urlOf = (pack: UiSoundPack, cue: UiSoundCue): string => `/cues/${pack}/${cue}.mp3`

function makePlayer(): UiSoundPlayer {
    return createUiSoundPlayer({
        createContext: () => new AudioContext(),
        fetchBytes: async (url) => {
            const response = await fetch(url)
            if (!response.ok) throw new Error('not found')
            return response.arrayBuffer()
        },
        now: clock.now,
        setTimer: clock.setTimer,
        enabled: () => state.enabled,
        muted: () => state.muted,
        pack: () => state.pack,
        urlOf,
    })
}

async function readyPlayer(): Promise<UiSoundPlayer> {
    const player = makePlayer()
    await player.preload('scifi')
    await player.preload('studio')
    return player
}

beforeEach(() => {
    audio = installFakeAudio()
    clock = createManualClock()
    state = { enabled: true, muted: false, pack: 'scifi' }
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    audio.uninstall()
    warn.mockRestore()
})

// The player is a new module: these are compatibility guards on its contract, not reproducers of a pre-fix defect.
describe('player: starting a cue', () => {
    it('plays the pack file at the manifest gain once the context runs', async () => {
        const player = await readyPlayer()
        player.play('send')
        await flushMicrotasks()
        expect(audio.started).toEqual([{ url: '/cues/scifi/send.mp3', gain: UI_SOUND_GAIN.scifi.send }])
        expect(audio.contexts).toHaveLength(1)
        expect(audio.contexts[0]!.resumeCalls).toBe(1)
    })

    it('takes the file from the pack current at play time', async () => {
        const player = await readyPlayer()
        state.pack = 'studio'
        player.play('undo')
        await flushMicrotasks()
        expect(audio.startedUrls()).toEqual(['/cues/studio/undo.mp3'])
    })

    it('carries the manifest gains for every cue of both packs', () => {
        const volumes = [0.2, 0.2, 0.22, 0.22, 0.23, 0.16, 0.18, 0.2, 0.18]
        expect(UI_SOUND_CUES.map((cue) => UI_SOUND_GAIN.scifi[cue])).toEqual(volumes)
        expect(UI_SOUND_CUES.map((cue) => UI_SOUND_GAIN.studio[cue])).toEqual(volumes)
    })

    it('does nothing and builds no context while off or muted', async () => {
        const player = await readyPlayer()
        const contexts = audio.contexts.length
        state.enabled = false
        player.play('send')
        state.enabled = true
        state.muted = true
        player.play('send')
        await flushMicrotasks()
        expect(audio.started).toEqual([])
        expect(audio.contexts).toHaveLength(contexts)
    })

    it('drops a cue whose buffer is still decoding instead of queueing it', async () => {
        const player = makePlayer()
        audio.holdFetches()
        player.play('send')
        await flushMicrotasks()
        player.play('send')
        audio.releaseFetches()
        await flushMicrotasks()
        expect(audio.started).toEqual([])
        expect(audio.fetched).toEqual(['/cues/scifi/send.mp3'])
        clock.advance(SAME_CUE_DEBOUNCE_MS)
        player.play('send')
        await flushMicrotasks()
        expect(audio.startedUrls()).toEqual(['/cues/scifi/send.mp3'])
    })
})

describe('player: one voice with priorities and a debounce', () => {
    it('lets a higher-priority cue cut a sounding one, and an equal one too', async () => {
        const player = await readyPlayer()
        player.play('toggle-on')
        await flushMicrotasks()
        player.play('error')
        await flushMicrotasks()
        player.play('send')
        await flushMicrotasks()
        // error (3) is not cut by send (2); only the first two started.
        expect(audio.startedUrls()).toEqual(['/cues/scifi/toggle-on.mp3', '/cues/scifi/error.mp3'])
        audio.endVoices()
        player.play('send')
        await flushMicrotasks()
        player.play('receive')
        await flushMicrotasks()
        expect(audio.startedUrls().slice(2)).toEqual(['/cues/scifi/send.mp3', '/cues/scifi/receive.mp3'])
    })

    it('drops a lower-priority cue while a higher one sounds and plays it after the voice ends', async () => {
        const player = await readyPlayer()
        player.play('undo')
        await flushMicrotasks()
        player.play('info')
        player.play('toggle-off')
        await flushMicrotasks()
        expect(audio.startedUrls()).toEqual(['/cues/scifi/undo.mp3'])
        audio.endVoices()
        player.play('info')
        await flushMicrotasks()
        expect(audio.startedUrls()).toEqual(['/cues/scifi/undo.mp3', '/cues/scifi/info.mp3'])
    })

    it('stops the cut cue so two sources never sound together', async () => {
        const player = await readyPlayer()
        player.play('warning')
        await flushMicrotasks()
        player.play('error')
        await flushMicrotasks()
        expect(audio.started).toHaveLength(2)
        expect(audio.sounding()).toBe(1)
    })

    it('drops the same cue within 120 ms and plays it again after', async () => {
        const player = await readyPlayer()
        player.play('success')
        await flushMicrotasks()
        clock.advance(SAME_CUE_DEBOUNCE_MS - 1)
        player.play('success')
        await flushMicrotasks()
        expect(audio.started).toHaveLength(1)
        clock.advance(1)
        player.play('success')
        await flushMicrotasks()
        expect(audio.started).toHaveLength(2)
    })
})

describe('player: context lifecycle', () => {
    it('suspends the context after 2 s idle and resumes it for the next cue', async () => {
        const player = await readyPlayer()
        player.play('send')
        await flushMicrotasks()
        audio.endVoices()
        const ctx = audio.contexts[0]!
        clock.advance(IDLE_SUSPEND_MS - 1)
        expect(ctx.suspendCalls).toBe(0)
        clock.advance(1)
        await flushMicrotasks()
        expect(ctx.suspendCalls).toBe(1)
        expect(ctx.state).toBe('suspended')
        player.play('receive')
        await flushMicrotasks()
        expect(ctx.resumeCalls).toBe(2)
        expect(audio.startedUrls()).toEqual(['/cues/scifi/send.mp3', '/cues/scifi/receive.mp3'])
    })

    it('does not suspend while a voice is still sounding', async () => {
        const player = await readyPlayer()
        player.play('send')
        await flushMicrotasks()
        clock.advance(IDLE_SUSPEND_MS * 2)
        expect(audio.contexts[0]!.suspendCalls).toBe(0)
        audio.endVoices()
        clock.advance(IDLE_SUSPEND_MS)
        expect(audio.contexts[0]!.suspendCalls).toBe(1)
    })

    it('drops the cue, and never plays it late, when the context does not run within 300 ms', async () => {
        const player = await readyPlayer()
        audio.blockResume = true
        player.play('send')
        await flushMicrotasks()
        clock.advance(RESUME_WINDOW_MS)
        await flushMicrotasks()
        audio.contexts[0]!.state = 'running'
        await flushMicrotasks()
        expect(audio.started).toEqual([])
    })

    it('drops the cue when resume is refused', async () => {
        const player = await readyPlayer()
        audio.rejectResume = true
        player.play('send')
        await flushMicrotasks()
        expect(audio.started).toEqual([])
        expect(() => player.play('send')).not.toThrow()
    })

    it('unlock resumes the context and decodes the active pack only', async () => {
        const player = makePlayer()
        await player.unlock()
        expect(audio.contexts).toHaveLength(1)
        expect(audio.contexts[0]!.state).toBe('running')
        expect(audio.fetched.slice().sort()).toEqual(UI_SOUND_CUES.map((cue) => urlOf('scifi', cue)).sort())
        player.play('send')
        await flushMicrotasks()
        expect(audio.startedUrls()).toEqual(['/cues/scifi/send.mp3'])
    })

    it('suspends the context 2 s after unlock when no cue plays', async () => {
        const player = makePlayer()
        await player.unlock()
        await flushMicrotasks()
        const ctx = audio.contexts[0]!
        clock.advance(IDLE_SUSPEND_MS - 1)
        expect(ctx.suspendCalls).toBe(0)
        clock.advance(1)
        await flushMicrotasks()
        expect(ctx.suspendCalls).toBe(1)
        expect(ctx.state).toBe('suspended')
    })

    it('suspends the context 2 s after a preload decode when no cue plays', async () => {
        const player = makePlayer()
        await player.preload('scifi')
        clock.advance(IDLE_SUSPEND_MS)
        await flushMicrotasks()
        expect(audio.contexts[0]!.suspendCalls).toBe(1)
    })

    it('suspends the context 2 s after a resume that lands too late to play', async () => {
        const player = await readyPlayer()
        clock.advance(IDLE_SUSPEND_MS)
        await flushMicrotasks()
        const ctx = audio.contexts[0]!
        expect(ctx.state).toBe('suspended')
        const before = ctx.suspendCalls
        let land: () => void = () => {}
        ctx.resume = () => {
            ctx.resumeCalls++
            return new Promise<void>((resolve) => { land = () => { ctx.state = 'running'; resolve() } })
        }
        player.play('send')
        await flushMicrotasks()
        clock.advance(RESUME_WINDOW_MS)
        await flushMicrotasks()
        land()
        await flushMicrotasks()
        expect(ctx.state).toBe('running')
        clock.advance(IDLE_SUSPEND_MS)
        await flushMicrotasks()
        expect(audio.started).toEqual([])
        expect(ctx.suspendCalls).toBe(before + 1)
        expect(ctx.state).toBe('suspended')
    })

    it('unlock does nothing while sounds are off', async () => {
        const player = makePlayer()
        state.enabled = false
        await player.unlock()
        expect(audio.contexts).toHaveLength(0)
        expect(audio.fetched).toEqual([])
    })
})

describe('player: failures stay silent', () => {
    it('logs a failed fetch once, keeps the cue silent and does not refetch', async () => {
        const player = makePlayer()
        audio.failFetch.add('/cues/scifi/send.mp3')
        player.play('send')
        await flushMicrotasks()
        player.play('send')
        player.play('send')
        await flushMicrotasks()
        expect(audio.started).toEqual([])
        expect(audio.fetched).toEqual(['/cues/scifi/send.mp3'])
        expect(warn).toHaveBeenCalledTimes(1)
    })

    it('logs a failed decode once and still plays the other cues', async () => {
        audio.failDecode.add('/cues/scifi/error.mp3')
        const player = await readyPlayer()
        player.play('error')
        player.play('error')
        await flushMicrotasks()
        expect(audio.started).toEqual([])
        expect(warn).toHaveBeenCalledTimes(1)
        player.play('info')
        await flushMicrotasks()
        expect(audio.startedUrls()).toEqual(['/cues/scifi/info.mp3'])
    })

    it('never throws when the context cannot be built', () => {
        const player = createUiSoundPlayer({
            createContext: () => { throw new Error('no audio') },
            fetchBytes: async () => new ArrayBuffer(0),
            now: clock.now,
            setTimer: clock.setTimer,
            enabled: () => true,
            muted: () => false,
            pack: () => 'scifi',
            urlOf,
        })
        expect(() => player.play('send')).not.toThrow()
        expect(() => player.play('send')).not.toThrow()
    })

    it('never throws when an injected dependency throws', () => {
        const player = createUiSoundPlayer({
            createContext: () => new AudioContext(),
            fetchBytes: async () => new ArrayBuffer(0),
            now: clock.now,
            setTimer: clock.setTimer,
            enabled: () => { throw new Error('storage') },
            muted: () => false,
            pack: () => 'scifi',
            urlOf,
        })
        expect(() => player.play('send')).not.toThrow()
    })
})
