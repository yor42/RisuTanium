/**
 * Unit tests of the pure Backyard planning module `src/ts/byafImport.ts`. The module is new, so these cannot fail on
 * the base commit for a behavioural reason (the import fails there); the integration tests in
 * `characterCards.byafImport.test.ts` carry the red-before-green evidence. No mocks.
 */
import { describe, expect, test } from 'vitest'
import { buildByafCard, convertByafPlaceholders, isByafJsonEntry, planByaf, type ByafPlan } from './byafImport'

const enc = new TextEncoder()
const CHAR = 'characters/c1/character.json'
const json = (v: unknown) => enc.encode(typeof v === 'string' ? v : JSON.stringify(v))

type Over = { manifest?: unknown, character?: unknown, scenarios?: Record<string, unknown> }
function texts(over: Over = {}): { [name: string]: Uint8Array } {
    const out: { [name: string]: Uint8Array } = {}
    // An explicit undefined omits the file.
    const manifest = 'manifest' in over ? over.manifest : { schemaVersion: 1, characters: [CHAR], scenarios: ['scenarios/s1.json'] }
    const character = 'character' in over ? over.character : { schemaVersion: 1, name: 'Ann' }
    const scenarios = over.scenarios ?? { 'scenarios/s1.json': { schemaVersion: 1, narrative: 'n' } }
    if (manifest !== undefined) out['manifest.json'] = json(manifest)
    if (character !== undefined) out[CHAR] = json(character)
    for (const [path, doc] of Object.entries(scenarios)) out[path] = json(doc)
    return out
}
const plan = (over: Over = {}): ByafPlan => {
    const r = planByaf(texts(over))
    if ('refusal' in r) throw new Error('refused: ' + r.refusal)
    return r.plan
}
const refusal = (t: { [name: string]: Uint8Array }) => {
    const r = planByaf(t)
    return 'refusal' in r ? r.refusal : 'ok'
}

describe('convertByafPlaceholders', () => {
    test.each([
        ['{user} hi', '{{user}} hi'],
        ['#{User}: x', '{{user}}: x'],
        ['#{character}: y', '{{char}}: y'],
        ['{{user}} z', '{{user}} z'],
        ['{{{user}}}', '{{{user}}}'],
        ['#{user} q', '#{{user}} q'],
        ['{character}s', '{{char}}s'],
        ['{{user}', '{{user}'],
        ['{user}}', '{user}}'],
        ['{USER}:', '{{user}}:'],
        ['{userx}', '{userx}'],
        ['{user}{character}', '{{user}}{{char}}'],
        ['a\n#{user}: b\n#{character}: c', 'a\n{{user}}: b\n{{char}}: c'],
        ['nothing here', 'nothing here'],
    ])('%j -> %j', (input, expected) => {
        expect(convertByafPlaceholders(input)).toBe(expected)
    })
})

describe('isByafJsonEntry', () => {
    test.each([
        ['manifest.json', true],
        ['characters/c1/character.json', true],
        ['scenarios/s1.json', true],
        ['Manifest.json', false],
        ['sub/manifest.json', false],
        ['characters/character.json', false],
        ['characters/a/b/character.json', false],
        ['characters\\c1\\character.json', false],
        ['scenarios/a/b.json', false],
        ['scenarios/s1.JSON', false],
        ['scenarios/.json', false],
        ['characters/c1/images/a.png', false],
    ])('%s -> %s', (name, expected) => {
        expect(isByafJsonEntry(name)).toBe(expected)
    })
})

