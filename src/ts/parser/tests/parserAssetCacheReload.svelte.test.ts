// @vitest-environment jsdom
/**
 * The parser's asset cache after a module install. An install replaces a slot of
 * `DBState.db.modules` in place. A slot write bumps no list version, and the cache effect in
 * `parser.svelte.ts` reads the modules through the `getModules()` memo, so it holds no dependency on that slot and does not re-run; the loader then bumps `ReloadGUIPointer`. The
 * pointer subscriber in the real `stores.svelte.ts` runs the registered GUI reload
 * hooks first, and the parser's hook rebuilds the cache from the selected
 * character, untracked.
 *
 * Every row here uses the real stores module and the real parser. Only
 * `process/modules` (a mutable module asset list and a `moduleUpdate` stub), the
 * module load trigger (`process/moduleEnsure`), the module update dependency
 * tracker (`process/moduleUpdateDeps`), `process/scripts`, `globalApi.svelte`,
 * `platform`, `alert` and the database accessors are stand-ins. Assertions go through the public output of
 * `ParseMarkdown`: the `src` of the `{{asset::name}}` markup.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { flushSync } from 'svelte'
import type { character, groupChat, Database } from '../../storage/database.svelte'

//#region module mocks

const moduleAssetList = vi.hoisted(() => ({ assets: [] as string[][] }))

vi.mock(import('../../process/modules'), () => ({
  getModuleAssets: () => moduleAssetList.assets,
  getModuleLorebooks: () => [],
  getModules: () => [],
  moduleUpdate: vi.fn(),
}) as unknown as typeof import('../../process/modules'))

vi.mock(import('../../process/moduleUpdateDeps'), () => ({
  trackModuleUpdateDeps: vi.fn(),
}) as unknown as typeof import('../../process/moduleUpdateDeps'))

vi.mock(import('../../process/moduleEnsure'), () => ({
  ensureSelectedModules: vi.fn(),
}) as unknown as typeof import('../../process/moduleEnsure'))

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

import { ParseMarkdown, resetAssetsCache } from '../parser.svelte'
import { DBState, ReloadGUIPointer, ReloadChatPointer, selectedCharID } from '../../stores.svelte'
import { resetScriptCache } from '../../process/scripts'

// The hook registry is loaded through a non-literal specifier so that the rows which only use the real stores and
// the parser load and run without it; only the rows that register a hook need the module itself.
const guiReloadHooksSpecifier = '../../guiReloadHooks'

async function loadGuiReloadHooks(): Promise<typeof import('../../guiReloadHooks')> {
  return await import(/* @vite-ignore */ guiReloadHooksSpecifier)
}

let pointerValue = 0

function bumpPointer() {
  pointerValue += 1
  ReloadGUIPointer.set(pointerValue)
}

