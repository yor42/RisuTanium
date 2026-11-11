// @vitest-environment jsdom
// Sanitizer tests run in a DOM where DOMPurify visits every node; see
// sanitizerMultiRemoval.test.ts for why happy-dom is not one.
//
// An anchor that carries a `rel` leaves with `rel="noopener noreferrer"`, whatever `rel` the author
// wrote; an anchor with no `rel` gets none added; an anchor with a non-http href gets no `target`.
// The sanitizer alone keeps `rel="opener"`, so only the DOMPurify hook can produce the rewritten
// value. An identity sanitizer keeps the author's `rel` and the `javascript:` href, so every
// assertion below fails on it.
import { describe, it, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import { ParseMarkdown } from '../parser.svelte'

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
  // avatarThumb.ts reads readImage at module load, through characters.ts.
  readImage: () => Promise.resolve(undefined),
}))

vi.mock(import('../../stores.svelte'), () => {
  return {
    DBState: {
      db: {
        characters: [
          {
            chatPage: 0,
            chats: [{}],
            defaultVariables: '',
          },
        ],
        globalChatVariables: {},
        templateDefaultVariables: '',
      },
    },
    selIdState: {
      selId: 0,
    },
    selectedCharID: writable(0),
  } as typeof import('../../stores.svelte')
})

//#endregion

async function anchorOf(markup: string): Promise<HTMLAnchorElement> {
  const out = await ParseMarkdown(markup, null, 'back')
  const holder = document.createElement('div')
  holder.innerHTML = out
  const anchor = holder.querySelector('a')
  if (!anchor) {
    throw new Error(`No anchor in the sanitized output: ${out}`)
  }
  return anchor
}

describe('anchor rel and target after sanitization', () => {
  it('replaces an author-supplied rel="opener" with noopener noreferrer and opens in a new tab', async () => {
    const anchor = await anchorOf('<a href="https://example.com" rel="opener">x</a>')
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer')
    expect(anchor.getAttribute('target')).toBe('_blank')
  })

  it('replaces a mixed-case multi-token rel with exactly noopener noreferrer', async () => {
    const anchor = await anchorOf('<a href="https://example.com" rel="OPENER nofollow">x</a>')
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer')
    expect(anchor.getAttribute('target')).toBe('_blank')
  })

  it('guard: a javascript: href is still emptied', async () => {
    const anchor = await anchorOf('<a href="javascript:alert(1)">x</a>')
    expect(anchor.getAttribute('href') ?? '').toBe('')
  })
})
