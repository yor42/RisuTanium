import { describe, expect, test } from 'vitest'
import { ChatUnitIndex, RARE_SHARE } from '../chatIndex'
import { recordOf, type CapturedMessage, type MessageRecord } from '../records'

// Records are built like the producer: from captured refs whose msg objects the app mutates in place.
function ref(i: number, data: string, chatId = `m${i}`): CapturedMessage {
    return { msg: { chatId, role: i % 2 ? 'char' : 'user', data }, chatIndex: i, name: 'Bot', preWrap: data, data }
}
const recs = (refs: CapturedMessage[]): MessageRecord[] => refs.map((r) => recordOf(r, 'User'))
const orderOf = (idx: ChatUnitIndex, q: string) => idx.rank(q, RARE_SHARE)
const textsOf = (idx: ChatUnitIndex, q: string): string[] => orderOf(idx, q).order.map((u) => u.text)

const BASE = ['zebra stripes everywhere', 'omega apple pie', 'comet orbit sky', 'river bank mud', 'tulip garden bloom']
const baseRefs = () => BASE.map((t, i) => ref(i, t))

function freshOver(d0: MessageRecord[]): ChatUnitIndex {
    const idx = new ChatUnitIndex('fresh')
    idx.reconcile(d0)
    return idx
}

describe('ChatUnitIndex.reconcile: sync with the chat', () => {
    test('new rule: an edited message departs its old unit', () => {
        const refs = baseRefs()
        const idx = new ChatUnitIndex('c')
        idx.reconcile(recs(refs))
        expect(textsOf(idx, 'zebra').some((t) => t.includes('zebra'))).toBe(true)
        refs[0].msg.data = 'giraffe necks'
        refs[0].data = 'giraffe necks'
        refs[0].preWrap = 'giraffe necks'
        const r = idx.reconcile(recs(refs))
        expect(r.removed).toBe(1)
        expect(r.rebuilt).toBe(true)
        expect(textsOf(idx, 'zebra').some((t) => t.includes('zebra'))).toBe(false)
        expect(textsOf(idx, 'giraffe')[0]).toBe('giraffe necks')
    })

    test('new rule: a deleted, hidden or reset message leaves the index', () => {
        const refs = baseRefs()
        const idx = new ChatUnitIndex('c')
        idx.reconcile(recs(refs))
        const r = idx.reconcile(recs(refs.filter((_, i) => i !== 2)))
        expect(r.removed).toBe(1)
        expect(r.rebuilt).toBe(true)
        expect(r.rebuildCause).toBe('mid-removal')
        expect(textsOf(idx, 'comet').some((t) => t.includes('comet'))).toBe(false)
    })

    test('new rule: a branch switch to other chatIds replaces every unit', () => {
        const idx = new ChatUnitIndex('c')
        idx.reconcile(recs(baseRefs()))
        const r = idx.reconcile(recs(BASE.map((t, i) => ref(i, t, `branch${i}`))))
        expect(r.removed).toBe(5)
        expect(r.added).toBe(5)
        expect(r.churn).toBe(1)
    })

    test('new rule: a swiped newest record is replaced and a later drop removes it', () => {
        const refs = baseRefs()
        const idx = new ChatUnitIndex('c')
        idx.reconcile(recs(refs))
        refs[4] = ref(4, 'swipe alternative', 'swiped')
        const r1 = idx.reconcile(recs(refs))
        expect(r1.removed).toBe(1)
        expect(r1.added).toBe(1)
        const r2 = idx.reconcile(recs(refs.slice(0, 4)))
        expect(r2.removed).toBe(1)
        expect(textsOf(idx, 'swipe').some((t) => t.includes('swipe'))).toBe(false)
    })

    test('new rule: the same chatId and rawHash with another preWrap keeps the indexed text and churns nothing', () => {
        const refs = baseRefs()
        const idx = new ChatUnitIndex('c')
        idx.reconcile(recs(refs))
        const again = recs(refs).map((r, i) => (i === 1 ? { ...r, preWrap: 'dynamic cbs rewrite' } : r))
        const r = idx.reconcile(again)
        expect(r.churn).toBe(0)
        expect(r.removed).toBe(0)
        expect(r.added).toBe(0)
        expect(textsOf(idx, 'omega')[0]).toBe('omega apple pie')
        expect(textsOf(idx, 'dynamic').some((t) => t.includes('dynamic'))).toBe(false)
    })

    test('new rule: the key follows rawHash, so an edit with an unchanged preWrap still departs', () => {
        const refs = baseRefs()
        const idx = new ChatUnitIndex('c')
        idx.reconcile(recs(refs))
        refs[1].msg.data = 'something else entirely'
        refs[1].data = 'something else entirely'
        const r = idx.reconcile(recs(refs))
        expect(r.removed).toBe(1)
        expect(r.added).toBe(1)
    })

    test('guard: a repeated chatId and hash in one D0 keeps both records as distinct units', () => {
        const a = ref(0, 'twin text here', 'same')
        const b = ref(1, 'twin text here', 'same')
        const idx = new ChatUnitIndex('c')
        const r = idx.reconcile(recs([a, b]))
        expect(r.units).toBe(2)
        expect(idx.reconcile(recs([a, b])).churn).toBe(0)
    })
})