function makeCharacter(chaId: string, additionalAssets: string[][] = []): character {
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

function makeGroup(chaId: string): groupChat {
  return { chaId, name: chaId, type: 'group', chatPage: 0, chats: [], characters: [] } as unknown as groupChat
}

function seedSelection(characters: (character | groupChat)[], selected: number) {
  DBState.db = { characters, legacyMediaFindings: true, modules: [] } as unknown as Database
  selectedCharID.set(selected)
  flushSync()
}

function characterAt(index: number): character {
  return DBState.db.characters[index] as character
}

async function assetSrcOf(char: character, name: string): Promise<string | null> {
  const html = await ParseMarkdown(`{{asset::${name}}}`, char, 'back')
  const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img')
  return img?.getAttribute('src') ?? null
}

beforeEach(() => {
  moduleAssetList.assets = []
  seedSelection([], -1)
  resetAssetsCache([], [], [])
})

describe('a pointer bump after an install, real stores', () => {
  test('a-pointer-bump-after-an-install-resolves-the-modules-asset-through-the-real-stores', async () => {
    seedSelection([makeCharacter('own-1', [['ownpic', 'assets/own-1.png', 'png']])], 0)
    resetAssetsCache([['ownpic', 'assets/own-1.png', 'png']], [], [])
    expect(await assetSrcOf(characterAt(0), 'modfox')).toBeNull()

    moduleAssetList.assets = [['modfox', 'assets/modfox-1.png', 'png']]
    bumpPointer()

    expect(await assetSrcOf(characterAt(0), 'modfox')).toBe('/served/assets/modfox-1.png')
    expect(await assetSrcOf(characterAt(0), 'ownpic')).toBe('/served/assets/own-1.png')
  })

  test('two-asset-modules-on-one-selected-character-both-resolve-after-two-pointer-bumps', async () => {
    seedSelection([makeCharacter('own-2')], 0)
    resetAssetsCache([], [], [])
    expect(await assetSrcOf(characterAt(0), 'modone')).toBeNull()

    moduleAssetList.assets = [['modone', 'assets/modone-2.png', 'png']]
    bumpPointer()
    expect(await assetSrcOf(characterAt(0), 'modone')).toBe('/served/assets/modone-2.png')

    moduleAssetList.assets = [...moduleAssetList.assets, ['modtwo', 'assets/modtwo-2.png', 'png']]
    bumpPointer()
    expect(await assetSrcOf(characterAt(0), 'modone')).toBe('/served/assets/modone-2.png')
    expect(await assetSrcOf(characterAt(0), 'modtwo')).toBe('/served/assets/modtwo-2.png')
  })

  test('a-bump-while-a-non-selected-character-is-parsed-does-not-change-the-selected-characters-assets', async () => {
    seedSelection([
      makeCharacter('selected-4', [['selpic', 'assets/selpic-4.png', 'png']]),
      makeCharacter('other-4', [['otherpic', 'assets/otherpic-4.png', 'png']]),
    ], 0)
    resetAssetsCache([['selpic', 'assets/selpic-4.png', 'png']], [], [])

    moduleAssetList.assets = [['modfox', 'assets/modfox-4.png', 'png']]
    bumpPointer()

    // The first parse after the bump is for the other character: the cache must still answer the selected
    // character's names, not be refilled from the parsed character.
    expect(await assetSrcOf(characterAt(1), 'selpic')).toBe('/served/assets/selpic-4.png')
    expect(await assetSrcOf(characterAt(1), 'otherpic')).toBeNull()
  })

  test('a-bump-with-a-group-selection-leaves-the-cache-alone', async () => {
    seedSelection([makeGroup('group-5')], 0)
    resetAssetsCache([['keptpic', 'assets/keptpic-5.png', 'png']], [], [])
    moduleAssetList.assets = [['modfox', 'assets/modfox-5.png', 'png']]

    bumpPointer()

    const parsed = makeCharacter('parsed-5')
    expect(await assetSrcOf(parsed, 'keptpic')).toBe('/served/assets/keptpic-5.png')
    expect(await assetSrcOf(parsed, 'modfox')).toBeNull()
  })

  test('a-bump-with-no-selection-is-a-no-op', async () => {
    seedSelection([makeCharacter('own-6')], -1)
    resetAssetsCache([['keptpic', 'assets/keptpic-6.png', 'png']], [], [])
    moduleAssetList.assets = [['modfox', 'assets/modfox-6.png', 'png']]

    bumpPointer()

    const parsed = makeCharacter('parsed-6')
    expect(await assetSrcOf(parsed, 'keptpic')).toBe('/served/assets/keptpic-6.png')
    expect(await assetSrcOf(parsed, 'modfox')).toBeNull()
  })
})

describe('the hooks run by themselves', () => {
  test('an-install-with-a-memo-hit-resolves-the-modules-asset-after-the-hooks-run', async () => {
    const { runGuiReloadHooks } = await loadGuiReloadHooks()
    seedSelection([makeCharacter('own-3')], 0)
    resetAssetsCache([], [], [])
    expect(await assetSrcOf(characterAt(0), 'modfox')).toBeNull()

    moduleAssetList.assets = [['modfox', 'assets/modfox-3.png', 'png']]
    runGuiReloadHooks()

    expect(await assetSrcOf(characterAt(0), 'modfox')).toBe('/served/assets/modfox-3.png')
  })
})

describe('the pointer subscriber and the hook registry, real stores', () => {
  test('ReloadGUIPointer-set-runs-registered-hooks-before-the-chat-reload', async () => {
    const { registerGuiReloadHook } = await loadGuiReloadHooks()
    const order: string[] = []
    const unregister = registerGuiReloadHook(() => { order.push('hook') })
    let chatReloadSeen = false
    const stopChat = ReloadChatPointer.subscribe(() => {
      if (chatReloadSeen) order.push('chat')
      chatReloadSeen = true
    })
    vi.mocked(resetScriptCache).mockImplementation(() => { order.push('script') })

    bumpPointer()

    stopChat()
    unregister()
    vi.mocked(resetScriptCache).mockImplementation(() => {})
    // The chat reload subscriber is delivered after the pointer subscriber returns, so only the hook's
    // position ahead of both is a contract.
    expect(order[0]).toBe('hook')
    expect(order).toContain('chat')
    expect(order).toContain('script')
  })

  test('a-throwing-hook-does-not-stop-the-others-or-the-script-cache-reset', async () => {
    const { registerGuiReloadHook } = await loadGuiReloadHooks()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const later = vi.fn()
    const unregisterThrowing = registerGuiReloadHook(() => { throw new Error('hook failure') })
    const unregisterLater = registerGuiReloadHook(later)
    vi.mocked(resetScriptCache).mockClear()

    bumpPointer()

    unregisterThrowing()
    unregisterLater()
    consoleError.mockRestore()
    expect(later).toHaveBeenCalledTimes(1)
    expect(resetScriptCache).toHaveBeenCalledTimes(1)
  })

  test('the-hook-does-not-subscribe-the-pointer-setting-effect-to-asset-edits', async () => {
    seedSelection([makeCharacter('own-9', [['ownpic', 'assets/own-9.png', 'png']])], 0)
    let runs = 0
    const stop = $effect.root(() => {
      $effect(() => {
        runs += 1
        bumpPointer()
      })
    })
    try {
      flushSync()
      expect(runs).toBe(1)

      // An edit of the selected character's own assets must not re-run an effect that only sets the pointer.
      characterAt(0).additionalAssets.push(['added', 'assets/added-9.png', 'png'])
      flushSync()
      // The mocked list is a plain object, so this assignment is not reactive. The row's teeth come from the additionalAssets edit above.
      moduleAssetList.assets = [['modfox', 'assets/modfox-9.png', 'png']]
      flushSync()

      expect(runs).toBe(1)
    } finally {
      stop()
    }
  })
})
