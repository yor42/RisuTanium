// @vitest-environment jsdom
// T1-RD (diagnostic): the character reader, the edit builder and the character writer over the nested set paths
// (`depth_prompt.prompt`, `additionalData.creator`, `additionalData.character_version`) and the flat Advanced texts. An
// absent or null container reads as its seed, a `had: true` write creates it from a fresh copy of the seed, an existing
// container keeps every other key, a container is never deleted, and no flat dotted key is ever assigned.
import { describe, expect, test, vi } from 'vitest'
import type { character } from 'src/ts/storage/database.svelte'
import { applyCharacterDefaults } from 'src/ts/storage/characterDefaults'
import { CONTAINER_SEEDS } from '../history/fieldRegistry'
import { planRestorePoint, type FieldValue, type SetPath, type WriteOp } from '../history/historyModel'
import { applyCharacterWrites, buildFieldEdit, createLiveReader } from './studioSetters'

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: { characters: [], modules: [] } },
    selIdState: { selId: 0 },
    clearCharEmotionCache: () => {},
}))

type Bag = Record<string, unknown>

function makeCharacter(over: Bag = {}): character {
    return applyCharacterDefaults({ chaId: 'c1', desc: 'd0', firstMessage: 'f0', exampleMessage: 'e0', ...over } as unknown as character) as character
}

const bag = (live: character): Bag => live as unknown as Bag
const readerOf = (live: character) => createLiveReader({ character: live, chat: null })
const had = (value: string): FieldValue => ({ had: true, value })
const ABSENT: FieldValue = { had: false }
const setOp = (path: SetPath, value: FieldValue): WriteOp => ({ op: 'set', path, value })

// Builds the edit through the real builder and lands its writes through the real character writer.
function typeInto(live: character, path: SetPath, value: string): ReturnType<typeof buildFieldEdit> {
    const built = buildFieldEdit(path, value, readerOf(live))
    if (built.ok) {
        applyCharacterWrites(live, built.writes, null)
    }
    return built
}

const NESTED: readonly SetPath[] = ['depth_prompt.prompt', 'additionalData.creator', 'additionalData.character_version']
const REQUIRED_FLAT: readonly SetPath[] = ['systemPrompt', 'replaceGlobalNote', 'additionalText', 'personality', 'scenario']
const OPTIONAL_FLAT: readonly SetPath[] = ['nickname', 'defaultVariables', 'translatorNote']

describe('T1-RD (a): an absent depth_prompt container reads as its seed', () => {
    test('the reader gives an empty prompt, the edit creates the seeded container and no flat dotted key', () => {
        const live = makeCharacter()
        expect(readerOf(live).field('depth_prompt.prompt')).toEqual(had(''))
        expect(typeInto(live, 'depth_prompt.prompt', 'x').ok).toBe(true)
        expect(bag(live).depth_prompt).toStrictEqual({ depth: 0, prompt: 'x' })
        expect('depth_prompt.prompt' in live).toBe(false)
    })

    test('an undo write of the seed reading keeps the container, and a had:false write changes nothing', () => {
        const live = makeCharacter()
        typeInto(live, 'depth_prompt.prompt', 'x')
        applyCharacterWrites(live, [setOp('depth_prompt.prompt', had(''))], null)
        expect(bag(live).depth_prompt).toStrictEqual({ depth: 0, prompt: '' })
        applyCharacterWrites(live, [setOp('depth_prompt.prompt', ABSENT)], null)
        expect(bag(live).depth_prompt).toStrictEqual({ depth: 0, prompt: '' })
        const fresh = makeCharacter()
        applyCharacterWrites(fresh, [setOp('depth_prompt.prompt', ABSENT)], null)
        expect('depth_prompt' in fresh).toBe(false)
    })
})

describe('T1-RD (b)(c)(d)(e): the container states of depth_prompt', () => {
    test('(b) an existing container keeps its depth and its identity', () => {
        const box = { depth: 3, prompt: 'p' }
        const live = makeCharacter({ depth_prompt: box })
        expect(typeInto(live, 'depth_prompt.prompt', 'q').ok).toBe(true)
        expect(bag(live).depth_prompt).toBe(box)
        expect(box).toStrictEqual({ depth: 3, prompt: 'q' })
    })

    test('(c) a container without a prompt reads absent and the edit is refused as a precondition', () => {
        const live = makeCharacter({ depth_prompt: { depth: 3 } })
        expect(readerOf(live).field('depth_prompt.prompt')).toEqual(ABSENT)
        expect(typeInto(live, 'depth_prompt.prompt', 'x')).toEqual({ ok: false, reason: 'precondition' })
        expect(bag(live).depth_prompt).toStrictEqual({ depth: 3 })
    })

    test('(d) a null container reads as the seed', () => {
        const live = makeCharacter({ depth_prompt: null })
        expect(readerOf(live).field('depth_prompt.prompt')).toEqual(had(''))
        typeInto(live, 'depth_prompt.prompt', 'x')
        expect(bag(live).depth_prompt).toStrictEqual({ depth: 0, prompt: 'x' })
    })

    test('(e) a string or array depth_prompt reads absent and the edit is refused; a creator edit replaces a wrong-typed additionalData', () => {
        for (const wrong of ['str', []]) {
            const live = makeCharacter({ depth_prompt: wrong })
            expect(readerOf(live).field('depth_prompt.prompt'), JSON.stringify(wrong)).toEqual(ABSENT)
            expect(typeInto(live, 'depth_prompt.prompt', 'x'), JSON.stringify(wrong)).toEqual({ ok: false, reason: 'precondition' })
            expect(bag(live).depth_prompt).toStrictEqual(wrong)
        }
        for (const wrong of ['str', []]) {
            const live = makeCharacter({ additionalData: wrong })
            expect(readerOf(live).field('additionalData.creator'), JSON.stringify(wrong)).toEqual(ABSENT)
            expect(typeInto(live, 'additionalData.creator', 'x').ok).toBe(true)
            expect(bag(live).additionalData).toStrictEqual({ tag: [], creator: 'x', character_version: '' })
        }
    })
})

