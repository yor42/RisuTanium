// @vitest-environment happy-dom

/**
 * The Type dropdown of `OtherBotSettings.svelte` shows the memory system the request path runs
 * when several flags are set: Hanurai, then HypaMemory V2, then V3, then SupaMemory.
 *
 * Mounts the REAL component over a real `$state` database and reads the selected value of the
 * dropdown that lists the HypaMemory V3 option. Titles beginning "guard:" pin behaviour that is
 * the same before and after the change.
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
import OtherBotSettings from './OtherBotSettings.svelte'
import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { defaultBudgetTokens, LORE_RECALL_CAP_DEFAULT } from 'src/ts/process/memory/chroMemory/settings'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function installDb(flags: Partial<Record<'hypaV3' | 'hypav2' | 'hanuraiEnable' | 'ltmEngine', boolean>> & { supaModelType?: string }): void {
    DBState.db = {
        hypaV3: false,
        hypav2: false,
        hanuraiEnable: false,
        supaModelType: 'none',
        useLegacyGUI: false,
        wavespeedImage: {},
        hypaV3Presets: [{ name: 'A' }],
        hypaV3PresetId: 0,
        characters: [{ chaId: 'c0', chats: [], chatPage: 0 }],
        memoryAlgorithmType: 'none',
        ...flags,
    } as unknown as Database
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

async function typeSelect(): Promise<HTMLSelectElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OtherBotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await sleep(20)
    flushSync()
    const select = Array.from(target.querySelectorAll('select')).find((el) =>
        Array.from(el.options).some((option) => option.value === 'hypaV3'))
    if (!select) throw new Error('the memory type dropdown is not shown')
    return select
}

async function selectedType(): Promise<string> {
    return (await typeSelect()).value
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await sleep(20)
    flushSync()
}

const memoryFields = () => ({
    supaModelType: DBState.db.supaModelType,
    memoryAlgorithmType: DBState.db.memoryAlgorithmType,
    hypav2: DBState.db.hypav2,
    hanuraiEnable: DBState.db.hanuraiEnable,
    hypaV3: DBState.db.hypaV3,
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('the memory Type dropdown follows the request path precedence', () => {
    // regression reproducer: CHORE-10 UI-1 (dropdown part), MC-712 8
    test('Hanurai together with V3 shows Hanurai', async () => {
        installDb({ hanuraiEnable: true, hypaV3: true })
        expect(await selectedType()).toBe('hanuraiMemory')
    })

    test('Hanurai together with V2 shows Hanurai', async () => {
        installDb({ hanuraiEnable: true, hypav2: true })
        expect(await selectedType()).toBe('hanuraiMemory')
    })

    test('V2 together with V3 shows V2', async () => {
        installDb({ hypav2: true, hypaV3: true })
        expect(await selectedType()).toBe('hypaV2')
    })

    test('Hanurai together with SupaMemory shows Hanurai', async () => {
        installDb({ hanuraiEnable: true, supaModelType: 'distilbart' })
        expect(await selectedType()).toBe('hanuraiMemory')
    })

    test('guard: V3 together with SupaMemory shows V3', async () => {
        installDb({ hypaV3: true, supaModelType: 'distilbart' })
        expect(await selectedType()).toBe('hypaV3')
    })

    test('guard: SupaMemory alone shows SupaMemory', async () => {
        installDb({ supaModelType: 'distilbart' })
        expect(await selectedType()).toBe('supaMemory')
    })

    test('guard: no memory system shows none', async () => {
        installDb({})
        expect(await selectedType()).toBe('none')
    })
})

describe('ChroMemory in the memory Type dropdown', () => {
    const bodyText = () => document.body.textContent ?? ''

    test('UI6 reproducer: ChroMemory over V3 flags shows the ChroMemory value, option and description, and no V3 panel', async () => {
        installDb({ ltmEngine: true, hypaV3: true })
        const select = await typeSelect()
        expect(select.value).toBe('chroMemory')
        expect(Array.from(select.options).some((o) => o.value === 'chroMemory')).toBe(true)
        expect(bodyText()).toContain(language.chroMemoryDesc)
        expect(bodyText()).not.toContain(language.hypaV3Settings.descriptionLabel)
    })

    test('guard: a V3 database without ChroMemory shows no ChroMemory description and its V3 panel', async () => {
        installDb({ hypaV3: true })
        await typeSelect()
        expect(bodyText()).not.toContain(language.chroMemoryDesc)
        expect(bodyText()).toContain(language.hypaV3Settings.descriptionLabel)
    })

    test('reproducer: choosing chroMemory writes the ChroMemory table from every flag set', async () => {
        installDb({ hypaV3: true, hypav2: true, hanuraiEnable: true, supaModelType: 'subModel' })
        DBState.db.memoryAlgorithmType = 'hypaMemoryV3'
        await choose(await typeSelect(), 'chroMemory')
        expect(memoryFields()).toEqual({ supaModelType: 'none', memoryAlgorithmType: 'none', hypav2: false, hanuraiEnable: false, hypaV3: false })
        expect(DBState.db.ltmEngine).toBe(true)
    })
})

describe('the ChroMemory budget input (UI6)', () => {
    const bodyText = () => document.body.textContent ?? ''

    async function budgetInput(settings?: unknown, maxContext = 8000): Promise<HTMLInputElement> {
        installDb({ ltmEngine: true })
        Object.assign(DBState.db, { maxContext })
        if (settings !== undefined) (DBState.db as unknown as Record<string, unknown>).ltmSettings = settings
        const select = await typeSelect()
        const root = select.closest('div')!.parentElement!
        const input = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="number"]')).find((el) =>
            (el.getAttribute('aria-labelledby') ?? '').endsWith('-chro-budget'))
        if (!input) throw new Error('the budget input is not shown')
        return input
    }
    const stored = () => (DBState.db as unknown as { ltmSettings?: unknown }).ltmSettings

    async function type(input: HTMLInputElement, text: string, commit: boolean): Promise<void> {
        input.value = text
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        if (commit) input.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        await sleep(5)
    }

    test('the description fills the automatic budget for the current context size', async () => {
        await budgetInput(undefined, 8000)
        expect(bodyText()).toContain(fillLang(language.chroMemoryBudgetDesc, { tokens: defaultBudgetTokens(8000) }))
    })

    test('mounting over a stored budget shows it, and writes nothing', async () => {
        const settings = { budgetTokens: 900, future: { x: 1 } }
        const input = await budgetInput(settings)
        expect(input.value).toBe('900')
        expect(stored()).toEqual({ budgetTokens: 900, future: { x: 1 } })
    })

    test('mounting over a bad ltmSettings shape shows blank and writes nothing', async () => {
        const input = await budgetInput('garbage')
        expect(input.value).toBe('')
        expect(stored()).toBe('garbage')
    })

    test('typing 0, a minus sign or a decimal writes nothing until change', async () => {
        const input = await budgetInput({ budgetTokens: 900, future: { x: 1 } })
        for (const text of ['0', '-', '1500.5']) {
            await type(input, text, false)
            expect(stored()).toEqual({ budgetTokens: 900, future: { x: 1 } })
        }
    })

    test('change writes the normalized value and keeps unknown keys', async () => {
        const input = await budgetInput({ budgetTokens: 900, future: { x: 1 } })
        await type(input, '1500', true)
        expect(stored()).toEqual({ budgetTokens: 1500, future: { x: 1 } })
        expect(input.value).toBe('1500')
    })

    test('G2-F8: a rejected value over an already blank field is cleared from the display, though the stored value did not change', async () => {
        for (const text of ['0', '1500.5']) {
            document.body.innerHTML = ''
            const input = await budgetInput({ future: { x: 1 } })
            await type(input, text, true)
            expect(stored()).toEqual({ future: { x: 1 } })
            expect(input.value).toBe('')
        }
    })

    test('change with a value that is not a positive integer deletes the key, and the field shows blank (G2-F8)', async () => {
        for (const text of ['0', '1500.5', '']) {
            document.body.innerHTML = ''
            const input = await budgetInput({ budgetTokens: 900, future: { x: 1 } })
            await type(input, text, true)
            expect(stored()).toEqual({ future: { x: 1 } })
            expect(input.value).toBe('')
        }
    })
})

describe('choosing an option in the memory Type dropdown writes all five engine fields', () => {
    // compatibility guard: the table is the one the page wrote before the engine helper existed,
    // so it passes before and after the change.
    const table: Array<[string, ReturnType<typeof memoryFields>]> = [
        ['none', { supaModelType: 'none', memoryAlgorithmType: 'none', hypav2: false, hanuraiEnable: false, hypaV3: false }],
        ['supaMemory', { supaModelType: 'distilbart', memoryAlgorithmType: 'supaMemory', hypav2: false, hanuraiEnable: false, hypaV3: false }],
        ['hypaV2', { supaModelType: 'distilbart', memoryAlgorithmType: 'hypaMemoryV2', hypav2: true, hanuraiEnable: false, hypaV3: false }],
        ['hanuraiMemory', { supaModelType: 'none', memoryAlgorithmType: 'hanuraiMemory', hypav2: false, hanuraiEnable: true, hypaV3: false }],
        ['hypaV3', { supaModelType: 'none', memoryAlgorithmType: 'hypaMemoryV3', hypav2: false, hanuraiEnable: false, hypaV3: true }],
    ]

    for (const [option, expected] of table) {
        test(`guard: ${option}, starting from every flag set`, async () => {
            installDb({ hypaV3: true, hypav2: true, hanuraiEnable: true, supaModelType: 'subModel' })
            DBState.db.memoryAlgorithmType = 'hypaMemoryV3'
            const select = await typeSelect()
            await choose(select, option)
            expect(memoryFields()).toEqual(expected)
        })

        test(`guard: ${option}, starting from no memory system`, async () => {
            installDb({})
            const select = await typeSelect()
            await choose(select, option)
            expect(memoryFields()).toEqual(expected)
        })
    }
})

describe('the lore recall cap input (S18)', () => {
    const bodyText = () => document.body.textContent ?? ''

    async function capInput(settings?: unknown, chroOn = true): Promise<HTMLInputElement | undefined> {
        installDb({ ltmEngine: chroOn })
        Object.assign(DBState.db, { maxContext: 8000 })
        if (settings !== undefined) (DBState.db as unknown as Record<string, unknown>).ltmSettings = settings
        const select = await typeSelect()
        const root = select.closest('div')!.parentElement!
        return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="number"]')).find((el) =>
            (el.getAttribute('aria-labelledby') ?? '').endsWith('-chro-lore-cap'))
    }
    const stored = () => (DBState.db as unknown as { ltmSettings?: unknown }).ltmSettings

    async function type(input: HTMLInputElement, text: string): Promise<void> {
        input.value = text
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        input.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        await sleep(5)
    }

    test('S18 (R): the input shows beside the budget with the default in its description, and only while ChroMemory is on', async () => {
        const input = await capInput()
        expect(input).toBeDefined()
        expect(bodyText()).toContain(fillLang(language.chroMemoryLoreRecallCapDesc, { tokens: LORE_RECALL_CAP_DEFAULT }))
        document.body.innerHTML = ''
        expect(await capInput(undefined, false)).toBeUndefined()
    })

    test('S18 (R): mounting over a stored cap shows it and writes nothing; a bad shape shows blank', async () => {
        const settings = { loreRecallCap: 1234, future: { x: 1 } }
        const input = await capInput(settings)
        expect(input!.value).toBe('1234')
        expect(stored()).toEqual({ loreRecallCap: 1234, future: { x: 1 } })
        document.body.innerHTML = ''
        const blank = await capInput('garbage')
        expect(blank!.value).toBe('')
        expect(stored()).toBe('garbage')
    })

    test('S18 (R): change writes the integer and keeps unknown keys and the budget', async () => {
        const input = await capInput({ budgetTokens: 900, future: { x: 1 } })
        await type(input!, '1500')
        expect(stored()).toEqual({ budgetTokens: 900, loreRecallCap: 1500, future: { x: 1 } })
        expect(input!.value).toBe('1500')
    })

    test('S18 (R): a blank, zero or decimal value removes the key, so the default applies, and the field shows blank', async () => {
        for (const text of ['', '0', '1500.5']) {
            document.body.innerHTML = ''
            const input = await capInput({ budgetTokens: 900, loreRecallCap: 1234, future: { x: 1 } })
            await type(input!, text)
            expect(stored()).toEqual({ budgetTokens: 900, future: { x: 1 } })
            expect(input!.value).toBe('')
        }
    })
})
