// @vitest-environment jsdom
// Sanitizer tests run in a DOM where DOMPurify visits every node; see
// sanitizerMultiRemoval.test.ts for why happy-dom is not one.
//
// A Blob-valued asset is shown through a `blob:` object URL (getFileSrc), so the
// sanitizer must keep that scheme on the media elements the chat renders it in,
// and must still strip what makes markup unsafe. The second half of each test is
// what an identity sanitizer fails: it would keep the event handler and the script.
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

const blobUrl = 'blob:http://localhost:6480/0b1c2d3e-aaaa-bbbb-cccc-0123456789ab'

describe('blob: src sanitization', () => {
  it('guard: keeps a blob: src on img through ParseMarkdown and strips the event handler', async () => {
    const out = await ParseMarkdown(`<img src="${blobUrl}" onerror="alert(1)">`, null, 'back')
    expect(out).toContain(`src="${blobUrl}"`)
    expect(out).not.toContain('onerror')
  })

  it('guard: keeps a blob: src on video and on its source, and strips the event handler and the script', async () => {
    const out = await ParseMarkdown(
      `<video src="${blobUrl}" onloadstart="alert(1)"><source src="${blobUrl}" onerror="alert(2)"></video><script>alert(3)</script>`,
      null,
      'back',
    )
    expect(out).toContain(`<video src="${blobUrl}"`)
    expect(out).toContain(`<source src="${blobUrl}"`)
    expect(out).not.toContain('onloadstart')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('<script')
  })
})
