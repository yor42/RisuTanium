import fc from 'fast-check'
import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'
import { risuChatParser } from '../../parser.svelte'

//#region module mocks

const h = vi.hoisted(() => {
  const messages = Array.from({ length: 25 }, (_, i) => ({
    role: 'user',
    data: `m${i + 1}`,
    chatId: `id${i + 1}`,
  }))
  const db = {
    username: 'Alice',
    characters: [
      {
        name: 'Chara',
        chatPage: 0,
        chats: [{ message: messages, scriptstate: {} }],
        defaultVariables: '',
      },
    ],
    globalChatVariables: {},
    templateDefaultVariables: '',
  }
  return { db }
})

vi.mock(
  import('../../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => h.db.characters[0],
      getCurrentChat: () => h.db.characters[0].chats[0],
      getDatabase: () => h.db,
    }) as unknown as typeof import('../../../storage/database.svelte'),
)

vi.mock(import('../../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
  readImage: () => Promise.resolve(undefined),
}))

vi.mock(import('../../../stores.svelte'), () => {
  return {
    DBState: { db: h.db },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
  } as unknown as typeof import('../../../stores.svelte')
})

//#endregion

/**
 * `risuChatParser` leaves text without `{{`, `{#` or a `<user>`/`<char>`/`<bot>`
 * tag untouched, and counts the call depth on the options object either way.
 * Every expectation below pins the output of the full scan, so the early
 * return in the parser must give the same strings and the same depth count.
 */

const fresh = () => ({ chara: h.db.characters[0] as never, db: h.db as never })

const parse = (s: string): string => risuChatParser(s, fresh())

const CORPUS: [string, string][] = [
  ['', ''],
  ['plain text', 'plain text'],
  [' x ', ' x '],
  ['<user>', 'Alice'],
  ['<Char>', 'Chara'],
  ['<BOT>', 'Chara'],
  ['<USER> and <char>', 'Alice and Chara'],
  ['<user', '<user'],
  ['< user>', '< user>'],
  ['<uſer>', '<uſer>'],
  ['<Kser>', '<Kser>'],
  ['{#', '{{'],
  ['a{#b', 'a{{b'],
  ['{#if 1#}x{#/if#}', '{#if 1#}x{#/if#}'],
  ['}}', '}}'],
  ['a}}b', 'a}}b'],
  ['{{', '{{'],
  ['a{{b', 'a{{b'],
  ['{{user}}', 'Alice'],
  ['{{char}}', 'Chara'],
  ['{ {user} }', '{ {user} }'],
  ['{', '{'],
  ['a{b}c', 'a{b}c'],
  ['#}', '#}'],
  ['\\{\\{user\\}\\}', '\\{\\{user\\}\\}'],
  ['\\{{x', '\\{{x'],
  ['{\\{', '{\\{'],
  ['\u{1F600} 한국어 \uD83D', '\u{1F600} 한국어 \uD83D'],
  ['{😀{', '{😀{'],
  ['<Thoughts>x</Thoughts>', '<Thoughts>x</Thoughts>'],
  ['<bott>', '<bott>'],
  ['{{#if 1}}y{{/if}}', 'y'],
  ['{{unknownmacro}}', '{{unknownmacro}}'],
  ['{{{user}}}', '{{{user}}}'],
  ['{<user>}', '{{{user}}}'],
]

describe('risuChatParser early return', () => {
  test('T-A1: a fixed corpus parses to the pinned strings', () => {
    for (const [input, expected] of CORPUS) {
      expect(parse(input), JSON.stringify(input)).toBe(expected)
    }
  })

  test('T-A2: text parses the same with and without a forced full scan', () => {
    // `{{comment::}}` is neutral with `visualize` unset and its presence
    // forces the full scan, so the two sides take different paths.
    expect(parse('{{comment::}}')).toBe('')
    const alphabet = fc.constantFrom(
      '{', '}', '#', '<', '>', '\\', ':', '/', '{{', '}}', '{#', '#}', '<user>', '<char>', '<bot>',
      'user', 'char', 'bot', 'a', ' ', 'é', '\uD83D', '\uDE00', 'ſ', 'K',
    )
    fc.assert(
      fc.property(fc.array(alphabet, { maxLength: 24 }).map((a) => a.join('')), (s) => {
        expect(parse(s)).toBe(parse('{{comment::}}' + s))
      }),
      { seed: 714, numRuns: 5000 },
    )
  })

  test('T-A3: a reused options object keeps counting depth and refuses from the 21st call', () => {
    const arg = fresh() as { callStack?: number }
    const results: string[] = []
    for (let i = 0; i < 23; i++) {
      results.push(risuChatParser('plain', arg as never))
    }
    expect(results.slice(0, 20).every((r) => r === 'plain')).toBe(true)
    expect(results.slice(20)).toEqual(Array(3).fill('ERROR: Call stack limit reached'))
    expect(arg.callStack).toBe(23)

    const once = fresh() as { callStack?: number }
    risuChatParser('plain', once as never)
    expect(once.callStack).toBe(1)
  })

  test('T-A4: {{userhistory}} shares one options object across messages, so entries from the 20th on are refused', () => {
    // Pins existing behaviour (the history macros reuse one options object for
    // every message), not an intended limit.
    const entries = JSON.parse(parse('{{userhistory}}')) as string[]
    const out = entries.map((e) => JSON.parse(e) as { data: string })
    expect(out).toHaveLength(25)
    expect(out.slice(0, 19).map((m) => m.data)).toEqual(Array.from({ length: 19 }, (_, i) => `m${i + 1}`))
    expect(out.slice(19).map((m) => m.data)).toEqual(Array(6).fill('ERROR: Call stack limit reached'))
  })

  test('T-A5: repeated tag parses do not depend on earlier parses', () => {
    expect(parse('<user>')).toBe('Alice')
    expect(parse('<user>')).toBe('Alice')
    expect(parse('<user>')).toBe('Alice')
    expect(parse('x <user>')).toBe('x Alice')
    expect(parse('<user>')).toBe('Alice')
  })

  test('T-A6: a non-string input still throws', () => {
    expect(() => risuChatParser(['{{user}}'] as never)).toThrow(TypeError)
    expect(() => risuChatParser(undefined as never)).toThrow(TypeError)
  })
})
