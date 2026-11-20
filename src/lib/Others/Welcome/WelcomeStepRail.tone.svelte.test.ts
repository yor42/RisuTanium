// @vitest-environment happy-dom

/**
 * The Welcome step rail's mark follows the scheme type: on a light canvas it is light-toned.
 *
 * MOCKED: the database module, preset templates, the persona picker, the character image lookup and the
 * restore entries, as in the Welcome steps tests, so the real `WelcomeFlow` builds without IO. The colour
 * scheme module is real except `updateTextThemeAndCSS`; the scheme type store is the real one. The tone
 * store module is not mocked.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    setPreset: vi.fn((db: unknown) => db),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    getFileSrc: vi.fn(async (loc: string) => loc),
    checkCharOrder: vi.fn(),
    requiresFullEncoderReload: { state: false },
    AppendableBuffer: class {},
    VirtualWriter: class {},
    LocalWriter: class {},
    BlankWriter: class {},
    downloadFile: vi.fn(),
    openURL: vi.fn(),
    loadAsset: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
    globalFetch: vi.fn(),
    aiWatermarkingLawApplies: vi.fn(() => false),
    changeChatTo: vi.fn(),
    hubURL: '',
    usingSw: false,
    getFetchLogs: vi.fn(() => []),
    getFetchData: vi.fn(() => ({})),
    aiLawApplies: vi.fn(() => false),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/templates/templates'), () => ({
    prebuiltPresets: {},
}) as unknown as typeof import('src/ts/process/templates/templates'))

vi.mock(import('src/ts/gui/colorscheme'), async (importOriginal) => ({
    ...(await importOriginal()),
    updateTextThemeAndCSS: vi.fn(),
}))

vi.mock(import('src/ts/persona'), () => ({
    selectUserImg: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/persona'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/drive/settingsRestore'), () => ({
    restoreFromBinFileAtFirstRun: vi.fn(async () => {}),
    restoreFromBinFile: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/drive/settingsRestore'))

import { ColorSchemeTypeStore } from 'src/ts/gui/colorscheme'
import WelcomeStepRail from './WelcomeStepRail.svelte'
import { WelcomeFlow } from './welcomeFlow.svelte'

let mounted: ReturnType<typeof mount> | undefined
let target: HTMLElement

beforeEach(() => {
    ColorSchemeTypeStore.set('dark')
    target = document.createElement('div')
    document.body.appendChild(target)
})

afterEach(() => {
    if (mounted) unmount(mounted)
    mounted = undefined
    target.remove()
    ColorSchemeTypeStore.set('dark')
})

function mountRail(): void {
    mounted = mount(WelcomeStepRail, { target, props: { flow: new WelcomeFlow('en-US') } })
    flushSync()
}

describe('TB14: the Welcome rail mark tone', () => {
    test('under a dark scheme the mark keeps the default dark tone', () => {
        mountRail()
        expect(target.querySelector('[data-tone]')).toBeNull()
    })

    test('under a light scheme the mark is light-toned', () => {
        ColorSchemeTypeStore.set('light')
        mountRail()
        expect(target.querySelector('[data-tone="light"]')).not.toBeNull()
    })

    test('the tone follows a scheme change while the rail stays mounted', () => {
        mountRail()
        expect(target.querySelector('[data-tone]')).toBeNull()
        ColorSchemeTypeStore.set('light')
        flushSync()
        expect(target.querySelector('[data-tone="light"]')).not.toBeNull()
    })
})
