// @vitest-environment happy-dom

/**
 * Android Back on the Realm upload frame does what its close button does, and Back on the Realm
 * info popup does what a backdrop click does. (R) = regression reproducer: fails on a base without
 * the Back handler (the store does not change and the quit warning shows); (G) = guard that may
 * pass before and after. The reproducers import only modules that exist on the pre-fix base.
 *
 * MOCKED: `alert`, `realm`, `realmUploadUrl`, `util` (a sleep that never resolves), the database
 * module, `characterCards`, `stores.svelte` and `alertBack`. The quit warning is a spy. The popup
 * is mounted directly: it registers inside itself, so the App host and the Realm tab host, which
 * both mount this component, are covered by the same registration.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { hubType } from 'src/ts/characterCards'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'

//#region module mocks

vi.mock(import('src/ts/alert'), () => ({
    alertMd: vi.fn(),
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/realm'), () => ({
    shareRealmCardData: vi.fn(async () => ({ name: new ArrayBuffer(1), data: new ArrayBuffer(1) })),
}) as unknown as typeof import('src/ts/realm'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    downloadPreset: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/realmUploadUrl'), () => ({
    getRealmUploadUrl: vi.fn(() => 'https://realm.risuai.net/upload'),
}) as unknown as typeof import('src/ts/realmUploadUrl'))

vi.mock(import('src/ts/util'), async (importOriginal) => ({
    ...await importOriginal(),
    sleep: vi.fn(() => new Promise(() => {})),
}))

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    downloadRisuHub: vi.fn(),
    getRealmInfo: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { characters: [], hideAllImages: false } as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(0),
        ShowRealmFrameStore: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

//#endregion

import { ShowRealmFrameStore } from 'src/ts/stores.svelte'
import { installBackGuard, resetBackHandlersForTests } from 'src/ts/backHandlers'
import RealmFrame from './RealmFrame.svelte'
import RealmPopUp from './RealmPopUp.svelte'

const showToast = vi.fn()
const mounted: Array<ReturnType<typeof mount>> = []

function pressBack(): boolean {
    const result = window.__risuTaniumBack?.()
    flushSync()
    return result === true
}

function mountFrame(): { target: HTMLElement; destroy: () => void } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(RealmFrame, { target, props: {} })
    mounted.push(component)
    flushSync()
    const iframe = target.querySelector('iframe')
    if (iframe) {
        Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage: vi.fn() } })
    }
    return {
        target,
        destroy: () => {
            unmount(component)
            mounted.splice(mounted.indexOf(component), 1)
            target.remove()
        },
    }
}

function makeChara(): hubType {
    return {
        name: 'popup-chara', desc: '', download: '', id: 'popup-chara', img: '', tags: [],
        viewScreen: 'none', hasLore: false, hasEmotion: false, hasAsset: false, hot: 0,
        license: '', type: 'character',
    }
}

/** The popup with a non-reactive bound prop: the host unmounts on null, which the test reads. */
function mountPopUp(): { target: HTMLElement; host: { value: hubType | null }; destroy: () => void } {
    const host: { value: hubType | null } = { value: makeChara() }
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(RealmPopUp, {
        target,
        props: {
            get openedData() { return host.value as hubType },
            set openedData(next: hubType | null) { host.value = next },
        },
    })
    mounted.push(component)
    flushSync()
    return {
        target,
        host,
        destroy: () => {
            unmount(component)
            mounted.splice(mounted.indexOf(component), 1)
            target.remove()
        },
    }
}

beforeEach(() => {
    ;(window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM.settings.disableIframePageLoading = true
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    showToast.mockReset()
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    ShowRealmFrameStore.set('character')
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    document.body.replaceChildren()
    ShowRealmFrameStore.set('')
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    resetBackHandlersForTests()
    vi.useRealTimers()
})

describe('Realm frame Back', () => {
    test('(R) Back closes the frame, then the root warns', () => {
        mountFrame()
        expect(get(ShowRealmFrameStore)).toBe('character')
        expect(pressBack()).toBe(true)
        expect(get(ShowRealmFrameStore)).toBe('')
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(G) Back leaves the store as the close button does', () => {
        const first = mountFrame()
        const button = Array.from(first.target.querySelectorAll('button')).find((b) => b.textContent === '×')
        button?.click()
        flushSync()
        const afterButton = get(ShowRealmFrameStore)
        first.destroy()
        ShowRealmFrameStore.set('character')
        mountFrame()
        pressBack()
        expect(get(ShowRealmFrameStore)).toBe(afterButton)
        expect(afterButton).toBe('')
    })

    test('(G) a frame that closed itself without acceptance does not answer Back', () => {
        localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
        resetUpstreamAgreementForTests()
        mountFrame()
        flushSync()
        expect(get(ShowRealmFrameStore)).toBe('')
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(G) an unmounted frame stops answering Back', () => {
        const { destroy } = mountFrame()
        destroy()
        expect(pressBack()).toBe(true)
        expect(get(ShowRealmFrameStore)).toBe('character')
        expect(showToast).toHaveBeenCalledTimes(1)
    })
})

describe('Realm info popup Back', () => {
    test('(R) Back closes the popup, then the root warns', () => {
        const { host } = mountPopUp()
        expect(pressBack()).toBe(true)
        expect(host.value).toBeNull()
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(G) Back leaves the bound value as a backdrop click does', () => {
        const first = mountPopUp()
        ;(first.target.firstElementChild as HTMLElement).click()
        flushSync()
        expect(first.host.value).toBeNull()
        first.destroy()
        const second = mountPopUp()
        pressBack()
        expect(second.host.value).toBeNull()
    })

    test('(G) an unmounted popup stops answering Back', () => {
        const { destroy, host } = mountPopUp()
        destroy()
        expect(pressBack()).toBe(true)
        expect(host.value).not.toBeNull()
        expect(showToast).toHaveBeenCalledTimes(1)
    })
})
