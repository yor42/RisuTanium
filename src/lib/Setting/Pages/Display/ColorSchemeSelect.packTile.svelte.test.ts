// @vitest-environment jsdom
/**
 * The theme-pack tile of the colour-scheme picker (T23): it is its own scheme entry beside the presets and Custom, shown
 * while a pack with a default scheme is applied or the name is `theme-pack`, and pressed exactly while the name is
 * `theme-pack`. The driver, the apply core and `colorscheme.ts` are real over the same stand-ins as `packScheme.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { manifestText, validPackFiles, zipPack } from 'src/ts/themePack/fixtures/packBuilder'
//#region module mocks

const world = vi.hoisted(() => ({
    files: new Map<string, Uint8Array>(),
    getDb: (() => ({})) as () => unknown,
    setDatabase: undefined as unknown as ReturnType<typeof import('vitest').vi.fn>,
}))

const channel = vi.hoisted(() => ({
    spawns: 0,
    deferred: false,
    held: [] as Array<() => void>,
}))

vi.mock('src/ts/storage/store/appStore', () => ({
    getAppStore: async () => ({
        read: async (key: string) => ({ bytes: world.files.get(key) ?? null, version: null }),
    }),
    pageStoreIsOpfsTransitional: async () => false,
}))
vi.mock('src/ts/globalApi.svelte', () => ({
    getFileSrc: vi.fn(),
    downloadFile: vi.fn(),
    requestSaveNow: vi.fn(),
    saveAsset: vi.fn(async (data: Uint8Array, customId = '', fileName = '') => {
        const key = `assets/${customId}.${fileName.split('.').pop()}`
        world.files.set(key, data.slice())
        return key
    }),
}))
vi.mock('src/ts/storage/database.svelte', () => {
    world.setDatabase = vi.fn()
    return { getDatabase: vi.fn(() => world.getDb()), setDatabase: world.setDatabase }
})
vi.mock('src/ts/util', () => ({ BufferToText: vi.fn(), selectSingleFile: vi.fn(), sleep: vi.fn(async () => { }) }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn(), alertConfirm: vi.fn(async () => true), alertNormal: vi.fn() }))
vi.mock('src/ts/gui/systemBars', () => ({ syncSystemBars: vi.fn() }))
vi.mock('src/ts/stores.svelte', () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state, SafeModeStore: writable(false), CustomCSSStore: writable('') }
})
vi.mock('src/ts/themePack/worker/spawnJudgeWorker', async () => {
    const { handleJudgeRequest } = await import('src/ts/themePack/worker/judgeHandler')
    class FakeWorker {
        private readonly listeners: Array<(event: Event) => void> = []

        postMessage(message: Parameters<typeof handleJudgeRequest>[0]): void {
            const answer = handleJudgeRequest(message)
            const deliver = (): void => {
                for (const listener of this.listeners) listener(new MessageEvent('message', { data: answer }))
            }
            if (channel.deferred) {
                channel.held.push(deliver)
            } else {
                setTimeout(deliver, 0)
            }
        }

        terminate(): void { }

        addEventListener(type: string, listener: (event: Event) => void): void {
            if (type === 'message') this.listeners.push(listener)
        }
    }
    return { spawnJudgeWorker: () => { channel.spawns += 1; return new FakeWorker() } }
})

//#endregion

import { DBState, SafeModeStore } from 'src/ts/stores.svelte'
import { changeColorScheme, defaultColorScheme } from 'src/ts/gui/colorscheme'
import { runThemePackInstall, selectThemePack, resetThemePackInstallFlowForTests } from './themePackInstallFlow.svelte'
import { judgePackSheets } from 'src/ts/themePack'
import { installThemePack } from 'src/ts/themePack/install'
import { intakePackBytes } from 'src/ts/themePack/intake'
import { resetPackSheetForTests } from 'src/ts/themePack/apply'
import { resetThemePackApplyForTests, startThemePackApply, themePackApplyState } from 'src/ts/themePack/activePack.svelte'
import { declareSurface, installThemePackGate, resetThemePackGateForTests } from 'src/ts/themePack/surfaceGate.svelte'
import { resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import ColorSchemeSelect from './ColorSchemeSelect.svelte'

world.getDb = () => DBState.db

const LEAF = '[data-part="chat-message-avatar"]{opacity:1}'
const CORE = `:root{--nexus-canvas:#101820;--nexus-surface:#182430;--nexus-text:#f0f0f0}${LEAF}`
const NO_CORE = `:root{--nexus-accent:#8be9fd}${LEAF}`

function archive(sheet: string, name: string, packId: string): Uint8Array {
    return zipPack(validPackFiles({ 'manifest.json': manifestText({ name, packId }), 'chat.css': sheet }))
}

const db = (): Record<string, unknown> => DBState.db as unknown as Record<string, unknown>
const status = () => themePackApplyState()

async function until(done: () => boolean, what = 'the condition'): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt++) {
        flushSync()
        if (done()) {
            return
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    throw new Error(`timed out waiting for ${what}`)
}

const settle = (): Promise<void> => until(() => status().phase !== 'pending', 'the apply to settle')

async function installPack(bytes: Uint8Array): Promise<void> {
    await runThemePackInstall({
        pickFile: async () => ({ name: 'pack.risutheme', size: bytes.length }) as unknown as File,
        readFile: async () => bytes,
        intake: (verified) => intakePackBytes(verified, async (sheets) => judgePackSheets(sheets)),
        install: installThemePack,
        confirm: async () => true,
        notify: vi.fn(),
    })
    await settle()
}

function tile(target: HTMLElement): HTMLButtonElement | undefined {
    return [...target.querySelectorAll('button')].find((button) => button.getAttribute('title') === 'Theme pack')
}

let target: HTMLElement
let app: Record<string, unknown> | null = null
let shell: () => void = () => { }
let savedCreate: typeof URL.createObjectURL | undefined
let savedRevoke: typeof URL.revokeObjectURL | undefined

function mountPicker(): void {
    app = mount(ColorSchemeSelect, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => { })
    world.files.clear()
    world.setDatabase.mockClear()
    channel.spawns = 0
    channel.deferred = false
    channel.held.length = 0
    savedCreate = URL.createObjectURL
    savedRevoke = URL.revokeObjectURL
    URL.createObjectURL = (): string => 'blob:http://localhost/1'
    URL.revokeObjectURL = (): void => { }
    resetBusyActionsForTest()
    resetThemePackInstallFlowForTests()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    const custom = document.createElement('style')
    custom.id = 'customcss'
    document.body.appendChild(custom)
    target = document.createElement('div')
    document.body.appendChild(target)
    SafeModeStore.set(false)
    DBState.db = {
        themePacks: [], colorScheme: structuredClone(defaultColorScheme), colorSchemeName: 'default',
        customColorScheme: structuredClone(defaultColorScheme), textTheme: 'standard', customTextTheme: {},
    } as unknown as Database
    installThemePackGate(() => false)
    shell = declareSurface('chat')
    startThemePackApply()
    flushSync()
})

afterEach(async () => {
    if (app !== null) {
        await unmount(app as never)
        app = null
    }
    shell()
    resetThemePackApplyForTests()
    resetPackSheetForTests()
    resetThemePackGateForTests()
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-theme-pack-base')
    if (savedCreate !== undefined) URL.createObjectURL = savedCreate
    if (savedRevoke !== undefined) URL.revokeObjectURL = savedRevoke
    vi.restoreAllMocks()
})

describe('T23 the theme-pack tile', () => {
    it('T23a reproducer: with a colour pack applied and another scheme named, the tile is offered unpressed and a click enters the pack scheme', async () => {
        expect(selectThemePack('builtin:origin-navy', { notify: vi.fn() })).toBe('selected')
        await settle()
        changeColorScheme('default')
        mountPicker()

        const button = tile(target)
        expect(button, 'the Theme pack tile').toBeDefined()
        expect(button!.getAttribute('aria-pressed')).toBe('false')
        // The palette is the applied pack's canvas, rgb(33, 34, 44) in the serialised style.
        expect(button!.innerHTML).toContain('rgb(33, 34, 44) 0deg')

        button!.click()
        flushSync()
        expect(db().colorSchemeName).toBe('theme-pack')
        expect(tile(target)!.getAttribute('aria-pressed')).toBe('true')
        expect([...target.querySelectorAll('button')].filter((candidate) => candidate.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    })

    it('T23b: in Safe Mode under theme-pack the tile shows pressed with the stored palette, and a click writes nothing', async () => {
        const copy = { ...structuredClone(defaultColorScheme), bgcolor: '#123456' }
        db().colorSchemeName = 'theme-pack'
        db().colorScheme = copy
        db().activeThemePack = 'builtin:origin-navy'
        SafeModeStore.set(true)
        await settle()
        mountPicker()

        const button = tile(target)
        expect(button, 'the Theme pack tile').toBeDefined()
        expect(button!.getAttribute('aria-pressed')).toBe('true')
        expect(button!.innerHTML).toContain('rgb(18, 52, 86) 0deg')
        const before = JSON.stringify($state.snapshot(DBState.db))
        button!.click()
        flushSync()
        expect(JSON.stringify($state.snapshot(DBState.db))).toBe(before)
        expect(world.setDatabase).not.toHaveBeenCalled()
    })

    it('T23c guard: with no pack and another scheme there is no tile', () => {
        mountPicker()
        expect(tile(target)).toBeUndefined()
    })

    it('T23d: a pack without core colours gives no tile', async () => {
        await installPack(archive(NO_CORE, 'No core', 'nocore'))
        expect(status().phase).toBe('applied')
        mountPicker()
        expect(tile(target)).toBeUndefined()
    })

    it('T23: the tile appears when the pack finishes applying', async () => {
        mountPicker()
        expect(tile(target)).toBeUndefined()
        await installPack(archive(CORE, 'Core', 'core'))
        changeColorScheme('ocean')
        flushSync()
        expect(tile(target)).toBeDefined()
    })
})