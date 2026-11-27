// The portrait op in the pure history model: the op's inverse, the whole-value precondition (portrait and exif map), the
// holds-result test of an op that failed to apply, the portrait revert chain with its net-zero snapshot, and the gone-file
// skip of a replay and of a revert. The live owner is a plain value the reader reads and the test applies the writes to,
// so the model alone is under test; the service and the real writer are in ownerHistory.portrait.svelte.test.ts. Ops come
// from the real builders.
import { describe, expect, test } from 'vitest'
import { buildPortraitAdd, buildPortraitMakeMain, buildPortraitRemove } from '../../edit/portraitSetters'
import {
    emptyRecord,
    invertOp,
    planReplay,
    planRevert,
    type ExifValue,
    type LiveReader,
    type Op,
    type OwnerRecord,
    type PortraitOp,
    type PortraitValue,
    type Step,
    type StepLabel,
    type WriteOp,
} from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'

const A = characterOwnerKey('A')
const hash = (letter: string): string => `assets/${letter.repeat(64)}.png`
const M = hash('m')
const N = hash('n')
const P = hash('p')

interface Sim {
    portrait: PortraitValue | null
    exif: ExifValue | null
}

function reader(sim: Sim): LiveReader {
    return {
        field: () => ({ had: false }),
        greetings: () => null,
        fmIndex: () => null,
        portrait: () => (sim.portrait === null ? null : structuredClone(sim.portrait)),
        pngExif: () => (sim.exif === null ? null : structuredClone(sim.exif)),
    }
}

function land(sim: Sim, writes: readonly WriteOp[]): void {
    for (const write of writes) {
        if (write.op === 'portraitSet') {
            sim.portrait = structuredClone(write.after)
            if (write.pngExif !== undefined) {
                sim.exif = structuredClone(write.pngExif.after)
            }
        }
    }
}

const value = (image: string | null, rows: { uri: string; name: string }[] | null): PortraitValue => ({
    image: image === null ? { had: false } : { had: true, value: image },
    alternates: rows === null ? { had: false } : { had: true, rows: rows.map((row) => ({ type: 'icon', name: row.name, uri: row.uri, ext: 'png' })) },
})

let counter = 0
function step(label: StepLabel, ops: Op[]): Step {
    counter += 1
    return { id: `p:${counter}`, at: counter, label, ops }
}

function record(...done: Step[]): OwnerRecord {
    return { ...emptyRecord(A, 0), done }
}

// One builder step run on the sim: its ops become a step and its writes land.
function run(sim: Sim, built: ReturnType<typeof buildPortraitAdd> | ReturnType<typeof buildPortraitMakeMain> | ReturnType<typeof buildPortraitRemove>): Step {
    if (built.ok === false) throw new Error(`builder refused: ${built.reason}`)
    const ops = built.ops as PortraitOp[]
    land(sim, ops)
    return step(built.label, ops)
}

const portraitOf = (op: Op): PortraitOp => {
    if (op.op !== 'portraitSet') throw new Error('not a portrait op')
    return op
}

describe('invertOp swaps the portrait and the exif pair', () => {
    test('before and after trade places for both, and an op without a pair gains none', () => {
        const op: PortraitOp = { op: 'portraitSet', before: value(M, null), after: value(N, [{ uri: M, name: 'iconx' }]), pngExif: { before: { had: false }, after: { had: true, value: { Title: 't' } } } }
        const inverse = portraitOf(invertOp(op))
        expect(inverse.before).toEqual(op.after)
        expect(inverse.after).toEqual(op.before)
        expect(inverse.pngExif).toEqual({ before: { had: true, value: { Title: 't' } }, after: { had: false } })
        const plain = portraitOf(invertOp({ op: 'portraitSet', before: value(M, null), after: value('', null) }))
        expect('pngExif' in plain).toBe(false)
    })
})

describe('B-T10 (a)/(b): the undo precondition and the already-in-place move', () => {
    const before = value(M, [])
    const sim = (): Sim => ({ portrait: before, exif: { had: false } })

    test('an undo after a classic-side edit of the alternates refuses with precondition and writes nothing', () => {
        const state = sim()
        const built = run(state, buildPortraitAdd(N, {}, reader(state)))
        const top = record(built)
        state.portrait = value(N, [{ uri: M, name: 'iconx' }, { uri: P, name: 'classic edit' }])
        const plan = planReplay(top, 'undo', reader(state))
        expect(plan).toEqual({ ok: false, reason: 'precondition' })
    })

    test('an undo whose result is already in place moves the step without a write', () => {
        const state = sim()
        const top = record(run(state, buildPortraitAdd(N, {}, reader(state))))
        state.portrait = structuredClone(before)
        const plan = planReplay(top, 'undo', reader(state))
        if (plan.ok === false) throw new Error(`refused: ${plan.reason}`)
        expect(plan.already).toBe('undo')
        expect(plan.writes).toEqual([])
    })
})

describe('B-T10 (b2): a portrait at its result with an exif map that is not is not "already"', () => {
    test('the live portrait equals the undo result but the exif map still holds the add: precondition, no already, nothing written', () => {
        const state: Sim = { portrait: value(M, []), exif: { had: true, value: { Title: 'old' } } }
        const top = record(run(state, buildPortraitAdd(N, { Comment: 'c' }, reader(state))))
        // A classic-side edit puts the photos back but leaves the notes the add copied.
        state.portrait = value(M, [])
        const plan = planReplay(top, 'undo', reader(state))
        expect(plan).toEqual({ ok: false, reason: 'precondition' })
        expect(state.exif).toEqual({ had: true, value: { Title: 'old', Comment: 'c' } })
    })

    test('an exif map that cannot be read refuses the replay of a step that carries the pair', () => {
        const state: Sim = { portrait: value(M, []), exif: { had: false } }
        const top = record(run(state, buildPortraitAdd(N, { Comment: 'c' }, reader(state))))
        state.exif = null
        expect(planReplay(top, 'undo', reader(state))).toEqual({ ok: false, reason: 'precondition' })
    })
})

