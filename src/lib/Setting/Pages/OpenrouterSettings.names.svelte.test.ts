// @vitest-environment jsdom

/**
 * `OpenrouterSettings.svelte`: the add and remove buttons of the three provider lists are named with
 * their glyphs hidden, the remove buttons use the danger outline tokens instead of a red fill with
 * white text, and the checkboxes are named by their visible text. Mounts the REAL page over a real
 * `$state` database with the real Accordion, Help and CheckInput; the provider picker and the chat
 * format panel are stubs and the provider fetch returns one provider.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = { alertStore: writable({ type: 'none', msg: '' }) }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/model/openrouter'), () => ({
    getOpenRouterProviders: vi.fn(async () => [{ name: 'Alpha', slug: 'alpha' }]),
}) as unknown as typeof import('src/ts/model/openrouter'))

vi.mock('src/lib/UI/OpenrouterProviderList.svelte', () => ({ default: () => {} }))
vi.mock('./ChatFormatSettings.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import OpenrouterSettings from './OpenrouterSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function headerNamed(target: HTMLElement, text: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes(text))
    if (!found) throw new Error('no accordion header ' + text)
    return found
}

async function render(): Promise<HTMLElement> {
    DBState.db = {
        openrouterFallback: false,
        openrouterMiddleOut: false,
        useInstructPrompt: false,
        openrouterProvider: { order: ['a'], only: ['b'], ignore: ['c'] },
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OpenrouterSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    headerNamed(target, 'OpenRouter ' + language.settings).click()
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
    for (const name of [language.openRouterProviderOrder, language.openRouterProviderOnly, language.openRouterProviderIgnore]) {
        headerNamed(target, name).click()
        flushSync()
    }
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('OpenrouterSettings accessible names', () => {
    test('regression reproducer: the order, only and ignore lists name their add and remove buttons', async () => {
        const target = await render()
        const rows = Array.from(target.querySelectorAll('div.flex.gap-2'))
        expect(rows).toHaveLength(3)
        for (const row of rows) {
            expect(Array.from(row.querySelectorAll('button')).map(controlName)).toEqual([language.add, language.remove])
        }
        expect(unnamedControls(target, { fields: true })).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the remove buttons use the danger outline tokens', async () => {
        const target = await render()
        const removes = Array.from(target.querySelectorAll('div.flex.gap-2 > button:last-child'))
        expect(removes).toHaveLength(3)
        for (const button of removes) {
            expect(button.classList.contains('border-draculared')).toBe(true)
            expect(button.classList.contains('text-draculared')).toBe(true)
        }
        expect(paletteClasses(target)).toEqual([])
    })

    test('guard: the three checkboxes keep their visible names (passes before and after)', async () => {
        const target = await render()
        expect(Array.from(target.querySelectorAll('input[type="checkbox"]')).map(controlName)).toEqual([
            language.openRouterFallback,
            language.openRouterMiddleOut,
            language.useInstructPrompt,
        ])
    })
})
