// @vitest-environment jsdom

/**
 * Test action and custom models on a connection detail (#539). The test request is a mock: no host is called.
 */
import 'src/ts/polyfill'
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

vi.mock(import('../../ts/stores.svelte'), () => {
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
    } as unknown as typeof import('../../ts/stores.svelte')
})
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/toast/toastHost.svelte', () => ({ postToast: vi.fn(), postUndoToast: vi.fn() }))
const h = vi.hoisted(() => ({ calls: [] as string[], status: 200, gate: null as Promise<void> | null }))
vi.mock('../../ts/connections/connectionTest', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../ts/connections/connectionTest')>()),
    appTestFetcher: async (url: string) => {
        h.calls.push(url)
        if (h.gate) await h.gate
        return { status: h.status, data: { data: [{}, {}] } }
    },
}))

import { language } from '../../lang'
import { DBState } from '../../ts/stores.svelte'
import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { setSettingsSubLevel } from '../../ts/settingsShell/settingsNavigation'
import Page from './ConnectionsShellPage.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

async function settle(): Promise<void> {
    for (let round = 0; round < 6; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function part(name: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(`[data-part="${name}"]`)
    if (!found) throw new Error(`no part ${name}`)
    return found
}

beforeEach(() => {
    h.calls = []
    h.status = 200
    h.gate = null
    DBState.db = {
        connections: [
            { id: 'c-custom', name: 'Local', provider: 'custom', key: 'sk-test-AAAA1234', url: 'https://l.invalid/v1' },
            { id: 'c-ok', name: 'OpenAI', provider: 'openai', key: 'sk-test-BBBB5678' },
            { id: 'c-nai', name: 'NovelAI', provider: 'novelai', key: 'tok' },
        ],
        proxyConnectionId: '',
        botPresets: [],
        customModels: [
            { id: 'xcustom:::1', internalId: 'm1', name: 'First', format: 0, tokenizer: 0, params: '', flags: [], connectionId: 'c-custom' },
            { id: 'xcustom:::2', internalId: 'm2', name: 'Elsewhere', format: 0, tokenizer: 0, params: '', flags: [], connectionId: 'c-other' },
        ],
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(Page, { target }))
    flushSync()
})

afterEach(() => {
    for (const instance of mounted.splice(0)) void unmount(instance)
    document.body.innerHTML = ''
    setSettingsSubLevel(null)
    resetBackHandlersForTests()
})

async function openDetail(id: string): Promise<void> {
    document.querySelector<HTMLButtonElement>(`[data-connection-open="${id}"]`)!.click()
    await settle()
}

describe('connection test', () => {
    test('nothing is requested until Test is pressed, then the result shows the model count', async () => {
        await openDetail('c-ok')
        expect(h.calls).toEqual([])
        part('settings-connection-test-run').click()
        await settle()
        expect(h.calls).toEqual(['https://api.openai.com/v1/models'])
        expect(part('settings-connection-test-result').textContent).toContain('2')
    })

    test('a refused key is reported as such', async () => {
        h.status = 401
        await openDetail('c-ok')
        part('settings-connection-test-run').click()
        await settle()
        expect(part('settings-connection-test-result').textContent).toBe(language.connectionsTestBadKey)
    })

    test('a provider without a list endpoint has Test disabled and makes no request', async () => {
        await openDetail('c-nai')
        const run = part('settings-connection-test-run') as HTMLButtonElement
        expect(run.disabled).toBe(true)
        run.click()
        await settle()
        expect(h.calls).toEqual([])
    })
})

describe('a test that is running', () => {
    function hold(): () => void {
        let release = (): void => {}
        h.gate = new Promise<void>((resolve) => { release = resolve })
        return release
    }

    test('Cancel drops the request and shows no result', async () => {
        const release = hold()
        await openDetail('c-ok')
        part('settings-connection-test-run').click()
        await settle()
        part('settings-connection-test-cancel').click()
        release()
        await settle()
        expect(document.querySelector('[data-part="settings-connection-test-result"]')).toBeNull()
        expect(document.querySelector('[data-part="settings-connection-test-run"]')).not.toBeNull()
    })

    test('a URL change mid-test discards the old result', async () => {
        const release = hold()
        await openDetail('c-custom')
        part('settings-connection-test-run').click()
        await settle()
        DBState.db.connections![0].url = 'https://other.invalid/v1'
        await settle()
        release()
        await settle()
        expect(document.querySelector('[data-part="settings-connection-test-result"]')).toBeNull()
    })

    test('clearing the key mid-test discards the old result', async () => {
        const release = hold()
        await openDetail('c-ok')
        part('settings-connection-test-run').click()
        await settle()
        DBState.db.connections![1].key = ''
        await settle()
        release()
        await settle()
        expect(document.querySelector('[data-part="settings-connection-test-result"]')).toBeNull()
    })
})

describe('custom models under a connection', () => {
    test('a custom connection lists its own models only', async () => {
        await openDetail('c-custom')
        const rows = document.querySelectorAll('[data-part="settings-connection-model"]')
        expect(rows).toHaveLength(1)
        expect((rows[0].querySelector('input') as HTMLInputElement).value).toBe('First')
    })

    test('a non-custom connection shows no model section', async () => {
        await openDetail('c-ok')
        expect(document.querySelector('[data-part="settings-connection-models"]')).toBeNull()
    })

    test('Add model stores a model that names the connection; remove deletes only it', async () => {
        await openDetail('c-custom')
        part('settings-connection-model-add').click()
        await settle()
        const db = DBState.db
        expect(db.customModels).toHaveLength(3)
        expect(db.customModels[2].connectionId).toBe('c-custom')
        expect(document.querySelectorAll('[data-part="settings-connection-model"]')).toHaveLength(2)
        document.querySelector<HTMLButtonElement>('[data-part="settings-connection-model-remove"]')!.click()
        await settle()
        expect(db.customModels).toHaveLength(2)
        expect(db.customModels.some((model) => model.id === 'xcustom:::2')).toBe(true)
        expect(db.customModels.some((model) => model.id === 'xcustom:::1')).toBe(false)
    })

    test('editing the name writes it to the model', async () => {
        await openDetail('c-custom')
        const input = document.querySelector<HTMLInputElement>('[data-part="settings-connection-model"] input')!
        input.value = 'Renamed'
        input.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        expect(DBState.db.customModels[0].name).toBe('Renamed')
    })
})
