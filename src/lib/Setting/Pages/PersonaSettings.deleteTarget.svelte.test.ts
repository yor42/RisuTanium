// @vitest-environment happy-dom

/**
 * `PersonaSettings.svelte`'s remove button removes the persona that was selected when the
 * user pressed it, and only that persona, however the persona list or the selection
 * changes while its confirmation is open; the last remaining persona is never removed and
 * switching to the first persona never throws.
 *
 * Mounts the REAL `PersonaSettings.svelte` over the real `src/ts/persona.ts` and a real
 * `$state` database. The alert confirm is a mock the test holds open and answers. Titles
 * beginning "guard:" pin behaviour that must be preserved before and after the change;
 * every other test is a regression reproducer for the behaviour it names.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'
import { changeUserPersona } from 'src/ts/persona'

//#region module mocks

const confirms = vi.hoisted(() => {
    const pending: Array<{ message: string, settle: (answer: boolean) => void }> = []
    return {
        pending,
        ask: (message: string) => new Promise<boolean>((settle) => { pending.push({ message, settle }) }),
    }
})

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: confirms.ask,
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

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
    selectSingleFile: vi.fn(),
    sortableOptions: { delay: 300, delayOnTouchOnly: true, filter: '.no-sort', onMove: () => true },
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(),
    setDatabase: vi.fn(),
    saveImage: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    downloadFile: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('src/ts/pngChunk'))

vi.mock('sortablejs/modular/sortable.core.esm.js', () => ({
    default: { create: () => ({ destroy() {} }) },
}))

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import PersonaSettings from './PersonaSettings.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

/** Persona `pn` has the prompt `prompt-pn`; the live fields start as the selected persona's. */
function installDb(personaNames: string[], selected: number): void {
    const personas = personaNames.map((name) => ({ name, icon: '', personaPrompt: 'prompt-' + name, note: '', id: 'id-' + name }))
    DBState.db = {
        personas,
        selectedPersona: selected,
        username: personas[selected].name,
        userIcon: '',
        personaPrompt: personas[selected].personaPrompt,
        userNote: '',
    } as unknown as Database
}

const names = () => DBState.db.personas.map((p) => p.name)

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function mountPersonas(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PersonaSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

async function clickRemove(target: HTMLElement): Promise<void> {
    const button = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.remove.trim())
    if (!button) throw new Error('remove button not found')
    button.click()
    await settle()
}

async function answer(value: boolean): Promise<void> {
    const next = confirms.pending.shift()
    if (!next) throw new Error('no confirmation is open')
    next.settle(value)
    await settle()
}

beforeEach(() => {
    confirms.pending.length = 0
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('a persona remove', () => {
    test('guard: the selected persona is removed, no other, and the first persona is loaded', async () => {
        installDb(['p0', 'p1', 'p2'], 1)
        const target = mountPersonas()
        await clickRemove(target)
        expect(confirms.pending.length).toBe(1)
        await answer(true)
        expect(names()).toEqual(['p0', 'p2'])
        expect(DBState.db.selectedPersona).toBe(0)
        expect(DBState.db.username).toBe('p0')
        expect(DBState.db.personaPrompt).toBe('prompt-p0')
    })

    test('guard: refusing the confirmation removes nothing', async () => {
        installDb(['p0', 'p1'], 1)
        const target = mountPersonas()
        await clickRemove(target)
        await answer(false)
        expect(names()).toEqual(['p0', 'p1'])
        expect(DBState.db.selectedPersona).toBe(1)
    })

    test('guard: the only persona has no confirmation and is kept', async () => {
        installDb(['p0'], 0)
        const target = mountPersonas()
        await clickRemove(target)
        expect(confirms.pending.length).toBe(0)
        expect(names()).toEqual(['p0'])
    })

    test('a persona removed above the selected one while the confirmation is open does not change which persona is removed', async () => {
        installDb(['p0', 'p1', 'p2'], 1)
        const target = mountPersonas()
        await clickRemove(target)
        DBState.db.personas.splice(0, 1)
        flushSync()
        await answer(true)
        expect(names()).toEqual(['p2'])
    })

    test('two pending removes of the selected persona remove it once and never empty the list', async () => {
        installDb(['p0', 'p1'], 1)
        const target = mountPersonas()
        await clickRemove(target)
        await clickRemove(target)
        expect(confirms.pending.length).toBe(2)
        await answer(true)
        await answer(true)
        expect(names()).toEqual(['p0'])
        expect(DBState.db.selectedPersona).toBe(0)
    })

    test('a persona removed by something else while its confirmation is open leaves every other persona in place', async () => {
        installDb(['p0', 'p1', 'p2'], 1)
        const target = mountPersonas()
        await clickRemove(target)
        DBState.db.personas.splice(1, 1)
        DBState.db.selectedPersona = 0
        flushSync()
        await answer(true)
        expect(names()).toEqual(['p0', 'p2'])
        expect(DBState.db.selectedPersona).toBe(0)
    })

    test('a delete whose confirmation outlives all but its own persona keeps that last persona', async () => {
        installDb(['p0', 'p1'], 1)
        const target = mountPersonas()
        await clickRemove(target)
        DBState.db.personas.splice(0, 1)
        DBState.db.selectedPersona = 0
        flushSync()
        await answer(true)
        expect(names()).toEqual(['p1'])
    })
})

describe('a persona remove while the selection moves', () => {
    test('when another persona is selected during the confirmation, its live edits are saved into it and the confirmed persona is removed', async () => {
        installDb(['p0', 'p1', 'p2'], 1)
        const target = mountPersonas()
        await clickRemove(target)
        changeUserPersona(0)
        DBState.db.username = 'edited-p0'
        flushSync()
        await answer(true)
        expect(names()).toEqual(['edited-p0', 'p2'])
        expect(DBState.db.selectedPersona).toBe(0)
        expect(DBState.db.username).toBe('edited-p0')
    })
})