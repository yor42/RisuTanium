import { describe, expect, it } from 'vitest'
import { createMessageKeys, type MessageKeyContext } from './messageKeys'

const base: MessageKeyContext = { focus: 'message', index: 1, count: 3, newestCharacter: true, now: 1000 }

describe('T10/T16 message keyboard map', () => {
    it.each([
        [{ key: 'ArrowLeft' }, 'stepPrev'], [{ key: 'ArrowRight' }, 'stepNext'],
        [{ key: 'Delete' }, 'delete'], [{ key: 'Delete', shiftKey: true }, 'deleteAfter'],
        [{ key: 'Enter' }, 'openActions'], [{ key: 'ContextMenu' }, 'openActions'],
        [{ key: 'F10', shiftKey: true }, 'openActions'], [{ key: 'Escape' }, 'close'],
        [{ key: 'ArrowUp' }, 'focusPrev'], [{ key: 'ArrowDown' }, 'focusNext'],
        [{ key: 'z', ctrlKey: true }, 'none'], [{ key: 'c', ctrlKey: true }, 'copy'],
    ] as const)('maps %o to %s', (event, action) => {
        expect(createMessageKeys().handle(event, base)).toBe(action)
    })
    it('never generates from a pager edge or a repeated hotkey', () => {
        const keys = createMessageKeys()
        const end = { ...base, index: 2 }
        expect(keys.handle({ key: 'ArrowRight' }, end)).toBe('none')
        expect(keys.handle({ key: 'r', ctrlKey: true, altKey: true, repeat: true }, end)).toBe('none')
        expect(keys.handle({ key: 'r', ctrlKey: true, altKey: true }, end)).toBe('newReply')
        expect(keys.handle({ key: 'r', ctrlKey: true, altKey: true }, { ...end, now: 1499 })).toBe('none')
        expect(keys.handle({ key: 'r', ctrlKey: true, altKey: true }, { ...end, now: 1500 })).toBe('newReply')
    })
    it('guards the new-answer control after a pager step and ignores first-message generation', () => {
        const keys = createMessageKeys()
        expect(keys.handle({ key: 'ArrowRight' }, base)).toBe('stepNext')
        const control = { ...base, focus: 'control' as const, control: 'newReply' as const, now: 1499 }
        expect(keys.handle({ key: 'Enter' }, control)).toBe('none')
        expect(keys.handle({ key: ' ' }, { ...control, now: 1500 })).toBe('newReply')
        expect(keys.handle({ key: 'Enter' }, { ...control, firstMessage: true, now: 2000 })).toBe('none')
        expect(keys.handle({ key: 'ArrowRight' }, { ...base, focus: 'other' })).toBe('none')
    })
})
