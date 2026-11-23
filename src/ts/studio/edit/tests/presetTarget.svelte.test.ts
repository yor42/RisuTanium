// The preset owner's resolver, live reader and write router over a real `$state` database: a preset is found by
// its id only, the active preset's text is the working setting and every other preset's is its own slot, and that
// choice is made again on every read and every write. The reader never reports the text absent and the write
// refuses anything but a string `set` of the toggle text.
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { WriteOp } from 'src/ts/studio/history/historyModel'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import { changeToPreset } from 'src/ts/storage/database.svelte'
import { presetAdapter } from '../presetTarget'
import { keylessPreset, presetNamed, seedPresetDb, slotText } from './presetFixture.test-helpers'

const PATH = 'customModuleToggle'

function setOp(value: string): WriteOp {
    return { op: 'set', path: PATH, value: { had: true, value } }
}

function readerOf(id: string) {
    const resolved = presetAdapter.resolve(id)
    if (!resolved.ok) {
        throw new Error('expected the preset to resolve')
    }
    return resolved.target.reader
}

let ids: string[]

beforeEach(() => {
    ids = seedPresetDb([presetNamed('A', 'a=A'), presetNamed('B', 'b=B'), presetNamed('C', 'c=C')], 0, 'a=A')
})

describe('T1: resolve by id', () => {
    test('a reorder moves the index, not the preset', () => {
        const [a, b, c] = ids
        const presets = DBState.db.botPresets
        const [moved] = presets.splice(2, 1)
        presets.unshift(moved)
        DBState.db.botPresetsId = 1
        expect(readerOf(c).field(PATH)).toEqual({ had: true, value: 'c=C' })
        expect(readerOf(a).field(PATH)).toEqual({ had: true, value: 'a=A' })
        expect(readerOf(b).field(PATH)).toEqual({ had: true, value: 'b=B' })
    })

    test('no holder, two holders and an empty id are gone', () => {
        expect(presetAdapter.resolve('nope')).toEqual({ ok: false, reason: 'gone' })
        expect(presetAdapter.resolve('')).toEqual({ ok: false, reason: 'gone' })
        DBState.db.botPresets[2].id = ids[1]
        expect(presetAdapter.resolve(ids[1])).toEqual({ ok: false, reason: 'gone' })
        expect(presetAdapter.write(ids[1], [setOp('x')])).toBe(false)
        expect(slotText(1)).toBe('b=B')
        expect(slotText(2)).toBe('c=C')
        expect(DBState.db.customPromptTemplateToggle).toBe('a=A')
    })

    test('the target names the session kind and the id', () => {
        const resolved = presetAdapter.resolve(ids[1])
        expect(resolved.ok && resolved.target.session).toBe('preset')
        expect(resolved.ok && resolved.target.id).toBe(ids[1])
    })

    test('a gone preset reads as an empty present text, never as absent', () => {
        const reader = readerOf(ids[1])
        DBState.db.botPresets.splice(1, 1)
        expect(reader.field(PATH)).toEqual({ had: true, value: '' })
    })
})

