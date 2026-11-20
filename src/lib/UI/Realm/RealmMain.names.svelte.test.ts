// @vitest-environment jsdom

/**
 * `RealmMain.svelte`: the header Back button, the search field and its button, the sort select, the
 * toolbar buttons and the page buttons are named, their glyphs are hidden, and no default-palette class
 * is left (the hub carries no scrim of its own). Mounts the REAL component; the card grid and the popup
 * are stubs, as in `RealmMain.hubStates.svelte.test.ts`, whose mocks and acceptance seeding this file copies.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'

//#region module mocks

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    // One card, so the page loads as populated and the pager renders.
    getRisuHub: vi.fn(async () => ({ ok: true, cards: [{ id: 'names-card', name: 'names-card', tags: [] }], additionalHTML: '' })),
    downloadRisuHub: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/alert'), () => ({
    alertInput: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        MobileGUI: writable(false),
        RealmInitialOpenChar: writable(null),
        OpenRealmStore: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('./RealmHubIcon.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./RealmPopUp.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))

//#endregion

import RealmMain from './RealmMain.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

async function settle(): Promise<void> {
    flushSync()
    for (let i = 0; i < 4; i++) await Promise.resolve()
    flushSync()
}

async function mountRealmMain(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(RealmMain, { target, props: {} }))
    await settle()
    return target
}

beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
})

async function chooseTrending(target: HTMLElement): Promise<void> {
    const select = target.querySelector('select') as HTMLSelectElement
    select.value = 'trending'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
}

describe('RealmMain accessible names and colours', () => {
    test('the search field, its button and the sort select are named, and nothing is left unnamed', async () => {
        const target = await mountRealmMain()
        expect(controlName(target.querySelector('input') as HTMLInputElement)).toBe(language.hubSearchLabel)
        expect(target.querySelector(`button[aria-label="${language.search}"]`)).not.toBeNull()
        expect(controlName(target.querySelector('select') as HTMLSelectElement)).toContain(language.hubSortLabel)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('the page buttons are named once a sort with paging is chosen', async () => {
        const target = await mountRealmMain()
        await chooseTrending(target)
        expect(target.querySelector(`button[aria-label="${language.realmPrevPage}"]`)).not.toBeNull()
        expect(target.querySelector(`button[aria-label="${language.realmNextPage}"]`)).not.toBeNull()
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('the glyphs are hidden in every state', async () => {
        const target = await mountRealmMain()
        expect(exposedIcons(target)).toEqual([])
        await chooseTrending(target)
        expect(exposedIcons(target)).toEqual([])
    })

    test('no default-palette class is left', async () => {
        const target = await mountRealmMain()
        await chooseTrending(target)
        expect(paletteClasses(target)).toEqual([])
    })
})
