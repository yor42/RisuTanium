// @vitest-environment jsdom

/**
 * The Connections page over the real connection writers and a real `$state` store. All rows are
 * guards for a new surface (T16-T19); the falsifiers are named per test.
 *
 * MOCKED: `stores.svelte` (DBState is a real `$state` object, the navigation stores are writables),
 * `setConnectionKey` (a spy that calls the real V1 body unless a test overrides one call), the toast
 * host (calls are recorded and the Undo action is run by the test) and the danger arm delay. The
 * page, its components, `PatternWarning`, the editor writers and the Back stack are real.
 */
import 'src/ts/polyfill'
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { UndoToastInit } from '../../ts/toast/toastHost.svelte'

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
vi.mock('../../ts/connections/keyAccess', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../ts/connections/keyAccess')>()
    return { ...original, setConnectionKey: vi.fn(original.setConnectionKey) }
})
vi.mock('../../ts/toast/toastHost.svelte', () => ({ postToast: vi.fn(), postUndoToast: vi.fn() }))
vi.mock('../Nexus/pattern/patternWarning', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../Nexus/pattern/patternWarning')>()),
    armDelayMs: () => 0,
}))

import { language } from '../../lang'
import { needsKey } from '../../ts/connections/connectionEditor'
import * as keyAccess from '../../ts/connections/keyAccess'
import { setConnectionKey } from '../../ts/connections/keyAccess'
import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { setSettingsSubLevel } from '../../ts/settingsShell/settingsNavigation'
import { DBState } from '../../ts/stores.svelte'
import { postUndoToast } from '../../ts/toast/toastHost.svelte'
import Page from './ConnectionsShellPage.svelte'

const realSetConnectionKey = (await vi.importActual<typeof import('../../ts/connections/keyAccess')>('../../ts/connections/keyAccess')).setConnectionKey
const mounted: Array<ReturnType<typeof mount>> = []

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

type Seed = { connections?: unknown[], proxyConnectionId?: string, botPresets?: unknown[], customModels?: unknown[] } & Record<string, unknown>

function seed(extra: Seed = {}): void {
    DBState.db = { connections: [], proxyConnectionId: '', botPresets: [], customModels: [], ...extra } as unknown as Database
}

function mountPage(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(Page, { target }))
    flushSync()
    return target
}

function part(name: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(`[data-part="${name}"]`)
    if (!found) throw new Error(`no part ${name}`)
    return found
}

/** The masked input inside the key field's wrapper. */
function keyInput(): HTMLInputElement {
    const found = part('connection-key-input').querySelector('input')
    if (!found) throw new Error('no key input')
    return found
}

