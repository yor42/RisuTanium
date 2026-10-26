// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { builtCommitOf, encodeDatabase, encodeScoped, planScopedEncode, previousFrom, type EncodedTree } from '../../store2/codec'
import { createKeyMint } from '../../store2/commit'
import { UNIT_TYPE } from '../../store2/format'
import { createListDerivation } from '../../store2/lists'
import type { Database } from '../../database.svelte'
import { buildSmall, seededEnv, type Obj } from './codecFixtures'

/**
 * Compatibility guard (it passes before and after the change that stops reused units from holding bytes): the units
 * a pass writes are byte for byte what they were. Each digest below is the SHA-256 of one pass's written units
 * (key, ref, digest and framed bytes, in order) and of its manifest's framed bytes. The profile, the key environments
 * and the key mint are seeded, so the output is a pure function of the codec. The digests were first generated before
 * reused units dropped their bytes, and re-pinned when module index entries gained the entry-fields tag; that changed
 * only the module index unit and the manifests that name it.
 */

const NOW = 1_700_000_000_000
const MODULE_COUNT = 12

const PINNED: Record<string, string> = {
    'scoped module tick, one module edited': 'c2f0003f587182d1ec3311ebbcb6a494c3dd5a3725512c753982ec23c7a762ca',
    'scoped pass, one named character edited': '1125c9922107a37471cc6a4ab61ceb4343ca1cabd6211008f9b57b3ae3bee4a1',
    'full encode, one module and one character edited': '9c246af25901bcb0f5f73d8de89d87be4cebdb856aefa69df223e61f234d0ca4',
    'planned scoped pass, one module edited': '120bdb87ea60bd062ee3fee9b23f5ca14bf0770edee495031f68831cf34f0661',
}

function mod(id: string): Obj {
    return { name: `Module ${id}`, description: 'x'.repeat(20_000), id, lorebook: [], regex: [], trigger: [] }
}

function profile(): Obj {
    const base = buildSmall(3) as unknown as Obj
    return JSON.parse(JSON.stringify({ ...base, modules: Array.from({ length: MODULE_COUNT }, (_, i) => mod(`m${i}`)) })) as Obj
}

function asDatabase(db: Obj): Database {
    return db as unknown as Database
}

function editModule(db: Obj): void {
    ;(db.modules as Obj[])[3].description = 'edited module'
}

function editCharacter(db: Obj): void {
    ;(db.characters as Obj[])[1].desc = 'edited character'
}

function framed(hash: ReturnType<typeof createHash>, label: string, bytes: Uint8Array): void {
    hash.update(`${label}:${bytes.length}:`).update(bytes)
}

/** Digest of what the pass writes: the built units in order, their refs and digests, and the manifest's framed bytes. */
function digestOfWrites(tree: EncodedTree): { digest: string, written: number } {
    const hash = createHash('sha256')
    const built = builtCommitOf(tree)
    const writtenUnits = tree.units.filter(unit => unit.reused === false && unit.type !== UNIT_TYPE.manifest)
    expect(writtenUnits.length).toBe(built.units.length)
    built.units.forEach((unit, index) => {
        const source = writtenUnits[index]
        hash.update(`key:${unit.key}:ref:${JSON.stringify(source.ref)}:digest:${source.digest}:`)
        framed(hash, 'unit', unit.bytes)
    })
    const manifest = tree.units[tree.units.length - 1]
    expect(manifest.type).toBe(UNIT_TYPE.manifest)
    expect(manifest.reused).toBe(false)
    if (manifest.reused === false) {
        hash.update(`manifest:${built.manifest.key}:`)
        framed(hash, 'manifest', manifest.bytes)
    }
    return { digest: hash.digest('hex'), written: built.units.length }
}

const lists = createListDerivation()

function firstEncode(db: Obj): EncodedTree {
    return encodeDatabase(asDatabase(db), { env: seededEnv(1), lists, seq: 1, createdAt: NOW })
}

const CASES: Record<string, () => Promise<EncodedTree>> = {
    'scoped module tick, one module edited': async () => {
        const db = profile()
        const first = firstEncode(db)
        editModule(db)
        const { mint } = createKeyMint(seededEnv(902), null)
        return encodeScoped(asDatabase(db),
            { env: seededEnv(2), lists, seq: 2, createdAt: NOW, previous: previousFrom(first), keys: mint },
            { modules: true, characters: new Set() })
    },
    'scoped pass, one named character edited': async () => {
        const db = profile()
        const first = firstEncode(db)
        editCharacter(db)
        const chaId = String((db.characters as Obj[])[1].chaId)
        const { mint } = createKeyMint(seededEnv(903), null)
        return encodeScoped(asDatabase(db),
            { env: seededEnv(2), lists, seq: 2, createdAt: NOW, previous: previousFrom(first), keys: mint },
            { modules: false, characters: new Set([chaId]) })
    },
    'full encode, one module and one character edited': async () => {
        const db = profile()
        const first = firstEncode(db)
        editModule(db)
        editCharacter(db)
        const { mint } = createKeyMint(seededEnv(904), null)
        return encodeDatabase(asDatabase(db),
            { env: seededEnv(2), lists, seq: 2, createdAt: NOW, previous: previousFrom(first), keys: mint })
    },
    'planned scoped pass, one module edited': async () => {
        const db = profile()
        const first = firstEncode(db)
        editModule(db)
        const plan = await planScopedEncode(asDatabase(db),
            { env: seededEnv(2), lists, seq: 2, createdAt: NOW, previous: previousFrom(first) },
            { modules: true, characters: new Set() })
        const { mint } = createKeyMint(seededEnv(905), null)
        return plan.finalize({ mint, seq: 2, now: NOW })
    },
}

describe('the units a pass writes are unchanged by dropping reused units\' bytes', () => {
    for (const label of Object.keys(CASES)) {
        test(label, async () => {
            const { digest, written } = digestOfWrites(await CASES[label]())
            // The edit must have written a non-manifest unit, or the digest would pin nothing but the manifest.
            expect(written).toBeGreaterThan(0)
            expect(digest).toBe(PINNED[label])
        })
    }
})