describe('B-T10 (c): a revert across add, make-main and remove stores the net chain', () => {
    test('the revert lands the first value and the stored ops are the portrait chain', () => {
        const state: Sim = { portrait: value(M, [{ uri: P, name: 'other' }]), exif: { had: false } }
        const base = step({ kind: 'portraitAdd' }, [])
        const start = structuredClone(state.portrait)
        const added = run(state, buildPortraitAdd(N, {}, reader(state)))
        const swapped = run(state, buildPortraitMakeMain(0, reader(state)))
        const removed = run(state, buildPortraitRemove('main', reader(state)))
        const plan = planRevert(record(base, added, swapped, removed), base.id, reader(state))
        if (plan.ok === false) throw new Error(`revert refused: ${plan.reason}`)
        land(state, plan.writes)
        expect(state.portrait).toEqual(start)
        expect(plan.ops.filter((op) => op.op === 'portraitSet')).toHaveLength(3)
    })
})

describe('B-T10 (d): the revert snapshot covers the exif map', () => {
    // The portrait starts as { M, [] }; add N (notes join the map); remove main promotes M back: the portrait is where it
    // started, the map is not.
    const arrange = (): { state: Sim; steps: Step[]; base: Step } => {
        const state: Sim = { portrait: value(M, []), exif: { had: true, value: { Title: 'E0' } } }
        const base = step({ kind: 'portraitAdd' }, [])
        const added = run(state, buildPortraitAdd(N, { Comment: 'E1' }, reader(state)))
        const removed = run(state, buildPortraitRemove('main', reader(state)))
        return { state, steps: [base, added, removed], base }
    }

    test('the revert is not unchanged: it restores the earlier exif map and keeps the portrait', () => {
        const { state, steps, base } = arrange()
        expect(state.portrait).toEqual(value(M, []))
        const plan = planRevert(record(...steps), base.id, reader(state))
        if (plan.ok === false) throw new Error(`revert answered ${plan.reason}`)
        land(state, plan.writes)
        expect(state.exif).toEqual({ had: true, value: { Title: 'E0' } })
        expect(state.portrait).toEqual(value(M, []))
        expect(plan.ops.some((op) => op.op === 'portraitSet')).toBe(true)
    })

    test('a revert across only a swap and its swap back is unchanged (the chain is net zero)', () => {
        const state: Sim = { portrait: value(M, [{ uri: P, name: 'iconx' }]), exif: { had: false } }
        const base = step({ kind: 'portraitAdd' }, [])
        const first = run(state, buildPortraitMakeMain(0, reader(state)))
        const second = run(state, buildPortraitMakeMain(0, reader(state)))
        const plan = planRevert(record(base, first, second), base.id, reader(state))
        expect(plan.ok).toBe(false)
        if (plan.ok !== false) return
        expect(plan.reason).toBe('unchanged')
    })
})

describe('B-T8: a replay or a revert that would put back a gone file leaves the portrait whole', () => {
    test('an undo of a main removal whose file is gone drops the step and names the path as a portrait file', () => {
        const state: Sim = { portrait: value(M, []), exif: { had: false } }
        const top = record(run(state, buildPortraitRemove('main', reader(state))))
        const plan = planReplay(top, 'undo', reader(state), undefined, new Set([M]))
        if (plan.ok === false) throw new Error(`refused: ${plan.reason}`)
        expect(plan.dropStep).toBe(true)
        expect(plan.writes).toEqual([])
        expect(plan.goneRows).toEqual([M])
        expect(plan.gonePortrait).toBe(true)
    })

    test('a revert whose only work puts back a gone portrait file answers unchanged with the path and the portrait marker', () => {
        const state: Sim = { portrait: value(M, []), exif: { had: false } }
        const base = step({ kind: 'portraitAdd' }, [])
        const removed = run(state, buildPortraitRemove('main', reader(state)))
        const plan = planRevert(record(base, removed), base.id, reader(state), undefined, undefined, new Set([M]))
        expect(plan).toMatchObject({ ok: false, reason: 'unchanged', goneRows: [M], gonePortrait: true })
    })

    test('a longer chain stops at the gone path: the older portrait op fails its precondition and the revert refuses', () => {
        const state: Sim = { portrait: value(M, []), exif: { had: false } }
        const base = step({ kind: 'portraitAdd' }, [])
        // The add moves M to the alternates; removing that alternate takes M out again, and its undo would put M back.
        const added = run(state, buildPortraitAdd(N, {}, reader(state)))
        const removed = run(state, buildPortraitRemove(0, reader(state)))
        const plan = planRevert(record(base, added, removed), base.id, reader(state), undefined, undefined, new Set([M]))
        expect(plan).toEqual({ ok: false, reason: 'precondition' })
        expect(state.portrait).toEqual(value(N, []))
    })

    test('the same replay without a gone set puts the file back', () => {
        const state: Sim = { portrait: value(M, []), exif: { had: false } }
        const top = record(run(state, buildPortraitRemove('main', reader(state))))
        const plan = planReplay(top, 'undo', reader(state))
        if (plan.ok === false) throw new Error(`refused: ${plan.reason}`)
        land(state, plan.writes)
        expect(state.portrait).toEqual(value(M, []))
    })
})
