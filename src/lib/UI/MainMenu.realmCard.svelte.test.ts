// @vitest-environment jsdom

/**
 * The home Realm card and the upload frame header use theme tokens only: the card is a recessed
 * `darkbg` panel with a `borderc` top rule, the consent action is a primary button, Retry a
 * secondary one, preview rows hover without moving, and the frame's close control is a named icon
 * button over a token background. Mounts the REAL MainMenu and RealmFrame with the hub, the Realm
 * view and every export/alert module mocked, so nothing reaches a Realm host.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { hubType, RisuHubResult } from 'src/ts/characterCards'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import { controlName, exposedIcons, paletteClasses } from 'src/lib/a11yNames.test-helpers'

//#region module mocks

const chara = vi.hoisted(() => ({
    name: 'preview-chara', desc: '', download: '', id: 'preview-chara', img: '', tags: [], viewScreen: 'none',
    hasLore: false, hasEmotion: false, hasAsset: false, hot: 0, license: '', type: 'character',
}) as unknown as hubType)

const hubMock = vi.hoisted(() => ({
    getRisuHub: vi.fn(async () => ({ ok: true, cards: [chara], additionalHTML: '' }) as unknown),
}))

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: hubMock.getRisuHub,
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getVersionString: vi.fn(() => 'test-version'),
    openURL: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

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

vi.mock(import('src/ts/realmUploadUrl'), () => ({
    getRealmUploadUrl: vi.fn(() => 'https://realm.invalid/upload'),
}) as unknown as typeof import('src/ts/realmUploadUrl'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(() => new Promise<void>(() => {})),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/moduleUse'), () => ({
    realmModuleJson: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/moduleUse'))

vi.mock(import('src/ts/toast/toastHost.svelte'), () => ({
    postToast: vi.fn(),
}) as unknown as typeof import('src/ts/toast/toastHost.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({
        db: { hideRealm: false, realmDirectOpen: false, hideAllImages: false, characters: [] } as unknown as Record<string, unknown>,
    })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        OpenRealmStore: writable(false),
        RealmInitialOpenChar: writable(null),
        ShowRealmFrameStore: writable(''),
        selectedCharID: writable(0),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('./Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import MainMenu from './MainMenu.svelte'
import RealmFrame from './Realm/RealmFrame.svelte'
import { ShowRealmFrameStore } from 'src/ts/stores.svelte'

const mountedInstances: unknown[] = []
const mountedTargets: HTMLElement[] = []

async function mountComponent(component: typeof MainMenu | typeof RealmFrame): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(component as typeof MainMenu, { target, props: {} }))
    flushSync()
    for (let i = 0; i < 4; i++) await Promise.resolve()
    flushSync()
    return target
}

function setHub(result: RisuHubResult | { ok: true, cards: hubType[], additionalHTML: string }): void {
    hubMock.getRisuHub.mockImplementation(async () => result)
}

function accept(): void {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
}

/** The Realm card: the grid child that owns the clickable preview/status area. */
function realmCard(target: HTMLElement): HTMLElement {
    const title = Array.from(target.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === language.hubBrowseMore)
    const card = title?.closest('[data-part="home-realm"]') as HTMLElement | null
    if (!card) {
        throw new Error('Realm card not found')
    }
    return card
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
    if (!found) {
        throw new Error(`button not found: ${text}`)
    }
    return found
}

beforeEach(() => {
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    setHub({ ok: true, cards: [chara], additionalHTML: '' })
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
})

