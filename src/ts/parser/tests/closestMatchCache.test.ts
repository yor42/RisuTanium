// @vitest-environment jsdom
/**
 * The closest-asset lookup of a near-miss asset name is remembered per assets array. The memory may only skip the
 * name scan: names are re-validated on every call, and the asset's path and extension and the `assetMaxDifference`
 * limit are read live, so every result must equal what an uncached lookup over the current array gives.
 *
 * Runs the real `ParseMarkdown` and `resetAssetsCache` over the harness of parser.closestMatchPool.test.ts. A warm
 * run renders from the mutated live array; the cold run renders the same data from a `structuredClone`, which no
 * memory has seen.
 *
 * Tests titled `guard:` pass before and after and pin the output; `diagnostic:` tests only show that the scan is
 * skipped.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { character, Database } from '../../storage/database.svelte'

//#region module mocks

vi.mock(import('../../process/modules'), () => ({
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModules: () => [],
  moduleUpdate: vi.fn(),
}) as unknown as typeof import('../../process/modules'))

vi.mock(import('../../process/moduleUpdateDeps'), () => ({
  trackModuleUpdateDeps: vi.fn(),
}) as unknown as typeof import('../../process/moduleUpdateDeps'))

vi.mock(import('../../process/moduleEnsure'), async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../process/moduleEnsure')>()),
  ensureSelectedModules: vi.fn(),
}))

vi.mock(import('../../process/scripts'), () => ({
  processScriptFull: vi.fn(async (_char: unknown, data: string) => ({ data, emoChanged: false })),
  resetScriptCache: vi.fn(),
}) as unknown as typeof import('../../process/scripts'))

vi.mock(import('../../storage/database.svelte'), () => ({
  appVer: '1234.5.67',
  getCurrentCharacter: () => ({}),
  getCurrentChat: () => ({}),
  getDatabase: () => ({ modules: [], enabledModules: [] }),
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: vi.fn(async (path: string) => `/served/${path}`),
  setUsingSw: vi.fn(),
  readImage: vi.fn(),
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
  isTauri: false,
  isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('../../alert'), () => ({
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  alertStore: { subscribe: vi.fn() },
}) as unknown as typeof import('../../alert'))

//#endregion

import { ParseMarkdown, resetAssetsCache, closestMatchScanCountForTests } from '../parser.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'

function makeCharacter(chaId: string, additionalAssets: string[][]): character {
  return {
    chaId,
    name: chaId,
    type: 'character',
    chatPage: 0,
    chats: [{ id: `${chaId}-chat`, message: [] }],
    additionalAssets,
    emotionImages: [],
    customscript: [],
  } as unknown as character
}

async function srcOf(char: character, name: string): Promise<string | null> {
  resetAssetsCache(char.additionalAssets ?? [], [], [])
  const html = await ParseMarkdown(`{{img::${name}}}`, char, 'back', 1)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.querySelector('img')?.getAttribute('src') ?? null
}

// The result over the live array, checked against a lookup that no memory has seen.
async function warmAndCold(live: character, name: string): Promise<string | null> {
  const warm = await srcOf(live, name)
  const cold = await srcOf(makeCharacter('cold', structuredClone(live.additionalAssets ?? [])), name)
  expect(warm).toBe(cold)
  return warm
}

beforeEach(() => {
  DBState.db = { characters: [], legacyMediaFindings: false, assetMaxDifference: 4, modules: [] } as unknown as Database
  selectedCharID.set(-1)
  resetAssetsCache([], [], [])
})

describe('closest-match memory over a mutated assets array', () => {
  test('guard: every in-place change is seen by the next lookup', async () => {
    const assets = [['pic', 'assets/a.png', 'png'], ['pid', 'assets/b.png', 'png']]
    const live = makeCharacter('live', assets)

    expect(await warmAndCold(live, 'pix')).toBe('/served/assets/a.png')

    // rename: the remembered closest asset is gone
    assets[0][0] = 'qqqqqq'
    expect(await warmAndCold(live, 'pix')).toBe('/served/assets/b.png')

    // path: read live, not remembered
    assets[1][1] = 'assets/c.png'
    expect(await warmAndCold(live, 'pix')).toBe('/served/assets/c.png')

    // limit: read live, in both directions
    DBState.db.assetMaxDifference = 0
    expect(await warmAndCold(live, 'pix')).toBeNull()
    DBState.db.assetMaxDifference = 5
    expect(await warmAndCold(live, 'pix')).toBe('/served/assets/c.png')
    DBState.db.assetMaxDifference = undefined as unknown as number
    expect(await warmAndCold(live, 'pix')).toBe('/served/assets/c.png')
    DBState.db.assetMaxDifference = 4

    // push: a tie keeps the earlier asset
    assets.push(['pixy', 'assets/d.png', 'png'])
    expect(await warmAndCold(live, 'pix')).toBe('/served/assets/c.png')

    // splice: the remembered asset's index now holds another asset
    assets.splice(1, 1)
    expect(await warmAndCold(live, 'pix')).toBe('/served/assets/d.png')

    // empty list
    assets.splice(0, assets.length)
    expect(await warmAndCold(live, 'pix')).toBeNull()
  })

  test('guard: a near miss first seen under a tight limit is found once the limit is raised', async () => {
    const live = makeCharacter('limit-first', [['pic', 'assets/a.png', 'png']])

    DBState.db.assetMaxDifference = 0
    expect(await warmAndCold(live, 'pix')).toBeNull()
    DBState.db.assetMaxDifference = 5
    expect(await warmAndCold(live, 'pix')).toBe('/served/assets/a.png')
    DBState.db.assetMaxDifference = 0
    expect(await warmAndCold(live, 'pix')).toBeNull()
  })

  test('guard: the same missed name on two characters is answered from each own assets', async () => {
    const one = makeCharacter('one', [['pic', 'assets/one.png', 'png']])
    const two = makeCharacter('two', [['pit', 'assets/two.png', 'png']])

    expect(await srcOf(one, 'pix')).toBe('/served/assets/one.png')
    expect(await srcOf(two, 'pix')).toBe('/served/assets/two.png')
    expect(await srcOf(one, 'pix')).toBe('/served/assets/one.png')
  })

  test('diagnostic: a repeated near miss skips the scan until a name changes', async () => {
    const assets = [['pic', 'assets/a.png', 'png']]
    const live = makeCharacter('scan', assets)

    const before = closestMatchScanCountForTests()
    await srcOf(live, 'pix')
    expect(closestMatchScanCountForTests()).toBe(before + 1)
    await srcOf(live, 'pix')
    expect(closestMatchScanCountForTests()).toBe(before + 1)

    assets[0][0] = 'pit'
    await srcOf(live, 'pix')
    expect(closestMatchScanCountForTests()).toBe(before + 2)
  })
})
