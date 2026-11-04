/**
 * Write-amplification rig (CHORE-412): the units one save pass writes after a small edit, measured through the real
 * `createSaveEncoder` plan, `commitRequest().build` and `acknowledge` over an acknowledged encoding made by the real
 * `encodeDatabase`. No backend and no commit. The written units are exactly the units of the built commit (reused
 * units are not in it), named back to their identities through the acknowledged encoding after `acknowledge`.
 *
 * The pass logic is the `measure` function of the CHORE-412 measurement harness, restated here so the repository
 * tests do not import from the harness folder. Everything is seeded and synthetic.
 */
import { previousFrom } from 'src/ts/storage/store2/codec'
import type { PreviousEncoding } from 'src/ts/storage/store2/codec'
import { createKeyMint } from 'src/ts/storage/store2/commit'
import { UNIT_TYPE } from 'src/ts/storage/store2/format'
import { createSaveEncoder, type SavePassRequest } from 'src/ts/storage/store2/saveEncoder'
import type { Database } from 'src/ts/storage/database.svelte'
import {
    asDatabase, buildSmall, chat, encodeWith, fakeLists, loreEntry, message, mulberry32, prosePool, seededEnv, sparseCharacter, uuidLike,
    type Obj,
} from './codecFixtures'

export const RIG_NOW = 1_700_000_000_000
export const RIG_EDIT_TEXT = ' [edited]'

export interface RigUnitRow {
    identity: string
    type: number
    bytes: number
}

export interface RigPass {
    /** Units the pass wrote, manifest excluded, largest first. */
    written: RigUnitRow[]
    /** Sum of the framed bytes of `written`. */
    writtenBytes: number
    /** Sum of the framed bytes of the written units of type shard. */
    shardBytes: number
    /** Number of written units of type shard. */
    shardUnits: number
    /** The manifest body's shard count as this pass wrote it. */
    shardCount: number
    /** Units the acknowledged encoding holds in total. */
    totalUnits: number
}

/** A pass request that marks the named characters; `extra` overrides any field. */
export function rigRequest(marked: readonly string[] = [], extra: Partial<SavePassRequest> = {}): SavePassRequest {
    return { marked: new Set(marked), modules: false, whole: false, ...extra }
}

export interface RigProfile {
    db: Database
    characters: Obj[]
}

/** `count` characters with one small chat each, over the small profile's global parts. Seeded: equal calls give equal databases. */
export function buildCharactersProfile(count: number, seed = 412): RigProfile {
    const rng = mulberry32(seed)
    const pool = prosePool(rng, 60, 200, 900)
    const characters: Obj[] = []
    for (let c = 0; c < count; c++) {
        const chats = [chat(rng, 0, Array.from({ length: 3 }, (_, m) => message(rng, pool, m, 300)))]
        characters.push(sparseCharacter(rng, pool, uuidLike(rng), `Rig Character ${c}`, chats, [loreEntry(rng, pool, 0, 300)]))
    }
    const base = buildSmall(1) as unknown as Obj
    return { db: asDatabase({ ...base, characters, characterOrder: characters.map(slot => slot.chaId) }), characters }
}

/** The acknowledged encoding of `db` as a first full encode: the base every pass is measured against. */
export function rigBase(db: Database): PreviousEncoding {
    return previousFrom(encodeWith(db))
}

/** Appends a marker text to a string field and returns its revert. */
export function appendRigText(target: Obj, key: string): () => void {
    const before = target[key] as string
    target[key] = before + RIG_EDIT_TEXT
    return () => { target[key] = before }
}

/**
 * Plans, builds and acknowledges one pass over `base`. `apply` edits `db` in place before the plan and returns its
 * revert, which runs afterwards, so one baseline serves many passes.
 */
export async function measureRigPass(db: Database, base: PreviousEncoding, request: SavePassRequest, apply?: () => () => void): Promise<RigPass> {
    const revert = apply?.()
    const encoder = createSaveEncoder({ previous: base, lists: fakeLists, env: seededEnv(77), now: () => RIG_NOW })
    try {
        const plan = await encoder.plan(db, request)
        const { mint } = createKeyMint(seededEnv(900), null)
        const built = await plan.commitRequest().build({ mint, seq: 2, now: RIG_NOW })
        plan.acknowledge()
        const acknowledged = encoder.acknowledged().units
        const identityOfKey = new Map<string, { identity: string, type: number }>()
        for (const [identity, unit] of acknowledged) {
            identityOfKey.set(unit.key, { identity, type: unit.type })
        }
        const written: RigUnitRow[] = built.units.map(unit => {
            const named = identityOfKey.get(unit.key)
            return { identity: named?.identity ?? `?${unit.key}`, type: named?.type ?? -1, bytes: unit.bytes.length }
        })
        written.sort((a, b) => b.bytes - a.bytes)
        const shards = written.filter(unit => unit.type === UNIT_TYPE.shard)
        return {
            written,
            writtenBytes: written.reduce((sum, unit) => sum + unit.bytes, 0),
            shardBytes: shards.reduce((sum, unit) => sum + unit.bytes, 0),
            shardUnits: shards.length,
            shardCount: built.manifest.body.shardCount,
            totalUnits: acknowledged.size,
        }
    } finally {
        revert?.()
    }
}
