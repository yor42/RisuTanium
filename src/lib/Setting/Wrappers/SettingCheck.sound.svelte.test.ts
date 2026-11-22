// @vitest-environment jsdom

/**
 * The toggle cue of the data-driven `SettingCheck` (#246 S1b, MC-3565): a click plays `toggle-on` or `toggle-off`, a
 * change of the database made elsewhere plays nothing. Items and the `$state` stand-in for `DBState` are shaped as in
 * `SettingWrappers.names.svelte.test.ts`; the fake Web Audio of `uiSound.testKit.ts` is installed before the component is
 * imported.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Component } from 'svelte'
import type { Database } from 'src/ts/storage/database.svelte'
import type { SettingContext, SettingItem } from 'src/ts/setting/types'
import { installFakeAudio, warmUiSounds, type FakeAudio } from 'src/ts/uiSound/uiSound.testKit'

vi.mock(import('src/ts/alert'), () => ({
    alertMd: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selIdState: { state: -1 },
        disableHighlight: writable(false),
        popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/platform', () => ({
    isMobile: false,
    isTauri: false,
    isNodeServer: false,
}))

const ctx = {} as unknown as SettingContext

const checkItem: SettingItem = {
    id: 'test.check', type: 'check', labelKey: 'longPressToPopupEditor', bindKey: 'longPressToPopupEditor',
}

let SettingCheck: Component<{ item: SettingItem, ctx: SettingContext }>
let DBState: { db: Database }
let audio: FakeAudio
let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

const cueOf = (url: string): string => url.match(/\/(?:scifi|studio)\/([\w-]+)\.mp3$/)?.[1] ?? url
const cues = (): string[] => audio.startedUrls().map(cueOf)

function render(): HTMLInputElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(SettingCheck, { target, props: { item: checkItem, ctx } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target.querySelector<HTMLInputElement>('input[type="checkbox"]')!
}

function click(input: HTMLInputElement): void {
    input.click()
    flushSync()
}

beforeAll(async () => {
    audio = installFakeAudio()
    vi.useFakeTimers({ toFake: ['performance'] })
    DBState = (await import('src/ts/stores.svelte')).DBState as unknown as { db: Database }
    SettingCheck = (await import('./SettingCheck.svelte')).default as unknown as typeof SettingCheck
}, 120_000)

afterAll(() => {
    vi.useRealTimers()
    audio.uninstall()
})

beforeEach(async () => {
    localStorage.clear()
    audio.endVoices()
    audio.started.length = 0
    vi.advanceTimersByTime(10000)
    await warmUiSounds()
    DBState.db = { longPressToPopupEditor: false } as unknown as Database
})

afterEach(async () => {
    for (const m of mounted.splice(0)) {
        await unmount(m.app as never)
        m.target.remove()
    }
})

describe('T15 SettingCheck toggle cues', () => {
    test('reproducer (T15): turning a setting on plays toggle-on and turning it off plays toggle-off', () => {
        const input = render()

        click(input)
        expect(DBState.db.longPressToPopupEditor).toBe(true)
        expect(cues()).toEqual(['toggle-on'])

        vi.advanceTimersByTime(1000)
        click(input)
        expect(DBState.db.longPressToPopupEditor).toBe(false)
        expect(cues()).toEqual(['toggle-on', 'toggle-off'])
    })

    test('guard: a change of the database made elsewhere plays nothing', () => {
        const input = render()

        DBState.db.longPressToPopupEditor = true
        flushSync()

        expect(input.checked).toBe(true)
        expect(audio.started).toEqual([])
    })

    test('guard (T17): the switch off silences the toggle cue', () => {
        localStorage.setItem('risutanium.uiSounds', '0')
        const input = render()

        click(input)

        expect(DBState.db.longPressToPopupEditor).toBe(true)
        expect(audio.started).toEqual([])
    })
})
