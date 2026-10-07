// @vitest-environment jsdom

/**
 * Wiring test for the `{@html sanitizeHubHtml(hubAnnouncement)}` sink in
 * `MainMenu.svelte` (Stage 2 of the home-screen rework; see
 * `Agents/Live-State.md`). `src/ts/hubHtml.test.ts` covers the sanitizer as
 * a pure function in isolation -- it does not prove the `.svelte` sink
 * actually calls it. This file mounts the REAL `MainMenu.svelte` against the
 * REAL `src/ts/hubHtml.ts` (not mocked) and drives it with a hostile
 * `additionalHTML` payload, so a disconnected sink (the call removed, or
 * replaced with a no-op) fails this test even though it would still pass
 * every unit test on `hubHtml.ts` alone.
 *
 * `getRisuHub` returns the discriminated `RisuHubResult`
 * (`src/ts/characterCards.ts`). The banner sits below the Related Links grid,
 * not inside the realm card, and renders whenever the resolved
 * `additionalHTML` is non-empty, independent of how many hub cards came
 * back. This test asserts zero cards specifically, to guard against the
 * banner being gated behind `{#if charas.length > 0}`.
 *
 * `src/ts/characterCards` is mocked for two reasons: `getRisuHub` performs a
 * network fetch this test must not make, and controlling its resolved value
 * is how this test drives the banner content. `./Realm/RealmMain.svelte`
 * (mounted only once `$OpenRealmStore` is true, which this file never sets)
 * is stubbed to a trivial component, following the
 * `ChatBody.svelte`/`PartialEditController.svelte` precedent in
 * `Chat.messageEditor.svelte.test.ts`.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'

//#region module mocks

const hubState = vi.hoisted(() => ({ result: null as unknown }))

vi.mock(import('src/ts/characterCards'), () => ({
    getRisuHub: vi.fn(async () => hubState.result),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getVersionString: vi.fn(() => 'test-version'),
    openURL: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { hideRealm: false, realmDirectOpen: false } as unknown as Record<string, unknown> })
    return {
        DBState: state,
        OpenRealmStore: writable(false),
        RealmInitialOpenChar: writable(null),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

// Stubbed out entirely -- not rendered ($OpenRealmStore stays false in every
// test here) and not itself under test (see file header).
vi.mock('./Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import MainMenu from './MainMenu.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountMainMenu() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(MainMenu, { target, props: {} })
    mountedInstances.push(instance)
    flushSync()
    return target
}

// This suite's own assertions are about the sanitizer wiring, not the
// agreement gate, so acceptance is seeded through the module for every case.
beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
})

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    hubState.result = null
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    vi.clearAllMocks()
})

describe('MainMenu.svelte realm banner: the additionalHTML sink is wired to sanitizeHubHtml', () => {
    test('a hostile additionalHTML payload is sanitized before it reaches the DOM, with zero hub cards', async () => {
        // Zero cards on purpose: the banner must render from a non-empty
        // `additionalHTML` alone, regardless of how many cards came back.
        hubState.result = {
            ok: true,
            cards: [],
            additionalHTML: '<img src=x onerror="alert(1)"><p>safe text</p>',
        }

        const target = mountMainMenu()
        // Let loadHubPreview's `await getRisuHub(...)` resolve.
        await Promise.resolve()
        await Promise.resolve()
        flushSync()

        expect(target.innerHTML).not.toContain('onerror')
        expect(target.innerHTML).not.toContain('<img')
        expect(target.innerHTML).toContain('<p>safe text</p>')
    })
})
