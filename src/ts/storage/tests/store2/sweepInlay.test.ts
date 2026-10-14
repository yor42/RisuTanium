import { describe, expect, it } from 'vitest'
import { hexStemToBase64url } from '../../store2/format'
import { deriveInlayList } from '../../store2/lists'
import { buildInlayKeepSet, decideInlayDeletions, type InlayKeepSet, type OwnerRef } from '../../store2/sweep'
import { COMPLETE } from '../../store2/sweep/types'
import { commitKeyOf, HEX_A, HEX_B, inlayListOf, overflowInlayList, Tree, UUID_A, UUID_B } from './sweepFixtures'

const owner = (kind: OwnerRef['kind'], id: string): OwnerRef => ({ kind, id, manifest: 'store2/m-x' })

function keepOf(over: Partial<InlayKeepSet> = {}): InlayKeepSet {
    // A fixture of a complete keep-set with chosen contents; the closure test below uses the builder.
    return { [COMPLETE]: true, uuids: new Set(), stems: new Set(), others: new Set(), owners: [owner('config', '')], unknownOwners: [], ...over }
}

const resident = (...ids: string[]) => (id: string): boolean => ids.includes(id)
const allOwners = (): boolean => true
const noOwners = (): boolean => false

function run(keep: InlayKeepSet, candidates: string[], over: { db?: (id: string) => boolean, owners?: (o: OwnerRef) => boolean } = {}) {
    return decideInlayDeletions({ keep, candidates, inResidentDatabase: over.db ?? resident(), isOwnerResident: over.owners ?? allOwners })
}