describe('planByaf refusals and order', () => {
    test.each([
        ['no manifest', texts({ manifest: undefined }), 'invalid'],
        ['manifest not JSON', texts({ manifest: 'x{' }), 'invalid'],
        ['manifest array', texts({ manifest: [] }), 'invalid'],
        ['manifest version "1"', texts({ manifest: { schemaVersion: '1', characters: [CHAR], scenarios: ['scenarios/s1.json'] } }), 'version'],
        ['manifest version absent', texts({ manifest: { characters: [CHAR], scenarios: ['scenarios/s1.json'] } }), 'version'],
        ['no characters', texts({ manifest: { schemaVersion: 1, characters: [], scenarios: ['scenarios/s1.json'] } }), 'invalid'],
        ['first character not a string', texts({ manifest: { schemaVersion: 1, characters: [5], scenarios: ['scenarios/s1.json'] } }), 'invalid'],
        ['character file missing', texts({ character: undefined }), 'invalid'],
        ['character version 2', texts({ character: { schemaVersion: 2, name: 'Ann' } }), 'version'],
        ['no scenarios', texts({ manifest: { schemaVersion: 1, characters: [CHAR], scenarios: [] } }), 'invalid'],
        ['first scenario missing', texts({ scenarios: {} }), 'invalid'],
        ['first scenario version 2', texts({ scenarios: { 'scenarios/s1.json': { schemaVersion: 2 } } }), 'version'],
        ['both names blank', texts({ character: { schemaVersion: 1, name: ' ', displayName: '' } }), 'invalid'],
        ['two characters', texts({ manifest: { schemaVersion: 1, characters: [CHAR, 'characters/c2/character.json'], scenarios: ['scenarios/s1.json'] } }), 'severalCharacters'],
        // Multi-defect archives: every version check precedes the count and the names.
        ['blank names + wrong-version scenario', texts({ character: { schemaVersion: 1 }, scenarios: { 'scenarios/s1.json': { schemaVersion: 2 } } }), 'version'],
        ['two characters + wrong-version first character', texts({ manifest: { schemaVersion: 1, characters: [CHAR, 'x'], scenarios: ['scenarios/s1.json'] }, character: { schemaVersion: 2, name: 'A' } }), 'version'],
        ['two characters + wrong-version second character is not read', texts({ manifest: { schemaVersion: 1, characters: [CHAR, 'characters/c2/character.json'], scenarios: ['scenarios/s1.json'] }, scenarios: { 'scenarios/s1.json': { schemaVersion: 1 }, 'characters/c2/character.json': { schemaVersion: 2 } } }), 'severalCharacters'],
        ['two characters + first character file absent', texts({ manifest: { schemaVersion: 1, characters: [CHAR, 'x'], scenarios: ['scenarios/s1.json'] }, character: undefined }), 'invalid'],
        // A listed path of another shape is missing at that path, even when the archive holds a JSON object there.
        ['character path is the manifest', texts({ manifest: { schemaVersion: 1, name: 'M', characters: ['manifest.json'], scenarios: ['scenarios/s1.json'] } }), 'invalid'],
        ['character path is a scenario file', texts({ manifest: { schemaVersion: 1, characters: ['scenarios/s1.json'], scenarios: ['scenarios/s1.json'] }, scenarios: { 'scenarios/s1.json': { schemaVersion: 1, name: 'S' } } }), 'invalid'],
        ['first scenario path is the manifest', texts({ manifest: { schemaVersion: 1, characters: [CHAR], scenarios: ['manifest.json'] } }), 'invalid'],
        ['first scenario path is the character file', texts({ manifest: { schemaVersion: 1, characters: [CHAR], scenarios: [CHAR] } }), 'invalid'],
        ['first scenario path is nested', texts({ manifest: { schemaVersion: 1, characters: [CHAR], scenarios: ['scenarios/a/b.json'] }, scenarios: { 'scenarios/a/b.json': { schemaVersion: 1 } } }), 'invalid'],
        ['first scenario absent + wrong-version later scenario',texts({ manifest: { schemaVersion: 1, characters: [CHAR], scenarios: ['scenarios/s1.json', 'scenarios/s2.json'] }, scenarios: { 'scenarios/s2.json': { schemaVersion: 2 } } }), 'version'],
    ] as Array<[string, { [name: string]: Uint8Array }, string]>)('%s', (_label, t, expected) => {
        expect(refusal(t)).toBe(expected)
    })

    test('a later scenario that is missing or garbled is skipped; a parsed wrong-version one refuses', () => {
        const manifest = { schemaVersion: 1, characters: [CHAR], scenarios: ['scenarios/s1.json', 'scenarios/gone.json', 'scenarios/s3.json', 'scenarios/s4.json'] }
        const base = { 'scenarios/s1.json': { schemaVersion: 1 }, 'scenarios/s3.json': 'garbled {' }
        expect(refusal(texts({ manifest, scenarios: base }))).toBe('ok')
        expect(refusal(texts({ manifest, scenarios: { ...base, 'scenarios/s4.json': { schemaVersion: 2 } } }))).toBe('version')
    })

    test('a BOM before the JSON is accepted', () => {
        const t = texts()
        t['manifest.json'] = new Uint8Array([0xef, 0xbb, 0xbf, ...t['manifest.json']])
        expect(refusal(t)).toBe('ok')
    })
})

