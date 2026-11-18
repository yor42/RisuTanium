// @vitest-environment happy-dom

/**
 * `OtherBotSettings.svelte` exposes the HypaV3 recency option: a "Favor Recent Summaries" checkbox
 * bound to `enableRecencyWeighting`, and a half-life number input (days) that exists only while the
 * option is on and is bound to `recencyHalfLifeDays`.
 *
 * Mounts the REAL page on its long-term-memory tab with HypaV3 chosen, over a real `$state`
 * database. Controls are found by the English label literals, so a missing control fails on
 * "no control with this label" rather than on a lookup of an undefined key.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => true),
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
    saveAsset: vi.fn(),
    pickedAssetLimitBytes: vi.fn(),
    downloadFile: vi.fn(),
    globalFetch: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    selectSingleFileObject: vi.fn(),
    readPickedFileBytes: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/process/prompt'), () => ({
    tokenizePreset: vi.fn(async () => 0),
}) as unknown as typeof import('src/ts/process/prompt'))

vi.mock(import('src/ts/tokenizer'), () => ({
    getCharToken: vi.fn(async () => ({ persistant: 0, dynamic: 0 })),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { createHypaV3Preset } from 'src/ts/process/memory/hypaV3Presets'
import OtherBotSettings from './OtherBotSettings.svelte'

//#region helpers

const RECENCY_LABEL = 'Favor Recent Summaries'
const HALF_LIFE_LABEL = 'Recency Half-Life (Days)'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    flushSync()
    await sleep(20)
    flushSync()
}

function installDb(): void {
    DBState.db = {
        hypaV3: true,
        hypav2: false,
        hanuraiEnable: false,
        supaModelType: 'none',
        useLegacyGUI: false,
        wavespeedImage: {},
        hypaV3Presets: [createHypaV3Preset('A', {})],
        hypaV3PresetId: 0,
        characters: [{ chaId: 'c0', chats: [], chatPage: 0 }],
    } as unknown as Database
}

const active = () => DBState.db.hypaV3Presets[0].settings

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

async function mountSettings(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OtherBotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    await settle()
    return target
}

function findLabelContaining(root: HTMLElement, text: string): HTMLLabelElement | null {
    return Array.from(root.querySelectorAll('label')).find((l) => l.textContent?.includes(text)) ?? null
}

function recencyCheckbox(root: HTMLElement): HTMLInputElement | null {
    return findLabelContaining(root, RECENCY_LABEL)?.querySelector('input[type=checkbox]') ?? null
}

function halfLifeLabelSpan(root: HTMLElement): HTMLElement | null {
    return Array.from(root.querySelectorAll('span')).find(
        (s) => s.textContent?.includes(HALF_LIFE_LABEL) && !s.querySelector('span'),
    ) ?? null
}

function halfLifeInput(root: HTMLElement): HTMLInputElement | null {
    const label = halfLifeLabelSpan(root)
    if (!label) return null
    const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type=number]'))
    return inputs.find((i) => !!(label.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? null
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('the HypaV3 recency option on the settings page', () => {
    // regression reproducer: the page had no such control
    test('UI1: the "Favor Recent Summaries" checkbox starts off and toggles the flag', async () => {
        installDb()
        const root = await mountSettings()

        const checkbox = recencyCheckbox(root)
        expect(checkbox, 'no control with this label').not.toBeNull()
        expect(checkbox!.checked).toBe(false)
        expect(active().enableRecencyWeighting).toBe(false)

        checkbox!.click()
        await settle()

        expect(active().enableRecencyWeighting).toBe(true)
    })

    // regression reproducer: the shared checkbox query fails on the base; the "absent while off"
    // assertion alone passes on the base
    test('UI2: the half-life input shows only while on and writes the setting', async () => {
        installDb()
        const root = await mountSettings()

        const checkbox = recencyCheckbox(root)
        expect(checkbox, 'no control with this label').not.toBeNull()
        expect(root.textContent).not.toContain(HALF_LIFE_LABEL)

        checkbox!.click()
        await settle()

        expect(halfLifeLabelSpan(root)).not.toBeNull()
        const input = halfLifeInput(root)
        expect(input).not.toBeNull()
        expect(Number(input!.value)).toBe(30)

        input!.value = '14'
        input!.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()

        expect(active().recencyHalfLifeDays).toBe(14)
    })
})
