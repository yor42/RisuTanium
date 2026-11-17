// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    classifyMembership, completeOrder, decideMembership, membershipInDomain, membershipTarget, mergeMembership, placeInsertions,
    type Insertion, type Member,
} from '../../store2/fastForward/delta'

const resident = (chaId: string): boolean => chaId.startsWith('§')

function members(...chaIds: string[]): Member[] {
    return chaIds.map(chaId => ({ chaId, u: `u-${chaId}` }))
}

function ids(list: readonly Member[]): string[] {
    return list.map(member => member.chaId)
}

/** Applies the removals, then the placements in the returned order, the way the steps do. */
function applyAll(live: readonly string[], target: readonly string[], insertions: readonly Insertion[]): string[] {
    const out = live.filter(id => target.includes(id))
    for (const insertion of insertions) {
        if (insertion.before === null) {
            out.push(insertion.chaId)
        } else {
            const at = out.indexOf(insertion.before)
            expect(at, `${insertion.chaId} before ${insertion.before} is already present`).toBeGreaterThanOrEqual(0)
            out.splice(at, 0, insertion.chaId)
        }
    }
    return out
}

function plan(base: readonly Member[], live: readonly Member[], theirs: readonly Member[], keep?: ReadonlySet<string>) {
    const target = membershipTarget({ base: ids(base), live: ids(live), theirs: ids(theirs), ...(keep === undefined ? {} : { keep }) })
    const afterRemovals = ids(live).filter(id => target.includes(id))
    const insertions = placeInsertions(afterRemovals, target)
    expect(applyAll(ids(live), target, insertions)).toEqual(target)
    return { target, insertions }
}

describe('V4 (a): mergeMembership agrees with classifyMembership where stage 1 is unchanged', () => {
    const base = members('A', 'B', 'C')

    test('theirs equal to base: keep on both', () => {
        expect(classifyMembership(base, base, members('A', 'B', 'C'), resident)).toEqual({ kind: 'keep' })
        expect(mergeMembership(base, base, members('A', 'B', 'C'), resident)).toEqual({ kind: 'keep' })
    })

    test('an append is `append` in stage 1 and `change` here, and every placement goes to the end', () => {
        const theirs = [...base, ...members('N1', 'N2')]
        expect(classifyMembership(base, base, theirs, resident)).toEqual({ kind: 'append', members: members('N1', 'N2') })
        expect(mergeMembership(base, base, theirs, resident)).toEqual({ kind: 'change', inserted: members('N1', 'N2') })
        const { insertions } = plan(base, base, theirs)
        expect(insertions).toEqual([{ chaId: 'N2', before: null }, { chaId: 'N1', before: 'N2' }])
    })

    test('this page changed the list: both-changed on both', () => {
        const mine = members('A', 'B')
        const theirs = [...base, ...members('N')]
        expect(classifyMembership(base, mine, theirs, resident)).toEqual({ kind: 'park', reason: 'both-changed' })
        expect(mergeMembership(base, mine, theirs, resident)).toEqual({ kind: 'park', reason: 'both-changed' })
    })

    test('a re-minted u: not-append on both', () => {
        const theirs = [{ chaId: 'A', u: 'u-other' }, ...base.slice(1), ...members('N')]
        expect(classifyMembership(base, base, theirs, resident)).toEqual({ kind: 'park', reason: 'not-append' })
        expect(mergeMembership(base, base, theirs, resident)).toEqual({ kind: 'park', reason: 'not-append' })
    })

    test('an appended resident id: resident-id on both', () => {
        const theirs = [...base, ...members('§N')]
        expect(classifyMembership(base, base, theirs, resident)).toEqual({ kind: 'park', reason: 'resident-id' })
        expect(mergeMembership(base, base, theirs, resident)).toEqual({ kind: 'park', reason: 'resident-id' })
    })

    test('a removal and a mid-list insertion are the stage-3 changes: not-append in stage 1, change here', () => {
        expect(classifyMembership(base, base, members('A', 'C'), resident)).toEqual({ kind: 'park', reason: 'not-append' })
        expect(mergeMembership(base, base, members('A', 'C'), resident)).toEqual({ kind: 'change', inserted: [] })
        expect(classifyMembership(base, base, members('A', 'N', 'B', 'C'), resident)).toEqual({ kind: 'park', reason: 'not-append' })
        expect(mergeMembership(base, base, members('A', 'N', 'B', 'C'), resident)).toEqual({ kind: 'change', inserted: members('N') })
    })
})

