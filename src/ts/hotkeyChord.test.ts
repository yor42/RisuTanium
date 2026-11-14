/**
 * The recording rules of the Shortcuts page, driven through `readChord` with inputs shaped like real keydown events.
 * New seam: every test here is a behaviour test of the new module (it has no pre-fix code).
 */
import { describe, expect, test } from 'vitest'
import {
    chordCaps, chordText, chordsEqual, isApplePlatform, readChord, reservedNote, type ChordInput, type ChordRead,
} from './hotkeyChord'

function input(key: string, init: Partial<ChordInput> = {}): ChordInput {
    return { key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, isComposing: false, keyCode: 0, altGraph: false, ...init }
}

function read(key: string, init: Partial<ChordInput> = {}, apple = false, action = 'home'): ChordRead {
    return readChord(input(key, init), { apple, action })
}

function refusal(result: ChordRead): string | undefined {
    return result.kind === 'refused' ? result.reason : undefined
}

describe('readChord: presses that are not chords', () => {
    test('composition, keyCode 229, Dead, Unidentified and Process are ignored', () => {
        expect(read('a', { isComposing: true, ctrlKey: true }).kind).toBe('ignore')
        expect(read('a', { keyCode: 229, ctrlKey: true }).kind).toBe('ignore')
        expect(read('Dead', { ctrlKey: true }).kind).toBe('ignore')
        expect(read('Unidentified', { ctrlKey: true }).kind).toBe('ignore')
        expect(read('Process', { ctrlKey: true }).kind).toBe('ignore')
    })

    test('Escape cancels and Tab leaves', () => {
        expect(read('Escape').kind).toBe('cancel')
        expect(read('Tab').kind).toBe('leave')
        expect(read('Tab', { shiftKey: true }).kind).toBe('leave')
    })

    test('a modifier alone only updates the preview', () => {
        expect(read('Control', { ctrlKey: true })).toEqual({ kind: 'modifiers', ctrl: true, alt: false, shift: false })
        expect(read('Shift', { shiftKey: true, ctrlKey: true })).toEqual({ kind: 'modifiers', ctrl: true, alt: false, shift: true })
        expect(read('Meta', { metaKey: true }, true)).toEqual({ kind: 'modifiers', ctrl: true, alt: false, shift: false })
    })
})

describe('readChord: refusals', () => {
    test('AltGr is refused, but Ctrl+Alt+R without AltGraph records', () => {
        expect(refusal(read('r', { ctrlKey: true, altKey: true, altGraph: true }))).toBe('altGr')
        expect(refusal(read('AltGraph'))).toBe('altGr')
        expect(read('r', { ctrlKey: true, altKey: true, altGraph: false })).toEqual({
            kind: 'chord', chord: { key: 'r', ctrl: true, alt: true, shift: false },
        })
    })

    test('the Windows key is refused off Apple and is never recorded as Ctrl', () => {
        expect(refusal(read('s', { metaKey: true }))).toBe('super')
        expect(refusal(read('s', { metaKey: true, ctrlKey: true }))).toBe('super')
        expect(refusal(read('Meta', { metaKey: true }))).toBe('super')
    })

    test('the Control key is refused on Apple', () => {
        expect(refusal(read('s', { ctrlKey: true }, true))).toBe('macCtrl')
        expect(refusal(read('s', { ctrlKey: true, metaKey: true }, true))).toBe('macCtrl')
        expect(refusal(read('Control', { ctrlKey: true }, true))).toBe('macCtrl')
    })

    test('bare keys are refused, except Space for focusInput', () => {
        expect(refusal(read('r'))).toBe('bare')
        expect(refusal(read('Enter'))).toBe('bare')
        expect(refusal(read(' '))).toBe('bare')
        expect(read(' ', {}, false, 'focusInput').kind).toBe('chord')
    })

    test('navigation and editing keys are refused with their own reason', () => {
        expect(refusal(read('ArrowUp'))).toBe('navKey')
        expect(refusal(read('ArrowUp', { shiftKey: true }))).toBe('navKey')
        expect(refusal(read('Backspace'))).toBe('navKey')
        expect(refusal(read('Delete'))).toBe('navKey')
    })

    test('Shift plus a printable key is refused', () => {
        expect(refusal(read('R', { shiftKey: true }))).toBe('shiftOnly')
    })

    test('function keys are allowed, except F5, F11 and F12', () => {
        expect(read('F2').kind).toBe('chord')
        expect(read('F2', { shiftKey: true }).kind).toBe('chord')
        expect(refusal(read('F5'))).toBe('browser')
        expect(refusal(read('F12', { ctrlKey: true }))).toBe('browser')
    })

    test('browser-reserved combos are refused', () => {
        expect(refusal(read('w', { ctrlKey: true }))).toBe('browser')
        expect(refusal(read('T', { ctrlKey: true, shiftKey: true }))).toBe('browser')
        expect(refusal(read('F4', { altKey: true }))).toBe('browser')
    })

    test('edit-reserved combos are refused', () => {
        for (const key of ['c', 'v', 'x', 'a', 'z']) {
            expect(refusal(read(key, { ctrlKey: true }))).toBe('edit')
        }
        expect(read('C', { ctrlKey: true, shiftKey: true }).kind).toBe('chord')
    })
})

