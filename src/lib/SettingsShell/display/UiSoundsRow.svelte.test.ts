// @vitest-environment jsdom

/**
 * The Display "UI sounds" row: it shows this device's stored choice, writes it through the prefs module, confirms an
 * enable with the toggle-on cue (observed through the fake Web Audio) and stays silent on disable or without Web Audio.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { flushMicrotasks, installFakeAudio, type FakeAudio } from 'src/ts/uiSound/uiSound.testKit'

// The row and the svelte runtime are loaded together after each module reset, so the facade's player starts fresh.
let instances: { unmount(): Promise<unknown> }[] = []
let flushSync: () => void = () => {}
let audio: FakeAudio | null = null

async function render(): Promise<HTMLElement> {
    const svelte = await import('svelte')
    flushSync = svelte.flushSync
    const { default: UiSoundsRow } = await import('./UiSoundsRow.svelte')
    const target = document.createElement('div')
    document.body.appendChild(target)
    const inst = svelte.mount(UiSoundsRow, { target, props: {} })
    instances.push({ unmount: () => svelte.unmount(inst) })
    flushSync()
    return target
}

const boxOf = (root: HTMLElement): HTMLInputElement | null => root.querySelector('input[type="checkbox"]')

function flip(box: HTMLInputElement, to: boolean): void {
    box.checked = to
    box.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
}

beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
    for (const inst of instances.splice(0)) await inst.unmount().catch(() => {})
    document.body.innerHTML = ''
    audio?.uninstall()
    audio = null
    vi.restoreAllMocks()
})

describe('UiSoundsRow', () => {
    // Guards: a fresh device showing the switch off, and a missing label, chip or help line.
    test('is on by default, named, explained and marked as this device only', async () => {
        audio = installFakeAudio()
        const root = await render()
        expect(boxOf(root)!.checked).toBe(true)
        expect(boxOf(root)!.getAttribute('aria-label')).toBe(language.uiSoundsLabel)
        expect(root.querySelector('[data-part="settings-device-chip"]')!.textContent).toBe(language.chatShellOnThisDevice)
        expect(root.querySelector('[data-part="settings-ui-sounds-help"]')!.textContent).toBe(language.uiSoundsDesc)
    })

    // Guards: the switch ignoring a stored "off" at mount.
    test('shows a stored off choice', async () => {
        audio = installFakeAudio()
        localStorage.setItem('risutanium.uiSounds', '0')
        expect(boxOf(await render())!.checked).toBe(false)
    })

    // Guards: the row writing a different key, or not writing at all.
    test('toggling writes the device key', async () => {
        audio = installFakeAudio()
        const root = await render()
        flip(boxOf(root)!, false)
        expect(localStorage.getItem('risutanium.uiSounds')).toBe('0')
        flip(boxOf(root)!, true)
        expect(localStorage.getItem('risutanium.uiSounds')).toBe('1')
    })

    // Guards: turning on staying mute, or turning off making a sound.
    test('turning on plays toggle-on and turning off is silent', async () => {
        audio = installFakeAudio()
        localStorage.setItem('risutanium.uiSounds', '0')
        const root = await render()
        flip(boxOf(root)!, true)
        await flushMicrotasks()
        // The first play of a cue decodes it; the cue sounds once it is ready.
        flip(boxOf(root)!, false)
        flip(boxOf(root)!, true)
        await flushMicrotasks()
        expect(audio.startedUrls().every((url) => /uisfx\/scifi\/toggle-on\.mp3$/.test(url))).toBe(true)
        expect(audio.startedUrls()).toHaveLength(1)
        const before = audio.started.length
        flip(boxOf(root)!, false)
        await flushMicrotasks()
        expect(audio.started).toHaveLength(before)
    })

    // Reproducer for the TalkBack note: the row says why nothing sounds while touch exploration is on, and says nothing otherwise.
    test('shows the TalkBack note only while touch exploration is on', async () => {
        audio = installFakeAudio()
        window.__risuTaniumAccessibility = { touchExploration: () => true }
        try {
            const muted = await render()
            expect(muted.querySelector('[data-part="settings-ui-sounds-talkback"]')!.textContent).toBe(language.uiSoundsTalkBackMuted)
            window.__risuTaniumAccessibility = { touchExploration: () => false }
            expect((await render()).querySelector('[data-part="settings-ui-sounds-talkback"]')).toBeNull()
        } finally {
            delete window.__risuTaniumAccessibility
        }
    })

    // Guards: offering a switch that can never sound on a page without Web Audio.
    test('renders nothing without an AudioContext', async () => {
        const root = await render()
        expect(boxOf(root)).toBeNull()
    })
})
