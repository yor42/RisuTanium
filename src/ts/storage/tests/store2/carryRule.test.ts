// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    encodeDatabase, planScopedEncode, previousFrom, type EncodedTree, type PreviousEncoding,
} from '../../store2/codec'
import { createKeyMint } from '../../store2/commit'
import {
    encodeUnit, newUnitKey, readUnit, refOfFrame, refsOf, UNIT_TYPE, type ModuleEntry, type UnitType,
} from '../../store2/format'
import { createListDerivation } from '../../store2/lists'
import { moduleStubOf } from '../../store2/moduleStubMatch'
import { buildColdStub } from '../../../process/coldCharacter'
import type { character, Database } from '../../database.svelte'
import { asDatabase, buildSmall, bytesOf, seededEnv, type Obj } from './codecFixtures'

/**
 * The invariant behind the carry rule: every unit key a commit's new units name is a key that commit writes, a key the
 * new manifest tree itself holds (reused or carried from the acknowledged encoding), or the legacy keep's unit. A
 * reference that is in none of those is a carrier the unit count cannot see, so a Save mine over a base that dropped
 * the manifest could name a unit the collector has already deleted.
 */

const NOW = 1_700_000_000_000

/** The targets named by the new units of `tree` that no allowed key covers, as `owner -> store2/tail`. */
function strayRefs(tree: EncodedTree, allowedExtra: ReadonlySet<string> = new Set()): string[] {
    const allowed = new Set<string>(allowedExtra)
    for (const unit of tree.index.units.values()) {
        allowed.add(unit.key)
    }
    const written = tree.units.filter(unit => unit.reused !== true)
    for (const unit of written) {
        allowed.add(unit.key)
    }
    const keep = tree.manifest.fixed.legacyKeep
    if (keep !== null) {
        allowed.add(`store2/${keep.unit[0]}`)
    }
    const stray: string[] = []
    for (const unit of written) {
        const parsed = readUnit(bytesOf(unit), unit.type as UnitType)
        if (parsed.status !== 'ok' && parsed.status !== 'stale') {
            stray.push(`${unit.key} does not parse`)
            continue
        }
        for (const target of refsOf(unit.type as UnitType, parsed.value.body)) {
            const key = `store2/${target.tail}`
            if (!allowed.has(key)) {
                stray.push(`${unit.key} -> ${key} (${target.path})`)
            }
        }
    }
    return stray
}

function modulesOf(): Obj[] {
    return [
        { id: 'm0', name: 'Zero', description: 'first', assets: [] },
        { id: 'm1', name: 'One', description: 'plain', assets: [] },
        { id: 'm2', name: 'Two', description: 'third' },
    ]
}

interface Fixture {
    db: Database
    previous: PreviousEncoding
    lists: ReturnType<typeof createListDerivation>
    entityOf(index: number): string
}

function fixtureOf(): Fixture {
    const lists = createListDerivation()
    const seed = asDatabase({
        ...(JSON.parse(JSON.stringify(buildSmall(4))) as Obj),
        modules: modulesOf(),
        pluginCustomStorage: { 'plugin-0': { counter: 1, items: ['a', 'b'] } },
    })
    const first = encodeDatabase(seed, { env: seededEnv(1), lists, seq: 1, createdAt: NOW })
    const previous = previousFrom(first)
    const manifest = structuredClone(first.manifest)
    const keepKey = newUnitKey(seededEnv(31))
    const keepBytes = encodeUnit(UNIT_TYPE.legacyList, { v: 1, iv: 1, files: [], h: '', l: [], i: { v: 1, u: [], h: '', o: [] } })
    manifest.fixed.legacyKeep = { unit: refOfFrame(keepKey, keepBytes), v: 1, files: [] }
    previous.objects = { ...previous.objects, manifest }
    const db = JSON.parse(JSON.stringify(seed)) as Database
    return {
        db, previous, lists,
        entityOf: index => first.index.entities.get(`${(db.characters[index] as unknown as { chaId: string }).chaId}#0`) as string,
    }
}

async function finalized(fixture: Fixture, scope: Parameters<typeof planScopedEncode>[2]): Promise<EncodedTree> {
    const plan = await planScopedEncode(fixture.db, { env: seededEnv(2), lists: fixture.lists, seq: 2, createdAt: NOW, previous: fixture.previous }, scope)
    const { mint } = createKeyMint(seededEnv(70), null)
    return plan.finalize({ mint, seq: 2, now: NOW })
}

describe('the references a pass writes stay inside the units it writes and the tree it names', () => {
    test('G15 self-check: a tree whose new units name a key outside the allowed set is reported', async () => {
        const fixture = fixtureOf()
        const tree = await finalized(fixture, { modules: true, characters: 'all' })
        expect(strayRefs(tree)).toEqual([])
        // Only the manifest is written and the tree holds no other unit: every reference it makes is outside the allowed set.
        const foreign = strayRefs({ ...tree, units: tree.units.filter(unit => unit.type === UNIT_TYPE.manifest), index: { ...tree.index, units: new Map() } })
        expect(foreign.length).toBeGreaterThan(0)
    })

    test('G15: a pass that edits one character and reuses the rest names no unit outside its own tree', async () => {
        const fixture = fixtureOf()
        ;(fixture.db.characters[0] as unknown as Obj).personality = 'edited'
        const tree = await finalized(fixture, { modules: false, characters: new Set([(fixture.db.characters[0] as unknown as { chaId: string }).chaId]) })
        expect(strayRefs(tree)).toEqual([])
    })

    test('G15: a full pass that carries a cold stub, a module stub and a legacy keep names no unit outside its own tree', async () => {
        const fixture = fixtureOf()
        const characters = fixture.db.characters as unknown as Obj[]
        characters[1] = buildColdStub(JSON.parse(JSON.stringify(characters[1])) as character, fixture.entityOf(1), ['chat-a']) as unknown as Obj
        const entry = fixture.previous.objects?.moduleIndex?.entries[1] as ModuleEntry
        ;(fixture.db.modules as unknown as Obj[])[1] = moduleStubOf(entry) as Obj
        const tree = await finalized(fixture, { modules: true, characters: 'all' })
        expect(tree.manifest.fixed.legacyKeep).not.toBeNull()
        expect(strayRefs(tree)).toEqual([])
    })
})
