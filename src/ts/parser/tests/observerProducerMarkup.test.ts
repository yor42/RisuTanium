// @vitest-environment jsdom
/**
 * The observer consumes markup that `ParseMarkdown` produces: fenced code blocks
 * (`x-hl-lang`) and `{{bgm::name}}` controls (`risu-ctrl`). The fixtures here are
 * the real producer's output, not hand-written markup, so a producer change that
 * the observer no longer understands fails here. The mock set is the one
 * `assetMarkupUrl.test.ts` uses to load `parser.svelte.ts`, plus `globalFetch`
 * for the observer's own import.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { ParseMarkdown, resetAssetsCache } from '../parser.svelte'
import { startObserveDom } from '../../observer.svelte'
import { registerMessageRoot } from '../../messageRootRegistry'

//#region module mocks

vi.mock(
  import('../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => ({}),
      getCurrentChat: () => ({}),
      getDatabase: () => ({ modules: [], enabledModules: [] }),
    } as typeof import('../../storage/database.svelte'))
)

vi.mock(import('../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: vi.fn(),
  setUsingSw: vi.fn(),
  readImage: vi.fn(),
  globalFetch: vi.fn(),
}) as unknown as typeof import('../../globalApi.svelte'))

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

import { getFileSrc } from '../../globalApi.svelte'

const ROUTE_URL = '/api/asset/6173736574732f782e706e67?risu-auth=aaa.bbb.ccc'

// Every fence name the parser's highlighter switch accepts.
const FENCE_NAMES = [
  'bash', 'c', 'cpp', 'cs', 'csharp', 'css', 'dart', 'html', 'svg', 'xml', 'java',
  'js', 'jsx', 'javascript', 'json', 'lua', 'markdown', 'md', 'py', 'python', 'rust',
  'shell', 'ts', 'tsx', 'typescript', 'txt', 'vtt', 'yaml',
]

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = []
  loop = false
  volume = 1
  src: string
  play = vi.fn(() => Promise.resolve())
  pause = vi.fn()
  remove = vi.fn()
  constructor(src: string) {
    super()
    this.src = src
    FakeAudio.instances.push(this)
  }
}

function makeChar(additionalAssets: string[][]) {
  return {
    type: 'character',
    chaId: 'char-observer-markup',
    additionalAssets,
    emotionImages: [],
    customscript: [],
  } as unknown as Parameters<typeof ParseMarkdown>[1]
}

let dispose: (() => void) | null = null
let downloads: string[] = []

// The pre-fix export returns a promise, so the disposer is recorded only when
// the export returns one.
function start() {
  const result = startObserveDom()
  if (typeof result === 'function') {
    dispose = result
  }
}

beforeEach(() => {
  vi.mocked(getFileSrc).mockReset()
  vi.mocked(getFileSrc).mockResolvedValue(ROUTE_URL)
  FakeAudio.instances = []
  downloads = []
  vi.stubGlobal('Audio', FakeAudio)
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download)
  })
})

afterEach(() => {
  if (typeof dispose === 'function') {
    dispose()
  }
  dispose = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('observer on real parser output', () => {
  test.each(FENCE_NAMES)('guard: a ```%s block downloads with the extension the parser produced', async (fence) => {
    const html = await ParseMarkdown('```' + fence + '\nlet a = 1\n```', makeChar([]), 'normal')
    document.body.innerHTML = html
    const block = document.querySelector('[x-hl-lang]')
    expect(block).not.toBeNull()
    const produced = block!.getAttribute('x-hl-lang')
    expect(produced).toBeTruthy()

    start()
    block!.querySelector('code')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    const download = Array.from(document.querySelectorAll('#code-contextmenu > div'))
      .find((option) => option.textContent === 'Download') as HTMLElement
    download.click()

    expect(downloads).toEqual([`code.${produced}`])
  })

  test('guard: a produced {{bgm::theme}} control plays its URL at volume 0.5', async () => {
    vi.useFakeTimers()
    try {
      const char = makeChar([['theme', 'assets/theme-bgm.mp3', 'mp3']])
      resetAssetsCache((char as { additionalAssets: string[][] }).additionalAssets, [], [])
      const html = await ParseMarkdown('{{bgm::theme}}', char, 'back')

      const root = document.createElement('div')
      root.className = 'flex max-w-full justify-center risu-chat'
      root.setAttribute('data-chat-index', '4')
      root.setAttribute('data-chat-id', 'm4')
      root.innerHTML = html
      document.body.append(root)
      const action = registerMessageRoot(root, { index: 4, chatId: 'm4' })

      start()
      await vi.advanceTimersByTimeAsync(200)

      expect(FakeAudio.instances.map((audio) => audio.src)).toEqual([ROUTE_URL])
      expect(FakeAudio.instances[0].volume).toBe(0.5)
      action.destroy()
    } finally {
      vi.useRealTimers()
    }
  })
})
