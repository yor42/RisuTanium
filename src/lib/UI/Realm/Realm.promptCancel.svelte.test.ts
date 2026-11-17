// @vitest-environment happy-dom

/**
 * The Realm menu's "import from URL or ID" prompt offers a cancel no text field can produce, and the
 * handler returns before it reads the answer as an address, so a cancelled prompt never starts a
 * download. MOCKED: `src/ts/characterCards` (so no request goes out; `downloadRisuHub` is a spy),
 * `src/ts/stores.svelte`, the child components, and `alertInput`, which answers with the cancel its
 * caller offered and rejects when none was offered. Synthetic data only; nothing touches a Realm service.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { RisuHubResult } from 'src/ts/characterCards'
import { ALERT_INPUT_CANCEL } from 'src/ts/alertCancel'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'

//#region module mocks

const hubMock = vi.hoisted(() => ({
    getRisuHub: vi.fn(async () => ({ ok: true, cards: [], additionalHTML: '' } satisfies RisuHubResult)),
    downloadRisuHub: vi.fn(),
    alertInput: vi.fn<(msg: string, list?: unknown, value?: string, options?: { cancel?: string }) => Promise<string>>(),
}))

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: hubMock.getRisuHub,
    downloadRisuHub: hubMock.downloadRisuHub,
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/alert'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        alertInput: hubMock.alertInput,
    }
})

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

vi.mock('./RealmHubIcon.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('./RealmPopUp.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import RealmMain from './RealmMain.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountRealmMain() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(RealmMain, { target, props: {} }))
    flushSync()
    return target
}

async function settle() {
    for (let i = 0; i < 6; i++) {
        await Promise.resolve()
    }
    flushSync()
}

async function openImportPrompt(target: HTMLElement) {
    // The menu button is the second of the two buttons beside the search input.
    Array.from(target.querySelectorAll('button'))[1].click()
    flushSync()
    const importButton = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.uiCommon.importCharacterFromUrlOrId)
    expect(importButton).toBeDefined()
    importButton!.click()
    await settle()
}

beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    hubMock.downloadRisuHub.mockReset()
    hubMock.alertInput.mockReset()
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

describe('RealmMain.svelte: the import-by-URL-or-ID prompt', () => {
    test('answering the offered cancel starts no download', async () => {
        hubMock.alertInput.mockImplementation(async (_msg, _list, _value, options) => options?.cancel ?? Promise.reject(new Error('no cancel offered')))

        await openImportPrompt(mountRealmMain())

        expect(hubMock.alertInput).toHaveBeenCalledTimes(1)
        expect(hubMock.alertInput.mock.calls[0][3]).toEqual({ cancel: ALERT_INPUT_CANCEL })
        expect(hubMock.downloadRisuHub).not.toHaveBeenCalled()
    })

    test('guard: a typed ID still downloads that ID', async () => {
        hubMock.alertInput.mockResolvedValue('abc-123')

        await openImportPrompt(mountRealmMain())

        expect(hubMock.downloadRisuHub).toHaveBeenCalledWith('abc-123')
    })
})
