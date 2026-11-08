// @vitest-environment jsdom

/**
 * After Delete in the custom sidebar dialog, focus moves to a neighbouring Delete (the same index, else the
 * previous one) or to Add Item, so it never falls back to the page when the focused row goes away.
 *
 * Mounts the REAL dialog over a `$state` stand-in for `DBState`; this file imports no toast module, so the
 * undo toast the Delete posts is never rendered. MOCKED: the settings data files `utils` imports (emptied).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        customSideBarConfigDialogStore: { open: true },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/setting/accessibilitySettingsData'), () => ({
    accessibilitySettingsItems: [],
}) as unknown as typeof import('src/ts/setting/accessibilitySettingsData'))
vi.mock(import('src/ts/setting/advancedSettingsData'), () => ({
    advancedSettingsItems: [],
}) as unknown as typeof import('src/ts/setting/advancedSettingsData'))
vi.mock(import('src/ts/setting/botSettingsParamsData'), () => ({
    basicParameterItems: [],
    modelSpecificParameterItems: [],
    penaltyParameterItems: [],
    samplingParameterItems: [],
    seedSetting: [],
}) as unknown as typeof import('src/ts/setting/botSettingsParamsData'))
vi.mock(import('src/ts/setting/chatFormatSettingsData'), () => ({
    chatFormatSettingsItems: [],
}) as unknown as typeof import('src/ts/setting/chatFormatSettingsData'))
vi.mock(import('src/ts/setting/displaySettingsData.svelte'), () => ({
    displaySettingsItems: [],
}) as unknown as typeof import('src/ts/setting/displaySettingsData.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import CustomSidebarConfig from './CustomSidebarConfig.svelte'

let target: HTMLElement
let app: Record<string, unknown>

function rowButtons(): HTMLButtonElement[] {
    return Array.from(target.querySelectorAll('button')).filter((b) => b.textContent?.trim() === language.uiCommon.delete)
}

function addItemButton(): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.othersUi.addItem)
    if (!found) throw new Error('no Add Item button')
    return found
}

async function deleteRow(index: number): Promise<void> {
    const button = rowButtons()[index]
    button.focus()
    button.click()
    flushSync()
    await tick()
    await Promise.resolve()
    flushSync()
}

function seed(count: number): void {
    DBState.db = {
        customSidebarItems: Array.from({ length: count }, (_, i) => ({ id: 'id' + i, type: 'model' as const, subType: 'none', label: 'Row ' + i })),
    } as unknown as Database
}

beforeEach(() => {
    vi.useFakeTimers()
    target = document.createElement('div')
    document.body.appendChild(target)
})

afterEach(async () => {
    await unmount(app as never)
    target.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
})

function mountDialog(): void {
    app = mount(CustomSidebarConfig, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
}

describe('focus after deleting a custom sidebar row', () => {
    test('regression reproducer: deleting the last of two rows focuses the first row Delete', async () => {
        seed(2)
        mountDialog()
        const first = rowButtons()[0]

        await deleteRow(1)

        expect(rowButtons()).toHaveLength(1)
        expect(document.activeElement).toBe(first)
    })

    test('regression reproducer: deleting the only row focuses Add Item, whose wrapper carries the data attribute', async () => {
        seed(1)
        mountDialog()

        await deleteRow(0)

        expect(document.activeElement).toBe(addItemButton())
        expect(document.querySelector('[data-sidebar-item-add] button')).toBe(addItemButton())
    })

    test('deleting the middle of three rows focuses the Delete now at that index', async () => {
        seed(3)
        mountDialog()

        await deleteRow(1)

        const rows = rowButtons()
        expect(rows).toHaveLength(2)
        expect(document.activeElement).toBe(rows[1])
        expect(DBState.db.customSidebarItems.map((item) => item.id)).toEqual(['id0', 'id2'])
    })

    test('deleting the first of three rows focuses the Delete now at index 0', async () => {
        seed(3)
        mountDialog()

        await deleteRow(0)

        expect(document.activeElement).toBe(rowButtons()[0])
    })
})