describe('T1: read and write routing', () => {
    test('the active preset reads and writes the working setting and leaves its slot alone', () => {
        const [a] = ids
        expect(readerOf(a).field(PATH)).toEqual({ had: true, value: 'a=A' })
        DBState.db.customPromptTemplateToggle = 'a=live'
        expect(readerOf(a).field(PATH)).toEqual({ had: true, value: 'a=live' })
        expect(presetAdapter.write(a, [setOp('a=new')])).toBe(true)
        expect(DBState.db.customPromptTemplateToggle).toBe('a=new')
        expect(slotText(0)).toBe('a=A')
    })

    test('an inactive preset reads and writes its slot and leaves the working setting alone', () => {
        const [, b] = ids
        expect(readerOf(b).field(PATH)).toEqual({ had: true, value: 'b=B' })
        expect(presetAdapter.write(b, [setOp('b=new')])).toBe(true)
        expect(slotText(1)).toBe('b=new')
        expect(slotText(0)).toBe('a=A')
        expect(slotText(2)).toBe('c=C')
        expect(DBState.db.customPromptTemplateToggle).toBe('a=A')
    })

    test.each([
        ['-1', -1],
        ['past the end', 99],
        ['fractional', 1.5],
    ])('a working preset id that is %s means no preset is active, so every preset writes its slot', (_title, active) => {
        DBState.db.botPresetsId = active
        for (let index = 0; index < ids.length; index++) {
            expect(presetAdapter.write(ids[index], [setOp(`w${index}`)])).toBe(true)
            expect(slotText(index)).toBe(`w${index}`)
        }
        expect(DBState.db.customPromptTemplateToggle).toBe('a=A')
    })

    test('a reader obtained before a switch reads and a write made after it lands in the copy that is live now', () => {
        const [a, b] = ids
        const readerB = readerOf(b)
        changeToPreset(1)
        expect(DBState.db.botPresetsId).toBe(1)
        DBState.db.customPromptTemplateToggle = 'b=live'
        expect(readerB.field(PATH)).toEqual({ had: true, value: 'b=live' })
        expect(presetAdapter.write(b, [setOp('b=after')])).toBe(true)
        expect(DBState.db.customPromptTemplateToggle).toBe('b=after')
        expect(slotText(1)).toBe('b=B')
        expect(presetAdapter.write(a, [setOp('a=after')])).toBe(true)
        expect(slotText(0)).toBe('a=after')
        expect(DBState.db.customPromptTemplateToggle).toBe('b=after')
    })

    test('a reader obtained before a reorder reads the preset by id', () => {
        const [, b] = ids
        const readerB = readerOf(b)
        const presets = DBState.db.botPresets
        const [moved] = presets.splice(1, 1)
        presets.push(moved)
        expect(readerB.field(PATH)).toEqual({ had: true, value: 'b=B' })
        expect(presetAdapter.write(b, [setOp('b=moved')])).toBe(true)
        expect(slotText(2)).toBe('b=moved')
    })

    test('the other readers hold nothing', () => {
        const reader = readerOf(ids[0])
        expect(reader.field('desc')).toEqual({ had: false })
        expect(reader.greetings()).toBeNull()
        expect(reader.fmIndex('c')).toBeNull()
    })
})

describe('T1e: a keyless slot and a malformed value', () => {
    test('the keyless fixture lacks the key before anything reads it', () => {
        const keyless = keylessPreset()
        expect(Object.hasOwn(keyless, 'customPromptTemplateToggle')).toBe(false)
    })

    test('a keyless slot and a non-string value read as an empty present text on both copies', () => {
        const ids2 = seedPresetDb([keylessPreset('K'), presetNamed('N', 42), presetNamed('A', 'a')], 0, 'working')
        expect(Object.hasOwn(DBState.db.botPresets[0], 'customPromptTemplateToggle')).toBe(false)
        // Inactive copies: the keyless slot and the number.
        DBState.db.botPresetsId = 2
        expect(readerOf(ids2[0]).field(PATH)).toEqual({ had: true, value: '' })
        expect(readerOf(ids2[1]).field(PATH)).toEqual({ had: true, value: '' })
        // Active copies: the working setting holding a non-string.
        for (const index of [0, 1]) {
            DBState.db.botPresetsId = index
            DBState.db.customPromptTemplateToggle = 7 as unknown as string
            expect(readerOf(ids2[index]).field(PATH)).toEqual({ had: true, value: '' })
        }
        expect(Object.hasOwn(DBState.db.botPresets[0], 'customPromptTemplateToggle')).toBe(false)
    })

    test('a write that is not a string set of the toggle text returns false and changes nothing', () => {
        const keyless = seedPresetDb([keylessPreset('K'), presetNamed('B', 'b=B')], 1, 'b=B')
        const before = JSON.stringify(DBState.db)
        const refused: readonly WriteOp[][] = [
            [{ op: 'set', path: PATH, value: { had: false } }],
            [{ op: 'set', path: 'desc', value: { had: true, value: 'x' } }],
            [{ op: 'set', path: PATH, value: { had: true, value: true } }],
            [{ op: 'listSet', index: 0, value: 'x' }],
            [{ op: 'textEdit', target: PATH, edits: [] } as unknown as WriteOp],
            // A valid op ahead of an invalid one must not land either.
            [setOp('first'), { op: 'set', path: PATH, value: { had: false } }],
        ]
        for (const writes of refused) {
            expect(presetAdapter.write(keyless[0], writes)).toBe(false)
            expect(presetAdapter.write(keyless[1], writes)).toBe(false)
        }
        expect(JSON.stringify(DBState.db)).toBe(before)
        expect(Object.hasOwn(DBState.db.botPresets[0], 'customPromptTemplateToggle')).toBe(false)
    })

    test('the first string write gives a keyless slot its key', () => {
        const keyless = seedPresetDb([presetNamed('A', 'a'), keylessPreset('K')], 0, 'a')
        expect(presetAdapter.write(keyless[1], [setOp('k=K')])).toBe(true)
        expect(slotText(1)).toBe('k=K')
    })
})
