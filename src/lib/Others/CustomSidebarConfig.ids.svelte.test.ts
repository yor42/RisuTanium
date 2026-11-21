// @vitest-environment jsdom

/**
 * Every Add button of the custom sidebar dialog stores an item with a v4 id and the matching type, on a plain-HTTP
 * origin where `crypto.randomUUID` does not exist (U3 regression reproducers, one per id site: model, preset, loadout,
 * persona and setting). `uuid` captures the native function when it is first evaluated, so these prove the buttons no
 * longer call `crypto.randomUUID`; they do not prove the library's own `getRandomValues` fallback.
 *
 * REAL: the dialog and its buttons. MOCKED: `DBState` (a `$state` object) and the settings catalogue.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const dialog = $state({ open: true })
    return {
        DBState: state,
        customSideBarConfigDialogStore: dialog,
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/setting/utils', () => ({
    getFullSettingsData: () => [{ id: 'sample-setting' }],
    getLabel: () => 'Sample setting',
}))

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import CustomSidebarConfig from './CustomSidebarConfig.svelte'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const mounted: Array<{ instance: object, target: HTMLElement }> = []

function open(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(CustomSidebarConfig, { target, props: {} })
    mounted.push({ instance, target })
    flushSync()
    return target
}

function buttonWithText(root: HTMLElement, text: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll('button')).find((button) => button.textContent?.trim() === text)
    if (!found) {
        throw new Error(`no button "${text}"`)
    }
    return found
}

function press(root: HTMLElement, text: string) {
    buttonWithText(root, text).click()
    flushSync()
}

function lastItem() {
    const items = DBState.db.customSidebarItems
    return items[items.length - 1]
}

beforeEach(() => {
    DBState.db = { customSidebarItems: [] } as unknown as Database
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
})

afterEach(async () => {
    delete (crypto as { randomUUID?: unknown }).randomUUID
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
})

describe('adding a custom sidebar item without crypto.randomUUID', () => {
    test.each([
        ['model', () => language.model],
        ['preset', () => language.presets],
        ['loadout', () => language.loadouts],
        ['persona', () => language.persona],
    ])('(R) U3: the %s button stores one item with a v4 id', (type, label) => {
        const root = open()
        press(root, language.othersUi.addItem)

        press(root, label())

        expect(DBState.db.customSidebarItems).toHaveLength(1)
        expect(lastItem().type).toBe(type)
        expect(lastItem().id).toMatch(V4)
    })

    test('(R) U3: a settings entry stores one item with a v4 id and its setting id', () => {
        const root = open()
        press(root, language.othersUi.addItem)
        press(root, language.settings)

        press(root, 'Sample setting')

        expect(DBState.db.customSidebarItems).toHaveLength(1)
        expect(lastItem().type).toBe('setting')
        expect(lastItem().subType).toBe('sample-setting')
        expect(lastItem().id).toMatch(V4)
    })

    test('(R) U3: two items added in a row get different ids', () => {
        const root = open()
        press(root, language.othersUi.addItem)
        press(root, language.model)
        press(root, language.othersUi.addItem)
        press(root, language.model)

        const ids = DBState.db.customSidebarItems.map((item) => item.id)
        expect(ids).toHaveLength(2)
        expect(ids[0]).not.toBe(ids[1])
    })
})
