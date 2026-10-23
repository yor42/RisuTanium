// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { assembleDatabase, encodeDatabase, planScopedEncode, previousFrom, unitMapSource } from '../../store2/codec'
import type { EncodedTree } from '../../store2/codec'
import { createKeyMint } from '../../store2/commit'
import { createListDerivation } from '../../store2/lists'
import type { Database } from '../../database.svelte'
import { buildSmall, encodeWith, seededEnv, type Obj } from './codecFixtures'

const NOW = 1_700_000_000_000

function mod(id: string, extra: Obj = {}): Obj {
    return { name: `Module ${id}`, description: `about ${id}`, id, lorebook: [], regex: [], trigger: [], ...extra }
}

function dbWith(modules: Obj[], characters = 3): Obj {
    return JSON.parse(JSON.stringify({ ...(buildSmall(characters) as unknown as Obj), modules })) as Obj
}

function chaIds(characters: unknown[]): string[] {
    return characters.map(slot => String((slot as { chaId?: unknown }).chaId))
}

/** One pass over `db` with the modules flagged and `characters` named; `onYield` runs at every yield, with its count. */
async function pass(
    db: Obj, previous: EncodedTree, characters: 'all' | Set<string>, onYield: (count: number) => void, seed = 2,
): Promise<{ tree: EncodedTree, yields: number }> {
    let yields = 0
    const plan = await planScopedEncode(
        db as unknown as Database,
        { env: seededEnv(seed), lists: createListDerivation(), seq: seed, createdAt: NOW, previous: previousFrom(previous) },
        {
            modules: true,
            characters,
            yield: async () => {
                yields++
                onYield(yields)
            },
        },
    )
    const { mint } = createKeyMint(seededEnv(900 + seed), null)
    return { tree: plan.finalize({ mint, seq: seed, now: NOW }), yields }
}

function decode(first: EncodedTree, tree: EncodedTree): { characters: unknown[], modules: Obj[] } {
    return assembleDatabase(tree.manifest, unitMapSource([...first.units, ...tree.units])) as unknown as { characters: unknown[], modules: Obj[] }
}

function firstTree(db: Obj): EncodedTree {
    return encodeWith(db as unknown as Database, { lists: createListDerivation() })
}

