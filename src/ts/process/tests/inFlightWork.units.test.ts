// @vitest-environment jsdom
/**
 * Image generation, translation and embedding hold an in-flight token for the
 * whole call and end it however the call settles.
 *
 * Drives the REAL `generateAIImage`, `runTranslator`, `translateHTML`,
 * `runEmbedding`, `runSummarizer`, `runImageEmbedding`, `HypaProcesser` and
 * `HypaProcessorV2`. The network, the transformers pipelines and the request
 * layer are fakes; a passing test says nothing about a real provider.
 *
 * Embedding tests that must tell the caller's own token from the one the real
 * `runEmbedding` holds replace `runEmbedding` for that call, so only the
 * caller's token is visible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

//#region module mocks

const db = vi.hoisted(() => ({
  translatorType: 'deepl',
  deeplOptions: { freeApi: true, key: 'k' },
  combineTranslation: true,
  translator: 'ko',
  aiModel: 'gpt',
  presetRegex: [],
  characters: [],
  sdProvider: 'webui',
  webUiUrl: 'http://localhost:7860',
  sdConfig: {},
  hypaModel: 'MiniLM',
  hypaCustomSettings: undefined,
  supaMemoryKey: '',
} as Record<string, unknown>))

const network = vi.hoisted(() => ({
  fetch: async (_url: string, _init: unknown): Promise<unknown> => ({ ok: true, data: {} }),
}))

const pipelineBox = vi.hoisted(() => ({
  create: async (_task: string): Promise<(input: unknown, options?: unknown) => Promise<unknown>> => async () => [],
}))

vi.mock('localforage', () => ({
  default: {
    createInstance: () => ({
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => {}),
      removeItem: vi.fn(async () => {}),
    }),
  },
}))

vi.mock('../modules', () => ({
  getModuleRegexScripts: () => [],
  moduleUpdate: () => {},
}))

vi.mock('../../globalApi.svelte', () => ({
  globalFetch: (url: string, init: unknown) => network.fetch(url, init),
  fetchNative: (url: string, init: unknown) => network.fetch(url, init),
  loadAsset: async () => new Uint8Array(4),
  saveAsset: async () => '',
  readImage: async () => '',
}))

vi.mock('../../secretRef', () => ({
  resolveSecret: async (value: string) => value,
  SecretRefError: class SecretRefError extends Error {},
}))

vi.mock('../scripts', () => ({
  processScriptFull: async (_char: unknown, data: string) => ({ data }),
  processScript: async (_char: unknown, data: string) => data,
  risuChatParser: (data: string) => data,
  resetScriptCache: () => {},
}))

vi.mock('../../parser/parser.svelte', () => ({
  applyMarkdownToNode: () => {},
  risuChatParser: (data: string) => data,
}))

vi.mock('../request/request', () => ({
  requestChatData: vi.fn(),
}))

vi.mock('../processzip', () => ({
  processZip: vi.fn(),
}))

vi.mock('@huggingface/transformers', () => ({
  env: {},
  // The code under test disposes of a pipeline when it swaps models.
  pipeline: vi.fn(async (task: string) => Object.assign(await pipelineBox.create(task), { dispose: async () => {} })),
}))

// Calls through to the real implementation unless a test replaces it for one call.
vi.mock('../transformers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../transformers')>()
  return { ...actual, runEmbedding: vi.fn(actual.runEmbedding) }
})

//#endregion

import { generateAIImage } from '../stableDiff'
import { runTranslator, translateHTML } from '../../translator/translator'
import { runEmbedding, runImageEmbedding, runSummarizer } from '../transformers'
import { HypaProcesser } from '../memory/hypamemory'
import { HypaProcessorV2 } from '../memory/hypamemoryv2'
import { inFlightKinds, resetInFlightForTest } from '../inFlightWork'
import { DBState } from '../../stores.svelte'
import type { character, Database } from '../../storage/database.svelte'

const character = { chaId: 'char-0', name: 'Char', type: 'character' } as unknown as character

/** Runs `call` with the network fake recording what was in flight when it was reached. */
async function duringNetwork<T>(call: () => Promise<T>, reply: unknown = { ok: true, data: { translations: [{ text: 'T' }], images: ['aW1n'] } }): Promise<{ during: string[], result: T }> {
  let during: string[] = []
  network.fetch = async () => {
    during = inFlightKinds()
    return reply
  }
  const result = await call()
  return { during, result }
}

