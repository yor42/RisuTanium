// @vitest-environment jsdom

/**
 * `ModelList.svelte` picker: the back button (title-only before) has an accessible name, its glyph is
 * hidden and the Horde rows use scheme tokens. The scrim stays `bg-black/50` (E2). Mounts the REAL
 * component with the mocks of `ModelList.status.svelte.test.ts`; the Horde fetch returns one model so
 * the Horde rows are rendered.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: () => ({}),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/horde/getModels'), () => ({
    getHordeModels: vi.fn(async () => [{ name: 'horde-model', performance: 1.5 }]),
}) as unknown as typeof import('src/ts/horde/getModels'))

vi.mock(import('src/ts/model/modelData/modelDataStore'), () => ({
    startModelData: vi.fn(),
    refreshModelDataNow: vi.fn(),
}) as unknown as typeof import('src/ts/model/modelData/modelDataStore'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    customProviderStore: writable([]),
    pluginV2: { providerOptions: new Map(), providers: new Map() },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/plugins/apiV3/v3.svelte'), () => ({
    customV3ProviderMetaStore: [],
}) as unknown as typeof import('src/ts/plugins/apiV3/v3.svelte'))

import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import ModelList from './ModelList.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function openPicker(): Promise<HTMLElement> {
    DBState.db = { customModels: [] } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModelList, { target, props: { value: '' } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    ;(target.querySelector(':scope > button') as HTMLButtonElement).click()
    flushSync()
    const horde = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Horde')
    horde?.click()
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 10))
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('ModelList accessible names and colours', () => {
    test('regression reproducer: the back button is named Back and its glyph is hidden', async () => {
        const target = await openPicker()
        const back = target.querySelector('button.shrink-0') as HTMLButtonElement
        expect(controlName(back)).toBe(language.settingsPage.back)
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the Horde rows and the rest use scheme tokens, only the scrim keeps a palette class', async () => {
        const target = await openPicker()
        expect(target.textContent).toContain('horde-model')
        expect(paletteClasses(target, { allow: [/^bg-black\/50$/] })).toEqual([])
    })
})
