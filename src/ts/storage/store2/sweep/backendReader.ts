import type { Store2Backend } from '../backend'
import {
    keyOfRef, readUnit, refOfFrame, UNIT_TYPE,
    type Manifest, type Parsed, type Ref, type UnitBody, type UnitType,
} from '../format'
import type { ClosureReader, NodeRead } from './types'

/**
 * The production `ClosureReader`: every unit the keep-set walk needs, read through the
 * session backend's `readUnits` and checked against the length and checksum its
 * referrer holds before any byte is parsed. An absent key answers `missing`; a
 * length or checksum mismatch answers `crc-failed` and the bytes are never parsed.
 * A backend failure is not caught here: the walk turns a thrown read into a node it
 * could not read, which makes the keep-set incomplete.
 *
 * A unit is fetched once however many referrers name it, so two keep-set builds
 * over one reader cost one read per unit. The reader also remembers every manifest
 * it delivered intact, for the fence check over their legacy files.
 */

export interface BackendClosureReader extends ClosureReader {
    /** The manifests read intact so far, by key. */
    manifests(): ReadonlyMap<string, Manifest>
}

function toNodeRead<T>(unit: Parsed<{ type: UnitType, body: UnitBody }>): NodeRead<T> {
    switch (unit.status) {
        case 'ok':
            return { status: 'ok', value: unit.value.body as T }
        case 'stale':
            return { status: 'stale', value: unit.value.body as T, reason: unit.reason }
        default:
            return unit
    }
}

/** Why `bytes` is not the unit `ref` names, or null when its length and checksum match. */
function mismatch(key: string, ref: Ref, bytes: Uint8Array): string | null {
    if (bytes.length !== ref[1]) {
        return `${key} holds ${bytes.length} bytes, its referrer expects ${ref[1]}.`
    }
    let crc: number
    try {
        crc = refOfFrame(key, bytes)[2]
    } catch {
        return `${key} is not a frame.`
    }
    return crc === ref[2] ? null : `${key} does not match the checksum its referrer holds.`
}

export function createBackendClosureReader(backend: Store2Backend): BackendClosureReader {
    const fetched = new Map<string, Promise<Uint8Array | null>>()
    const manifests = new Map<string, Manifest>()

    const fetchUnit = (key: string): Promise<Uint8Array | null> => {
        let pending = fetched.get(key)
        if (pending === undefined) {
            pending = backend.readUnits([key]).then(units => units.get(key) ?? null)
            fetched.set(key, pending)
        }
        return pending
    }

    const readRef = async <T>(ref: Ref, type: UnitType): Promise<NodeRead<T>> => {
        const key = keyOfRef(ref)
        const bytes = await fetchUnit(key)
        if (bytes === null) {
            return { status: 'missing', reason: `${key} is not stored.` }
        }
        const wrong = mismatch(key, ref, bytes)
        if (wrong !== null) {
            return { status: 'crc-failed', reason: wrong }
        }
        return toNodeRead<T>(readUnit(bytes, type))
    }

    return {
        manifests: () => manifests,
        manifest: async key => {
            const bytes = await fetchUnit(key)
            if (bytes === null) {
                return { status: 'missing', reason: `${key} is not stored.` }
            }
            const result = toNodeRead<Manifest>(readUnit(bytes, UNIT_TYPE.manifest))
            if (result.status === 'ok' || result.status === 'stale') {
                manifests.set(key, result.value)
            }
            return result
        },
        shard: ref => readRef(ref, UNIT_TYPE.shard),
        moduleIndex: ref => readRef(ref, UNIT_TYPE.moduleIndex),
        assetList: ref => readRef(ref, UNIT_TYPE.assetList),
        inlayList: ref => readRef(ref, UNIT_TYPE.inlayList),
        legacyList: ref => readRef(ref, UNIT_TYPE.legacyList),
    }
}
