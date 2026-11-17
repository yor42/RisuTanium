// @vitest-environment happy-dom

/**
 * Coverage for `RealmPopUp.svelte`'s report control (T-C12): reporting a
 * character sends nothing to upstream before the user has accepted its
 * terms. The confirm and input prompts the control already shows stay
 * exactly as they are; only the network request behind them is gated.
 *
 * `src/ts/alert` is mocked so the existing confirm/input prompts resolve
 * without a real `AlertComp` mounted. `src/ts/characterCards` is mocked for
 * `hubURL`/`downloadRisuHub`/`getRealmInfo`. `src/ts/stores.svelte` is
 * mocked for `DBState` and a real `alertStore`, per the agreement module's
 * own import. `src/ts/upstreamAgreement` itself is never mocked: acceptance
 * is seeded through its own key and test reset.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { hubType } from 'src/ts/characterCards'
import { ALERT_INPUT_CANCEL } from 'src/ts/alertCancel'
import { UPSTREAM_AGREEMENT_DECLINE, UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'

//#region module mocks

const alertConfirmSpy = vi.hoisted(() => vi.fn(async () => true))
const alertInputSpy = vi.hoisted(() => vi.fn<(msg: string, list?: unknown, value?: string, options?: { cancel?: string }) => Promise<string>>(async () => 'a report'))
const alertNormalSpy = vi.hoisted(() => vi.fn())
const downloadRisuHubSpy = vi.hoisted(() => vi.fn())
const getRealmInfoSpy = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: alertConfirmSpy,
    alertInput: alertInputSpy,
    alertNormal: alertNormalSpy,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    downloadRisuHub: downloadRisuHubSpy,
    getRealmInfo: getRealmInfoSpy,
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { hideAllImages: false } as unknown as Record<string, unknown> })
    // `MultiLangDisplay.svelte`'s markdown rendering reaches
    // `src/ts/parser/parser.svelte.ts`, whose own module-scope effect reads
    // `selIdState.selId` and `DBState.db.characters` unconditionally;
    // `characters` stays absent so it returns immediately.
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

//#endregion

import RealmPopUp from './RealmPopUp.svelte'
import { alertStore } from 'src/ts/stores.svelte'

function makeChara(): hubType {
    return {
        name: 'reported-chara',
        desc: '',
        download: '',
        id: 'reported-chara',
        img: '',
        tags: [],
        viewScreen: 'none',
        hasLore: false,
        hasEmotion: false,
        hasAsset: false,
        hot: 0,
        license: '',
        type: 'character',
    }
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountRealmPopUp() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(RealmPopUp, { target, props: { openedData: makeChara() } })
    mountedInstances.push(instance)
    flushSync()
    return target
}

async function settle() {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    flushSync()
}

async function waitFor(predicate: () => boolean, expected: string, timeoutMs = 2000): Promise<void> {
    const start = Date.now()
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`timed out waiting for: ${expected}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
}

function reportButton(target: HTMLElement): HTMLButtonElement {
    // The report control is the only button whose only child is an <svg>
    // (the flag icon) among the popup's row of icon-only actions -- found
    // by position among that row rather than by a test id (none is
    // specified for this control).
    const button = target.querySelector('.flex-row-reverse button') as HTMLButtonElement | null
    if (!button) {
        throw new Error('report button not found')
    }
    return button
}

beforeEach(() => {
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '' })))
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
})

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
})

describe('RealmPopUp.svelte: the report control asks before it sends anything', () => {
    test('without acceptance, declining the agreement prompt sends no report', async () => {
        const target = mountRealmPopUp()
        reportButton(target).click()
        await waitFor(() => get(alertStore).type === 'tos', 'the agreement prompt')
        alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE } as never)
        await settle()

        expect(fetch).not.toHaveBeenCalled()
    })

    test('the report prompt offers a cancel: answering it asks no agreement and sends nothing', async () => {
        localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
        resetUpstreamAgreementForTests()
        alertInputSpy.mockImplementationOnce(async (_msg, _list, _value, options) => options?.cancel ?? Promise.reject(new Error('no cancel offered')))

        const target = mountRealmPopUp()
        reportButton(target).click()
        await settle()

        expect(alertInputSpy.mock.calls[0][3]).toEqual({ cancel: ALERT_INPUT_CANCEL })
        expect(get(alertStore).type).toBe('none')
        expect(fetch).not.toHaveBeenCalled()
        expect(alertNormalSpy).not.toHaveBeenCalled()
    })

    test('with acceptance, the report is sent with its existing shape', async () => {
        localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
        resetUpstreamAgreementForTests()

        const target = mountRealmPopUp()
        reportButton(target).click()
        await settle()

        expect(fetch).toHaveBeenCalledWith(
            'https://hub.test/hub/report',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ id: 'reported-chara', report: 'a report' }),
            }),
        )
    })
})
