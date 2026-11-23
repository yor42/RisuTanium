// @vitest-environment jsdom
// T-F1, a compatibility guard (it passes on the hand-kept focus chain too): a path whose presentation has no focus
// target is never the focus target of a history action.
import { describe, expect, test } from 'vitest'
import { changedFieldTarget } from './historyFocus'
import type { OwnerFields } from './ownerFields'

const fields = (rest: Partial<OwnerFields> = {}): OwnerFields => ({ greetings: ['a'], firstMessage: 'f', exampleMessage: '<START>\nx', desc: 'd', hideChatIcon: false, risutanium_render_when_complete: false, note: undefined, ...rest })

describe('T-F1: a path without a focus target is never targeted', () => {
    test('a restore that changes the toggle and the hide icon flag targets the flag', () => {
        expect(changedFieldTarget(fields({ customModuleToggle: 'a' }), fields({ customModuleToggle: 'b', hideChatIcon: true }))).toEqual({ kind: 'hideChatIcon' })
    })

    test('a change of the toggle alone targets nothing', () => {
        expect(changedFieldTarget(fields({ customModuleToggle: 'a' }), fields({ customModuleToggle: 'b' }))).toBeNull()
    })
})
