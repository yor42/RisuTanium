// @vitest-environment jsdom

/**
 * `RealmMain.svelte`: the search field, the search and menu buttons, the page buttons and the menu's X
 * are named, their glyphs are hidden, and the hovers use scheme tokens (the dimmed scrim `bg-black/50`
 * stays, E2). Mounts the REAL component; the card grid and the popup are stubs, as in
 * `RealmMain.hubStates.svelte.test.ts`, whose mocks and acceptance seeding this file copies.
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
    getRisuHub: vi.fn(async () => ({ ok: true, cards: [], additionalHTML: '' })),
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
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('./RealmHubIcon.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./RealmPopUp.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))

//#endregion

import RealmMain from './RealmMain.svelte'

const SCRIM = [/^bg-black\/50$/]

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

async function mountRealmMain(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(RealmMain, { target, props: {} }))
    flushSync()
    for (let i = 0; i < 4; i++) await Promise.resolve()
    flushSync()
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

const searchRow = (target: HTMLElement) => target.querySelector('input')!.parentElement as HTMLElement
const byText = (target: HTMLElement, text: string) => Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement

async function openTrending(target: HTMLElement): Promise<void> {
    byText(target, language.trending).click()
    flushSync()
    for (let i = 0; i < 4; i++) await Promise.resolve()
    flushSync()
}

describe('RealmMain accessible names and colours', () => {
    test('regression reproducer: the search field and its two buttons are named', async () => {
        const target = await mountRealmMain()
        const field = target.querySelector('input') as HTMLInputElement
        expect(controlName(field)).toBe(language.search)
        const buttons = Array.from(searchRow(target).querySelectorAll(':scope > button'))
        expect(buttons.map(controlName)).toEqual([language.search, language.menu])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the page buttons are named once a sort with paging is chosen', async () => {
        const target = await mountRealmMain()
        await openTrending(target)
        const paging = Array.from(target.querySelectorAll('button')).filter((b) => b.classList.contains('h-14'))
        expect(paging.map(controlName)).toEqual([language.realmPrevPage, '1', language.realmNextPage])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the menu close button is named', async () => {
        const target = await mountRealmMain()
        ;(searchRow(target).querySelectorAll(':scope > button')[1] as HTMLButtonElement).click()
        flushSync()
        const close = target.querySelector('h1 > button') as HTMLButtonElement
        expect(controlName(close)).toBe(language.uiCommon.close)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the glyphs are hidden in every state', async () => {
        const target = await mountRealmMain()
        await openTrending(target)
        ;(searchRow(target).querySelectorAll(':scope > button')[1] as HTMLButtonElement).click()
        flushSync()
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: no default-palette class is left beyond the scrim and the hovers use scheme tokens', async () => {
        const target = await mountRealmMain()
        await openTrending(target)
        ;(searchRow(target).querySelectorAll(':scope > button')[1] as HTMLButtonElement).click()
        flushSync()
        expect(paletteClasses(target, { allow: SCRIM })).toEqual([])
        const [search, menu] = Array.from(searchRow(target).querySelectorAll(':scope > button'))
        for (const button of [search, menu]) {
            expect(button.classList.contains('hover:bg-borderc')).toBe(true)
        }
    })
})
