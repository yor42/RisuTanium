/**
 * `readOldCard` in `src/ts/oldCardFormat.ts`: one reader for the card shapes that carry no spec (TavernAI v1,
 * Pygmalion, a v2 wrapper without a spec). Pure unit tests; the import routes are tested in
 * `characterCards.oldFormat.test.ts`.
 */

import { describe, expect, test } from 'vitest'
import { readOldCard } from 'src/ts/oldCardFormat'

const entry = { keys: ['k'], content: 'c', insertion_order: 1, enabled: true }

describe('readOldCard mappings', () => {
    test('a v1 card maps its six fields and leaves the Pygmalion-only fields empty', () => {
        expect(readOldCard({ name: 'N', description: 'd', personality: 'p', scenario: 's', first_mes: 'f', mes_example: 'e', creator: 'me', tags: ['t'] })).toEqual({
            name: 'N', desc: 'd', personality: 'p', scenario: 's', firstMessage: 'f', exampleMessage: 'e',
            creatorNotes: '', creator: '', tags: [],
            systemPrompt: '', postHistoryInstructions: '', characterBook: null,
        })
    })

    test('a Pygmalion card maps every field SillyTavern maps', () => {
        expect(readOldCard({ char_name: 'P', char_persona: 'pe', char_greeting: 'g', example_dialogue: 'ex', world_scenario: 'ws', creator_notes: 'cn', creator: 'me', tags: ['a', 1, null, 'b'] })).toEqual({
            name: 'P', desc: 'pe', personality: '', scenario: 'ws', firstMessage: 'g', exampleMessage: 'ex',
            creatorNotes: 'cn', creator: 'me', tags: ['a', 'b'],
            systemPrompt: '', postHistoryInstructions: '', characterBook: null,
        })
    })

    test('name takes the v1 mapping and ignores the char_ keys', () => {
        const card = readOldCard({ name: 'V1', char_name: 'P', description: 'd', char_persona: 'pe', first_mes: 'f', char_greeting: 'g' })
        expect(card).toMatchObject({ name: 'V1', desc: 'd', firstMessage: 'f' })
    })

    test('creator_notes wins over creatorcomment, which is used when creator_notes is missing or empty', () => {
        expect(readOldCard({ char_name: 'P', creator_notes: 'cn', creatorcomment: 'cc' })?.creatorNotes).toBe('cn')
        expect(readOldCard({ char_name: 'P', creatorcomment: 'cc' })?.creatorNotes).toBe('cc')
        expect(readOldCard({ char_name: 'P', creator_notes: '', creatorcomment: 'cc' })?.creatorNotes).toBe('cc')
    })

    test('tags that are not an array become an empty list', () => {
        expect(readOldCard({ char_name: 'P', tags: 'a,b' })?.tags).toEqual([])
    })

    test('a Pygmalion text field that is empty falls back to the filled v1 field', () => {
        const card = readOldCard({ char_name: 'P', char_persona: '', description: 'd', char_greeting: '', first_mes: 'hi', example_dialogue: '', mes_example: 'ex', world_scenario: '', scenario: 'sc', personality: 'pp' })
        expect(card).toMatchObject({ name: 'P', desc: 'd', firstMessage: 'hi', exampleMessage: 'ex', scenario: 'sc', personality: 'pp' })
    })

    test('a filled Pygmalion text field wins over the v1 field', () => {
        const card = readOldCard({ char_name: 'P', char_persona: 'pe', description: 'd' })
        expect(card?.desc).toBe('pe')
    })

    test('a field that is not a string imports empty, and a name that is not a string is no name', () => {
        expect(readOldCard({ name: 'N', description: 5, first_mes: { a: 1 }, mes_example: ['x'], scenario: null })).toMatchObject({ name: 'N', desc: '', firstMessage: '', exampleMessage: '', scenario: '' })
        expect(readOldCard({ name: 5, description: 'd' })).toBeNull()
    })

    test('the name is kept as given, not trimmed', () => {
        expect(readOldCard({ name: ' N ' })?.name).toBe(' N ')
    })
})

