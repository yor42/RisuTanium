import { describe, expect, test } from 'vitest'
import type { JsonObject } from '../../blockFrame'
import type { ModuleEntry } from '../../store2/format'
import { moduleStubOf, slotIsRecordedStub } from '../../store2/moduleStubMatch'

/** A module slot in the live database is a `$state` proxy; the check reads it through the proxy like the encoder does. */

const entry: ModuleEntry = {
    id: 'm1',
    name: 'Module one',
    description: 'about one',
    hasToggle: false,
    dsp: true,
    unit: ['u-m1', 10, 1, 1],
    al: ['a-m1', 5, 2, 1],
    il: ['i-m1', 5, 3, 1],
}

describe('slotIsRecordedStub over a $state proxy', () => {
    test('an untouched proxy of the minted stub is the recorded stub', () => {
        const slot = $state<JsonObject>(moduleStubOf(entry))
        expect(slotIsRecordedStub(slot, entry)).toBe(true)
    })

    test('a proxy that gained a key is not', () => {
        const slot = $state<JsonObject>(moduleStubOf(entry))
        slot.lorebook = []
        expect(slotIsRecordedStub(slot, entry)).toBe(false)
    })

    test('a proxy that changed a nested element is not', () => {
        const slot = $state<JsonObject>(moduleStubOf(entry))
        ;(slot.al as unknown[])[0] = 'x'
        expect(slotIsRecordedStub(slot, entry)).toBe(false)
    })
})
