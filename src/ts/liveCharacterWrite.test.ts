import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    mark: vi.fn(),
    db: { characters: [] as unknown[] },
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: h.mark,
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

import { writeLiveCharacter } from 'src/ts/liveCharacterWrite'

type Fixture = { chaId: string, name: string, coldstorage?: string }

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    h.mark.mockReset()
    h.db.characters = [
        { chaId: 'char-a', name: 'Alpha' },
        { chaId: 'char-b', name: 'Beta' },
    ] satisfies Fixture[]
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    warn.mockRestore()
})

const rename = (to: string) => (target: { name: string }) => { target.name = to }

describe('writeLiveCharacter', () => {
    test('a character found by id is written, then marked for save, and the call reports true', () => {
        const order: string[] = []
        h.mark.mockImplementation(() => { order.push('mark') })

        const landed = writeLiveCharacter('char-b', (target) => {
            order.push('write')
            rename('Changed')(target as never)
        })

        expect(landed).toBe(true)
        expect(order).toEqual(['write', 'mark'])
        expect((h.db.characters[1] as Fixture).name).toBe('Changed')
        expect((h.db.characters[0] as Fixture).name).toBe('Alpha')
        expect(h.mark).toHaveBeenCalledTimes(1)
        expect(h.mark).toHaveBeenCalledWith('char-b')
        expect(warn).not.toHaveBeenCalled()
    })

    test('the live element at lookup time is written, so a replacement with the same id receives the write', () => {
        const replacement: Fixture = { chaId: 'char-a', name: 'Replacement' }
        h.db.characters[0] = replacement

        writeLiveCharacter('char-a', rename('Written') as never)

        expect(replacement.name).toBe('Written')
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('an id that no character has drops the write with one warning and marks nothing', () => {
        const write = vi.fn()

        expect(writeLiveCharacter('char-gone', write)).toBe(false)

        expect(write).not.toHaveBeenCalled()
        expect(h.mark).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledTimes(1)
    })

    test('an archived stub is not written into: the write is dropped with one warning and nothing is marked', () => {
        h.db.characters[0] = { chaId: 'char-a', name: 'Stub', coldstorage: 'entry-1' } satisfies Fixture
        const write = vi.fn()

        expect(writeLiveCharacter('char-a', write)).toBe(false)

        expect(write).not.toHaveBeenCalled()
        expect(h.mark).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledTimes(1)
    })

    test('an empty id never matches, even a character whose own id is empty', () => {
        h.db.characters.push({ chaId: '', name: 'Unlabelled' } satisfies Fixture)
        const write = vi.fn()

        expect(writeLiveCharacter('', write)).toBe(false)

        expect(write).not.toHaveBeenCalled()
        expect(h.mark).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledTimes(1)
    })
})