describe('T1-RD (f): containers are never shared', () => {
    test('two characters each get their own additionalData, and their tag arrays and the seed stay separate', () => {
        const first = makeCharacter({ chaId: 'a' })
        const second = makeCharacter({ chaId: 'b' })
        typeInto(first, 'additionalData.creator', 'x')
        typeInto(second, 'additionalData.creator', 'y')
        const boxA = bag(first).additionalData as { tag: string[] }
        const boxB = bag(second).additionalData as { tag: string[] }
        expect(boxA).not.toBe(boxB)
        boxA.tag.push('t')
        expect(boxB.tag).toEqual([])
        expect(CONTAINER_SEEDS.additionalData.tag).toEqual([])
        expect(CONTAINER_SEEDS.additionalData).toStrictEqual({ tag: [], creator: '', character_version: '' })
    })
})

describe('T1-RD (g): the two readings of additionalData.creator', () => {
    test('an absent container reads an empty string and its undo writes the empty string into the kept container', () => {
        const live = makeCharacter()
        expect(readerOf(live).field('additionalData.creator')).toEqual(had(''))
        typeInto(live, 'additionalData.creator', 'x')
        applyCharacterWrites(live, [setOp('additionalData.creator', had(''))], null)
        expect(bag(live).additionalData).toStrictEqual({ tag: [], creator: '', character_version: '' })
    })

    test('a container missing the key reads absent, the edit adds the key and its undo deletes only that key', () => {
        const live = makeCharacter({ additionalData: { tag: ['t'], character_version: 'v' } })
        expect(readerOf(live).field('additionalData.creator')).toEqual(ABSENT)
        const built = typeInto(live, 'additionalData.creator', 'x')
        expect(built.ok).toBe(true)
        expect(bag(live).additionalData).toStrictEqual({ tag: ['t'], character_version: 'v', creator: 'x' })
        applyCharacterWrites(live, [setOp('additionalData.creator', ABSENT)], null)
        expect(bag(live).additionalData).toStrictEqual({ tag: ['t'], character_version: 'v' })
    })
})

describe('T1-RD (h): a wrong-typed write assigns nothing', () => {
    test.each([...NESTED, ...REQUIRED_FLAT, ...OPTIONAL_FLAT])('%s', (path) => {
        const live = makeCharacter({ depth_prompt: { depth: 1, prompt: 'p' }, additionalData: { tag: [], creator: 'c', character_version: 'v' } })
        const before = structuredClone(live)
        const write: WriteOp = { op: 'set', path, value: { had: true, value: true } }
        applyCharacterWrites(live, [write], null)
        expect(live).toStrictEqual(before)
    })
})

describe('T1-RD (i): the flat Advanced texts', () => {
    test.each(REQUIRED_FLAT)('%s keeps its key on had:false and refuses an edit while the key is missing', (path) => {
        const live = makeCharacter({ [path]: 'v' })
        applyCharacterWrites(live, [setOp(path, ABSENT)], null)
        expect(bag(live)[path]).toBe('v')
        delete bag(live)[path]
        expect(buildFieldEdit(path, 'x', readerOf(live))).toEqual({ ok: false, reason: 'precondition' })
    })

    test.each(OPTIONAL_FLAT)('%s deletes its key on had:false and accepts an edit while the key is missing', (path) => {
        const live = makeCharacter({ [path]: 'v' })
        applyCharacterWrites(live, [setOp(path, ABSENT)], null)
        expect(path in live).toBe(false)
        expect(buildFieldEdit(path, 'x', readerOf(live))).toMatchObject({ ok: true })
    })

    test('additionalData.character_version deletes only its own key', () => {
        const live = makeCharacter({ additionalData: { tag: [], creator: 'c', character_version: 'v' } })
        applyCharacterWrites(live, [setOp('additionalData.character_version', ABSENT)], null)
        expect(bag(live).additionalData).toStrictEqual({ tag: [], creator: 'c' })
    })
})

describe('T1-RD (j): a restore over a wrong-typed container', () => {
    test('writes the restored text into a seeded container, which replaces the wrong-typed value', () => {
        const live = makeCharacter({ depth_prompt: 'str' })
        const restore = { visitId: 'v1', at: 1, fields: { 'depth_prompt.prompt': { before: had('a'), last: had('b') } } }
        const plan = planRestorePoint(restore, readerOf(live), new Set())
        expect(plan.ok).toBe(true)
        if (plan.ok) {
            applyCharacterWrites(live, plan.writes, null)
        }
        expect(bag(live).depth_prompt).toStrictEqual({ depth: 0, prompt: 'a' })
    })
})