describe('V4 (b): outside the domain decideMembership is classifyMembership', () => {
    test('a repeated id in base and an append: append', () => {
        const base = members('A', 'X', 'X', 'B').map((member, index) => ({ ...member, u: `u${index}` }))
        const theirs = [...base, { chaId: 'N', u: 'uN' }]
        expect(membershipInDomain(base, base, theirs)).toBe(false)
        expect(decideMembership(base, base, theirs, resident)).toEqual({ kind: 'append', members: [{ chaId: 'N', u: 'uN' }] })
        expect(decideMembership(base, base, theirs, resident)).toEqual(classifyMembership(base, base, theirs, resident))
    })

    test('an empty id in base and an append: append', () => {
        const base = [{ chaId: 'A', u: 'u0' }, { chaId: '', u: 'u1' }, { chaId: '', u: 'u2' }]
        const theirs = [...base, { chaId: 'N', u: 'uN' }]
        expect(decideMembership(base, base, theirs, resident)).toEqual({ kind: 'append', members: [{ chaId: 'N', u: 'uN' }] })
    })

    test('theirs appends a second X: duplicate-id', () => {
        const base = members('A', 'X', 'B')
        const theirs = [...base, { chaId: 'X', u: 'u-second' }]
        expect(membershipInDomain(base, base, theirs)).toBe(false)
        expect(decideMembership(base, base, theirs, resident)).toEqual({ kind: 'park', reason: 'duplicate-id' })
    })

    test('a removal outside the domain parks not-append, never a change', () => {
        const base = members('A', 'X', 'X', 'B').map((member, index) => ({ ...member, u: `u${index}` }))
        const theirs = [base[0], base[1], base[2]]
        expect(decideMembership(base, base, theirs, resident)).toEqual({ kind: 'park', reason: 'not-append' })
    })
})

describe('V5: mergeMembership, membershipTarget and placeInsertions', () => {
    test('(a) a removal', () => {
        const base = members('A', 'B', 'C')
        expect(mergeMembership(base, base, members('A', 'C'), resident)).toEqual({ kind: 'change', inserted: [] })
        const { target, insertions } = plan(base, base, members('A', 'C'))
        expect(target).toEqual(['A', 'C'])
        expect(insertions).toEqual([])
    })

    test('(b) an insertion mid-list with its successor', () => {
        const base = members('A', 'B')
        const theirs = members('A', 'N', 'B')
        const { target, insertions } = plan(base, base, theirs)
        expect(target).toEqual(ids(theirs))
        expect(insertions).toEqual([{ chaId: 'N', before: 'B' }])
    })

    test('(c) a removal plus an insertion', () => {
        const base = members('A', 'B', 'C')
        const theirs = members('A', 'N', 'C')
        expect(mergeMembership(base, base, theirs, resident)).toEqual({ kind: 'change', inserted: members('N') })
        const { target, insertions } = plan(base, base, theirs)
        expect(target).toEqual(['A', 'N', 'C'])
        expect(insertions).toEqual([{ chaId: 'N', before: 'C' }])
    })

    test('(d) a re-minted u parks', () => {
        const base = members('A', 'B')
        expect(mergeMembership(base, base, [base[0], { chaId: 'B', u: 'u-new' }], resident)).toEqual({ kind: 'park', reason: 'not-append' })
        expect(mergeMembership(base, base, members('B', 'A'), resident)).toEqual({ kind: 'park', reason: 'not-append' })
    })

    test('(e) an inserted resident id parks', () => {
        const base = members('A', 'B')
        expect(mergeMembership(base, base, members('A', '§N', 'B'), resident)).toEqual({ kind: 'park', reason: 'resident-id' })
    })

    test('(f) a theirs-side repeat is outside the domain: duplicate-id', () => {
        const base = members('A', 'B')
        expect(decideMembership(base, base, [...base, { chaId: 'A', u: 'u-x' }], resident)).toEqual({ kind: 'park', reason: 'duplicate-id' })
    })

    test('(g) two adjacent insertions: placed in reverse, each before an already present id', () => {
        const base = members('X', 'S', 'Y')
        const theirs = members('X', 'D1', 'D2', 'S', 'Y')
        const { target, insertions } = plan(base, base, theirs)
        expect(target).toEqual(ids(theirs))
        expect(insertions).toEqual([{ chaId: 'D2', before: 'S' }, { chaId: 'D1', before: 'D2' }])
    })

    test('(h) three insertions at the front', () => {
        const base = members('X', 'Y')
        const theirs = members('N1', 'N2', 'N3', 'X', 'Y')
        const { target, insertions } = plan(base, base, theirs)
        expect(target).toEqual(ids(theirs))
        expect(insertions.map(insertion => insertion.chaId)).toEqual(['N3', 'N2', 'N1'])
    })

    test('(i) the R13 shape: a kept deletion returns before the next present member', () => {
        const base = members('X', 'D', 'D2', 'S')
        const live = members('X', 'S')
        const { target, insertions } = plan(base, live, base, new Set(['D']))
        expect(target).toEqual(['X', 'D', 'S'])
        expect(insertions).toEqual([{ chaId: 'D', before: 'S' }])
    })

    test('(j) a mine-only member is a possible anchor', () => {
        const base = members('X', 'D')
        const live = members('X', 'N')
        const { target, insertions } = plan(base, live, members('X', 'D'), new Set(['D']))
        expect(target).toEqual(['X', 'D', 'N'])
        expect(insertions).toEqual([{ chaId: 'D', before: 'N' }])
    })

    test('(k) outside the domain a peer removal is not-append, while (a) to (j) are inside it', () => {
        const base = members('A', 'X', 'X', 'B').map((member, index) => ({ ...member, u: `u${index}` }))
        expect(membershipInDomain(base, base, base)).toBe(false)
        expect(decideMembership(base, base, [base[0], base[1], base[2]], resident)).toEqual({ kind: 'park', reason: 'not-append' })
    })

    test('an adjacent removal pair (P11c shape) places both kept ids in order', () => {
        const base = members('A', 'D1', 'D2', 'Z')
        const live = members('A', 'D1', 'D2', 'Z')
        const theirs = members('A', 'Z')
        const { target } = plan(base, live, theirs, new Set(['D1', 'D2']))
        expect(target).toEqual(['A', 'D1', 'D2', 'Z'])
    })
})