describe('readChord: chords', () => {
    test('Ctrl+Alt+R keeps the raw key', () => {
        expect(read('r', { ctrlKey: true, altKey: true })).toEqual({ kind: 'chord', chord: { key: 'r', ctrl: true, alt: true, shift: false } })
    })

    test('Ctrl+Shift+S keeps the shifted key as the event reports it', () => {
        expect(read('S', { ctrlKey: true, shiftKey: true })).toEqual({ kind: 'chord', chord: { key: 'S', ctrl: true, alt: false, shift: true } })
    })

    test('on Apple the command key fills the ctrl slot', () => {
        expect(read('s', { metaKey: true }, true)).toEqual({ kind: 'chord', chord: { key: 's', ctrl: true, alt: false, shift: false } })
    })
})

describe('caps, text and equality', () => {
    test('Apple caps use the command, option and shift symbols in order', () => {
        expect(chordCaps({ key: 'r', ctrl: true, alt: true, shift: true }, true)).toEqual(['⌘', '⌥', '⇧', 'R'])
        expect(chordCaps({ key: 'r', ctrl: true, alt: true, shift: true }, false)).toEqual(['Ctrl', 'Alt', 'Shift', 'R'])
    })

    test('Space and Escape have names, an empty key has no caps', () => {
        expect(chordCaps({ key: ' ', ctrl: false, alt: false, shift: false }, false)).toEqual(['Space'])
        expect(chordCaps({ key: 'Escape', ctrl: false, alt: false, shift: false }, false)).toEqual(['Esc'])
        expect(chordCaps({ key: '', ctrl: true, alt: false, shift: false }, false)).toEqual([])
        expect(chordText(['Ctrl', 'H'])).toBe('Ctrl+H')
    })

    test('an empty key never equals, and keys compare case-insensitively', () => {
        const none = { key: '', ctrl: false, alt: false, shift: false }
        expect(chordsEqual(none, none)).toBe(false)
        expect(chordsEqual({ key: 'H', ctrl: true, alt: false, shift: false }, { key: 'h', ctrl: true, alt: false, shift: false })).toBe(true)
    })
})

describe('platform and reserved notes', () => {
    test('Apple detection', () => {
        expect(isApplePlatform({ platform: 'MacIntel' })).toBe(true)
        expect(isApplePlatform({ platform: 'iPhone' })).toBe(true)
        expect(isApplePlatform({ platform: 'Win32', userAgentData: { platform: 'macOS' } })).toBe(true)
        expect(isApplePlatform({ platform: 'Win32' })).toBe(false)
        expect(isApplePlatform({ platform: 'Linux armv8l' })).toBe(false)
    })

    test('Ctrl+L carries the browser note and Ctrl+X the edit note', () => {
        expect(reservedNote({ key: 'l', ctrl: true, alt: false, shift: false })).toBe('browser')
        expect(reservedNote({ key: 'x', ctrl: true, alt: false, shift: false })).toBe('edit')
        expect(reservedNote({ key: 'h', ctrl: true, alt: false, shift: false })).toBeNull()
    })
})