describe('the module set yields between modules (regression reproducers, except the R6 cases marked as guards)', () => {
    test('R3: a pass that names no character still yields once per module', async () => {
        const db = dbWith([mod('a'), mod('b'), mod('c'), mod('d')])
        const first = firstTree(db)
        const { yields } = await pass(db, first, new Set(), () => undefined)
        expect(yields).toBe(4)
    })

    test('R3: the yield falls between modules, not after the whole set', async () => {
        const db = dbWith([mod('a'), mod('b'), mod('c')])
        const first = firstTree(db)
        const edits: string[] = []
        // A module edited at the first yield is still unencoded modules b and c's turn; module a is already encoded.
        const { tree } = await pass(db, first, new Set(), (count) => {
            edits.push(`yield ${count}`)
            if (count === 1) {
                ;(db.modules as Obj[])[2].description = 'edited at the first yield'
            }
        })
        expect(edits).toHaveLength(3)
        expect(decode(first, tree).modules[2].description).toBe('edited at the first yield')
    })

    for (const change of ['unshift', 'splice', 'reassign-filter'] as const) {
        test(`R5 (${change}): a character list edit at a module yield does not fail the pass; the commit holds the pre-pass list`, async () => {
            const db = dbWith([mod('a'), mod('b')])
            const first = firstTree(db)
            const before = chaIds(db.characters as unknown[])
            const extra = JSON.parse(JSON.stringify((db.characters as Obj[])[0])) as Obj
            extra.chaId = 'added-during-module-yield'
            const { tree, yields } = await pass(db, first, new Set(), (count) => {
                if (count !== 1) {
                    return
                }
                const live = db.characters as Obj[]
                if (change === 'unshift') {
                    live.unshift(extra)
                } else if (change === 'splice') {
                    live.splice(0, 1)
                } else {
                    db.characters = live.filter((_slot, index) => index !== 0)
                }
            })
            expect(yields).toBe(2)
            const saved = chaIds(decode(first, tree).characters)
            expect(saved).toEqual(before)
            expect(new Set(saved).size).toBe(saved.length)
        })
    }

    test('R5: a character added at a module yield is in the next pass (the new-character rule is the next pass\'s)', async () => {
        const db = dbWith([mod('a'), mod('b')])
        const first = firstTree(db)
        const extra = JSON.parse(JSON.stringify((db.characters as Obj[])[0])) as Obj
        extra.chaId = 'added-during-module-yield'
        const one = await pass(db, first, new Set(), (count) => {
            if (count === 1) {
                ;(db.characters as Obj[]).push(extra)
            }
        })
        expect(chaIds(decode(first, one.tree).characters)).not.toContain('added-during-module-yield')
        // The next pass names the character the previous commit does not hold, as `scopeOf` does with `unheldChaIds`.
        const next = await pass(db, one.tree, new Set(['added-during-module-yield']), () => undefined, 3)
        expect(chaIds(decode(first, next.tree).characters)).toContain('added-during-module-yield')
    })

    for (const variant of ['edit-encoded', 'edit-unencoded', 'splice', 'reassign'] as const) {
        const label = variant === 'edit-unencoded' ? '' : ' (compatibility guard; passes before and after)'
        test(`R6 (${variant})${label}: a module edit at a yield is in this commit or the next, never torn`, async () => {
            const db = dbWith([
                mod('a', { assets: [['n', 'assets/a.png', 'png']] }),
                mod('b', { assets: [['n', 'assets/b.png', 'png']] }),
                mod('c', { assets: [['n', 'assets/c.png', 'png']] }),
            ])
            const first = firstTree(db)
            const before = (db.modules as Obj[]).map(module => String(module.id))
            const { tree } = await pass(db, first, new Set(), (count) => {
                if (count !== 1) {
                    return
                }
                const live = db.modules as Obj[]
                if (variant === 'edit-encoded') {
                    live[0].description = 'edited after its turn'
                } else if (variant === 'edit-unencoded') {
                    live[2].description = 'edited before its turn'
                } else if (variant === 'splice') {
                    live.splice(0, 1)
                } else {
                    db.modules = live.filter((_module, index) => index !== 0)
                }
            })
            const saved = decode(first, tree).modules
            expect(saved.map(module => String(module.id))).toEqual(before)
            if (variant === 'edit-encoded') {
                expect(saved[0].description).toBe('about a')
            }
            if (variant === 'edit-unencoded') {
                expect(saved[2].description).toBe('edited before its turn')
            }
            // Each module's lists agree with its own unit: the index entry's lists equal a fresh derivation of the saved module.
            const fresh = encodeWith({ ...(db as unknown as Obj), modules: saved } as unknown as Database, { lists: createListDerivation() })
            for (const module of saved) {
                const id = String(module.id)
                const identityAl = `al:module:${id}#0`
                const a = tree.units.find(unit => unit.identity === identityAl) ?? first.units.find(unit => unit.identity === identityAl)
                const b = fresh.units.find(unit => unit.identity === identityAl)
                expect(a).toBeDefined()
                expect(Buffer.from(a!.bytes).equals(Buffer.from(b!.bytes))).toBe(true)
            }
            // The next pass over the same db commits the remainder: afterwards the saved modules are the live ones.
            const next = await pass(db, tree, new Set(), () => undefined, 3)
            expect(decode(first, next.tree).modules).toEqual((db.modules as Obj[]))
        })
    }
})

describe('the synchronous encodeDatabase is the same module step without yields (compatibility guard; passes before and after)', () => {
    test('encodeDatabase writes the same module unit identities as the first encoding, and a yielding scoped pass decodes to the same modules', async () => {
        const db = dbWith([mod('a', { assets: [['n', 'assets/a.png', 'png']] }), mod('dup'), mod('dup', { name: 'second' })])
        const sync = encodeDatabase(db as unknown as Database, { env: seededEnv(5), lists: createListDerivation(), seq: 1, createdAt: NOW })
        const first = firstTree(db)
        const { tree } = await pass(db, first, new Set(), () => undefined)
        const moduleIdentities = (t: EncodedTree) => t.units.map(unit => unit.identity).filter(identity => identity.includes('module'))
        expect(moduleIdentities(sync).sort()).toEqual(moduleIdentities(first).sort())
        expect(decode(first, tree).modules).toEqual(db.modules)
    })
})

describe('R5 on the whole path', () => {
    test('a whole pass (characters all, modules flagged) survives a character edit at a module yield', async () => {
        const db = dbWith([mod('a'), mod('b')])
        const first = firstTree(db)
        const before = chaIds(db.characters as unknown[])
        const extra = JSON.parse(JSON.stringify((db.characters as Obj[])[0])) as Obj
        extra.chaId = 'added-during-module-yield'
        const { tree, yields } = await pass(db, first, 'all', (count) => {
            if (count === 1) {
                ;(db.characters as Obj[]).unshift(extra)
            }
        })
        expect(yields).toBeGreaterThanOrEqual(2)
        const saved = chaIds(decode(first, tree).characters)
        expect(saved).toEqual(before)
    })
})
