import { IL_REF_V, splitHashStems, type InlayList } from '../format'
import { resolveListParams, type ListParams } from './params'
import { InlayIdCollector, sortedUnique } from './scan'

/**
 * Inlay lists (type 21 and the `i` of type 20). A body is exact on a full
 * derivation; an append or plugin-storage write may use `mergeInlayLists`, whose
 * result is a superset. A body over the size parameter is never truncated: it
 * becomes the overflow marker, which makes its owner unknown to the cleanup.
 */

/** The overflow body: the owner's ids could not all be listed. */
export function overflowInlayList(): InlayList {
    return { v: IL_REF_V, u: [], h: '', o: [], x: true }
}

function serialisedBytes(body: InlayList): number {
    return new TextEncoder().encode(JSON.stringify(body)).length
}

function boundedBody(uuids: string[], stems: string[], others: string[], params: ListParams): InlayList {
    const body: InlayList = { v: IL_REF_V, u: uuids, h: stems.join(''), o: others }
    return serialisedBytes(body) > params.maxInlayBodyBytes ? overflowInlayList() : body
}

/** Turns what a collector holds into a body: sorted, unique, uuids lower-case, overflow when over the size parameter. */
export function inlayListOf(collector: InlayIdCollector, params?: Partial<ListParams>): InlayList {
    return boundedBody(
        sortedUnique([...collector.uuids].map(id => id.toLowerCase())),
        collector.stems(),
        sortedUnique(collector.others),
        resolveListParams(params),
    )
}

/** Full derivation over an owner's parts (any JSON-like values: every string and key is scanned). */
export function deriveInlayList(parts: readonly unknown[], params?: Partial<ListParams>): InlayList {
    const collector = new InlayIdCollector()
    for (const part of parts) {
        collector.addAll(part)
    }
    return inlayListOf(collector, params)
}

/**
 * previous ∪ added. An overflowed list on either side stays overflowed: the
 * ids it could not hold are not recoverable from the other. A side that is not
 * of the current version also yields the overflow marker (owner unknown, never
 * "complete"): its ids follow another collection rule, so a union stamped current
 * would claim ids it never collected.
 */
export function mergeInlayLists(previous: InlayList, added: InlayList, params?: Partial<ListParams>): InlayList {
    if (previous.v !== IL_REF_V || added.v !== IL_REF_V || previous.x === true || added.x === true) {
        return overflowInlayList()
    }
    return boundedBody(
        sortedUnique([...previous.u, ...added.u].map(id => id.toLowerCase())),
        sortedUnique([...splitHashStems(previous.h), ...splitHashStems(added.h)]),
        sortedUnique([...previous.o, ...added.o]),
        resolveListParams(params),
    )
}
