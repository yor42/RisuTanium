import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'
import type { Message } from '../../../storage/database.svelte'
import { risuChatParser } from '../../parser.svelte'
import { buildDisplayParseOptions } from '../../../process/displayParseOptions'
import { splitSentMessages } from '../../../cbs'
import { branchMarkerData, markerIdField, markerName } from '../../../drive/exportBranches'
import { trimVarPrefix } from './lib'

// CHORE-478 S5 (K1-K5): the `branchedfrom` marker a `.bin` export writes survives the real CBS parser unchanged, so the
// renderer (upstream's and the fork's share one predicate) recognises it and reads the parent id, the shown name and the
// branch-point id at `split('::')` positions 2, 3 and 4, whatever the chat name, the user name and the character name hold.

//#region module mocks

const userBox = vi.hoisted(() => ({ name: 'USERNAME' }))

vi.mock(
  import('../../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => ({}),
      getDatabase: () => ({ get username() { return userBox.name } }),
    } as typeof import('../../../storage/database.svelte'))
)

vi.mock(import('../../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
  readImage: () => Promise.resolve(undefined),
}))

const varStorage = vi.hoisted(
  () => new Proxy({}, { get(_, prop) { return trimVarPrefix(prop) } })
)

vi.mock(import('../../../stores.svelte'), () => {
  return {
    DBState: {
      db: {
        characters: [{ chatPage: 0, chats: [{ scriptstate: varStorage }], defaultVariables: '' }],
        globalChatVariables: varStorage,
        templateDefaultVariables: '',
        get username() { return userBox.name },
      },
    },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
  } as typeof import('../../../stores.svelte')
})

//#endregion

