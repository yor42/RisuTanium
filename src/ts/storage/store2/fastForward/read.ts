import type { Store2Backend } from '../backend/types'
import { checkUnit } from '../codec/assemble'
import type { UnitSource } from '../codec'
import { classifyCommitRead } from '../commitKey'
import { keyOfRef, readUnit, UNIT_TYPE, type Manifest, type Ref, type UnitType } from '../format'
import type { PreviousEncoding } from '../codec'
import type { StoredTree } from '../previousOfTree'
import { checkManifestKey, readBatch } from '../tree'

/**
 * The read half of the fast-forward: the peer's manifest and only the units whose Ref differs from the acknowledged
 * encoding's (the fixed units a decision needs and the shards). Entity units are never read: a character the peer
 * changed is installed as the stub its entry stands for. The read is checked by the codec's own unit check, so a damaged
 * or newer unit is told from a failing store.
 */

export type PeerTreeRead =
    | { status: 'ok', tree: StoredTree }
    /** A unit is in a newer format, or damaged or missing: this page does not take the tree; today's prompts apply. */
    | { status: 'park', reason: 'too-new' | 'structure', detail: string }
    /** The backend failed: nothing is known; the pass retries. */
    | { status: 'retry', detail: string }
    /** The commit key no longer names the tree that was read. */
    | { status: 'moved' }

interface Wanted {
    identity: string
    ref: Ref
    type: UnitType
}

/** The fixed units and shards of `manifest` under the identities the acknowledged encoding holds them by. */
export function wantedOf(manifest: Manifest): Wanted[] {
    const fixed = manifest.fixed
    const wanted: Wanted[] = [
        { identity: 'order', ref: fixed.order, type: UNIT_TYPE.order },
        { identity: 'config', ref: fixed.config, type: UNIT_TYPE.configRoot },
        { identity: 'al:config', ref: fixed.configAl, type: UNIT_TYPE.assetList },
        { identity: 'il:config', ref: fixed.il, type: UNIT_TYPE.inlayList },
        { identity: 'statics', ref: fixed.statics, type: UNIT_TYPE.statics },
        { identity: 'loadouts', ref: fixed.loadouts, type: UNIT_TYPE.loadouts },
    ]
    fixed.presets.forEach((ref, index) => wanted.push({ identity: `preset:${index}`, ref, type: UNIT_TYPE.preset }))
    manifest.shards.forEach((ref, index) => wanted.push({ identity: `shard:${index}`, ref, type: UNIT_TYPE.shard }))
    return wanted
}

/**
 * Reads the tree `manifestKey` names, against `old`, the acknowledged encoding. After the units are read the commit key
 * is read once more: a `current` that is no longer `manifestKey` is `moved` (a later peer commit), never damage.
 */
export async function readPeerTree(backend: Store2Backend, manifestKey: string, old: PreviousEncoding): Promise<PeerTreeRead> {
    const refused = checkManifestKey(manifestKey)
    if (refused !== null) {
        return { status: 'park', reason: 'structure', detail: `${manifestKey} is not a manifest key.` }
    }
    const bytes = new Map<string, Uint8Array>()
    const source: UnitSource = { get: key => bytes.get(key) }
    const load = async (keys: readonly string[]): Promise<PeerTreeRead | null> => {
        const pending = [...new Set(keys)].filter(key => !bytes.has(key))
        if (pending.length === 0) {
            return null
        }
        let batch = pending
        while (batch.length > 0) {
            const read = await readBatch(backend, batch)
            if (read.status === 'unreadable') {
                return { status: 'retry', detail: read.cause.message }
            }
            if (read.status === 'not-binary') {
                return { status: 'park', reason: 'structure', detail: `${read.key} is not binary.` }
            }
            for (const [key, value] of read.units) {
                if (value !== null) {
                    bytes.set(key, value)
                }
            }
            break
        }
        return null
    }

    const first = await load([manifestKey])
    if (first !== null) {
        return first
    }
    const manifestBytes = bytes.get(manifestKey)
    if (manifestBytes === undefined) {
        return { status: 'park', reason: 'structure', detail: `${manifestKey} is missing.` }
    }
    const parsed = readUnit(manifestBytes, UNIT_TYPE.manifest)
    if (parsed.status === 'too-new' || parsed.status === 'unreadable') {
        return { status: 'park', reason: 'too-new', detail: parsed.reason }
    }
    if (parsed.status !== 'ok' && parsed.status !== 'stale') {
        return { status: 'park', reason: 'structure', detail: parsed.reason }
    }
    const manifest = parsed.value.body as Manifest
    const changed = wantedOf(manifest).filter((item) => {
        const held = old.units.get(item.identity)
        return held === undefined || held.key !== keyOfRef(item.ref)
    })
    const second = await load(changed.map(item => keyOfRef(item.ref)))
    if (second !== null) {
        return second
    }
    for (const item of changed) {
        const checked = checkUnit(source, item.ref, item.type)
        switch (checked.status) {
            case 'ok':
                break
            case 'too-new':
                return { status: 'park', reason: 'too-new', detail: checked.reason }
            case 'newer-list':
                break
            case 'missing':
                return { status: 'park', reason: 'structure', detail: `${keyOfRef(item.ref)} is missing.` }
            case 'damaged':
                return { status: 'park', reason: 'structure', detail: `${keyOfRef(item.ref)}: ${checked.reason}` }
        }
    }
    let commit
    try {
        commit = classifyCommitRead(await backend.readCommit())
    } catch (error) {
        return { status: 'retry', detail: error instanceof Error ? error.message : String(error) }
    }
    if (commit.status !== 'parsed' || commit.value.current?.key !== manifestKey) {
        return { status: 'moved' }
    }
    return { status: 'ok', tree: { manifestKey, manifest, source } }
}
