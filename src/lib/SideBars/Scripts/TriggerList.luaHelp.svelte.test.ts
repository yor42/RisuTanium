// @vitest-environment happy-dom

/**
 * The Help button under a Lua trigger opens this fork's wiki page for Lua scripting and never a URL on the
 * upstream hub.
 *
 * Mounts the REAL `TriggerList.svelte` over a Lua trigger list, bound the way `CharConfig.svelte` binds it.
 * The editors and the alert confirm are stubbed; `openURL` is a recording mock, and the hub address is a
 * recognisable fake so that any use of it is visible.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'
import type { Database, triggerscript } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    openURL: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock('src/lib/SideBars/Scripts/TriggerV2List.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SideBars/Scripts/TriggerV1List.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

//#endregion

import { language } from 'src/lang'
import { openURL } from 'src/ts/globalApi.svelte'
import { DBState } from 'src/ts/stores.svelte'
import TriggerList from './TriggerList.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('the Lua Help button', () => {
    test('opens the fork wiki page and never a hub URL', () => {
        const lua = [{ comment: '', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: 'x' }] }] as triggerscript[]
        DBState.db = { showDeprecatedTriggerV1: true, characters: [{ chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, chats: [], triggerscript: lua }] } as unknown as Database
        const target = document.createElement('div')
        document.body.appendChild(target)
        const props = {
            get value() { return lua },
            set value(_next: triggerscript[]) {},
        }
        mounted.push({ target, app: mount(TriggerList, { target, props }) as unknown as Record<string, unknown> })
        flushSync()
        const help = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.helpBlock)
        if (!help) throw new Error('help button not found')

        help.click()

        expect(vi.mocked(openURL)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(openURL).mock.calls[0][0]).toBe('https://github.com/yor42/RisuTanium/wiki/Lua-Scripting')
        expect(vi.mocked(openURL).mock.calls.flat().some((arg) => String(arg).startsWith('https://hub.invalid'))).toBe(false)
    })
})
