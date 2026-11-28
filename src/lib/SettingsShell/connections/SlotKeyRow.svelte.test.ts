// @vitest-environment jsdom

/**
 * #892: the DeepL and DeepL X key rows of the language settings are data-driven rows that render a label over the
 * masked key field. Regression reproducer: before the fix they were text rows that bound the saved key to an input.
 * Synthetic keys only.
 */
import 'src/ts/polyfill'
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../../ts/storage/database.svelte'

vi.mock(import('../../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        additionalSettingsMenu: [],
        easyPanelStore: { open: false },
        MobileGUI: writable(false),
        SettingsMenuIndex: writable(-1),
        settingsOpen: writable(false),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../../ts/stores.svelte')
})
vi.mock('../../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

import { language } from '../../../lang'
import { DBState } from '../../../ts/stores.svelte'
import SlotKeyRow from './SlotKeyRow.svelte'

const KEY = 'SYN-deepl-key-abcdef-3333'
const mounted: Array<ReturnType<typeof mount>> = []

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

afterEach(() => {
    while (mounted.length > 0) void unmount(mounted.pop()!)
    document.body.innerHTML = ''
})

describe('SlotKeyRow', () => {
    test.each([
        { keySlot: 'deeplOptions.key', labelKey: 'deeplKey', provider: 'deepl' },
        { keySlot: 'deeplXOptions.token', labelKey: 'deeplXToken', provider: 'deeplx' },
    ] as const)('$keySlot shows its label and a chip, and the saved key is in no field', async ({ keySlot, labelKey, provider }) => {
        DBState.db = { connections: [{ id: 'conn-1', name: 'D', provider, key: KEY }], botPresets: [], customModels: [] } as unknown as Database
        mounted.push(mount(SlotKeyRow, { target: document.body, props: { keySlot, labelKey } }))
        await settle()
        expect(document.body.textContent).toContain(language[labelKey])
        expect(document.querySelector('[data-slot-key="chip"]')).not.toBeNull()
        expect(document.querySelector('input')).toBeNull()
        expect(document.body.innerHTML).not.toContain(KEY)
        expect(document.body.innerHTML).not.toContain('deepl-key')
    })
})
