// @vitest-environment jsdom

/**
 * Custom-model rows of the model picker carry a Custom tag and the name of their connection; no host is called.
 */
import 'src/ts/polyfill'
import { writable } from 'svelte/store'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        additionalSettingsMenu: [],
        MobileGUI: writable(false),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../ts/stores.svelte')
})
vi.mock('../../ts/horde/getModels', () => ({ getHordeModels: async () => [] }))
vi.mock('../../ts/alert', () => ({ alertConfirm: vi.fn(async () => true) }))

import { language } from '../../lang'
import { DBState } from '../../ts/stores.svelte'
import ModelList from './ModelList.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

beforeEach(() => {
    DBState.db = {
        connections: [{ id: 'c-custom', name: 'Local', provider: 'custom', key: 'sk-test-AAAA1234', url: 'https://l.invalid/v1' }],
        customModels: [
            { id: 'xcustom:::1', internalId: 'm1', name: 'First', format: 0, tokenizer: 0, params: '', flags: [], connectionId: 'c-custom' },
            { id: 'xcustom:::2', internalId: 'm2', name: 'Loose', format: 0, tokenizer: 0, params: '', flags: [] },
        ],
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(ModelList, { target, props: { value: '' } }))
    flushSync()
})

afterEach(() => {
    for (const instance of mounted.splice(0)) void unmount(instance)
    document.body.innerHTML = ''
})

async function openCustomRows(): Promise<HTMLElement[]> {
    document.querySelector<HTMLButtonElement>('button')!.click()
    flushSync()
    await tick()
    const header = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((el) => el.textContent?.trim() === language.customModels)
    header!.click()
    for (let round = 0; round < 4; round++) {
        flushSync()
        await tick()
    }
    return Array.from(document.querySelectorAll<HTMLElement>('[data-part="modal-row"]')).filter((row) => row.querySelector('[data-testid="modal-custom-tag"]'))
}

test('a custom model row shows the Custom tag and its connection name', async () => {
    const rows = await openCustomRows()
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('[data-testid="modal-custom-tag"]')!.textContent).toBe(language.customModelTag)
    expect(rows[0].querySelector('[data-testid="modal-custom-connection"]')!.textContent).toBe('Local')
})

test('a custom model naming no connection omits the connection name', async () => {
    const rows = await openCustomRows()
    expect(rows[1].querySelector('[data-testid="modal-custom-connection"]')).toBeNull()
    expect(rows[1].querySelector('[data-testid="modal-custom-tag"]')).not.toBeNull()
})
