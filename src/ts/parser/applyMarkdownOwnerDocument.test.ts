// @vitest-environment jsdom
/**
 * applyMarkdownToNode runs on nodes of the inert document translateHTML parsed.
 * The span that carries the rendered markdown must be created in the node's own
 * document, never in the live one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('../storage/database.svelte'), () =>
  ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => ({}),
    getCurrentChat: () => ({}),
    getDatabase: () => ({}),
  } as typeof import('../storage/database.svelte'))
)

vi.mock(import('../globalApi.svelte'), () =>
  ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
  } as unknown as typeof import('../globalApi.svelte'))
)

vi.mock(import('../stores.svelte'), () =>
  ({
    DBState: { db: { characters: [], globalChatVariables: {}, templateDefaultVariables: '' } },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
  } as unknown as typeof import('../stores.svelte'))
)

import { applyMarkdownToNode } from './parser.svelte'

const creations: boolean[] = []
let restore: () => void = () => {}

beforeEach(() => {
  creations.length = 0
  const createElement = Document.prototype.createElement
  Document.prototype.createElement = function (this: Document, ...args: Parameters<Document['createElement']>) {
    creations.push(this === document)
    return createElement.apply(this, args)
  } as Document['createElement']
  restore = () => { Document.prototype.createElement = createElement }
})

afterEach(() => restore())

describe('applyMarkdownToNode', () => {
  it('creates the markdown span in the node own document', () => {
    const doc = new DOMParser().parseFromString('<p>a *b* c</p>', 'text/html')

    applyMarkdownToNode(doc.body)

    expect(creations.length).toBeGreaterThan(0)
    expect(creations).not.toContain(true)
    expect(doc.body.innerHTML).toContain('<em>b</em>')
  })

  it('renders markdown into a span and copies the parent inline style', () => {
    const doc = new DOMParser().parseFromString('<p style="color: red">a *b* c</p>', 'text/html')

    applyMarkdownToNode(doc.body)

    const span = doc.body.querySelector('p > span')!
    expect(span.innerHTML).toContain('<em>b</em>')
    expect((span as HTMLElement).style.color).toBe('red')
  })

  it('wraps the rendered paragraph of plain text in a span', () => {
    const doc = new DOMParser().parseFromString('<p>plain text</p>', 'text/html')

    applyMarkdownToNode(doc.body)

    expect(doc.body.innerHTML).toBe('<p><span><p>plain text</p>\n</span></p>')
  })
})
