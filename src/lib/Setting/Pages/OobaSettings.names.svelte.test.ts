// @vitest-environment jsdom

/**
 * `OobaSettings.svelte` custom stop words: the add and remove buttons are named with their glyphs
 * hidden, each stop-word field is named by the stop-words label, and the hovers use scheme tokens.
 * Mounts the REAL page over a real `$state` database with the real shared inputs; the optional-value
 * input (its inner checkbox belongs to the number/select/slider ticket) and the chat format panel
 * are stubs.
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

vi.mock('src/lib/UI/GUI/OptionalInput.svelte', () => ({ default: () => {} }))
vi.mock('./ChatFormatSettings.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { controlDescription, controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import OobaSettings from './OobaSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(): HTMLElement {
    DBState.db = {
        reverseProxyOobaArgs: { mode: 'instruct' },
        localStopStrings: ['stop one', 'stop two'],
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OobaSettings, { target, props: { instructionMode: true } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    const header = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes('Ooba'))!
    header.click()
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

describe('OobaSettings accessible names', () => {
    test('regression reproducer: the add and remove buttons are named and their glyphs hidden', () => {
        const target = render()
        const buttons = Array.from(target.querySelectorAll('div.flex.flex-col.p-2 button'))
        expect(buttons.map(controlName)).toEqual([language.add, language.remove, language.remove])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: each stop-word field is named by the stop-words label', () => {
        const target = render()
        expect(unnamedControls(target, { fields: true })).toEqual([])
        const fields = Array.from(target.querySelectorAll<HTMLElement>('input[type="text"]'))
        expect(fields).toHaveLength(2)
        for (const field of fields) {
            expect(controlName(field)).toBe(language.customStopWords)
            expect(controlDescription(field).startsWith(language.customStopWords)).toBe(true)
        }
    })

    test('regression reproducer: the hovers use scheme tokens', () => {
        const target = render()
        expect(paletteClasses(target)).toEqual([])
    })
})
