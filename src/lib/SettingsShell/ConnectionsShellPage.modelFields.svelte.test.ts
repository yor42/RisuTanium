// @vitest-environment jsdom

/**
 * The format, tokenizer, additional-params and flag controls of a model on a connection detail write the
 * stored model, and only the one that names this connection.
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

function field<T extends HTMLElement>(selector: string): T {
    const found = document.querySelector<T>(`[data-part="settings-connection-model"] ${selector}`)
    if (!found) throw new Error(`no field ${selector}`)
    return found
}

describe('custom model fields on a connection detail', () => {
    test('the tokenizer select writes the model', async () => {
        await openDetail('c-custom')
        const select = field<HTMLSelectElement>('select[aria-labelledby$="-tokenizer-xcustom:::1"]')
        select.value = '6'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        expect(DBState.db.customModels[0].tokenizer).toBe(6)
        expect(DBState.db.customModels[1].tokenizer).toBe(0)
    })

    test('the format select writes the model', async () => {
        await openDetail('c-custom')
        const select = field<HTMLSelectElement>('select[aria-labelledby$="-format-xcustom:::1"]')
        select.value = '2'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        expect(DBState.db.customModels[0].format).toBe(2)
        expect(DBState.db.customModels[1].format).toBe(0)
    })

    test('the additional params write the model', async () => {
        await openDetail('c-custom')
        const area = field<HTMLTextAreaElement>('textarea')
        area.value = 'temperature=0.7'
        area.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
        expect(DBState.db.customModels[0].params).toBe('temperature=0.7')
        expect(DBState.db.customModels[1].params).toBe('')
    })

    test('a flag button toggles the flag on the model', async () => {
        await openDetail('c-custom')
        const open = Array.from(document.querySelectorAll<HTMLElement>('[data-part="settings-connection-model"] button')).find((button) => button.textContent?.trim() === language.flags)
        open?.click()
        await settle()
        const flag = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-part="settings-connection-model"] button')).find((button) => button.textContent?.trim() === 'hasStreaming')!
        flag().click()
        await settle()
        expect(DBState.db.customModels[0].flags).toEqual([8])
        flag().click()
        await settle()
        expect(DBState.db.customModels[0].flags).toEqual([])
        expect(DBState.db.customModels[1].flags).toEqual([])
    })
})
