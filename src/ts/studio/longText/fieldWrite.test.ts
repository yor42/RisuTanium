import { describe, expect, test } from 'vitest'
import type { StudioResult } from '../history/ownerHistory.svelte'
import { createFieldWriteController, lf, toStored, type FieldWriteController, type LongTextWritePort } from './fieldWrite'

interface Rig {
    controller: FieldWriteController
    owner: { value: string | null }
    surface: { text: string }
    writes: string[]
    results: (StudioResult | null)[]
    resets: string[]
    closeSteps: () => number
    type(text: string, composing: boolean): void
}

// A fake owner and a fake textarea. `refuse` makes every write a refusal.
function makeRig(stored: string, shown: string, refuse = false): Rig {
    const owner = { value: stored as string | null }
    const surface = { text: shown }
    const writes: string[] = []
    const results: (StudioResult | null)[] = []
    const resets: string[] = []
    let steps = 0
    const port: LongTextWritePort = {
        read: () => owner.value,
        write: (value) => {
            writes.push(value)
            if (refuse) return { ok: false, reason: 'not-selected' }
            owner.value = value
            return { ok: true }
        },
        closeStep: () => {
            steps += 1
        },
    }
    const controller = createFieldWriteController(
        port,
        {
            value: () => surface.text,
            reset: (value) => {
                resets.push(value)
                surface.text = lf(value)
            },
        },
        (result) => results.push(result),
    )
    return {
        controller,
        owner,
        surface,
        writes,
        results,
        resets,
        closeSteps: () => steps,
        type(text, composing) {
            surface.text = text
            controller.input(composing)
        },
    }
}

function expectThreeZeros(rig: Rig): void {
    expect(rig.writes).toHaveLength(0)
    expect(rig.results).toHaveLength(0)
    expect(rig.resets).toHaveLength(0)
}

