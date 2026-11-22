// @vitest-environment jsdom

/**
 * T15: the stored key never reaches the DOM beyond a four-character tail or a whole `${NAME}`
 * reference. New surface, so a guard; falsified by M-DOM (a key field bound to the stored key).
 * Synthetic keys only. MOCKED: as the sibling page test (real `$state` DBState, toast host).
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

import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { needsKey } from '../../ts/connections/connectionEditor'
import { setSettingsSubLevel } from '../../ts/settingsShell/settingsNavigation'
import { DBState } from '../../ts/stores.svelte'
import Page from './ConnectionsShellPage.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

const KEYS = {
    openai: 'sk-SYNTH-openai-aaaa1234',
    rotation: 'sk-SYNTH-rot-first-bbbb5678\nsk-SYNTH-rot-second-cccc9012',
    pem: '-----BEGIN PRIVATE KEY-----\nSYNTHPEMBODYLINE\n-----END PRIVATE KEY-----',
    short: 'tiny-ky',
    proxy: 'sk-SYNTH-proxy-dddd3456',
}
const ENV_REF = '${SYNTH_ENV_KEY}'

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function fieldValues(): string[] {
    return Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')).map((el) => el.value)
}

function attributeText(): string {
    return Array.from(document.querySelectorAll('*')).flatMap((el) => Array.from(el.attributes).map((attr) => attr.value)).join('\n')
}

function expectNoRawKey(): void {
    const html = document.body.innerHTML
    const everything = html + '\n' + fieldValues().join('\n') + '\n' + attributeText()
    for (const key of [KEYS.openai, KEYS.proxy, KEYS.pem, KEYS.short, ...KEYS.rotation.split('\n')]) {
        expect(everything).not.toContain(key)
    }
    expect(everything).not.toContain('SYNTHPEMBODYLINE')
    expect(everything).not.toContain('SYNTH-rot')
    expect(everything).not.toContain('SYNTH-openai')
}

beforeEach(() => {
    needsKey.clear()
    resetBackHandlersForTests()
    DBState.db = {
        connections: [
            { id: 'conn-1', name: 'OpenAI', provider: 'openai', key: KEYS.openai },
            { id: 'conn-2', name: 'Rotating', provider: 'mistral', key: KEYS.rotation },
            { id: 'conn-3', name: 'Vertex AI', provider: 'vertex', key: KEYS.pem },
            { id: 'conn-4', name: 'Short', provider: 'cohere', key: KEYS.short },
            { id: 'conn-5', name: 'Proxy', provider: 'reverse_proxy', key: KEYS.proxy, url: 'https://p.invalid' },
            { id: 'conn-6', name: 'Env', provider: 'anthropic', key: ENV_REF },
        ],
        proxyConnectionId: 'conn-5',
        botPresets: [],
        customModels: [],
    } as unknown as Database
})

afterEach(async () => {
    for (const app of mounted.splice(0)) {
        await unmount(app)
    }
    document.body.innerHTML = ''
    setSettingsSubLevel(null)
    resetBackHandlersForTests()
})

function mountPage(): void {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(Page, { target }))
    flushSync()
}

describe('T15 no key in the DOM', () => {
    test('the list shows tails, counts and a whole reference only', () => {
        mountPage()
        expectNoRawKey()
        const text = document.body.textContent ?? ''
        expect(text).toContain('•••• 1234')
        expect(text).toContain('•••• 5678')
        expect(text).toContain('2 keys')
        expect(text).toContain(ENV_REF)
        const chips = Array.from(document.querySelectorAll('[data-part="settings-connection-chip"]')).map((el) => el.textContent?.trim())
        expect(chips).toContain('••••')
    })

    test.each(['conn-1', 'conn-2', 'conn-3', 'conn-4', 'conn-5', 'conn-6'])('the detail of %s and its Replace field hold no key', async (id) => {
        mountPage()
        document.querySelector<HTMLElement>(`[data-connection-open="${id}"]`)!.click()
        await settle()
        expectNoRawKey()
        document.querySelector<HTMLElement>('[data-part="settings-connection-key-replace"]')!.click()
        await settle()
        const fields = Array.from(document.querySelectorAll<HTMLInputElement>('[data-part="settings-connection-key-input"] input'))
        expect(fields.length).toBeGreaterThan(0)
        // A CSS-masked textarea would carry no password semantics; every key field is a real password input.
        expect(document.querySelectorAll('textarea').length).toBe(0)
        for (const field of fields) {
            expect(field.type).toBe('password')
            expect(field.value).toBe('')
            expect(field.getAttribute('autocomplete')).toBe('new-password')
            // The Vertex PEM matches its legacy TextInput, which sets no spellcheck attribute.
            if (id !== 'conn-3') expect(field.getAttribute('spellcheck')).toBe('false')
        }
        expectNoRawKey()
    })

    test('the add flow key field is an empty password input for every offered provider', async () => {
        for (const provider of ['google', 'reverse_proxy', 'ollama']) {
            mountPage()
            document.querySelector<HTMLElement>('[data-part="settings-connection-add-open"]')!.click()
            await settle()
            document.querySelector<HTMLElement>(`[data-connection-provider="${provider}"]`)!.click()
            await settle()
            expect(document.querySelectorAll('textarea').length).toBe(0)
            const field = document.querySelector<HTMLInputElement>('[data-part="settings-connection-key-input"] input')!
            expect(field.type).toBe('password')
            expect(field.value).toBe('')
            await unmount(mounted.pop()!)
            document.body.innerHTML = ''
        }
    })

    test('the Remove and Delete dialogs hold no key', async () => {
        mountPage()
        document.querySelector<HTMLElement>('[data-connection-open="conn-1"]')!.click()
        await settle()
        document.querySelector<HTMLElement>('[data-part="settings-connection-key-clear"]')!.click()
        await settle()
        expectNoRawKey()
        document.querySelector<HTMLElement>('[data-part="pattern-warn-cancel"]')!.click()
        await settle()
        document.querySelector<HTMLElement>('[data-part="settings-connection-delete"]')!.click()
        await settle()
        expectNoRawKey()
    })
})
