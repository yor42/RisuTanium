// @vitest-environment happy-dom

/**
 * The export select mode of the preset list. (R) = reproducer: fails when Export sends presets that are not ticked.
 * (G) = guard that may pass before and after the select mode existed.
 *
 * Mounts the REAL preset list over a `$state` database. MOCKED: the database module (spies), `alert`,
 * `characterCards`, the prebuilt templates, `stores.svelte` and the bundle flow, whose `downloadPresetBundle` records
 * the ids it is given.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import 'src/ts/polyfill'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const downloadPresetBundle = vi.hoisted(() => vi.fn(async (_ids: readonly string[]) => {}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        openPresetList: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/storage/database.svelte', async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => DBState.db),
        changeToPreset: vi.fn(),
        copyPreset: vi.fn(),
        downloadPreset: vi.fn(),
        importPreset: vi.fn(),
    }
})

vi.mock('src/ts/storage/presetBundleFlow', () => ({ downloadPresetBundle }))
vi.mock('src/ts/alert', () => ({
    alertCardExport: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
}))
vi.mock('src/ts/characterCards', () => ({ openRealmUpload: vi.fn() }))
vi.mock('src/ts/process/templates/templates', () => ({ prebuiltPresets: {} }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

//#endregion

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { changeToPreset } from 'src/ts/storage/database.svelte'
import BotPreset from './botpreset.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const mounted: Array<{ app: ReturnType<typeof mount>, target: HTMLElement }> = []

function installDb(): void {
    DBState.db = {
        botPresets: [
            { name: 'Alpha', id: 'a', slot: 1 },
            { name: 'Beta', id: 'b' },
            { name: 'Gamma', id: 'c' },
        ],
        botPresetsId: 0,
        showPromptComparison: false,
    } as unknown as Database
}

function mountList(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push({ app: mount(BotPreset, { target, props: { close: vi.fn() } }), target })
    flushSync()
    return target
}

const byLabel = (target: HTMLElement, label: string) => target.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
const rows = (target: HTMLElement) => [...target.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].filter((b) => b.querySelector('[data-select-mark]'))
const barButton = (target: HTMLElement, text: string) =>
    [...target.querySelectorAll<HTMLButtonElement>('[data-select-bar] button')].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement

function enterSelectMode(target: HTMLElement): void {
    byLabel(target, language.presetBundleSelect).click()
    flushSync()
}

beforeEach(() => {
    installDb()
    vi.clearAllMocks()
})

afterEach(async () => {
    for (const m of mounted.splice(0)) {
        await unmount(m.app)
        m.target.remove()
    }
})

describe('preset list select mode', () => {
    test('(G) outside select mode a row click switches preset and the bar is absent', () => {
        const target = mountList()
        expect(target.querySelector('[data-select-bar]')).toBeNull()
        const first = [...target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Beta')) as HTMLButtonElement
        first.click()
        expect(changeToPreset).toHaveBeenCalledWith(1)
    })

    test('(R) a row click in select mode toggles and does not switch preset', () => {
        const target = mountList()
        enterSelectMode(target)
        const [alpha, beta] = rows(target)
        expect(rows(target)).toHaveLength(3)
        beta.click()
        flushSync()
        expect(changeToPreset).not.toHaveBeenCalled()
        expect(beta.getAttribute('aria-pressed')).toBe('true')
        expect(alpha.getAttribute('aria-pressed')).toBe('false')
        beta.click()
        flushSync()
        expect(beta.getAttribute('aria-pressed')).toBe('false')
    })

    test('(R) Export is disabled at zero, shows the count, and sends exactly the ticked ids', async () => {
        const target = mountList()
        enterSelectMode(target)
        expect(barButton(target, 'Export').disabled).toBe(true)
        const [alpha, , gamma] = rows(target)
        gamma.click()
        alpha.click()
        flushSync()
        expect(barButton(target, 'Export').textContent?.trim()).toBe('Export 2')
        barButton(target, 'Export').click()
        await sleep(20)
        flushSync()
        expect(downloadPresetBundle).toHaveBeenCalledTimes(1)
        expect(downloadPresetBundle.mock.calls[0][0].toSorted()).toEqual(['a', 'c'])
        // select mode ends once the export finished
        expect(target.querySelector('[data-select-bar]')).toBeNull()
    })

    test('(R) All ticks every preset, a second press clears them, and Cancel leaves without exporting', () => {
        const target = mountList()
        enterSelectMode(target)
        barButton(target, language.presetBundleAll).click()
        flushSync()
        expect(rows(target).every((b) => b.getAttribute('aria-pressed') === 'true')).toBe(true)
        expect(barButton(target, 'Export').textContent?.trim()).toBe('Export 3')
        barButton(target, language.presetBundleAll).click()
        flushSync()
        expect(rows(target).every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true)
        barButton(target, language.cancel).click()
        flushSync()
        expect(target.querySelector('[data-select-bar]')).toBeNull()
        expect(downloadPresetBundle).not.toHaveBeenCalled()
    })

    test('select mode hides the per-row copy, export and remove controls', () => {
        const target = mountList()
        expect(target.querySelector(`[aria-label="${language.copy}"]`)).not.toBeNull()
        enterSelectMode(target)
        expect(target.querySelector(`[aria-label="${language.copy}"]`)).toBeNull()
        expect(target.querySelector(`[aria-label="${language.remove}"]`)).toBeNull()
    })
})