describe('inlay deletion rule', () => {
    it('deletes an id nothing holds, whatever its shape, when every owner is resident', () => {
        const decision = run(keepOf(), [UUID_A, `assets/${HEX_A}.png`, 'free-token'])
        expect(decision.delete).toEqual([UUID_A, `assets/${HEX_A}.png`, 'free-token'])
        expect(decision.kept).toEqual([])
    })

    it('keeps a uuid held by an owner list, an asset-shaped id held by an owner hash', () => {
        const keep = keepOf({ uuids: new Set([UUID_A]), stems: new Set([hexStemToBase64url(HEX_A)]) })
        const decision = run(keep, [UUID_A, UUID_B, `assets/${HEX_A}.png`, `assets/${HEX_B}.png`])
        expect(decision.delete).toEqual([UUID_B, `assets/${HEX_B}.png`])
        expect(decision.kept.map(k => k.id)).toEqual([UUID_A, `assets/${HEX_A}.png`])
    })

    it('lower-cases the candidate before the uuid lookup', () => {
        const keep = keepOf({ uuids: new Set([UUID_A]) })
        const decision = run(keep, [UUID_A.toUpperCase()])
        expect(decision.delete).toEqual([])
        expect(decision.kept).toEqual([{ id: UUID_A.toUpperCase(), reason: 'in-keep-set' }])
    })

    it('matches an upper-case asset hash against the stem', () => {
        const keep = keepOf({ stems: new Set([hexStemToBase64url(HEX_A)]) })
        expect(run(keep, [`assets/${HEX_A.toUpperCase()}.PNG`]).delete).toEqual([])
    })

    it('keeps an id the resident database refers to', () => {
        const decision = run(keepOf(), [UUID_A, `assets/${HEX_A}.png`, 'tok'], { db: resident(UUID_A.toLowerCase(), `assets/${HEX_A}.png`, 'tok') })
        expect(decision.delete).toEqual([])
        expect(decision.kept.every(k => k.reason === 'in-resident-database')).toBe(true)
    })

    it('keeps an other-shaped id unless every owner is resident, even when no list names it', () => {
        const keep = keepOf({ owners: [owner('config', ''), owner('character', 'c1')] })
        const partial = run(keep, ['held-only-by-unloaded-owner'], { owners: o => o.kind === 'config' })
        expect(partial.delete).toEqual([])
        expect(partial.kept).toEqual([{ id: 'held-only-by-unloaded-owner', reason: 'owner-not-resident' }])
        expect(run(keep, ['held-only-by-unloaded-owner'], { owners: noOwners }).delete).toEqual([])
        expect(run(keep, ['held-only-by-unloaded-owner'], { owners: allOwners }).delete).toEqual(['held-only-by-unloaded-owner'])
    })

    it('keeps an other-shaped id an owner list names, even with every owner resident', () => {
        const decision = run(keepOf({ others: new Set(['listed']) }), ['listed'])
        expect(decision.kept).toEqual([{ id: 'listed', reason: 'in-keep-set' }])
    })

    it('deletes nothing while any owner is unknown', () => {
        const keep = keepOf({ unknownOwners: [owner('character', 'c1')] })
        const decision = run(keep, [UUID_A, `assets/${HEX_A}.png`, 'tok'])
        expect(decision.delete).toEqual([])
        expect(decision.kept.every(k => k.reason === 'unknown-owner')).toBe(true)
        expect(decision.kept).toHaveLength(3)
    })

    // Every case is an inlay token whose list is derived from chat text by the collector and held by a character that is not resident.
    it.each([
        ['an upper-case prefix', `ASSETS/${HEX_A}.png`],
        ['a capitalised prefix', `Assets/${HEX_A}.png`],
        ['an upper-case hash', `assets/${HEX_A.toUpperCase()}.png`],
        ['a lower-case asset path', `assets/${HEX_A}.png`],
    ])('keeps a token id held only by an unloaded owner: %s', async (_name, id) => {
        const tree = new Tree()
        const il = deriveInlayList([{ chat: `hello {{inlay::${id}}}` }])
        const current = tree.addManifest({ characters: [{ u: 'c1', il }] }, 1)
        const built = await buildInlayKeepSet({ commitKey: commitKeyOf({ current }), reader: tree.reader })
        if (built.status !== 'complete') {
            throw new Error('the keep-set should be complete')
        }
        const decision = run(built.keep, [id], { db: resident(), owners: o => o.kind !== 'character' })
        expect(decision.delete).toEqual([])
    })

    // The collector lists only token ids and lower-case `assets/` hashes, so a raw upper-case reference is in no list; only the case-sensitive asset prefix keeps it out of the asset branch, which would delete it.
    it.each([
        ['an upper-case prefix', `ASSETS/${HEX_A}.png`],
        ['a capitalised prefix', `Assets/${HEX_A}.png`],
    ])('keeps a raw non-token reference held only by an unloaded owner: %s', async (_name, id) => {
        const tree = new Tree()
        const il = deriveInlayList([{ chat: `<img src="${id}">` }])
        const current = tree.addManifest({ characters: [{ u: 'c1', il }] }, 1)
        const built = await buildInlayKeepSet({ commitKey: commitKeyOf({ current }), reader: tree.reader })
        if (built.status !== 'complete') {
            throw new Error('the keep-set should be complete')
        }
        const decision = run(built.keep, [id], { db: resident(), owners: o => o.kind !== 'character' })
        expect(decision.delete).toEqual([])
        expect(decision.kept).toEqual([{ id, reason: 'owner-not-resident' }])
    })

    it('keeps a listed id before any shape branch, even one the asset matcher would take', () => {
        const id = `assets/${HEX_A}.png`
        const decision = run(keepOf({ others: new Set([id]) }), [id])
        expect(decision.kept).toEqual([{ id, reason: 'in-keep-set' }])
    })

    it('an id held by an unloaded owner survives through the keep-set read from the closure', async () => {
        const tree = new Tree()
        const current = tree.addManifest({
            characters: [
                { u: 'c1', il: inlayListOf({ u: [UUID_A], h: hexStemToBase64url(HEX_A), o: ['custom'] }) },
                { u: 'c2', il: overflowInlayList() },
            ],
        }, 1)
        const built = await buildInlayKeepSet({ commitKey: commitKeyOf({ current }), reader: tree.reader })
        if (built.status !== 'complete') {
            throw new Error('the keep-set should be complete')
        }
        const candidates = [UUID_A.toUpperCase(), `assets/${HEX_A}.png`, 'custom', UUID_B]
        // The overflow owner c2 makes everything survive, even ids no list names.
        expect(run(built.keep, candidates).delete).toEqual([])
        expect(built.keep.unknownOwners).toMatchObject([{ id: 'c2' }])
    })
})