describe('ChatUnitIndex.reconcile: append, truncate and rebuild', () => {
    test('new rule: a growing prefix appends and ranks like a fresh index', () => {
        const refs = baseRefs()
        const idx = new ChatUnitIndex('c')
        const first = idx.reconcile(recs(refs.slice(0, 2)))
        expect(first).toMatchObject({ fresh: true, rebuilt: true, rebuildCause: 'fresh', churn: 0 })
        for (let n = 3; n <= 5; n++) {
            const r = idx.reconcile(recs(refs.slice(0, n)))
            expect(r).toMatchObject({ rebuilt: false, fresh: false, removed: 0, added: 1, rebuildCause: null })
            const ref2 = freshOver(recs(refs.slice(0, n)))
            for (const q of ['zebra apple', 'tulip comet river', 'nothing here']) {
                expect(orderOf(idx, q)).toEqual(orderOf(ref2, q))
            }
        }
    })

    test('new rule: a pure tail removal truncates in place and ranks like a fresh index', () => {
        const refs = baseRefs()
        const idx = new ChatUnitIndex('c')
        idx.reconcile(recs(refs))
        const r = idx.reconcile(recs(refs.slice(0, 3)))
        expect(r).toMatchObject({ rebuilt: false, removed: 2, added: 0, rebuildCause: null, units: 3 })
        expect(r.churn).toBeCloseTo(2 / 5)
        const ref2 = freshOver(recs(refs.slice(0, 3)))
        // The removed units' terms must not leave postings behind: rare-term choice and order equal the fresh index's.
        for (const q of ['zebra apple comet river tulip', 'river tulip', 'comet', 'tulip bloom']) {
            expect(orderOf(idx, q)).toEqual(orderOf(ref2, q))
        }
        expect(orderOf(idx, 'zebra apple comet river tulip').terms).toEqual(['zebra', 'apple', 'comet'])
    })

    test('new rule: a tail shrink with new records after the kept prefix truncates then appends', () => {
        const refs = baseRefs()
        const idx = new ChatUnitIndex('c')
        idx.reconcile(recs(refs))
        const next = [...refs.slice(0, 2), ref(9, 'brand new tail', 'fresh9')]
        const r = idx.reconcile(recs(next))
        expect(r).toMatchObject({ rebuilt: false, removed: 3, added: 1, units: 3 })
        expect(orderOf(idx, 'brand zebra tail')).toEqual(orderOf(freshOver(recs(next)), 'brand zebra tail'))
    })

    test('new rule: a reorder rebuilds from the held units and ranks like a fresh index', () => {
        const refs = baseRefs()
        const idx = new ChatUnitIndex('c')
        idx.reconcile(recs(refs))
        const swapped = [refs[1], refs[0], ...refs.slice(2)]
        const r = idx.reconcile(recs(swapped))
        expect(r).toMatchObject({ rebuilt: true, rebuildCause: 'mid-removal', removed: 0, added: 0 })
        expect(orderOf(idx, 'zebra omega')).toEqual(orderOf(freshOver(recs(swapped)), 'zebra omega'))
    })

    test('new rule: a shrink then growth keeps ranking equal to a fresh index', () => {
        const refs = baseRefs()
        const idx = new ChatUnitIndex('c')
        idx.reconcile(recs(refs))
        idx.reconcile(recs(refs.slice(0, 2)))
        idx.reconcile(recs(refs))
        expect(orderOf(idx, 'tulip river zebra')).toEqual(orderOf(freshOver(recs(refs)), 'tulip river zebra'))
    })

    test('guard: rank lists scored units first, newer first on a tie, then every unscored unit newest first', () => {
        const idx = new ChatUnitIndex('c')
        idx.reconcile(recs([ref(0, 'shared word one'), ref(1, 'shared word two'), ref(2, 'unrelated'), ref(3, 'other')]))
        const { order } = idx.rank('shared', 1)
        expect(order.map((u) => u.text)).toEqual(['shared word two', 'shared word one', 'other', 'unrelated'])
    })

    test('guard: long records split into units with ordinals in offset order', () => {
        const idx = new ChatUnitIndex('c', 20)
        const r = idx.reconcile(recs([ref(0, 'Aaaa aaaa aaaa. Bbbb bbbb bbbb. Cccc cccc cccc.')]))
        expect(r.units).toBe(3)
        const units = idx.rank('aaaa', 1).order
        expect(units.map((u) => u.ordinal).sort()).toEqual([0, 1, 2])
    })
})
