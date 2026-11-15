/**
 * The pure rules for recording and showing a shortcut chord. No stores, no Svelte, no platform module: the hotkey
 * engine imports it, so it must stay dependency-free.
 *
 * `Chord.ctrl` is the ctrl slot of the stored hotkey. On Apple it means the command key, everywhere else the
 * control key. `Chord.key` is the raw `KeyboardEvent.key`, never `code`.
 */

export interface Chord {
    key: string
    ctrl: boolean
    alt: boolean
    shift: boolean
}

export interface ChordInput {
    key: string
    ctrlKey: boolean
    altKey: boolean
    shiftKey: boolean
    metaKey: boolean
    isComposing?: boolean
    keyCode?: number
    /** `getModifierState('AltGraph')` of the event. */
    altGraph?: boolean
}

export type Refusal = 'bare' | 'navKey' | 'shiftOnly' | 'macCtrl' | 'super' | 'altGr' | 'browser' | 'edit'

export type ChordRead =
    | { kind: 'ignore' }
    | { kind: 'cancel' }
    | { kind: 'leave' }
    | { kind: 'modifiers', ctrl: boolean, alt: boolean, shift: boolean }
    | { kind: 'refused', reason: Refusal, chord?: Chord }
    | { kind: 'chord', chord: Chord }

interface NavigatorLike {
    platform?: string
    userAgentData?: { platform?: string }
}

/** Mac, iPhone, iPad and iPod. iPadOS reports `MacIntel` and so counts as Apple. */
export function isApplePlatform(nav: NavigatorLike): boolean {
    const reported = nav.userAgentData?.platform
    if (reported) {
        return /macOS|iOS/i.test(reported)
    }
    return /Mac|iPhone|iPad|iPod/.test(nav.platform ?? '')
}

let appleMemo: boolean | undefined

export function hotkeyIsApple(): boolean {
    if (appleMemo === undefined) {
        appleMemo = typeof navigator === 'undefined' ? false : isApplePlatform(navigator as NavigatorLike)
    }
    return appleMemo
}

/** Clears the memoised platform so a test can change `navigator`. */
export function resetHotkeyPlatformForTests(): void {
    appleMemo = undefined
}

export function chordInputOf(ev: KeyboardEvent): ChordInput {
    return {
        key: ev.key,
        ctrlKey: ev.ctrlKey,
        altKey: ev.altKey,
        shiftKey: ev.shiftKey,
        metaKey: ev.metaKey,
        isComposing: ev.isComposing,
        keyCode: ev.keyCode,
        altGraph: typeof ev.getModifierState === 'function' && ev.getModifierState('AltGraph'),
    }
}

const IGNORED_KEYS = new Set(['Dead', 'Unidentified', 'Process', 'CapsLock', 'NumLock', 'ScrollLock'])
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete', 'Insert'])
const BROWSER_F_KEYS = new Set(['f5', 'f11', 'f12'])

function isFunctionKey(key: string): boolean {
    return /^F([1-9]|1[0-9]|2[0-4])$/.test(key)
}

/** Browser-reserved: Ctrl+W/T/N/L/R, Ctrl+Tab, Ctrl+Shift+T/N/W, Alt+F4, and F5/F11/F12 with any modifiers. */
function isBrowserReserved(chord: Chord): boolean {
    const key = chord.key.toLowerCase()
    if (BROWSER_F_KEYS.has(key)) {
        return true
    }
    if (chord.ctrl && !chord.alt) {
        if (!chord.shift && ['w', 't', 'n', 'l', 'r'].includes(key)) {
            return true
        }
        if (chord.shift && ['t', 'n', 'w'].includes(key)) {
            return true
        }
        if (key === 'tab') {
            return true
        }
    }
    return chord.alt && !chord.ctrl && !chord.shift && key === 'f4'
}

/** Edit-reserved: Ctrl+V/C/X/A/Z with the ctrl slot alone. */
function isEditReserved(chord: Chord): boolean {
    return chord.ctrl && !chord.alt && !chord.shift && ['v', 'c', 'x', 'a', 'z'].includes(chord.key.toLowerCase())
}

export function reservedNote(chord: Chord): 'browser' | 'edit' | null {
    if (!chord.key) {
        return null
    }
    if (isBrowserReserved(chord)) {
        return 'browser'
    }
    return isEditReserved(chord) ? 'edit' : null
}

/**
 * Classifies one keydown while a chord is being recorded. The order of the checks is load-bearing: composition and
 * Escape/Tab come first, then the presses that are not what they seem (AltGr, Control on Apple, the Windows key),
 * then bare modifiers, then the rules for keys that need a modifier, then the reserved lists.
 */
export function readChord(input: ChordInput, options: { apple: boolean, action?: string }): ChordRead {
    const { key } = input
    if (input.isComposing || input.keyCode === 229 || IGNORED_KEYS.has(key)) {
        return { kind: 'ignore' }
    }
    if (key === 'Escape') {
        return { kind: 'cancel' }
    }
    if (key === 'Tab') {
        return { kind: 'leave' }
    }
    if (input.altGraph || key === 'AltGraph') {
        return { kind: 'refused', reason: 'altGr' }
    }
    if (options.apple && (input.ctrlKey || key === 'Control')) {
        return { kind: 'refused', reason: 'macCtrl' }
    }
    if (!options.apple && (input.metaKey || key === 'Meta' || key === 'OS')) {
        return { kind: 'refused', reason: 'super' }
    }
    const ctrl = options.apple ? input.metaKey : input.ctrlKey
    const alt = input.altKey
    const shift = input.shiftKey
    if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') {
        return { kind: 'modifiers', ctrl, alt, shift }
    }
    const chord: Chord = { key, ctrl, alt, shift }
    if (!ctrl && !alt) {
        if (isFunctionKey(key)) {
            return BROWSER_F_KEYS.has(key.toLowerCase())
                ? { kind: 'refused', reason: 'browser', chord }
                : { kind: 'chord', chord }
        }
        if (key === ' ' && !shift && options.action === 'focusInput') {
            return { kind: 'chord', chord }
        }
        if (NAV_KEYS.has(key)) {
            return { kind: 'refused', reason: 'navKey', chord }
        }
        if (shift) {
            return { kind: 'refused', reason: 'shiftOnly', chord }
        }
        return { kind: 'refused', reason: 'bare', chord }
    }
    if (isBrowserReserved(chord)) {
        return { kind: 'refused', reason: 'browser', chord }
    }
    if (isEditReserved(chord)) {
        return { kind: 'refused', reason: 'edit', chord }
    }
    return { kind: 'chord', chord }
}

/** An empty key never equals anything. Keys compare lower-cased. */
export function chordsEqual(a: Chord, b: Chord): boolean {
    if (!a.key || !b.key) {
        return false
    }
    return a.key.toLowerCase() === b.key.toLowerCase() &&
        !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift
}

/** The key caps in spec order: ctrl slot, alt, shift, key. An empty key gives no caps. */
export function chordCaps(chord: Chord, apple: boolean): string[] {
    if (!chord.key) {
        return []
    }
    const caps: string[] = []
    if (chord.ctrl) caps.push(apple ? '⌘' : 'Ctrl')
    if (chord.alt) caps.push(apple ? '⌥' : 'Alt')
    if (chord.shift) caps.push(apple ? '⇧' : 'Shift')
    let name = chord.key
    if (name === ' ') {
        name = 'Space'
    } else if (name === 'Escape') {
        name = 'Esc'
    } else if (name.length === 1) {
        name = name.toUpperCase()
    }
    caps.push(name)
    return caps
}

export function chordText(caps: readonly string[]): string {
    return caps.join('+')
}
