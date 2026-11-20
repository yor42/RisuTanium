// @vitest-environment jsdom

/**
 * Mutant-kill guard (passes on the base, where `setDatabase` refilled the quotes): a saved Custom
 * text theme without the quote keys goes through the real `setDatabase`, and the real
 * `CustomTextThemeEditor` with the real `ColorInput` must mount over the result. `ColorInput`
 * declares `value = $bindable('#000000')`, which throws on an `undefined` binding, so `setDatabase`
 * has to store `null` for an absent quote rather than leave the key absent.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/gui/colorscheme'), async (importOriginal) => ({
    ...(await importOriginal()),
    updateTextThemeAndCSS: vi.fn(),
}))

import { setDatabase } from 'src/ts/storage/database.svelte'
import CustomTextThemeEditor from './CustomTextThemeEditor.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('CustomTextThemeEditor over a save without quote keys', () => {
    test('EG-1: mounts after setDatabase and renders all six pickers', () => {
        setDatabase({
            characters: [],
            botPresets: [],
            botPresetsId: -1,
            personas: [],
            selectedPersona: 0,
            enabledModules: [],
            globalChatVariables: {},
            textTheme: 'custom',
            customTextTheme: {
                FontColorStandard: '#111111',
                FontColorItalic: '#222222',
                FontColorBold: '#333333',
                FontColorItalicBold: '#444444',
            },
        } as unknown as Database)

        const target = document.createElement('div')
        document.body.appendChild(target)
        expect(() => {
            const app = mount(CustomTextThemeEditor, { target, props: {} }) as unknown as Record<string, unknown>
            mounted.push({ target, app })
            flushSync()
        }).not.toThrow()
        expect(target.querySelectorAll('div.flex.items-center.mt-2').length).toBe(6)
    })
})
