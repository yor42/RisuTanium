// Random items and stores against an independent model of the value rules. Renamed targets are fresh keys, so no flow
// reads what another flow writes and the model can apply flows one after another.
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import type { CarryItem } from './toggleCarry'
import { applyCarry, planCarryWrites, undoCarry, type CarryValuePort, type PlaceRef } from './toggleCarryApply'

const OLD_KEYS = ['a', 'b', 'c', 'd'] as const
const NEW_KEYS = ['n1', 'n2', 'n3', 'n4'] as const
const VALUES = ['0', '1', '2', '3', ' 1', '01', '', 'text']
const OPTIONS = 3

type Entries = Record<string, string>
type Place = { readonly ref: PlaceRef, readonly entries: Entries | undefined }

const permutation = fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 })
const withRemoval = fc.constantFrom([0, 0, 1], [0, 1, 0], [1, 0, 0])
const remapArb = fc.oneof(permutation, withRemoval)

const flowArb = (oldKey: string, index: number): fc.Arbitrary<CarryItem[]> =>
    fc.record({ rename: fc.boolean(), remap: fc.option(remapArb, { nil: undefined }) }).map(({ rename, remap }) => {
        const items: CarryItem[] = []
        if (rename) {
            items.push({ kind: 'rename', from: oldKey, to: NEW_KEYS[index] })
        }
        if (remap) {
            items.push({ kind: 'optionRemap', key: oldKey, remap, removed: [] })
        }
        return items
    })

const itemsArb = fc.tuple(...OLD_KEYS.map(flowArb)).map((groups) => groups.flat())

const entriesArb: fc.Arbitrary<Entries | undefined> = fc.option(
    fc.dictionary(fc.constantFrom(...[...OLD_KEYS, ...NEW_KEYS].map((key) => `toggle_${key}`)), fc.constantFrom(...VALUES)),
    { nil: undefined },
)

const placesArb: fc.Arbitrary<Place[]> = fc.array(entriesArb, { minLength: 1, maxLength: 5 }).map((list) =>
    list.map((entries, index): Place => ({ ref: index === 0 ? { kind: 'global' } : { kind: 'chat', chaId: `c${index}`, chatId: 'x' }, entries })))

const keyOf = (ref: PlaceRef): string => (ref.kind === 'global' ? 'global' : `${ref.chaId}/${ref.chatId}`)

/** The independent model: for every place and flow, the renumbered value lands under the target key. */
function modelOf(items: readonly CarryItem[], places: readonly Place[]): Map<string, Entries> {
    const result = new Map<string, Entries>()
    for (const place of places) {
        const entries: Entries = { ...place.entries }
        for (const key of OLD_KEYS) {
            const rename = items.find((item) => item.kind === 'rename' && item.from === key)
            const remapItem = items.find((item) => item.kind === 'optionRemap' && item.key === key)
            const old = place.entries?.[`toggle_${key}`]
            if (old === undefined || (!rename && !remapItem)) {
                continue
            }
            const remap = remapItem && remapItem.kind === 'optionRemap' ? remapItem.remap : undefined
            const canonical = /^(0|[1-9][0-9]*)$/.test(old) && Number(old) < OPTIONS
            const next = remap && canonical ? String(remap[Number(old)]) : old
            const target = rename && rename.kind === 'rename' ? rename.to : key
            entries[`toggle_${target}`] = next
        }
        result.set(keyOf(place.ref), entries)
    }
    return result
}

function portOver(places: readonly Place[]) {
    const store = new Map(places.map((place) => [keyOf(place.ref), { ...place.entries }]))
    const port: CarryValuePort = {
        read: (ref, varKey) => store.get(keyOf(ref))?.[varKey],
        write(ref, varKey, value) {
            const values = store.get(keyOf(ref))!
            if (value === undefined) {
                delete values[varKey]
            } else {
                values[varKey] = value
            }
        },
        mark: () => undefined,
    }
    return { port, store }
}

const reachOf = (places: readonly Place[]) => ({ places, others: [] })

describe('carry writes against the value model (A-P)', () => {
    test('applying the plan gives the model state, the old keys of renames keep their values, and undo restores the start', () => {
        fc.assert(fc.property(itemsArb, placesArb, (items, places) => {
            const plan = planCarryWrites(items, reachOf(places))
            const { port, store } = portOver(places)
            const result = applyCarry(plan, plan.signature, port)
            expect(result.ok).toBe(true)
            const model = modelOf(items, places)
            for (const place of places) {
                expect(store.get(keyOf(place.ref))).toEqual(model.get(keyOf(place.ref)))
            }
            if (result.ok) {
                expect(undoCarry(result.journal, port)).toEqual({ ok: true })
                for (const place of places) {
                    expect(store.get(keyOf(place.ref))).toEqual({ ...place.entries })
                }
            }
        }), { seed: 20261118, numRuns: 300 })
    })

    test('re-planning the same renames over the carried state writes nothing, and an empty item list never writes', () => {
        fc.assert(fc.property(itemsArb, placesArb, (items, places) => {
            const renames = items.filter((item) => item.kind === 'rename')
            const plan = planCarryWrites(renames, reachOf(places))
            const { port, store } = portOver(places)
            applyCarry(plan, plan.signature, port)
            const after: Place[] = places.map((place) => ({ ref: place.ref, entries: store.get(keyOf(place.ref)) }))
            expect(planCarryWrites(renames, reachOf(after)).writes).toEqual([])
            expect(planCarryWrites([], reachOf(places)).writes).toEqual([])
        }), { seed: 20261118, numRuns: 200 })
    })
})
