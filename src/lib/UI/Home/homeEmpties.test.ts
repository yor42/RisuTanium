/**
 * `homeEmpties.ts`: the pure rules behind Home's empty states. A slot is live when it is present,
 * not trashed and not a hidden system character; the persona chip shows the stored username unless
 * it is empty or the default, which count as unnamed.
 */

import { describe, expect, test } from 'vitest'
import { hasLiveCharacter, personaChipName } from './homeEmpties'

type Slot = { chaId?: string, trashTime?: number }

function slot(chaId: string, extra: Partial<Slot> = {}): Slot {
    return { chaId, ...extra }
}

describe('hasLiveCharacter', () => {
    const cases: [string, readonly (Slot | null | undefined)[] | undefined, boolean][] = [
        ['an undefined list', undefined, false],
        ['an empty list', [], false],
        ['only a null slot', [null], false],
        ['only an undefined slot', [undefined], false],
        ['only a trashed character', [slot('a', { trashTime: 3 })], false],
        ['the playground and the temp copy', [slot('§playground'), slot('§temp')], false],
        ['a hidden character and a trashed one', [slot('§playground'), slot('a', { trashTime: 3 })], false],
        ['a single live character', [slot('a')], true],
        ['a live character after hidden and trashed ones', [slot('§temp'), slot('a', { trashTime: 3 }), slot('b')], true],
        ['a live group', [{ chaId: 'g1' }], true],
        ['a cold-storage placeholder', [{ chaId: 'cold-1' }], true],
        ['a slot without an id', [{}], true],
    ]

    test.each(cases)('%s', (_name, characters, expected) => {
        expect(hasLiveCharacter(characters)).toBe(expected)
    })
})

describe('personaChipName', () => {
    test.each([
        ['User', null],
        ['', null],
        ['  ', null],
        [' User ', null],
        [undefined, null],
        ['Juno', 'Juno'],
        ['user', 'user'],
        ['  Juno  ', 'Juno'],
    ] as [string | undefined, string | null][])('%j gives %j', (username, expected) => {
        expect(personaChipName(username)).toBe(expected)
    })
})
