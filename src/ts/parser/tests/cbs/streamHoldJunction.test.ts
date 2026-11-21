import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'
import { risuChatParser } from '../../parser.svelte'
import { splitAtOpenCbsSpan } from '../../../chatShell/streamSpans'
import { describeOpenTail, splitStreamingText } from '../../../chatShell/streamingSafe'

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
 * The producer parses the text before an open CBS block with the real parser and appends the block raw. The junction
 * must keep the paragraph break the hold depends on, and the viewer's own split of the stored text must show the
 * parsed head as finished and the block as the Formatting chip. Options are fresh per call, as the output scripts
 * build them.
 */

const fresh = () => ({ chara: h.db.characters[0] as never, db: h.db as never })

describe('open CBS block junction', () => {
  // Compatibility guard of the helper against the real parser (new export): passes only with the macro in the head,
  // which keeps the parser out of its plain-text shortcut.
  test('T-J1 the parsed head and the raw block join at the paragraph break the view holds on', () => {
    const whole = 'A {{user}}\n\n{{#if 1}}\n\nB\n\nC'
    const { head, held } = splitAtOpenCbsSpan(whole)
    expect(head).toBe('A {{user}}\n\n')
    expect(held).toBe('{{#if 1}}\n\nB\n\nC')

    const parsedHead = risuChatParser(head, fresh())
    expect(parsedHead).toBe('A Alice\n\n')

    const stored = parsedHead + held
    expect(stored).toBe('A Alice\n\n{{#if 1}}\n\nB\n\nC')
    expect(stored).not.toContain('<')

    const split = splitStreamingText(stored)
    expect(split.finished).toEqual(['A Alice\n\n'])
    expect(describeOpenTail(split.open).chip?.kind).toBe('formatting')
  })
})