beforeEach(() => {
  DBState.db = db as unknown as Database
  resetInFlightForTest()
  network.fetch = async () => ({ ok: true, data: {} })
  pipelineBox.create = async () => async () => []
  vi.stubGlobal('caches', { open: async () => ({ put: async () => {}, match: async () => undefined }) })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => {
  resetInFlightForTest()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('generateAIImage', () => {
  it('holds an image token while the provider is called and ends it afterwards', async () => {
    const { during } = await duringNetwork(() => generateAIImage('a cat', character, '', ''))

    expect(during).toEqual(['image'])
    expect(inFlightKinds()).toEqual([])
  })

  it('ends the token when the provider call throws', async () => {
    network.fetch = async () => { throw new Error('provider down') }

    await generateAIImage('a cat', character, '', '').catch(() => {})

    expect(inFlightKinds()).toEqual([])
  })
})

describe('translation', () => {
  it('runTranslator holds a translate token over the translator call', async () => {
    const { during, result } = await duringNetwork(() => runTranslator('hello', false, 'ko', 'en'))

    expect(result).toBe('T')
    expect(during).toContain('translate')
    expect(inFlightKinds()).toEqual([])
  })

  it('runTranslator ends the token when the translator throws', async () => {
    network.fetch = async () => { throw new Error('translator down') }

    await expect(runTranslator('hello', false, 'ko', 'en')).rejects.toThrow('translator down')

    expect(inFlightKinds()).toEqual([])
  })

  it('translateHTML holds a translate token and ends it', async () => {
    const { during } = await duringNetwork(() => translateHTML('<p>fresh text</p>', false, '', -1))

    expect(during).toContain('translate')
    expect(inFlightKinds()).toEqual([])
  })

  it('translateHTML ends the token when the translator throws', async () => {
    network.fetch = async () => { throw new Error('translator down') }

    await translateHTML('<p>other text</p>', false, '', -1).catch(() => {})

    expect(inFlightKinds()).toEqual([])
  })

  it('translateHTML holds no token for empty input that returns at once', async () => {
    await translateHTML('', false, '', -1)

    expect(inFlightKinds()).toEqual([])
  })
})

describe('local transformers work', () => {
  it('runEmbedding holds an embed token while the model runs', async () => {
    let during: string[] = []
    pipelineBox.create = async () => async () => {
      during = inFlightKinds()
      return { data: new Float32Array(4) }
    }

    await runEmbedding(['a', 'b'], 'Xenova/all-MiniLM-L6-v2', 'wasm')

    expect(during).toEqual(['embed'])
    expect(inFlightKinds()).toEqual([])
  })

  it('runEmbedding ends the token when the model fails to load', async () => {
    pipelineBox.create = async () => { throw new Error('download stalled') }

    await expect(runEmbedding(['a'], 'nomic-ai/nomic-embed-text-v1.5', 'wasm')).rejects.toThrow('download stalled')

    expect(inFlightKinds()).toEqual([])
  })

  it('runSummarizer holds an embed token and ends it on success and on throw', async () => {
    let during: string[] = []
    pipelineBox.create = async () => async () => {
      during = inFlightKinds()
      return [{ summary_text: 'short' }]
    }
    await expect(runSummarizer('long text')).resolves.toBe('short')
    expect(during).toEqual(['embed'])
    expect(inFlightKinds()).toEqual([])

    pipelineBox.create = async () => { throw new Error('download stalled') }
    await expect(runSummarizer('long text')).rejects.toThrow('download stalled')
    expect(inFlightKinds()).toEqual([])
  })

  it('runImageEmbedding holds an embed token and ends it on success and on throw', async () => {
    let during: string[] = []
    pipelineBox.create = async () => async () => {
      during = inFlightKinds()
      return [{ generated_text: 'a cat' }]
    }
    await runImageEmbedding('data:image/png;base64,AA==')
    expect(during).toEqual(['embed'])
    expect(inFlightKinds()).toEqual([])

    pipelineBox.create = async () => { throw new Error('download stalled') }
    await expect(runImageEmbedding('data:image/png;base64,AA==')).rejects.toThrow('download stalled')
    expect(inFlightKinds()).toEqual([])
  })
})

describe('memory embedders', () => {
  it('HypaProcesser.getEmbeds holds an embed token of its own around a local model', async () => {
    let during: string[] = []
    vi.mocked(runEmbedding).mockImplementationOnce(async () => {
      during = inFlightKinds()
      return [new Float32Array(2)]
    })

    await new HypaProcesser('MiniLM').getEmbeds('query')

    expect(during).toEqual(['embed'])
    expect(inFlightKinds()).toEqual([])
  })

  it('HypaProcesser.getEmbeds ends the token when the embedder throws', async () => {
    await expect(new HypaProcesser('custom').getEmbeds('query')).rejects.toThrow('Custom model requires a Custom Server URL')

    expect(inFlightKinds()).toEqual([])
  })

  it('HypaProcessorV2 holds an embed token of its own around a local model', async () => {
    let during: string[] = []
    vi.mocked(runEmbedding).mockImplementationOnce(async () => {
      during = inFlightKinds()
      return [new Float32Array(2)]
    })

    await new HypaProcessorV2<string>({ model: 'MiniLM' }).addTexts([{ id: 'a', content: 'text' }])

    expect(during).toEqual(['embed'])
    expect(inFlightKinds()).toEqual([])
  })

  it('HypaProcessorV2 ends the token when the embedder throws', async () => {
    vi.mocked(runEmbedding).mockImplementationOnce(async () => { throw new Error('model failed') })

    await new HypaProcessorV2<string>({ model: 'MiniLM' }).addTexts([{ id: 'a', content: 'text' }]).catch(() => {})

    expect(inFlightKinds()).toEqual([])
  })

  it('HypaProcessorV2 holds no token for an empty batch', async () => {
    await new HypaProcessorV2<string>({ model: 'MiniLM' }).addTexts([])

    expect(inFlightKinds()).toEqual([])
  })
})
