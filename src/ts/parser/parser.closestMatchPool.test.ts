// @vitest-environment jsdom
/**
 * The asset pool after a near-miss lookup. A name that matches no asset exactly resolves to the closest asset's
 * path. That resolution is a fresh result for the missed name: it must not overwrite the closest name's pool, or an
 * exact lookup of that name afterwards picks from one path instead of the whole pool.
 *
 * Runs the real `ParseMarkdown` and the real `resetAssetsCache`; the modules a render reaches around them are
 * inert stand-ins. `DBState.db.characters` is empty and nothing is selected, so the selection effect cannot refill
 * the pool between renders.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { character, Database } from '../storage/database.svelte'

//#region module mocks

vi.mock(import('../process/modules'), () => ({
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModules: () => [],
  moduleUpdate: vi.fn(),
}) as unknown as typeof import('../process/modules'))

vi.mock(import('../process/moduleUpdateDeps'), () => ({
  trackModuleUpdateDeps: vi.fn(),
}) as unknown as typeof import('../process/moduleUpdateDeps'))

vi.mock(import('../process/moduleEnsure'), async (importOriginal) => ({
  ...(await importOriginal<typeof import('../process/moduleEnsure')>()),
  ensureSelectedModules: vi.fn(),
}))

vi.mock(import('../process/scripts'), () => ({
  processScriptFull: vi.fn(async (_char: unknown, data: string) => ({ data, emoChanged: false })),
  resetScriptCache: vi.fn(),
}) as unknown as typeof import('../process/scripts'))

vi.mock(import('../storage/database.svelte'), () => ({
  appVer: '1234.5.67',
  getCurrentCharacter: () => ({}),
  getCurrentChat: () => ({}),
  getDatabase: () => ({ modules: [], enabledModules: [] }),
}) as unknown as typeof import('../storage/database.svelte'))

vi.mock(import('../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: vi.fn(async (path: string) => `/served/${path}`),
  setUsingSw: vi.fn(),
  readImage: vi.fn(),
}) as unknown as typeof import('../globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
  isTauri: false,
  isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('../alert'), () => ({
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  alertStore: { subscribe: vi.fn() },
}) as unknown as typeof import('../alert'))

//#endregion

import { ParseMarkdown, resetAssetsCache } from './parser.svelte'
import { DBState, selectedCharID } from '../stores.svelte'
import { pickHashRand } from '../util'

const CHA_ID = 'pool-char'

function makeCharacter(additionalAssets: string[][]): character {
  return {
    chaId: CHA_ID,
    name: CHA_ID,
    type: 'character',
    chatPage: 0,
    chats: [{ id: `${CHA_ID}-chat`, message: [] }],
    additionalAssets,
    emotionImages: [],
    customscript: [],
  } as unknown as character
}

// The chat id whose pick over a two-path pool is the second path.
function chatIdPickingSecondOfTwo(): number {
  for (let id = 1; id < 1000; id++) {
    if (Math.floor(pickHashRand(id, CHA_ID + id) * 2) === 1) return id
  }
  throw new Error('no chat id picks the second path')
}

async function render(markup: string, char: character, chatId: number): Promise<Element | null> {
  const html = await ParseMarkdown(markup, char, 'back', chatId)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.querySelector('img, video source')
}

beforeEach(() => {
  DBState.db = { characters: [], legacyMediaFindings: false, assetMaxDifference: 4, modules: [] } as unknown as Database
  selectedCharID.set(-1)
  resetAssetsCache([], [], [])
})

describe('a near-miss lookup and the pool of the closest name', () => {
  test('an exact-name render after a near miss still picks from the whole pool', async () => {
    const assets = [['pic', 'assets/a.png', 'png'], ['pic', 'assets/b.png', 'png']]
    const char = makeCharacter(assets)
    resetAssetsCache(assets, [], [])
    const chatId = chatIdPickingSecondOfTwo()
    expect(DBState.db.characters.length).toBe(0)

    const nearMiss = await render('{{img::pix}}', char, chatId)
    expect(nearMiss?.getAttribute('src')).toBe('/served/assets/a.png')

    expect(DBState.db.characters.length).toBe(0)
    const exact = await render('{{img::pic}}', char, chatId)
    expect(exact?.getAttribute('src')).toBe('/served/assets/b.png')
  })

  test('a near miss answers with the closest asset and its extension, and the pool keeps its extension', async () => {
    const assets = [['clip', 'assets/c.mp4', 'mp4']]
    const char = makeCharacter(assets)
    resetAssetsCache(assets, [], [])

    const nearMiss = await render('{{asset::clop}}', char, 1)
    expect(nearMiss?.tagName).toBe('SOURCE')
    expect(nearMiss?.getAttribute('src')).toBe('/served/assets/c.mp4')

    const exact = await render('{{asset::clip}}', char, 1)
    expect(exact?.tagName).toBe('SOURCE')
    expect(exact?.getAttribute('src')).toBe('/served/assets/c.mp4')
  })

  test('a near miss is not remembered under the missed name', async () => {
    const assets = [['pic', 'assets/a.png', 'png']]
    const char = makeCharacter(assets)
    resetAssetsCache(assets, [], [])

    expect((await render('{{img::pix}}', char, 1))?.getAttribute('src')).toBe('/served/assets/a.png')

    // With near-miss matching off, the missed name has no entry of its own to answer from.
    DBState.db.legacyMediaFindings = true
    expect(await render('{{img::pix}}', char, 1)).toBeNull()
  })
})
