// @vitest-environment jsdom

/**
 * #884: the custom-model key field shows a masked chip and never the saved key. Regression
 * reproducer: before the fix the Advanced editor bound a field to the stored key, so the key
 * reached an input value. Synthetic keys only. MOCKED: real `$state` DBState as the sibling tests.
 */
import 'src/ts/polyfill'
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
vi.mock('../../Nexus/pattern/patternWarning', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../Nexus/pattern/patternWarning')>()),
    armDelayMs: () => 0,
}))

import { DBState } from '../../../ts/stores.svelte'
import SlotKeyField from './SlotKeyField.svelte'

const KEY = 'sk-SYNTH-custom-aaaa1234'
const mounted: Array<ReturnType<typeof mount>> = []

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function everything(): string {
    const values = Array.from(document.querySelectorAll<HTMLInputElement>('input, textarea')).map((el) => el.value)
    const attrs = Array.from(document.querySelectorAll('*')).flatMap((el) => Array.from(el.attributes).map((attr) => attr.value))
    return [document.body.innerHTML, ...values, ...attrs].join('\n')
}

function mountField(): void {
    document.body.innerHTML = '<span id="lbl">Key</span>'
    mounted.push(mount(SlotKeyField, { target: document.body, props: { keySlot: 'customModels:xcustom:::m1', labelId: 'lbl' } }))
}

function button(part: string): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(`[data-part="settings-slot-key-${part}"]`)
}

beforeEach(() => {
    DBState.db = {
        connections: [{ id: 'conn-1', name: 'My custom', provider: 'custom', key: KEY, url: 'https://c.invalid' }],
        botPresets: [],
        customModels: [{ id: 'xcustom:::m1', name: 'M1', internalId: 'm', connectionId: 'conn-1', tokenizer: 0, format: 0, params: '', flags: [] }],
    } as unknown as Database
})

afterEach(() => {
    while (mounted.length > 0) void unmount(mounted.pop()!)
    document.body.innerHTML = ''
})

describe('SlotKeyField', () => {
    test('shows a last-four chip and no field holds the saved key', async () => {
        mountField()
        await settle()
        expect(document.querySelector('[data-part="settings-slot-key-chip"]')?.textContent).toContain('1234')
        expect(document.querySelector('input')).toBeNull()
        expect(everything()).not.toContain(KEY)
        expect(everything()).not.toContain('SYNTH-custom')
    })

    test('Replace key opens an empty masked field; Cancel drops it', async () => {
        mountField()
        await settle()
        button('replace')!.click()
        await settle()
        const input = document.querySelector<HTMLInputElement>('input')!
        expect(input.type).toBe('password')
        expect(input.value).toBe('')
        expect(everything()).not.toContain(KEY)
        const cancel = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel')
        cancel!.click()
        await settle()
        expect(document.querySelector('input')).toBeNull()
    })

    test('Remove key asks first, then blanks the key', async () => {
        mountField()
        await settle()
        button('remove')!.click()
        await settle()
        expect(DBState.db.connections[0].key).toBe(KEY)
        const confirm = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Remove key' && b !== button('remove'))
        expect(confirm).toBeDefined()
        confirm!.click()
        await settle()
        expect(DBState.db.connections[0].key).toBe('')
        expect(button('remove')).toBeNull()
    })
    test('Remove key on a connection another model uses leaves that model its key', async () => {
        DBState.db.customModels.push({ id: 'xcustom:::m2', name: 'M2', internalId: 'm', connectionId: 'conn-1', tokenizer: 0, format: 0, params: '', flags: [] } as never)
        mountField()
        await settle()
        button('remove')!.click()
        await settle()
        Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Remove key' && b !== button('remove'))!.click()
        await settle()
        expect(DBState.db.connections.find((c) => c.id === 'conn-1')?.key).toBe(KEY)
        expect(DBState.db.customModels[1].connectionId).toBe('conn-1')
        expect(DBState.db.customModels[0].connectionId).not.toBe('conn-1')
    })
})
