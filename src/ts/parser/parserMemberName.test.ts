/**
 * `{{char}}` in the REAL `risuChatParser` over a group: the name is that of the last speaker. A live
 * member answers by its own name; a member that is gone answers by the name the group recorded when it
 * joined; with no record either, `{{char}}` is what it was before the record existed.
 *
 * Classes: `regression reproducer:` fails on the code before the member record existed (a gone last
 * speaker made `{{char}}` fall back to the generic name); `guard:` passes before and after.
 */
import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { risuChatParser } from './parser.svelte'

//#region module mocks

const state = vi.hoisted(() => {
  const state = {
    characters: [] as unknown[],
    db: {} as Record<string, unknown>,
  }
  state.db = {
    get characters() {
      return state.characters
    },
    globalChatVariables: {},
    templateDefaultVariables: '',
  }
  return state
})

vi.mock(
  import('../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => ({}),
      getCurrentChat: () => ({}),
      getDatabase: () => state.db,
      defaultSdDataFunc: () => ({}),
    }) as unknown as typeof import('../storage/database.svelte'),
)

vi.mock(import('../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
  readImage: () => Promise.resolve(undefined),
}))

vi.mock(import('../stores.svelte'), () => {
  return {
    DBState: {
      db: state.db,
    },
    selIdState: {
      selId: 0,
    },
    selectedCharID: writable(0),
  } as unknown as typeof import('../stores.svelte')
})

//#endregion

type Members = Record<string, unknown> | undefined

// The group's last message was said by 'm-1'. `members` is risutanium_members exactly as joinRecord
// writes it ({name, slot 0..7}); `live` are the member characters still in the list.
function setGroup(members: Members, live: { chaId: string, name: string }[]) {
  const group = {
    type: 'group',
    name: 'Group',
    chaId: 'g0',
    chatPage: 0,
    characters: ['m-1'],
    chats: [{ message: [{ role: 'char', data: 'spoken', saying: 'm-1' }], scriptstate: {} }],
    defaultVariables: '',
    ...(members === undefined ? {} : { risutanium_members: members }),
  }
  state.characters = [group, ...live.map((c) => ({ ...c, type: 'character', chats: [], chatPage: 0 }))]
  return group
}

beforeEach(() => {
  state.characters = []
})

describe('{{char}} for a group: the last speaker', () => {
  test('regression reproducer: a gone last speaker reads as the name recorded at join', () => {
    const group = setGroup({ 'm-1': { name: 'Alice', slot: 0 } }, [])
    expect(risuChatParser('{{char}}', { chara: group as never })).toBe('Alice')
  })

  test('guard: a live last speaker reads as its own name, not the record', () => {
    const group = setGroup({ 'm-1': { name: 'Alice', slot: 0 } }, [{ chaId: 'm-1', name: 'Alicia' }])
    expect(risuChatParser('{{char}}', { chara: group as never })).toBe('Alicia')
  })

  test('guard: a gone last speaker with no record reads as it did before the record existed', () => {
    const group = setGroup(undefined, [])
    const bare = risuChatParser('{{char}}', { chara: group as never })
    expect(bare).not.toBe('Alice')
    // A member map that names somebody else gives the same answer as no map.
    const other = setGroup({ 'm-2': { name: 'Bea', slot: 1 } }, [])
    expect(risuChatParser('{{char}}', { chara: other as never })).toBe(bare)
  })
})
