// @vitest-environment happy-dom

/**
 * `RealmFrame.svelte` shows the upload-success message in the active UI language and places
 * the Realm link where the translation puts `{link}`. The language module is switched per
 * test and restored to English afterwards. The Realm export, the alert and the stores are stubs.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'

const spies = vi.hoisted(() => ({ alertMd: vi.fn() }))

vi.mock(import('src/ts/alert'), () => ({
    alertMd: spies.alertMd,
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/realm'), () => ({
    shareRealmCardData: vi.fn(async () => ({ name: new ArrayBuffer(1), data: new ArrayBuffer(1) })),
}) as unknown as typeof import('src/ts/realm'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    downloadPreset: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/realmUploadUrl'), () => ({
    getRealmUploadUrl: () => 'https://realm.risuai.net/upload',
}) as unknown as typeof import('src/ts/realmUploadUrl'))
// Never resolves, so the ping loop parks after its first attempt.
vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(() => new Promise(() => {})),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { characters: [{ type: 'character' }] } as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ShowRealmFrameStore: writable('character'),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { changeLanguage } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import RealmFrame from './RealmFrame.svelte'
import { ShowRealmFrameStore } from 'src/ts/stores.svelte'

const LINK = '```\nhttps://realm.risuai.net/character/abc123\n```'
let instance: unknown
let target: HTMLElement

function mountAccepted(): void {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    target = document.createElement('div')
    document.body.appendChild(target)
    instance = mount(RealmFrame, { target, props: {} })
    flushSync()
    const iframe = target.querySelector('iframe')
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage: vi.fn() } })
}

async function uploadSucceeds(): Promise<void> {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'success', id: 'abc123' } }))
    await Promise.resolve()
    flushSync()
}

beforeEach(() => {
    ;(window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM.settings.disableIframePageLoading = true
    ShowRealmFrameStore.set('character')
    spies.alertMd.mockReset()
})

afterEach(async () => {
    await unmount(instance as never).catch(() => {})
    target.remove()
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    changeLanguage('en')
})

describe('RealmFrame upload success message', () => {
    test('guard: English shows the exact English text with the link at the end', async () => {
        mountAccepted()
        await uploadSucceeds()
        expect(spies.alertMd).toHaveBeenCalledWith(
            '## Upload Success\n\nYour character has been uploaded to Realm successfully.\n\n' + LINK)
        expect(languageEnglish.alerts.realmUploadSuccess).toContain('{link}')
    })

    test('regression reproducer: Korean shows the Korean locale text with the link filled in', async () => {
        changeLanguage('ko')
        mountAccepted()
        await uploadSucceeds()
        expect(spies.alertMd).toHaveBeenCalledWith(fillLang(languageKorean.alerts.realmUploadSuccess, { link: LINK }))
        expect(spies.alertMd.mock.calls[0][0]).toContain(LINK)
        expect(languageKorean.alerts.realmUploadSuccess).not.toBe(languageEnglish.alerts.realmUploadSuccess)
    })
})