describe('planByaf fields', () => {
    test.each([
        [{ displayName: 'Ann', name: 'Annie' }, 'Ann', 'Annie'],
        [{ displayName: 'Ann', name: 'Ann' }, 'Ann', ''],
        [{ displayName: '  ', name: 'Annie' }, 'Annie', ''],
        [{ displayName: 'Ann', name: ' ' }, 'Ann', ''],
        [{ displayName: ' Ann ', name: ' Annie ' }, ' Ann ', ' Annie '],
        [{ displayName: 5, name: 'Annie' }, 'Annie', ''],
    ])('names %j -> %j / %j', (names, name, nickname) => {
        const p = plan({ character: { schemaVersion: 1, ...names } })
        expect(p.card.name).toBe(name)
        expect(p.card.nickname).toBe(nickname)
    })

    test('dates, tags and creator', () => {
        const p = plan({
            manifest: { schemaVersion: 1, characters: [CHAR], scenarios: ['scenarios/s1.json'], author: { name: 'Au', backyardURL: 'u' } },
            character: { schemaVersion: 1, name: 'A', isNSFW: true, createdAt: '2025-06-12T19:03:56.873Z', updatedAt: 'junk' },
        })
        expect(p.card).toMatchObject({ creationDate: 1749755036, modificationDate: 0, tags: ['nsfw'], creator: 'Au', creatorNotes: 'u' })
        const q = plan({ character: { schemaVersion: 1, name: 'A', isNSFW: 'true', createdAt: 5, updatedAt: '' } })
        expect(q.card).toMatchObject({ creationDate: 0, modificationDate: 0, tags: [], creator: '', creatorNotes: '' })
    })

    test('first messages: the first scenario with one wins, the rest are alternates without duplicates', () => {
        const manifest = { schemaVersion: 1, characters: [CHAR], scenarios: ['scenarios/a.json', 'scenarios/b.json', 'scenarios/c.json', 'scenarios/d.json'] }
        const p = plan({
            manifest,
            scenarios: {
                'scenarios/a.json': { schemaVersion: 1, firstMessages: [{ text: '  ' }] },
                'scenarios/b.json': { schemaVersion: 1, firstMessages: [{ text: 'One {user}' }] },
                'scenarios/c.json': { schemaVersion: 1, firstMessages: [{ text: 'One {user}' }, { text: 'ignored' }] },
                'scenarios/d.json': { schemaVersion: 1, firstMessages: [{ text: 'Two' }] },
            },
        })
        // The first scenario is the source of every other field; only first messages come from later ones.
        expect(p.card.firstMessage).toBe('One {{user}}')
        expect(p.card.alternateGreetings).toEqual(['Two'])
    })

    test('examples are joined with <START> lines, blank ones dropped, unprefixed text kept as given', () => {
        const p = plan({ scenarios: { 'scenarios/s1.json': { schemaVersion: 1, exampleMessages: [{ text: '#{user}: a' }, { text: ' ' }, { text: 'Hello, I am a test bot!' }, 5] } } })
        expect(p.card.exampleMessage).toBe('<START>\n{{user}}: a\n<START>\nHello, I am a test bot!')
    })

    test('lore keeps the array index, splits and trims keys, and keeps the raw key', () => {
        const p = plan({ character: { schemaVersion: 1, name: 'A', loreItems: [{ key: ' a , {user},, ', value: '{character}' }, 'x', { key: 7 }] } })
        expect(p.card.lore).toEqual([
            { order: 0, rawKey: ' a , {user},, ', keys: ['a', '{{user}}'], content: '{{char}}' },
            { order: 2, rawKey: '', keys: [], content: '' },
        ])
        const card = buildByafCard(p, {})
        expect(card.data.character_book?.entries.map((e) => e.insertion_order)).toEqual([0, 2])
        expect(card.data.character_book?.entries[0].comment).toBe(' a , {user},, ')
    })

    test('image paths: safe ones resolve inside the character directory, unsafe and unsupported ones are skipped, duplicates keep the first label', () => {
        const paths = ['images/a.PNG', './images/b.jpg', 'images/../c.webp', '../x.png', '/x.png', 'a\\b.png', 'images/x.bmp', 'images/', '', 'images//d.png', 'noext', 'images/a.PNG', 'images/e.gif']
        const p = plan({ character: { schemaVersion: 1, name: 'A', images: [...paths.map((path, i) => ({ path, label: 'L' + i })), 'junk', { path: 5 }] } })
        expect(p.images).toEqual([
            { key: 'characters/c1/images/a.PNG', label: 'L0', ext: 'png' },
            { key: 'characters/c1/images/b.jpg', label: 'L1', ext: 'jpg' },
            { key: 'characters/c1/c.webp', label: 'L2', ext: 'webp' },
            { key: 'characters/c1/images/e.gif', label: 'L12', ext: 'gif' },
        ])
    })

    test('weird JSON values never throw', () => {
        const weird: unknown[] = [null, 0, 'x', [], {}, [null], { a: 1 }, true]
        for (const v of weird) {
            const r = planByaf(texts({
                manifest: { schemaVersion: 1, characters: [CHAR], scenarios: ['scenarios/s1.json'], author: v },
                character: { schemaVersion: 1, name: 'A', persona: v, images: v, loreItems: v, isNSFW: v, createdAt: v },
                scenarios: { 'scenarios/s1.json': { schemaVersion: 1, narrative: v, exampleMessages: v, firstMessages: v, formattingInstructions: v } },
            }))
            expect(r.ok).toBe(true)
        }
    })
})