describe('readOldCard refusals', () => {
    test.each([
        ['null', null], ['undefined', undefined], ['a number', 42], ['a string', 's'], ['an array', [{ name: 'N' }]],
        ['an empty object', {}], ['no name', { description: 'd', first_mes: 'f' }],
        ['an empty name', { name: '' }], ['a blank name', { name: '  ' }], ['a blank char_name', { char_name: ' \t' }],
    ])('%s is no old card', (_, value) => {
        expect(readOldCard(value)).toBeNull()
    })

    test('a blank name does not hide a filled char_name', () => {
        expect(readOldCard({ name: '  ', char_name: 'P' })?.name).toBe('P')
    })
})

describe('readOldCard v2 wrapper', () => {
    test('the data is the body, with its system prompt, post-history instructions and character book', () => {
        const book = { entries: [entry] }
        const card = readOldCard({ spec_version: '2.0', data: { name: 'W', description: 'd', first_mes: 'f', system_prompt: 'sp', post_history_instructions: 'ph', character_book: book }, name: 'Ignored' })
        expect(card).toMatchObject({ name: 'W', desc: 'd', firstMessage: 'f', systemPrompt: 'sp', postHistoryInstructions: 'ph' })
        expect(card?.characterBook).toBe(book)
    })

    test('a wrapper book that is null or absent is no book', () => {
        expect(readOldCard({ spec_version: '2.0', data: { name: 'W', character_book: null } })?.characterBook).toBeNull()
        expect(readOldCard({ spec_version: '2.0', data: { name: 'W' } })?.characterBook).toBeNull()
    })

    test('a data that is not an object falls back to the top level, with no wrapper extras', () => {
        for (const data of ['s', 5, null, ['x']]) {
            const card = readOldCard({ spec_version: '2.0', data, name: 'Top', first_mes: 'hi', system_prompt: 'ignored' })
            expect(card).toMatchObject({ name: 'Top', firstMessage: 'hi', systemPrompt: '', postHistoryInstructions: '', characterBook: null })
        }
    })

    test('a data that carries no name takes the name from the top level and keeps its own extras', () => {
        const book = { entries: [entry] }
        const card = readOldCard({ spec_version: '2.0', data: { description: 'dd', system_prompt: 'sp', character_book: book }, name: 'Top', system_prompt: 'ignored' })
        expect(card).toMatchObject({ name: 'Top', desc: 'dd', systemPrompt: 'sp' })
        expect(card?.characterBook).toBe(book)
    })

    test('data wins where it has a non-empty value, and the top level fills the empty fields', () => {
        const card = readOldCard({ spec_version: '2.0', data: { description: 'dd', first_mes: 'f', scenario: '' }, name: 'Top', first_mes: 'hi', description: 'top', scenario: 'ts', mes_example: 'tx' })
        expect(card).toMatchObject({ name: 'Top', desc: 'dd', firstMessage: 'f', scenario: 'ts', exampleMessage: 'tx' })
    })

    test('a data with no name and a top level with no name is no old card', () => {
        expect(readOldCard({ spec_version: '2.0', data: { description: 'd' } })).toBeNull()
    })

    test('a spec_version other than 2.0 does not unwrap', () => {
        expect(readOldCard({ spec_version: '1.0', data: { name: 'W' } })).toBeNull()
    })
})

describe('readOldCard purity', () => {
    test('the input is not mutated', () => {
        const input = { spec_version: '2.0', data: { description: 'dd', tags: ['a'], character_book: { entries: [{ ...entry }] } }, char_name: 'P', tags: ['x', 2] }
        const before = JSON.stringify(input)
        readOldCard(input)
        expect(JSON.stringify(input)).toBe(before)
    })

    test('the tags list is a copy, not the input array', () => {
        const tags = ['a']
        const card = readOldCard({ char_name: 'P', tags })
        expect(card?.tags).not.toBe(tags)
    })
})