describe('toStored and lf', () => {
    test.each([
        ['CRLF', 'a\r\nb', 'a\nbX', 'a\r\nbX'],
        ['LF', 'a\nb', 'a\nbX', 'a\nbX'],
        ['lone CR', 'a\rb', 'a\nbX', 'a\nbX'],
        ['mixed, LF majority', 'a\r\nb\nc\nd', 'a\nb', 'a\nb'],
        ['mixed, CRLF majority', 'a\r\nb\r\nc\r\nd\ne', 'a\nb', 'a\r\nb'],
        ['empty', '', 'x\ny', 'x\ny'],
    ])('B1-U1 toStored %s', (_name, stored, field, expected) => {
        expect(toStored(field, stored)).toBe(expected)
    })

    test('lf turns CRLF and a lone CR into LF', () => {
        expect(lf('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
    })
})

describe('B1-U1 the write controller', () => {
    test.each([
        ['stale-blur', (rig: Rig) => rig.controller.blur()],
        ['stale-hide', (rig: Rig) => rig.controller.flush('hide')],
        ['stale-leave', (rig: Rig) => rig.controller.flush('leave')],
        ['stale-comp-no-input', (rig: Rig) => {
            rig.controller.compositionStart()
            rig.controller.compositionEnd()
        }],
    ])('%s: no input means no write, no result and no reset', (_name, act) => {
        const rig = makeRig('abc', 'abX')
        act(rig)
        expectThreeZeros(rig)
        expect(rig.owner.value).toBe('abc')
        expect(rig.controller.owed).toBe(false)
    })

    test('hold: a composing input is held until compositionend, then written once', () => {
        const rig = makeRig('d0', 'd0')
        rig.controller.compositionStart()
        rig.type('d0ㅎ', true)
        rig.type('d0한', true)
        expect(rig.writes).toHaveLength(0)
        expect(rig.controller.composing).toBe(true)
        rig.controller.compositionEnd()
        expect(rig.writes).toEqual(['d0한'])
        expect(rig.owner.value).toBe('d0한')
    })

    test('refuse-composing: a refusal during composition keeps the surface; compositionend resets once', () => {
        const rig = makeRig('d0', 'd0', true)
        rig.controller.compositionStart()
        rig.type('d0한', true)
        rig.controller.flush('hide')
        expect(rig.surface.text).toBe('d0한')
        expect(rig.resets).toHaveLength(0)
        expect(rig.controller.owed).toBe(true)
        rig.controller.compositionEnd()
        expect(rig.resets).toEqual(['d0'])
        expect(rig.surface.text).toBe('d0')
        expect(rig.controller.owed).toBe(false)
    })

    test('blur-commit: blur writes held text, ends composing and closes the step once', () => {
        const rig = makeRig('d0', 'd0')
        rig.controller.compositionStart()
        rig.type('d0한', true)
        rig.controller.blur()
        expect(rig.owner.value).toBe('d0한')
        expect(rig.controller.composing).toBe(false)
        expect(rig.closeSteps()).toBe(1)
    })

    test('blur-refused-resets: a refused blur resets to the owner value once', () => {
        const rig = makeRig('d0', 'd0', true)
        rig.controller.compositionStart()
        rig.type('d0한', true)
        rig.controller.blur()
        expect(rig.resets).toEqual(['d0'])
        expect(rig.controller.owed).toBe(false)
    })

    test('hide-writes-held: the hide flush writes held text and leaves composing set', () => {
        const rig = makeRig('d0', 'd0')
        rig.controller.compositionStart()
        rig.type('d0한', true)
        rig.controller.flush('hide')
        expect(rig.owner.value).toBe('d0한')
        expect(rig.controller.composing).toBe(true)
        expect(rig.closeSteps()).toBe(0)
    })

    test('leave flush writes and closes the step', () => {
        const rig = makeRig('d0', 'd0')
        rig.type('d0한', true)
        rig.controller.flush('leave')
        expect(rig.owner.value).toBe('d0한')
        expect(rig.closeSteps()).toBe(1)
    })

    test('crlf-restore: a real edit keeps the stored CRLF style', () => {
        const rig = makeRig('a\r\nb', 'a\nb')
        rig.type('a\nbX', false)
        expect(rig.owner.value).toBe('a\r\nbX')
    })

    test('base: held text is never written over a value that changed under it', () => {
        const rig = makeRig('g1', 'g1')
        rig.controller.compositionStart()
        rig.type('g1ㅎ', true)
        rig.owner.value = 'g2'
        rig.controller.compositionEnd()
        expect(rig.writes).toHaveLength(0)
        expect(rig.results).toEqual([{ ok: false, reason: 'precondition' }])
        expect(rig.resets).toEqual(['g2'])
    })

    test('base-held-across-input: a later composing input does not re-take the base', () => {
        const rig = makeRig('g1', 'g1')
        rig.controller.compositionStart()
        rig.type('g1ㅎ', true)
        rig.owner.value = 'g2'
        rig.type('g1하', true)
        rig.controller.compositionEnd()
        expect(rig.writes).toHaveLength(0)
        expect(rig.results).toEqual([{ ok: false, reason: 'precondition' }])
    })

    test('gone: a target that vanished is neither written nor reset', () => {
        const rig = makeRig('g1', 'g1')
        rig.controller.compositionStart()
        rig.type('g1ㅎ', true)
        rig.owner.value = null
        rig.controller.compositionEnd()
        expectThreeZeros(rig)
        expect(rig.controller.owed).toBe(false)
    })

    test('valve: a non-composing input ends a composition and writes', () => {
        const rig = makeRig('d0', 'd0')
        rig.controller.compositionStart()
        rig.type('d0x', false)
        expect(rig.owner.value).toBe('d0x')
        expect(rig.controller.composing).toBe(false)
    })

    test('dispose: held text is dropped; nothing is written, reset or closed', () => {
        const rig = makeRig('d0', 'd0')
        rig.controller.compositionStart()
        rig.type('d0한', true)
        rig.controller.dispose()
        expectThreeZeros(rig)
        expect(rig.closeSteps()).toBe(0)
    })

    test('netzero-composition: a composition back to the shown text rewrites no line endings', () => {
        const rig = makeRig('a\r\nb\nc', 'a\nb\nc')
        rig.controller.compositionStart()
        rig.type('a\nb\ncX', true)
        rig.type('a\nb\nc', true)
        rig.controller.compositionEnd()
        expectThreeZeros(rig)
        expect(rig.controller.owed).toBe(false)
        expect(rig.owner.value).toBe('a\r\nb\nc')
    })

    test('unchanged-input-after-write: an input that leaves the text unchanged writes nothing more', () => {
        const rig = makeRig('abc', 'abc')
        rig.type('abX', false)
        rig.type('abX', false)
        expect(rig.writes).toEqual(['abX'])
    })

    test('write-through: a non-composing input writes at once', () => {
        const rig = makeRig('d0', 'd0')
        rig.type('d0a', false)
        expect(rig.writes).toEqual(['d0a'])
        expect(rig.owner.value).toBe('d0a')
    })

    test('a null write result resets and reports null', () => {
        const owner = { value: 'd0' }
        const resets: string[] = []
        const results: (StudioResult | null)[] = []
        let shown = 'd0'
        const controller = createFieldWriteController(
            { read: () => owner.value, write: () => null, closeStep: () => {} },
            { value: () => shown, reset: (value) => { resets.push(value); shown = value } },
            (result) => results.push(result),
        )
        shown = 'd0x'
        controller.input(false)
        expect(results).toEqual([null])
        expect(resets).toEqual(['d0'])
    })
})