const PARENT = '0f8b6c1e-2d3a-4b5c-9d8e-7f6a5b4c3d2e'
const POINT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const HAZARD = /\{\{|\{#|\}\}|#\}|::|:$|<(user|char|bot)>/i

const USERS = ['USERNAME', 'Us::er', 'U#}x', '<char>', '{{char}}']
const CHARAS = ['Alice', 'Al::ice', 'C#}', '<user>']

/** Hostile chat names: every token the tokeniser acts on, alone and joined, in any case, with and without the `::` split. */
const NAMED = [
  'Plain Name', 'A::B', 'Trail:', 'Trail::', ':Lead', 'Br}}ace', 'Op{{en', 'Has {{user}} x', 'Q{{random::a::b}}', '{{', '}}', '{{{x}}}',
  'a{{setvar::k::v}}b', 'x:::y', 'A:{{user}}:', '{', '}', '}x{', 'Has {{char}}',
  'C#}', 'Plan #} x', 'x{#y', '{#if 1#}x{#/if#}', 'Hi <user>', '<char> talk', '<BOT>', 'a\\{b', 'a\\:b', 'a\\', 'ends {', 'ends #',
  '<USER>', '<Char>', '<<user>>', '<user>>', '<<user>', '{{#', '{##}', '#}}', '{#}', 'a#}b', '{#if x}', '{{#if 1}}x{{/if}}', '{{call::f}}',
  '{{? 1+1}}', '{{//}}', '{{:else}}', 'x\n{#if 1\ny#}', 'Hi <user> ::', '}{', '#', '##}}', ':::', '', '대화 #} <char>', '{<user>}', '{#<char>#}',
  '<us<user>er>', '{{<bot>}}', '#}<user>{#', ':<user>:', '{{#each [1] as a}}{{slot::a}}{{/each}}', '{{#pure}}x{{/pure}}',
]

function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TOKENS = ['{', '}', ':', '#', '<', '>', '\\', '/', '?', ' ', 'user', 'char', 'bot', 'USER', 'Bot', 'a', 'b', '\n', '::', '{{', '}}', '{#', '#}']

function randomNames(seed: number, count: number): string[] {
  const random = mulberry32(seed)
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const length = Math.floor(random() * 14)
    let name = ''
    for (let k = 0; k < length; k++) {
      name += TOKENS[Math.floor(random() * TOKENS.length)]
    }
    names.push(name)
  }
  return names
}

/** What the renderer does to a marker message: the real parser with the display options, then the shared predicate. */
function renderMarker(data: string, chara: string): { parsed: string, recognised: boolean, parts: string[] } {
  const parsed = risuChatParser(data, buildDisplayParseOptions({ chara, chatID: 3, firstmsg: false, chatRole: 'char' }))
  const parts = parsed.split('::')
  return { parsed, recognised: parsed.startsWith('{{specialcomment') && parts[1] === 'branchedfrom', parts }
}

/** Whether the marker built for `name` is returned unchanged and read back as parent, shown name and point. */
function failureOf(name: string, user: string, chara: string): string | null {
  userBox.name = user
  const data = branchMarkerData(PARENT, name, POINT)
  const { parsed, recognised, parts } = renderMarker(data, chara)
  const ok = recognised && parsed === data && parts.length === 6 && parts[2] === PARENT && parts[3] === markerName(name) && parts[4] === POINT
  return ok ? null : JSON.stringify({ user, chara, name, shown: markerName(name), parsed })
}

function failuresOver(names: readonly string[]): { cases: number, failures: string[] } {
  const failures: string[] = []
  let cases = 0
  for (const user of USERS) {
    for (const chara of CHARAS) {
      for (const name of names) {
        cases++
        const failure = failureOf(name, user, chara)
        if (failure !== null) {
          failures.push(failure)
        }
      }
    }
  }
  return { cases, failures }
}

describe('branch marker against the real parser', () => {
  test('K1 guard: every hostile chat name parses back to the marker, under every user and character name', () => {
    const { cases, failures } = failuresOver(NAMED)
    expect(cases).toBe(NAMED.length * USERS.length * CHARAS.length)
    expect(failures.slice(0, 3)).toEqual([])
  })

  test('K1 guard: the named results the plan records', () => {
    userBox.name = 'Us::er'
    expect(markerName('Hi <user>')).toBe('Hi user')
    expect(markerName('C#}')).toBe('C}')
    expect(markerName('<<user>>')).toBe('user')
    expect(markerName('{{#if 1}}x')).toBe('{if 1}x')
    expect(markerName('A::B')).toBe('A:B')
    expect(markerName('Trail:')).toBe('Trail')
    expect(markerName(7)).toBe('')
    expect(markerName(undefined)).toBe('')
    const render = renderMarker(branchMarkerData(PARENT, 'Hi <user>', POINT), 'Al::ice')
    expect(render.parts[3]).toBe('Hi user')
    expect(render.parts[4]).toBe(POINT)
  })

  test('K2 compatibility: without the sanitiser the parser breaks or moves the marker (the premise of the rules)', () => {
    userBox.name = 'Us::er'
    const raw = (name: string) => `{{specialcomment::branchedfrom::${PARENT}::${name}::${POINT}::}}`
    expect(renderMarker(raw('C#}'), 'Alice').recognised).toBe(false)
    expect(renderMarker(raw('Hi <user>'), 'Alice').parts[4]).not.toBe(POINT)
    expect(renderMarker(raw('A::B'), 'Alice').parts[4]).not.toBe(POINT)
    expect(renderMarker(raw('Trail:'), 'Alice').parts[4]).toBe(`:${POINT}`)
  })

  test('K3 compatibility: a disabled marker message is not sent with the request', () => {
    const marker: Message = { role: 'char', data: branchMarkerData(PARENT, 'Chat', POINT), isComment: true, disabled: true, chatId: 'm' }
    const reply: Message = { role: 'char', data: 'hello', chatId: 'r' }
    const split = splitSentMessages([reply, marker])
    expect(split.sent).toEqual([reply])
    expect(split.hidden.has(marker)).toBe(true)
  })

  test('K4 guard: seeded random names leave no token the parser acts on and parse back exactly', () => {
    const names = randomNames(478, 3000)
    const { cases, failures } = failuresOver(names)
    expect(cases).toBe(3000 * USERS.length * CHARAS.length)
    expect(failures.slice(0, 3)).toEqual([])
    for (const name of [...NAMED, ...names]) {
      const shown = markerName(name)
      expect(HAZARD.test(shown), JSON.stringify({ name, shown })).toBe(false)
      expect(markerName(shown), JSON.stringify({ name, shown })).toBe(shown)
    }
  })

  test('K5 guard: an id outside the allowlist reads as no id and cannot move the other fields', () => {
    for (const id of ['a:b', 'x{y', 'p#}', 'q<user>', 'a::b', '', 7, undefined, null, 'a b']) {
      expect(markerIdField(id)).toBe('')
    }
    expect(markerIdField(PARENT)).toBe(PARENT)
    expect(markerIdField('ok_id-1')).toBe('ok_id-1')
    userBox.name = 'Us::er'
    const render = renderMarker(branchMarkerData(PARENT, 'Chat', 'q<user>'), 'Alice')
    expect(render.recognised).toBe(true)
    expect(render.parts).toHaveLength(6)
    expect(render.parts[2]).toBe(PARENT)
    expect(render.parts[4]).toBe('')
    const hostileParent = renderMarker(branchMarkerData('a:b', 'Chat', POINT), 'Alice')
    expect(hostileParent.parts[2]).toBe('')
    expect(hostileParent.parts[4]).toBe(POINT)
  })
})
