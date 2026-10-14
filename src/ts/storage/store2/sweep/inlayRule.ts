import { hexStemToBase64url } from '../format'
import type { InlayKeepSet, OwnerRef } from './types'

/**
 * The conservative deletion rule of the inlay cleanup. It decides, for each
 * candidate id, delete or keep; it reads nothing. Over-protection is the safe
 * direction: a candidate is deleted only when every check that could protect it
 * has been made and none did.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The prefix is case-sensitive like the collector's and the hash either case: a differently-cased prefix is an other-shaped id.
const ASSET_ID = /^assets\/([0-9a-fA-F]{64})\.[A-Za-z0-9]+$/

export type InlayKeepReason =
    | 'unknown-owner'
    | 'in-keep-set'
    | 'in-resident-database'
    | 'owner-not-resident'

export interface InlayDecisionInput {
    /** A complete inlay keep-set (`buildInlayKeepSet`); an incomplete result never reaches the rule. */
    keep: InlayKeepSet
    candidates: readonly string[]
    /** Whether the resident (loaded) database refers to the id. */
    inResidentDatabase(id: string): boolean
    /**
     * Whether the owner's inlay ids are fully held by the resident database,
     * so a full scan of it speaks for the owner. An owner read through a
     * retained or pinned manifest may hold ids the current database no longer
     * does: answer true only where the content is the same.
     */
    isOwnerResident(owner: OwnerRef): boolean
}

export interface InlayDecision {
    delete: string[]
    kept: { id: string, reason: InlayKeepReason }[]
}

function decideOne(input: InlayDecisionInput, id: string): InlayKeepReason | null {
    const { keep } = input
    // An id an owner list names is kept whatever shape the matcher gives it; the shape branches below only add protection.
    if (keep.others.has(id)) {
        return 'in-keep-set'
    }
    if (UUID.test(id)) {
        // The matcher accepts a uuid in any case but the keep-set holds lower case: look up the lower-cased id.
        if (keep.uuids.has(id.toLowerCase())) {
            return 'in-keep-set'
        }
        return input.inResidentDatabase(id) || input.inResidentDatabase(id.toLowerCase()) ? 'in-resident-database' : null
    }
    const asset = ASSET_ID.exec(id)
    if (asset !== null) {
        if (keep.stems.has(hexStemToBase64url(asset[1]))) {
            return 'in-keep-set'
        }
        return input.inResidentDatabase(id) ? 'in-resident-database' : null
    }
    // An id of any other shape is listed in `o` only by owners that were scanned; an owner that is not resident may hold it unlisted by this build.
    if (!keep.owners.every(owner => input.isOwnerResident(owner))) {
        return 'owner-not-resident'
    }
    return input.inResidentDatabase(id) ? 'in-resident-database' : null
}

export function decideInlayDeletions(input: InlayDecisionInput): InlayDecision {
    const decision: InlayDecision = { delete: [], kept: [] }
    if (input.keep.unknownOwners.length > 0) {
        decision.kept = input.candidates.map(id => ({ id, reason: 'unknown-owner' }))
        return decision
    }
    for (const id of input.candidates) {
        const reason = decideOne(input, id)
        if (reason === null) {
            decision.delete.push(id)
        } else {
            decision.kept.push({ id, reason })
        }
    }
    return decision
}
