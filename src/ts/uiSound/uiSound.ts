import { get } from 'svelte/store'
import scifiError from '../../etc/uisfx/scifi/error.mp3'
import scifiInfo from '../../etc/uisfx/scifi/info.mp3'
import scifiReceive from '../../etc/uisfx/scifi/receive.mp3'
import scifiSend from '../../etc/uisfx/scifi/send.mp3'
import scifiSuccess from '../../etc/uisfx/scifi/success.mp3'
import scifiToggleOff from '../../etc/uisfx/scifi/toggle-off.mp3'
import scifiToggleOn from '../../etc/uisfx/scifi/toggle-on.mp3'
import scifiUndo from '../../etc/uisfx/scifi/undo.mp3'
import scifiWarning from '../../etc/uisfx/scifi/warning.mp3'
import studioError from '../../etc/uisfx/studio/error.mp3'
import studioInfo from '../../etc/uisfx/studio/info.mp3'
import studioReceive from '../../etc/uisfx/studio/receive.mp3'
import studioSend from '../../etc/uisfx/studio/send.mp3'
import studioSuccess from '../../etc/uisfx/studio/success.mp3'
import studioToggleOff from '../../etc/uisfx/studio/toggle-off.mp3'
import studioToggleOn from '../../etc/uisfx/studio/toggle-on.mp3'
import studioUndo from '../../etc/uisfx/studio/undo.mp3'
import studioWarning from '../../etc/uisfx/studio/warning.mp3'
import { hostTouchExploration } from '../android/hostBridge'
import { studioOpen } from '../studio/studioOpen'
import { createUiSoundPlayer, type UiSoundCue, type UiSoundPack, type UiSoundPlayer } from './uiSoundPlayer'
import { readUiSounds, uiSoundContextCtor, uiSoundsSupported } from './uiSoundPrefs'

export type { UiSoundCue, UiSoundPack } from './uiSoundPlayer'

/** The one table mapping each cue to its file in each pack. */
const CUE_URLS: Readonly<Record<UiSoundPack, Readonly<Record<UiSoundCue, string>>>> = {
    scifi: {
        send: scifiSend,
        receive: scifiReceive,
        error: scifiError,
        warning: scifiWarning,
        success: scifiSuccess,
        info: scifiInfo,
        undo: scifiUndo,
        'toggle-on': scifiToggleOn,
        'toggle-off': scifiToggleOff,
    },
    studio: {
        send: studioSend,
        receive: studioReceive,
        error: studioError,
        warning: studioWarning,
        success: studioSuccess,
        info: studioInfo,
        undo: studioUndo,
        'toggle-on': studioToggleOn,
        'toggle-off': studioToggleOff,
    },
}

/** The Studio pack sounds while Studio is open; everything else uses the sci-fi pack. */
function activePack(): UiSoundPack {
    return get(studioOpen) ? 'studio' : 'scifi'
}

/** Sounds are on and the page can play them; read per call so a late-installed AudioContext or a changed switch counts. */
function soundsOn(): boolean {
    return uiSoundsSupported() && readUiSounds(true)
}

/** Android touch exploration (TalkBack) mutes the cues; read per play, unknown (no host) never mutes. */
function soundsMuted(): boolean {
    return hostTouchExploration() === true
}

/** True while TalkBack mutes the UI sounds; the settings row shows a note for it. */
export function uiSoundsMutedByTalkBack(): boolean {
    return soundsMuted()
}

let player: UiSoundPlayer | null = null

function getPlayer(): UiSoundPlayer {
    player ??= createUiSoundPlayer({
        createContext: () => {
            const Ctor = uiSoundContextCtor()
            if (!Ctor) throw new Error('Web Audio is not available')
            return new Ctor()
        },
        fetchBytes: async (url) => {
            const response = await fetch(url)
            if (!response.ok) throw new Error(`UI sound ${url} answered ${response.status}`)
            return response.arrayBuffer()
        },
        now: () => performance.now(),
        setTimer: (run, ms) => {
            const handle = setTimeout(run, ms)
            return () => clearTimeout(handle)
        },
        enabled: soundsOn,
        muted: soundsMuted,
        pack: activePack,
        urlOf: (pack, cue) => CUE_URLS[pack][cue],
    })
    return player
}

/** Plays the cue when this device has sounds on and Web Audio; otherwise does nothing. Never throws. */
export function playUiSound(cue: UiSoundCue): void {
    try {
        if (!soundsOn()) return
        getPlayer().play(cue)
    } catch (error) {
        console.warn('UI sound failed:', error)
    }
}

let removeUnlock: (() => void) | null = null

/**
 * Listens for the first user gesture at which sounds are on, then creates and resumes the context and decodes the
 * active pack, so a cue that fires later from an asynchronous event can play. Installing twice keeps one listener.
 * Returns a remover.
 */
export function installUiSoundUnlock(): () => void {
    if (removeUnlock !== null || typeof window === 'undefined') return removeUnlock ?? (() => {})
    const handler = (): void => {
        if (!soundsOn()) return
        remove()
        try {
            void getPlayer().unlock()
        } catch (error) {
            console.warn('UI sound failed:', error)
        }
    }
    const remove = (): void => {
        window.removeEventListener('pointerdown', handler, true)
        window.removeEventListener('keydown', handler, true)
        removeUnlock = null
    }
    window.addEventListener('pointerdown', handler, true)
    window.addEventListener('keydown', handler, true)
    removeUnlock = remove
    return remove
}