describe('buildByafCard', () => {
    const images = [
        { key: 'characters/c1/images/a.png', label: 'A', ext: 'png' },
        { key: 'characters/c1/images/b.png', label: 'main', ext: 'png' },
        { key: 'characters/c1/images/c.png', label: 'C', ext: 'png' },
    ]
    const base = (): ByafPlan => ({ ...plan(), images })

    test('the card shape fills the fields a CharX card needs and references only saved images', () => {
        const card = buildByafCard(base(), { [images[1].key]: 'idB', [images[2].key]: 'idC' })
        expect(card.spec).toBe('chara_card_v3')
        expect(card.spec_version).toBe('3.0')
        expect(card.data).toMatchObject({ extensions: {}, character_version: '', personality: '', post_history_instructions: '', source: [], group_only_greetings: [] })
        expect(card.data.character_book).toBeUndefined()
        expect(card.data.assets).toEqual([
            { type: 'icon', uri: '__asset:' + images[1].key, name: 'main', ext: 'png' },
            { type: 'icon', uri: '__asset:' + images[2].key, name: 'C', ext: 'png' },
        ])
    })

    test('a label of main on a later image is stored empty so it cannot replace the avatar', () => {
        const card = buildByafCard(base(), { [images[0].key]: 'idA', [images[1].key]: 'idB' })
        expect(card.data.assets?.map((a) => a.name)).toEqual(['main', ''])
    })

    test('no saved image means no assets', () => {
        expect(buildByafCard(base(), {}).data.assets).toBeUndefined()
    })
})