describe('V6: membershipInDomain', () => {
    const base = members('A', 'B')

    test('all unique: true', () => {
        expect(membershipInDomain(base, base, base)).toBe(true)
    })

    test('a repeat on one side only: false for each side', () => {
        const repeated = [...base, { chaId: 'A', u: 'u-3' }]
        expect(membershipInDomain(repeated, base, base)).toBe(false)
        expect(membershipInDomain(base, repeated, base)).toBe(false)
        expect(membershipInDomain(base, base, repeated)).toBe(false)
    })

    test('an empty id on one side only: false for each side', () => {
        const empty = [...base, { chaId: '', u: 'u-e' }]
        expect(membershipInDomain(empty, base, base)).toBe(false)
        expect(membershipInDomain(base, empty, base)).toBe(false)
        expect(membershipInDomain(base, base, empty)).toBe(false)
    })

    test('a unique resident id is inside the domain', () => {
        const withResident = [...base, ...members('§R', '')].slice(0, 3)
        expect(membershipInDomain(withResident, withResident, withResident)).toBe(true)
    })

    test('a removed resident id gives no row: mergeMembership returns change with nothing inserted', () => {
        const withResident = members('A', '§R', 'B')
        expect(mergeMembership(withResident, withResident, members('A', 'B'), resident)).toEqual({ kind: 'change', inserted: [] })
    })
})

describe('V7: completeOrder', () => {
    test('(a) a kept, untrashed id named nowhere is appended at the top-level end', () => {
        expect(completeOrder(['a', 'b'], [{ chaId: 'k', trashed: false }])).toEqual(['a', 'b', 'k'])
    })

    test('(b) a kept id named inside a folder is unchanged', () => {
        const folder = { id: 'f', name: 'Folder', data: ['k'] }
        expect(completeOrder(['a', folder], [{ chaId: 'k', trashed: false }])).toEqual(['a', folder])
    })

    test('(c) a kept trashed id is unchanged', () => {
        expect(completeOrder(['a'], [{ chaId: 'k', trashed: true }])).toEqual(['a'])
    })

    test('(d) an absent id that is not kept is unchanged', () => {
        expect(completeOrder(['a'], [{ chaId: 'k', trashed: false }]).includes('x')).toBe(false)
        expect(completeOrder(['a'], [])).toEqual(['a'])
    })

    test('(e) empty kept equals the input, and the input is not mutated', () => {
        const order = ['a', 'b']
        const out = completeOrder(order, [])
        expect(out).toEqual(order)
        expect(out).not.toBe(order)
        completeOrder(order, [{ chaId: 'k', trashed: false }])
        expect(order).toEqual(['a', 'b'])
    })

    test('a kept id listed twice is appended once, and an id already at the top level is not repeated', () => {
        expect(completeOrder(['a'], [{ chaId: 'k', trashed: false }, { chaId: 'k', trashed: false }, { chaId: 'a', trashed: false }])).toEqual(['a', 'k'])
    })
})
