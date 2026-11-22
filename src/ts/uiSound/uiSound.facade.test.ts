// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UI_SOUND_CUES } from './uiSoundPlayer'
import { flushMicrotasks, installFakeAudio, type FakeAudio } from './uiSound.testKit'

let audio: FakeAudio | null = null

// The fake is installed before the facade is imported, as the hooks' own tests do.
async function loadFacade(withAudio: boolean) {
    vi.resetModules()
    if (withAudio) audio = installFakeAudio()
    const facade = await import('./uiSound')
    const { studioOpen } = await import('../studio/studioOpen')
    return { ...facade, studioOpen }
}

beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    audio?.uninstall()
    audio = null
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('facade: support and the switch (T21, T17)', () => {
    // Guard: a page without Web Audio must stay silent and quiet.
    it('is a no-op without an AudioContext', async () => {
        const { playUiSound } = await loadFacade(false)
        const { uiSoundsSupported } = await import('./uiSoundPrefs')
        expect(uiSoundsSupported()).toBe(false)
        expect(() => playUiSound('send')).not.toThrow()
    })

    it('plays through a context installed before import and stays silent with the switch off', async () => {
        const { playUiSound } = await loadFacade(true)
        // The first play only decodes the cue; a later one starts it.
        playUiSound('send')
        await flushMicrotasks()
        localStorage.setItem('risutanium.uiSounds', '0')
        playUiSound('send')
        await flushMicrotasks()
        expect(audio!.started).toEqual([])
        localStorage.setItem('risutanium.uiSounds', '1')
        playUiSound('send')
        await flushMicrotasks()
        expect(audio!.startedUrls()).toHaveLength(1)
        expect(audio!.startedUrls()[0]).toMatch(/uisfx\/scifi\/send\.mp3$/)
    })
})

describe('facade: cue table and packs (T16 shape)', () => {
    it('maps every cue to its own file in each pack', async () => {
        const { playUiSound, studioOpen } = await loadFacade(true)
        for (const cue of UI_SOUND_CUES) playUiSound(cue)
        studioOpen.set(true)
        for (const cue of UI_SOUND_CUES) playUiSound(cue)
        studioOpen.set(false)
        await flushMicrotasks()
        const urls = audio!.fetched
        expect(urls).toHaveLength(18)
        expect(new Set(urls).size).toBe(18)
        for (const cue of UI_SOUND_CUES) {
            expect(urls.filter((url) => url.endsWith(`/scifi/${cue}.mp3`))).toHaveLength(1)
            expect(urls.filter((url) => url.endsWith(`/studio/${cue}.mp3`))).toHaveLength(1)
        }
    })

    it('plays the Studio pack while Studio is open and the sci-fi pack otherwise', async () => {
        vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
        const { playUiSound, studioOpen } = await loadFacade(true)
        const packOfStarts = () => audio!.startedUrls().map((url) => url.match(/uisfx\/(\w+)\//)?.[1])
        // The first play of each cue only decodes it; the next one starts it.
        playUiSound('info')
        await flushMicrotasks()
        playUiSound('info')
        await flushMicrotasks()
        expect(packOfStarts()).toEqual(['scifi'])
        vi.advanceTimersByTime(500)
        studioOpen.set(true)
        playUiSound('info')
        await flushMicrotasks()
        vi.advanceTimersByTime(500)
        playUiSound('info')
        await flushMicrotasks()
        expect(packOfStarts()).toEqual(['scifi', 'studio'])
        vi.advanceTimersByTime(500)
        studioOpen.set(false)
        playUiSound('info')
        await flushMicrotasks()
        expect(packOfStarts()).toEqual(['scifi', 'studio', 'scifi'])
    })
})

describe('facade: unlock', () => {
    it('on the first gesture creates and resumes the context and decodes the active pack, once', async () => {
        const { installUiSoundUnlock } = await loadFacade(true)
        installUiSoundUnlock()
        installUiSoundUnlock()
        expect(audio!.contexts).toHaveLength(0)
        window.dispatchEvent(new Event('keydown'))
        await flushMicrotasks()
        expect(audio!.contexts).toHaveLength(1)
        expect(audio!.contexts[0]!.state).toBe('running')
        expect(audio!.fetched).toHaveLength(9)
        expect(audio!.fetched.every((url) => url.includes('/scifi/'))).toBe(true)
        window.dispatchEvent(new Event('pointerdown'))
        await flushMicrotasks()
        expect(audio!.contexts).toHaveLength(1)
        expect(audio!.fetched).toHaveLength(9)
    })

    it('keeps listening while sounds are off and unlocks at the first gesture after they are turned on', async () => {
        const { installUiSoundUnlock } = await loadFacade(true)
        localStorage.setItem('risutanium.uiSounds', '0')
        installUiSoundUnlock()
        window.dispatchEvent(new Event('pointerdown'))
        await flushMicrotasks()
        expect(audio!.contexts).toHaveLength(0)
        localStorage.removeItem('risutanium.uiSounds')
        window.dispatchEvent(new Event('pointerdown'))
        await flushMicrotasks()
        expect(audio!.contexts).toHaveLength(1)
        expect(audio!.fetched).toHaveLength(9)
    })

    it('does nothing and does not throw when the page has no AudioContext', async () => {
        const { installUiSoundUnlock } = await loadFacade(false)
        installUiSoundUnlock()
        expect(() => window.dispatchEvent(new Event('pointerdown'))).not.toThrow()
    })
})