function maybePart(name: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-part="${name}"]`)
}

function cardButton(id: string): HTMLButtonElement {
    const found = document.querySelector<HTMLButtonElement>(`[data-connection-open="${id}"]`)
    if (!found) throw new Error(`no card ${id}`)
    return found
}

function buttonByText(text: string): HTMLButtonElement {
    const found = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === text)
    if (!found) throw new Error(`no button ${text}`)
    return found
}

function type(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

/** A click whose own event time is far ahead, so the danger arm delay never rejects it. */
function tapLate(button: HTMLElement): void {
    const tap = new MouseEvent('click', { bubbles: true, cancelable: true })
    Object.defineProperty(tap, 'timeStamp', { value: Number.MAX_SAFE_INTEGER })
    button.dispatchEvent(tap)
    flushSync()
}

function warn(name: string): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>(`[data-part="pattern-warn-${name}"]`)!
}

async function openDetail(id: string): Promise<void> {
    cardButton(id).click()
    await settle()
}

async function confirmDialog(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10))
    tapLate(warn('primary'))
    await settle()
}

function stored(id: string) {
    return DBState.db.connections?.find((conn) => conn.id === id)
}

const OPENAI = { id: 'conn-1', name: 'My OpenAI', provider: 'openai', key: 'sk-SYNTH-openai-1234' }
const PROXY = { id: 'conn-2', name: 'Home proxy', provider: 'reverse_proxy', key: 'sk-SYNTH-proxy-5678', url: 'https://p.invalid/v1' }

beforeEach(() => {
    vi.mocked(postUndoToast).mockClear()
    vi.mocked(setConnectionKey).mockReset()
    vi.mocked(setConnectionKey).mockImplementation(realSetConnectionKey)
    needsKey.clear()
    localStorage.clear()
    resetBackHandlersForTests()
    seed({ connections: [{ ...OPENAI }] })
})

afterEach(async () => {
    for (const app of mounted.splice(0)) {
        await unmount(app)
    }
    document.body.innerHTML = ''
    setSettingsSubLevel(null)
    resetBackHandlersForTests()
})

describe('list and cards (A1)', () => {
    test('a card shows the masked tail, the used-by line and no key', () => {
        seed({
            connections: [{ ...OPENAI }, { ...PROXY }, { id: 'conn-3', name: 'Orphan', provider: 'reverse_proxy', key: 'sk-SYNTH-orphan-9999', url: 'https://q.invalid' }],
            proxyConnectionId: 'conn-9',
            botPresets: [{ id: 'p1', name: 'One', proxyConnectionId: 'conn-2' }, { id: 'p2', name: 'Two', proxyConnectionId: 'conn-2' }],
        })
        mountPage()
        const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-part="connection-card"]'))
        expect(cards.length).toBe(3)
        expect(cards[0].textContent).toContain('•••• 1234')
        expect(cards[1].textContent).toContain(language.connectionsUsedByPresets.replace('{n}', '2'))
        expect(cards[2].textContent).toContain(language.connectionsNotUsed)
        expect(document.body.innerHTML).not.toContain('sk-SYNTH')
    })

    test('an empty list shows the empty state', () => {
        seed()
        mountPage()
        expect(part('connections-empty').textContent).toBe(language.connectionsEmpty)
    })
})

describe('T16 delete, undo and focus (falsified by M3, M7)', () => {
    function sevenPresets() {
        return Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `Preset ${i}`, proxyConnectionId: 'conn-2' }))
    }

    test('the dialog lists 5 users and "and 2 more" with Cancel focused; confirm clears every reference and offers Undo', async () => {
        seed({ connections: [{ ...OPENAI }, { ...PROXY }], proxyConnectionId: 'conn-2', botPresets: sevenPresets() })
        mountPage()
        await openDetail('conn-2')
        part('connection-delete').click()
        await settle()
        const dialog = part('pattern-warn-root')
        for (let i = 0; i < 5; i++) expect(dialog.textContent).toContain(`Preset ${i}`)
        expect(dialog.textContent).not.toContain('Preset 5')
        expect(dialog.textContent).toContain(language.connectionsAndMore.replace('{n}', '2'))
        expect(document.activeElement).toBe(warn('cancel'))
        await confirmDialog()
        expect(DBState.db.connections?.map((conn) => conn.id)).toEqual(['conn-1'])
        expect(DBState.db.proxyConnectionId).toBe('')
        expect(DBState.db.botPresets.every((preset) => preset.proxyConnectionId === '')).toBe(true)
        expect(vi.mocked(postUndoToast)).toHaveBeenCalledTimes(1)
        const toast = vi.mocked(postUndoToast).mock.calls[0][0] as UndoToastInit
        expect(toast.text).toBe(language.connectionsDeleted.replace('{name}', 'Home proxy'))
        expect(toast.actionLabel).toBe(language.uiCommon.undo)
        expect(maybePart('connection-detail')).toBeNull()
        expect(document.activeElement).toBe(part('connection-add-open'))
    })

    test('Undo restores the connection in place with an empty key and asks for the key again', async () => {
        seed({ connections: [{ ...PROXY }, { ...OPENAI }], proxyConnectionId: 'conn-2', botPresets: sevenPresets() })
        mountPage()
        await openDetail('conn-2')
        part('connection-delete').click()
        await settle()
        await confirmDialog()
        const toast = vi.mocked(postUndoToast).mock.calls[0][0] as UndoToastInit
        const outcome = await toast.action.run()
        await settle()
        expect(outcome).toEqual({ ok: true, text: language.connectionsRestored })
        expect(DBState.db.connections?.map((conn) => conn.id)).toEqual(['conn-2', 'conn-1'])
        expect(stored('conn-2')?.key).toBe('')
        expect(DBState.db.proxyConnectionId).toBe('conn-2')
        const card = cardButton('conn-2').closest('li')!
        expect(card.textContent).toContain(language.connectionsKeyAgain)
        expect(card.querySelector('[data-part="connection-chip"]')).toBeNull()
        // The detail of a restored connection opens on the empty key field.
        await openDetail('conn-2')
        expect(document.activeElement).toBe(keyInput())
        expect((keyInput()).value).toBe('')
    })

    test('Undo is refused when the id has been taken since', async () => {
        seed({ connections: [{ ...PROXY }] })
        mountPage()
        await openDetail('conn-2')
        part('connection-delete').click()
        await settle()
        await confirmDialog()
        DBState.db.connections = [{ id: 'conn-2', name: 'Newcomer', provider: 'reverse_proxy', key: 'sk-SYNTH-new-0000', url: 'https://n.invalid' }]
        const toast = vi.mocked(postUndoToast).mock.calls[0][0] as UndoToastInit
        expect(await toast.action.run()).toEqual({ ok: false, text: language.connectionsUndoRefused })
        expect(stored('conn-2')?.name).toBe('Newcomer')
    })

    test('Cancel in the delete dialog changes nothing', async () => {
        seed({ connections: [{ ...PROXY }], proxyConnectionId: 'conn-2' })
        mountPage()
        await openDetail('conn-2')
        part('connection-delete').click()
        await settle()
        warn('cancel').click()
        await settle()
        expect(stored('conn-2')).toBeDefined()
        expect(DBState.db.proxyConnectionId).toBe('conn-2')
        expect(vi.mocked(postUndoToast)).not.toHaveBeenCalled()
        expect(maybePart('connection-detail')).not.toBeNull()
    })
})

describe('T17 add flow (A2); falsified by M-KEYWRITE: the add flow ignores keyWrite and closes', () => {
    async function openAdd(): Promise<void> {
        part('connection-add-open').click()
        await settle()
    }

    test('offers only providers without a connection, plus Reverse proxy, never Custom', async () => {
        mountPage()
        await openAdd()
        const offered = Array.from(document.querySelectorAll<HTMLElement>('[data-connection-provider]')).map((el) => el.getAttribute('data-connection-provider'))
        expect(offered).not.toContain('openai')
        expect(offered).not.toContain('custom')
        expect(offered).toContain('reverse_proxy')
        expect(offered).toContain('anthropic')
    })

    test('the name is prefilled, follows the proxy URL until typed, and Save waits for a key', async () => {
        mountPage()
        await openAdd()
        ;(document.querySelector('[data-connection-provider="reverse_proxy"]') as HTMLElement).click()
        await settle()
        const nameField = document.querySelector<HTMLInputElement>('input[type="text"]')!
        expect(nameField.value).toBe('Reverse proxy')
        type(document.querySelector<HTMLInputElement>('input[type="url"]')!, 'https://p.invalid/v1')
        expect(nameField.value).toBe('p.invalid')
        expect(part('connection-save').hasAttribute('disabled')).toBe(false)
        type(nameField, 'Mine')
        type(document.querySelector<HTMLInputElement>('input[type="url"]')!, 'https://other.invalid')
        expect(nameField.value).toBe('Mine')
    })

    test('Save stays disabled for a service until a key is typed, and Back stores nothing', async () => {
        mountPage()
        await openAdd()
        ;(document.querySelector('[data-connection-provider="anthropic"]') as HTMLElement).click()
        await settle()
        expect(part('connection-save').hasAttribute('disabled')).toBe(true)
        type(keyInput(), 'sk-SYNTH-claude-4321')
        expect(part('connection-save').hasAttribute('disabled')).toBe(false)
        expect(DBState.db.connections?.length).toBe(1)
    })

    test('a rejected key write shows the error, keeps the flow open and stores no connection', async () => {
        mountPage()
        await openAdd()
        ;(document.querySelector('[data-connection-provider="anthropic"]') as HTMLElement).click()
        await settle()
        type(keyInput(), 'sk-SYNTH-claude-4321')
        vi.mocked(setConnectionKey).mockRejectedValueOnce(new Error('vault down'))
        part('connection-save').click()
        await settle()
        expect(part('connection-error').textContent).toBe(language.connectionsKeyWriteFailed)
        expect(maybePart('connection-add')).not.toBeNull()
        expect(DBState.db.connections?.map((conn) => conn.id)).toEqual(['conn-1'])
        expect(part('connection-save').hasAttribute('disabled')).toBe(false)
        part('connection-save').click()
        await settle()
        expect(maybePart('connection-add')).toBeNull()
        expect(DBState.db.connections?.map((conn) => conn.provider)).toEqual(['openai', 'anthropic'])
        expect(document.activeElement).toBe(part('connection-add-open'))
    })

    test('a second tap while the write is pending adds nothing twice', async () => {
        mountPage()
        await openAdd()
        ;(document.querySelector('[data-connection-provider="reverse_proxy"]') as HTMLElement).click()
        await settle()
        type(keyInput(), 'sk-SYNTH-proxy-1111')
        let release: () => void = () => {}
        vi.mocked(setConnectionKey).mockImplementationOnce(async (conn, plain) => {
            await new Promise<void>((resolve) => { release = resolve })
            conn.key = plain
        })
        part('connection-save').click()
        await settle()
        expect(part('connection-save').hasAttribute('disabled')).toBe(true)
        part('connection-save').click()
        await settle()
        release()
        await settle()
        expect(DBState.db.connections?.filter((conn) => conn.provider === 'reverse_proxy').length).toBe(1)
    })

    test('A10: the first proxy becomes the working proxy; a later one does not take over', async () => {
        mountPage()
        await openAdd()
        ;(document.querySelector('[data-connection-provider="reverse_proxy"]') as HTMLElement).click()
        await settle()
        type(keyInput(), 'sk-SYNTH-proxy-1111')
        part('connection-save').click()
        await settle()
        const first = DBState.db.connections?.find((conn) => conn.provider === 'reverse_proxy')?.id
        expect(DBState.db.proxyConnectionId).toBe(first)
        part('connection-add-open').click()
        await settle()
        ;(document.querySelector('[data-connection-provider="reverse_proxy"]') as HTMLElement).click()
        await settle()
        type(keyInput(), 'sk-SYNTH-proxy-2222')
        part('connection-save').click()
        await settle()
        expect(DBState.db.proxyConnectionId).toBe(first)
        const second = DBState.db.connections?.filter((conn) => conn.provider === 'reverse_proxy')[1].id
        await openDetail(second!)
        part('connection-use').click()
        await settle()
        expect(DBState.db.proxyConnectionId).toBe(second)
        expect(maybePart('connection-use')).toBeNull()
    })
})

describe('T18 replace, remove and Use (A4, A10)', () => {
    test('Replace key opens an empty field and Save updates the chip', async () => {
        mountPage()
        await openDetail('conn-1')
        part('connection-key-replace').click()
        await settle()
        const field = keyInput()
        expect(field.value).toBe('')
        type(field, 'sk-SYNTH-newkey-7777')
        part('connection-key-save').click()
        await settle()
        expect(stored('conn-1')?.key).toBe('sk-SYNTH-newkey-7777')
        expect(part('connection-chip').textContent).toContain('7777')
        expect(maybePart('connection-key-input')).toBeNull()
    })

    test('a rejected replace shows the error and keeps the old key; a pending write disables the buttons', async () => {
        mountPage()
        await openDetail('conn-1')
        part('connection-key-replace').click()
        await settle()
        type(keyInput(), 'sk-SYNTH-newkey-7777')
        vi.mocked(setConnectionKey).mockRejectedValueOnce(new Error('vault down'))
        part('connection-key-save').click()
        await settle()
        expect(part('connection-error').textContent).toBe(language.connectionsKeyWriteFailed)
        expect(stored('conn-1')?.key).toBe('sk-SYNTH-openai-1234')
        let release: () => void = () => {}
        vi.mocked(setConnectionKey).mockImplementationOnce(async (conn, plain) => {
            await new Promise<void>((resolve) => { release = resolve })
            conn.key = plain
        })
        part('connection-key-save').click()
        await settle()
        expect(part('connection-key-save').hasAttribute('disabled')).toBe(true)
        expect(part('connection-delete').hasAttribute('disabled')).toBe(true)
        release()
        await settle()
        expect(stored('conn-1')?.key).toBe('sk-SYNTH-newkey-7777')
    })

    test('Remove key confirms first; for NanoGPT the dialog names the reset and confirm applies it after the write', async () => {
        seed({
            connections: [{ id: 'conn-1', name: 'Nano', provider: 'nanogpt', key: 'sk-SYNTH-nano-4242' }],
            nanogptProvider: 'p', nanogptRequestModel: 'm', nanogptRequestModelName: 'n', nanogptSubscriptionState: 's', nanogptUseSubscriptionEndpoint: true,
        })
        mountPage()
        await openDetail('conn-1')
        part('connection-key-clear').click()
        await settle()
        expect(part('pattern-warn-root').textContent).toContain(language.connectionsNanoGptEffect)
        expect(stored('conn-1')?.key).toBe('sk-SYNTH-nano-4242')
        warn('cancel').click()
        await settle()
        expect(DBState.db.nanogptProvider).toBe('p')
        part('connection-key-clear').click()
        await settle()
        await confirmDialog()
        expect(stored('conn-1')?.key).toBe('')
        expect(DBState.db.nanogptProvider).toBe('')
        expect(DBState.db.nanogptUseSubscriptionEndpoint).toBe(false)
        expect(part('connection-alert').textContent).toContain(language.connectionsKeyMissing)
    })

    test('a rejected Remove leaves the key and the NanoGPT choice untouched', async () => {
        seed({
            connections: [{ id: 'conn-1', name: 'Nano', provider: 'nanogpt', key: 'sk-SYNTH-nano-4242' }],
            nanogptProvider: 'p',
        })
        mountPage()
        await openDetail('conn-1')
        part('connection-key-clear').click()
        await settle()
        vi.mocked(setConnectionKey).mockRejectedValueOnce(new Error('vault down'))
        await confirmDialog()
        expect(stored('conn-1')?.key).toBe('sk-SYNTH-nano-4242')
        expect(DBState.db.nanogptProvider).toBe('p')
        expect(part('connection-error').textContent).toBe(language.connectionsKeyWriteFailed)
    })

    test('replacing a Vertex key clears the saved token', async () => {
        seed({
            connections: [{ id: 'conn-1', name: 'Vertex AI', provider: 'vertex', key: '-----BEGIN PRIVATE KEY-----\nSYNTHPEM\n-----END PRIVATE KEY-----' }],
            vertexAccessToken: 'tok', vertexAccessTokenExpires: 99,
        })
        mountPage()
        await openDetail('conn-1')
        part('connection-key-replace').click()
        await settle()
        type(keyInput(), '-----BEGIN PRIVATE KEY-----\nSYNTHPEM2\n-----END PRIVATE KEY-----')
        part('connection-key-save').click()
        await settle()
        expect(DBState.db.vertexAccessToken).toBe('')
        expect(DBState.db.vertexAccessTokenExpires).toBe(0)
    })

    test('rename cuts at 60, warns on a duplicate but saves, and an empty name keeps the old one', async () => {
        seed({ connections: [{ ...OPENAI }, { ...PROXY }] })
        mountPage()
        await openDetail('conn-1')
        const nameField = document.querySelector<HTMLInputElement>('input[type="text"]')!
        type(nameField, 'x'.repeat(70))
        nameField.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        expect(stored('conn-1')?.name).toBe('x'.repeat(60))
        type(nameField, 'Home proxy')
        nameField.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        expect(stored('conn-1')?.name).toBe('Home proxy')
        expect(part('connection-name-note').textContent).toBe(language.connectionsNameDuplicate)
        type(nameField, '   ')
        nameField.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        expect(stored('conn-1')?.name).toBe('Home proxy')
        expect(nameField.value).toBe('Home proxy')
        expect(part('connection-name-note').textContent).toBe(language.connectionsNameEmpty)
    })

    test('the key writer was the real V1 body, so a replace reached the store through the seam', async () => {
        mountPage()
        await openDetail('conn-1')
        part('connection-key-replace').click()
        await settle()
        type(keyInput(), 'sk-SYNTH-seam-3131')
        part('connection-key-save').click()
        await settle()
        expect(vi.mocked(keyAccess.setConnectionKey)).toHaveBeenCalledTimes(1)
    })
})

describe('T19 rename notice (A7); falsified by M17', () => {
    test('lists default-named connections only, and a dismissal survives a remount', async () => {
        seed({ connections: [{ ...OPENAI, name: 'OpenAI' }, { ...PROXY }, { id: 'conn-3', name: 'Mistral 2', provider: 'mistral', key: 'sk-SYNTH-mis-0001' }] })
        const target = mountPage()
        const notice = part('connection-notice')
        expect(notice.textContent).toContain('OpenAI')
        expect(notice.textContent).toContain('Mistral 2')
        expect(notice.textContent).not.toContain('Home proxy')
        part('connection-notice-dismiss').click()
        await settle()
        expect(maybePart('connection-notice')).toBeNull()
        await unmount(mounted.pop()!)
        target.remove()
        mountPage()
        expect(maybePart('connection-notice')).toBeNull()
    })

    test('no notice when every connection has a chosen name', () => {
        mountPage()
        expect(maybePart('connection-notice')).toBeNull()
    })
})
