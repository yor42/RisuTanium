// @vitest-environment jsdom

/**
 * `MainMenu.svelte`: the Realm full view's back arrow is named, its glyph is hidden and it hovers to
 * a token different from its rest colour, and the Realm preview list backing is the scheme tint
 * instead of a black one. Mounts the REAL component with the module set of
 * `MainMenu.hubStates.svelte.test.ts` (the Realm view itself and the hub are stubs).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { hubType } from 'src/ts/characterCards'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import { controlName, exposedIcons, textColourTokens } from 'src/lib/a11yNames.test-helpers'

//#region module mocks

const chara = vi.hoisted(() => ({
    name: 'preview-chara', desc: '', download: '', id: 'preview-chara', img: '', tags: [], viewScreen: 'none',
    hasLore: false, hasEmotion: false, hasAsset: false, hot: 0, license: '', type: 'character',
}) as unknown as hubType)

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: vi.fn(async () => ({ ok: true, cards: [chara], additionalHTML: '' })),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getVersionString: vi.fn(() => 'test-version'),
    openURL: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({
        db: { hideRealm: false, realmDirectOpen: false, hideAllImages: false } as unknown as Record<string, unknown>,
    })
    return {
        DBState: state,
        OpenRealmStore: writable(false),
        RealmInitialOpenChar: writable(null),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('./Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import MainMenu from './MainMenu.svelte'
import { OpenRealmStore } from 'src/ts/stores.svelte'

const mountedInstances: unknown[] = []
const mountedTargets: HTMLElement[] = []

async function mountMainMenu(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(MainMenu, { target, props: {} }))
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
    OpenRealmStore.set(false)
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
})

describe('MainMenu Realm header back and preview backing', () => {
    test('regression reproducer: the Realm view back arrow is named, its glyph hidden and its hover differs from its rest', async () => {
        const target = await mountMainMenu()
        OpenRealmStore.set(true)
        flushSync()
        const back = target.querySelector('div.flex.items-center.mt-4 > button') as HTMLButtonElement
        expect(back).not.toBeNull()
        expect(controlName(back)).toBe(language.settingsPage.back)
        expect(exposedIcons(back)).toEqual([])
        const { rest, hover } = textColourTokens(back.querySelector('svg')!.parentElement!)
        expect(hover).not.toBeNull()
        expect(hover).not.toBe(rest)
    })

    test('regression reproducer: the Realm preview list backing is the scheme tint, not black', async () => {
        const target = await mountMainMenu()
        const list = target.querySelector('[data-realm-preview-list]') as HTMLElement
        expect(list).not.toBeNull()
        expect(list.classList.contains('bg-darkbg/30')).toBe(true)
        expect(list.classList.contains('bg-black/30')).toBe(false)
    })
})