describe('MainMenu Realm card tokens', () => {
    test('regression reproducer: the populated card has no default-palette class and is a recessed darkbg panel with a borderc top rule', async () => {
        accept()
        const target = await mountComponent(MainMenu)
        const card = realmCard(target)
        expect(paletteClasses(card)).toEqual([])
        expect(card.classList.contains('bg-darkbg')).toBe(true)
        expect(card.classList.contains('border-t-borderc')).toBe(true)
        expect(Array.from(card.querySelectorAll('*')).some((el) => Array.from(el.classList).some((c) => c.startsWith('bg-primary')))).toBe(false)
        expect(Array.from(card.classList).some((c) => c.startsWith('bg-primary'))).toBe(false)
        expect(card.innerHTML).not.toContain('textcolor/80')
    })

    test('regression reproducer: the consent state has no default-palette class and no textcolor/80 text', async () => {
        const target = await mountComponent(MainMenu)
        const card = realmCard(target)
        expect(card.querySelector('[data-testid="upstream-consent-placeholder"]')).not.toBeNull()
        expect(paletteClasses(card)).toEqual([])
        expect(card.innerHTML).not.toContain('textcolor/80')
    })

    test('regression reproducer: Agree and show is the primary button, with a focus ring and a 44 px target', async () => {
        const target = await mountComponent(MainMenu)
        const agree = target.querySelector('[data-testid="upstream-consent-accept"]') as HTMLElement
        expect(agree.classList.contains('bg-selected')).toBe(true)
        expect(agree.classList.contains('text-textcolor')).toBe(true)
        expect(agree.classList.contains('risu-focus-ring')).toBe(true)
        expect(agree.classList.contains('min-h-11')).toBe(true)
        expect(agree.classList.contains('bg-darkbutton')).toBe(false)
        expect(agree.className).not.toMatch(/translate/)
    })

    test('regression reproducer: Retry in the failed state is a secondary button, with a focus ring and a 44 px target', async () => {
        accept()
        setHub({ ok: false, reason: 'network' })
        const target = await mountComponent(MainMenu)
        const retry = buttonByText(realmCard(target), language.hubRetry)
        expect(retry.classList.contains('bg-darkbutton')).toBe(true)
        expect(retry.classList.contains('border-darkborderc')).toBe(true)
        expect(retry.classList.contains('risu-focus-ring')).toBe(true)
        expect(retry.classList.contains('min-h-11')).toBe(true)
        expect(retry.classList.contains('bg-selected')).toBe(false)
        expect(retry.className).not.toMatch(/translate/)
        expect(controlName(retry)).toBe(language.hubRetry)
    })

    test('regression reproducer: a preview row hovers by background only and carries the focus ring', async () => {
        accept()
        const target = await mountComponent(MainMenu)
        const row = buttonByText(realmCard(target), 'preview-chara')
        expect(row.className).not.toMatch(/translate/)
        expect(row.classList.contains('hover:bg-selected/50')).toBe(true)
        expect(row.classList.contains('risu-focus-ring')).toBe(true)
        expect(row.classList.contains('min-h-11')).toBe(true)
    })
})

describe('RealmFrame header', () => {
    test('regression reproducer: the close control is named uiCommon.close, its glyph is hidden and no times sign remains', async () => {
        accept()
        const target = await mountComponent(RealmFrame)
        const close = Array.from(target.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === language.uiCommon.close)
        expect(close).toBeTruthy()
        expect(controlName(close as Element)).toBe(language.uiCommon.close)
        expect(close?.textContent?.trim()).toBe('')
        expect(close?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
        expect(exposedIcons(target)).toEqual([])
        expect(close?.classList.contains('size-11')).toBe(true)
        expect(close?.classList.contains('risu-focus-ring')).toBe(true)
        expect(target.textContent).not.toContain('×')
    })

    test('regression reproducer: the frame container is on theme tokens, not a default-palette background', async () => {
        accept()
        const target = await mountComponent(RealmFrame)
        expect(paletteClasses(target)).toEqual([])
        expect(target.querySelector('.bg-bgcolor')).not.toBeNull()
    })

    test('guard: pressing close resets the store', async () => {
        accept()
        const target = await mountComponent(RealmFrame)
        const close = Array.from(target.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === language.uiCommon.close) as HTMLButtonElement
        close.click()
        flushSync()
        let value = 'unset'
        ShowRealmFrameStore.subscribe((v) => { value = v })()
        expect(value).toBe('')
    })
})
