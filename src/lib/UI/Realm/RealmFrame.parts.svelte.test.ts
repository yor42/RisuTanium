// @vitest-environment happy-dom

/**
 * `RealmFrame.svelte` carries the overlay vocabulary on its chrome only (#438 W3-3). The REAL component is mounted; each element is found by
 * tag, role, aria-label, text or structure, never by its part, and the part is asserted on it together with its direct parent. The iframe, the
 * third-party upload page, carries no part, and no part sits between it and the root: the outline stays the chrome alone with the iframe
 * mounted. No sanitizer is involved, so the happy-dom environment of the existing RealmFrame tests applies.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: `src/ts/alert`, `src/ts/realm`, `src/ts/storage/database.svelte`, `src/ts/process/moduleUse`, `src/ts/realmUploadUrl`, `src/ts/util`
 * (a sleep that never resolves), `src/ts/toast/toastHost.svelte` and `src/ts/stores.svelte`. Synthetic data only; the iframe URL is an unresolvable `.invalid` host and page
 * loading is disabled, so nothing contacts a host.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'

const realmUploadUrlSpy = vi.hoisted(() => vi.fn(() => 'https://realm.example.invalid/upload'))

vi.mock(import('src/ts/alert'), () => ({
    alertMd: vi.fn(),
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/realm'), () => ({
    shareRealmCardData: vi.fn(async () => ({ name: new ArrayBuffer(1), data: new ArrayBuffer(1) })),
}) as unknown as typeof import('src/ts/realm'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    downloadPreset: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/process/moduleUse'), () => ({
    realmModuleJson: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/moduleUse'))

vi.mock(import('src/ts/realmUploadUrl'), () => ({
    getRealmUploadUrl: realmUploadUrlSpy,
}) as unknown as typeof import('src/ts/realmUploadUrl'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn((_ms: number): Promise<void> => new Promise(() => {})),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/toast/toastHost.svelte'), () => ({
    postToast: vi.fn(),
}) as unknown as typeof import('src/ts/toast/toastHost.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { characters: [] } as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ShowRealmFrameStore: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

import RealmFrame from './RealmFrame.svelte'
import { ShowRealmFrameStore } from 'src/ts/stores.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountRealmFrame(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(RealmFrame, { target, props: {} }))
    flushSync()
    const iframe = target.querySelector('iframe')
    if (iframe) {
        Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage: vi.fn() } })
    }
    return target
}

async function settle(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    flushSync()
}

function accept(): void {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
}

beforeEach(() => {
    ;(window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM.settings.disableIframePageLoading = true
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    ShowRealmFrameStore.set('character')
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    ShowRealmFrameStore.set('')
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    vi.clearAllMocks()
})

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null

/** The names of the parted elements as a nested string: `name(child child)`; an element without a part is looked through. */
function outline(el: Element): string {
    const inner = Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')
    const name = partOf(el)
    if (name === null) return inner
    return inner === '' ? name : `${name}(${inner})`
}

function assertChrome(target: HTMLElement): void {
    const root = target.firstElementChild as HTMLElement
    expect(partOf(root)).toBe('modal-realm-frame')
    const title = Array.from(target.querySelectorAll('h1')).find((h) => h.textContent?.trim() === language.uiCommon.uploadToRealm) as HTMLElement
    expect(title).toBeTruthy()
    expect(partOf(title)).toBe('modal-title')
    const header = title.parentElement as HTMLElement
    expect(partOf(header)).toBe('modal-header')
    expect(header).toBe(root.firstElementChild)
    expect(header.parentElement).toBe(root)
    const close = target.querySelector(`button[aria-label="${language.uiCommon.close}"]`) as HTMLElement
    expect(partOf(close)).toBe('modal-close')
    expect(close.parentElement).toBe(header)
}

describe('RealmFrame overlay parts', () => {
    test('acceptance: without acceptance the root, header, title and close are named', async () => {
        const target = mountRealmFrame()
        await settle()
        expect(target.querySelector('iframe')).toBeNull()
        assertChrome(target)
        expect(outline(target)).toBe('modal-realm-frame(modal-header(modal-title modal-close))')
    })

    test('acceptance: with acceptance the iframe is present and the outline is still the chrome alone', async () => {
        accept()
        const target = mountRealmFrame()
        await settle()
        expect(target.querySelector('iframe')).toBeTruthy()
        assertChrome(target)
        expect(outline(target)).toBe('modal-realm-frame(modal-header(modal-title modal-close))')
    })

    test('acceptance: no part sits between the iframe and the root', async () => {
        accept()
        const target = mountRealmFrame()
        await settle()
        const root = target.firstElementChild as HTMLElement
        const iframe = target.querySelector('iframe') as HTMLIFrameElement
        expect(iframe.parentElement).toBe(root)
        expect(partOf(root)).toBe('modal-realm-frame')
        expect(iframe.closest('[data-part]')).toBe(root)
    })

    test('guard: the iframe and its loading container carry no part', async () => {
        accept()
        const target = mountRealmFrame()
        await settle()
        const root = target.firstElementChild as HTMLElement
        const iframe = target.querySelector('iframe') as HTMLIFrameElement
        expect(iframe.getAttributeNames().filter((name) => name.startsWith('data-part'))).toEqual([])
        expect(iframe.parentElement).toBe(root)
        expect(iframe.children).toHaveLength(0)
        expect(iframe.getAttribute('src')).toBe('https://realm.example.invalid/upload')
        const loading = target.querySelector('.loadmove')
        expect(loading).toBeTruthy()
        expect(partOf(loading!.parentElement)).toBeNull()
        expect(partOf(loading)).toBeNull()
    })

    test('guard: close empties the store', async () => {
        const target = mountRealmFrame()
        await settle()
        ShowRealmFrameStore.set('character')
        ;(target.querySelector(`button[aria-label="${language.uiCommon.close}"]`) as HTMLElement).click()
        flushSync()
        expect(get(ShowRealmFrameStore)).toBe('')
    })
})
