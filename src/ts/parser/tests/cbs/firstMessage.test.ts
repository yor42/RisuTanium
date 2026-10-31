import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { risuChatParser } from '../../parser.svelte'

//#region module mocks

const state = vi.hoisted(() => {
  const state = {
    character: {} as Record<string, unknown>,
    db: {} as Record<string, unknown>,
  }
  state.db = {
    get characters() {
      return [state.character]
    },
    globalChatVariables: {},
    templateDefaultVariables: '',
  }
  return state
})

vi.mock(
  import('../../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => ({}),
      getCurrentChat: () => ({}),
      getDatabase: () => state.db,
    }) as unknown as typeof import('../../../storage/database.svelte'),
)

vi.mock(import('../../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
  readImage: () => Promise.resolve(undefined),
}))

vi.mock(import('../../../stores.svelte'), () => {
  return {
    DBState: {
      db: state.db,
    },
    selIdState: {
      selId: 0,
    },
    selectedCharID: writable(0),
  } as unknown as typeof import('../../../stores.svelte')
})

//#endregion

function installChat(fmIndex: number): void {
  state.character = {
    chatPage: 0,
    firstMessage: 'DEFAULT_HELLO',
    alternateGreetings: ['ALT_ZERO'],
    defaultVariables: '',
    chats: [{ fmIndex, message: [], scriptstate: {} }],
  }
}

beforeEach(() => {
  installChat(-1)
})

describe('first message reads with a stale fmIndex', () => {
  test('regression reproducer: {{lastcharmessage}} falls back to the default first message', () => {
    installChat(3)
    expect(risuChatParser('{{lastcharmessage}}', { chatID: 0 })).toBe('DEFAULT_HELLO')
  })

  test('regression reproducer: {{previoususerchat}} falls back to the default first message', () => {
    installChat(3)
    expect(risuChatParser('{{previoususerchat}}', { chatID: 0 })).toBe('DEFAULT_HELLO')
  })

  test('regression reproducer: {{history}} starts with the default first message', () => {
    installChat(3)
    const history = JSON.parse(risuChatParser('{{history}}', { chatID: 0 })) as string[]
    expect((JSON.parse(history[0]) as { data: string }).data).toBe('DEFAULT_HELLO')
  })

  test('regression reproducer: {{firstmsgindex}} reads -1', () => {
    installChat(3)
    expect(risuChatParser('{{firstmsgindex}}', { chatID: 0 })).toBe('-1')
  })

  test('guard (passes before and after): an in-range fmIndex reads that alternate greeting and its index', () => {
    installChat(0)
    expect(risuChatParser('{{lastcharmessage}}', { chatID: 0 })).toBe('ALT_ZERO')
    expect(risuChatParser('{{firstmsgindex}}', { chatID: 0 })).toBe('0')
  })
})