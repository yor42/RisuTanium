/**
 * The `<Thoughts>` scan shared by the chat screen and the plain-copy path.
 *
 * `replaceThoughtsBlocks` hands each closed, exact-case, nesting-aware
 * `<Thoughts>...</Thoughts>` block to a replacer. An unclosed block stays as text
 * and a closed block nested inside an unclosed outer one is still replaced.
 *
 * Test purposes:
 *  - the `replaceThoughtsBlocks` tests are feature tests of the extracted helper;
 *  - the `parseThoughtsAndTools guard` tests are compatibility guards: the
 *    expected literals are golden outputs of the pre-extraction scan loop, so
 *    they pin the real parser wiring (the `<details>` replacer and the
 *    tool_call rewrite) to that output. They are compatibility guards, not
 *    proof of a fix.
 *
 * The parser's module dependencies are stood in for the way the other parser
 * tests do; no live database, file system or network is involved.
 */
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { parseThoughtsAndTools } from '../parser.svelte'
import { replaceThoughtsBlocks } from '../thoughts'

//#region module mocks

vi.mock(
  import('../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => ({}),
      getDatabase: () => ({}),
    } as typeof import('../../storage/database.svelte'))
)

vi.mock(import('../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
  isPlainHttpFileSrc: () => false,
  readImage: () => Promise.resolve(undefined),
}))

vi.mock(import('../../stores.svelte'), () => {
  return {
    DBState: {
      db: {
        characters: [{ chatPage: 0, chats: [{}], defaultVariables: '' }],
        globalChatVariables: {},
        templateDefaultVariables: '',
      },
    },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
  } as typeof import('../../stores.svelte')
})

//#endregion

const DETAILS_OPEN = '<details><summary>Chain of Thoughts</summary>'
const TOOL_CALL = ''

describe('replaceThoughtsBlocks', () => {
  const bracket = (inner: string) => `[${inner}]`
  const drop = () => ''

  const table: { name: string; input: string; bracketed: string; dropped: string }[] = [
    { name: 'plain text', input: 'Hello world', bracketed: 'Hello world', dropped: 'Hello world' },
    {
      name: 'a nested block is replaced whole, by its outermost match',
      input: 'a<Thoughts>outer<Thoughts>inner</Thoughts>tail</Thoughts>b',
      bracketed: 'a[outer<Thoughts>inner</Thoughts>tail]b',
      dropped: 'ab',
    },
    {
      name: 'two blocks',
      input: '<Thoughts>one</Thoughts>mid<Thoughts>two</Thoughts>end',
      bracketed: '[one]mid[two]end',
      dropped: 'midend',
    },
    {
      name: 'an unclosed block stays as text',
      input: 'a<Thoughts>never closed',
      bracketed: 'a<Thoughts>never closed',
      dropped: 'a<Thoughts>never closed',
    },
    {
      name: 'a closed block inside an unclosed outer block is still replaced',
      input: '<Thoughts>outer<Thoughts>inner</Thoughts> tail',
      bracketed: '<Thoughts>outer[inner] tail',
      dropped: '<Thoughts>outer tail',
    },
    {
      name: 'the wrong case is not a block',
      input: 'a<thoughts>x</thoughts>b',
      bracketed: 'a<thoughts>x</thoughts>b',
      dropped: 'a<thoughts>x</thoughts>b',
    },
    {
      name: 'a stray close tag before a block stays as text',
      input: 'a</Thoughts>b<Thoughts>c</Thoughts>d',
      bracketed: 'a</Thoughts>b[c]d',
      dropped: 'a</Thoughts>bd',
    },
    { name: 'an empty block', input: 'a<Thoughts></Thoughts>b', bracketed: 'a[]b', dropped: 'ab' },
  ]

  for (const row of table) {
    test(`${row.name}: the replacer's return value substitutes the block`, () => {
      expect(replaceThoughtsBlocks(row.input, bracket)).toBe(row.bracketed)
    })

    test(`${row.name}: an empty replacer removes the block`, () => {
      expect(replaceThoughtsBlocks(row.input, drop)).toBe(row.dropped)
    })
  }

  test('the replacer receives the inner text of each outermost block, in document order', () => {
    const seen: string[] = []
    replaceThoughtsBlocks('<Thoughts>one<Thoughts>x</Thoughts></Thoughts>-<Thoughts>two</Thoughts>', (inner) => {
      seen.push(inner)
      return ''
    })
    expect(seen).toEqual(['one<Thoughts>x</Thoughts>', 'two'])
  })

  test('the replacer is not called when there is no closed block', () => {
    const replace = vi.fn(() => '')
    replaceThoughtsBlocks('a<Thoughts>open <thoughts>x</thoughts>', replace)
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('parseThoughtsAndTools guard', () => {
  const rows: { name: string; input: string; expected: string }[] = [
    { name: 'plain text is unchanged', input: 'Hello world', expected: 'Hello world' },
    {
      name: 'a nested block becomes one details element holding the inner block as text',
      input: 'a<Thoughts>outer<Thoughts>inner</Thoughts>tail</Thoughts>b',
      expected: `a${DETAILS_OPEN}outer<Thoughts>inner</Thoughts>tail</details>b`,
    },
    {
      name: 'two blocks become two details elements',
      input: '<Thoughts>one</Thoughts>mid<Thoughts>two</Thoughts>end',
      expected: `${DETAILS_OPEN}one</details>mid${DETAILS_OPEN}two</details>end`,
    },
    {
      name: 'an unclosed block stays as text',
      input: 'a<Thoughts>never closed',
      expected: 'a<Thoughts>never closed',
    },
    {
      name: 'a closed block inside an unclosed outer block still becomes a details element',
      input: '<Thoughts>outer<Thoughts>inner</Thoughts> tail',
      expected: `<Thoughts>outer${DETAILS_OPEN}inner</details> tail`,
    },
    {
      name: 'the wrong case stays as text',
      input: 'a<thoughts>x</thoughts>b',
      expected: 'a<thoughts>x</thoughts>b',
    },
    {
      name: 'a tool_call becomes the tool-call div followed by a blank line',
      input: `before<tool_call>id${TOOL_CALL}lookup</tool_call>after`,
      expected: 'before<div class="x-risu-tool-call">🛠️ Tool \'lookup\' Called</div>\n\nafter',
    },
    {
      name: 'a tool_call without a name part reads unknown',
      input: 'x<tool_call>bare</tool_call>y',
      expected: 'x<div class="x-risu-tool-call">🛠️ Tool \'unknown\' Called</div>\n\ny',
    },
    {
      name: 'a stray close tag stays as text and a later block still converts',
      input: 'a</Thoughts>b<Thoughts>c</Thoughts>d',
      expected: `a</Thoughts>b${DETAILS_OPEN}c</details>d`,
    },
    {
      name: 'a block and a tool_call in one text both convert',
      input: `<Thoughts>t</Thoughts><tool_call>id${TOOL_CALL}go</tool_call>`,
      expected: `${DETAILS_OPEN}t</details><div class="x-risu-tool-call">🛠️ Tool 'go' Called</div>\n\n`,
    },
  ]

  for (const row of rows) {
    test(row.name, () => {
      expect(parseThoughtsAndTools(row.input)).toBe(row.expected)
    })
  }
})
