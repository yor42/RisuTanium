// The adapters of the session owner kinds: each resolves its live data by id and writes it. The service
// holds no target or reader across calls; every action resolves again. An adapter module reads no
// `studioSetters` binding at module evaluation, only inside method bodies.

import type { LiveReader, WriteOp } from '../history/historyModel'
import type { SessionOwnerKind } from '../history/sessionKinds'
import { presetAdapter } from './presetTarget'
import type { SaveAck } from './saveAck.svelte'
import type { SetterRefusal } from './studioSetters'

export interface SessionTarget {
    // The session kind name and the id the adapter resolved.
    session: string
    id: string
    reader: LiveReader
}

export interface SessionOwnerAdapter {
    resolve(id: string): { ok: true; target: SessionTarget } | { ok: false; reason: SetterRefusal }
    // Re-resolves by id at write time. False means the owner is gone and nothing was written.
    write(id: string, writes: readonly WriteOp[]): boolean
    // Called after an edit landed and the step was recorded.
    noteEdit?(id: string, marksBefore: number): void
    // Called when the visit to this owner begins.
    beginVisit?(id: string): SaveAck | null
}

export const SESSION_OWNER_ADAPTERS: { readonly [K in SessionOwnerKind]: SessionOwnerAdapter } = {
    preset: presetAdapter,
}

// Read at call time, so a registration made after import is seen.
export function sessionAdapterOf(kind: string): SessionOwnerAdapter | null {
    return Object.hasOwn(SESSION_OWNER_ADAPTERS, kind) ? (SESSION_OWNER_ADAPTERS as Readonly<Record<string, SessionOwnerAdapter>>)[kind] : null
}
