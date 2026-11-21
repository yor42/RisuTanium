// @vitest-environment jsdom
/**
 * The theme-pack scheme invariants the main file leaves open: lite gives shape mode with no write (A18), Safe Mode with a
 * pending request writes nothing (Invariant 10), a broken update keeps the copy (Invariant 11) and a turn-on whose commit
 * fails is left, not entered (SC.7). Same harness as packScheme.svelte.test.ts.
 * REAL: the driver, the apply core, the intake, the validator (through the real worker handler behind a fake channel), the
 * surface gate, `install.ts`, the install flow, and `colorscheme.ts` painting into the jsdom root. FAKED: the page store
 * (an in-memory read and write), `URL.createObjectURL`/`revokeObjectURL` (jsdom has neither), the worker channel (real
 * verdicts, no real Worker) and `DBState`, which is a real `$state` object. Packs come from `zipPack`, the golden producer
 * (MC-329). Titles say `reproducer` (fails on the pre-change code at the named assertion) or `guard` (passes before and after).
 */
import { createHash } from 'node:crypto'
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../storage/database.svelte'
import { resetBusyActionsForTest } from '../process/memory/busyActions'
import { resetRestoreInProgressForTests } from '../drive/restoreInProgress'
import { resetPageStorageModeForTests } from '../storage/pageStorageMode'
import { manifestText, PNG_1X1, validPackFiles, zipPack } from './fixtures/packBuilder'

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

vi.mock('../storage/store/appStore', () => ({
    getAppStore: async () => ({
        read: async (key: string) => ({ bytes: world.files.get(key) ?? null, version: null }),
    }),
    pageStoreIsOpfsTransitional: async () => false,
}))
vi.mock('../globalApi.svelte', () => ({
    getFileSrc: vi.fn(),
    downloadFile: vi.fn(),
    requestSaveNow: vi.fn(),
    saveAsset: vi.fn(async (data: Uint8Array, customId = '', fileName = '') => {
        const key = `assets/${customId}.${fileName.split('.').pop()}`
        world.files.set(key, data.slice())
        return key
    }),
}))
vi.mock('../storage/database.svelte', () => {
    world.setDatabase = vi.fn()
    return { getDatabase: vi.fn(() => world.getDb()), setDatabase: world.setDatabase }
})
vi.mock('../util', () => ({ BufferToText: vi.fn(), selectSingleFile: vi.fn(), sleep: vi.fn(async () => { }) }))
vi.mock('../alert', () => ({ alertError: vi.fn(), alertConfirm: vi.fn(async () => true), alertNormal: vi.fn() }))
vi.mock('../gui/systemBars', () => ({ syncSystemBars: vi.fn() }))
vi.mock('../stores.svelte', () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state, SafeModeStore: writable(false), CustomCSSStore: writable('') }
})
vi.mock('./worker/spawnJudgeWorker', async () => {
    const { handleJudgeRequest } = await import('./worker/judgeHandler')
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

import { DBState, SafeModeStore } from '../stores.svelte'
import { changeColorScheme, colorSchemePresets, defaultColorScheme, updateColorScheme, type ColorScheme } from '../gui/colorscheme'
import { runThemePackInstall, removeThemePack, selectThemePack, resetThemePackInstallFlowForTests } from '../../lib/Setting/Pages/Display/themePackInstallFlow.svelte'
import { judgePackSheets, judgeAreaSheet } from './index'
import { installThemePack } from './install'
import { intakePackBytes } from './intake'
import { listThemePacks } from './packRecord'
import { BUILTIN_PACKS } from './builtins'
import { resetPackSheetForTests } from './apply'
import {
    adoptActivePackScheme, pendingPackSchemeRequestForTests, resetThemePackApplyForTests, startThemePackApply, themePackApplyState,
} from './activePack.svelte'
import { declareSurface, installThemePackGate, resetThemePackGateForTests } from './surfaceGate.svelte'
import { decls } from './csslit'
import { isLite } from '../lite'
import { SHAPE_PROPERTY } from './shapeMode'

//#region fixtures

world.getDb = () => DBState.db

const CUSTOM: ColorScheme = {
    bgcolor: '#101010', darkbg: '#202020', borderc: '#303030', selected: '#404040', draculared: '#505050',
    textcolor: '#606060', textcolor2: '#123456', darkBorderc: '#707070', darkbutton: '#808080', type: 'dark',
}
const OWN_COPY: ColorScheme = {
    bgcolor: '#111111', darkbg: '#222222', borderc: '#333333', selected: '#444444', draculared: '#555555',
    textcolor: '#666666', textcolor2: '#777777', darkBorderc: '#888888', darkbutton: '#999999', type: 'light',
}

const LEAF = '[data-part="chat-message-avatar"]{opacity:1}'
const coreSheet = (canvas: string, extra = ''): string => `:root{--nexus-canvas:${canvas};--nexus-surface:#182430;--nexus-text:#f0f0f0}${LEAF}${extra}`
const CORE_V1 = coreSheet('#101820')
const CORE_V2 = coreSheet('#203040')
/** Only an accent: no default scheme (MC-3001). */
const NO_CORE = `:root{--nexus-accent:#8be9fd}${LEAF}`
/** P5: the judge accepts a token background with a literal text colour, which only colour mode may keep. */
const P5 = '[data-part="chat-send"]{background-color:var(--nexus-accent) !important;color:#000000 !important}'

function archive(sheet: string, name: string, packId: string, extra: Record<string, string | Uint8Array> = {}): Uint8Array {
    return zipPack(validPackFiles({ 'manifest.json': manifestText({ name, packId }), 'chat.css': sheet, ...extra }))
}

function freshDb(extra: Record<string, unknown> = {}): Database {
    return {
        themePacks: [], colorScheme: structuredClone(defaultColorScheme), colorSchemeName: 'default', customColorScheme: structuredClone(CUSTOM),
        textTheme: 'standard', customTextTheme: {}, font: 'default', customCSS: '', ...extra,
    } as unknown as Database
}

const blobs = { minted: [] as string[], revoked: [] as string[] }
let savedCreate: typeof URL.createObjectURL | undefined
let savedRevoke: typeof URL.revokeObjectURL | undefined

function installUrlFake(): void {
    savedCreate = URL.createObjectURL
    savedRevoke = URL.revokeObjectURL
    URL.createObjectURL = (): string => {
        const url = `blob:http://localhost/${blobs.minted.length + 1}`
        blobs.minted.push(url)
        return url
    }
    URL.revokeObjectURL = (url: string): void => {
        blobs.revoked.push(url)
    }
}

function restoreUrlFake(): void {
    for (const [name, saved] of [['createObjectURL', savedCreate], ['revokeObjectURL', savedRevoke]] as const) {
        if (saved === undefined) {
            Reflect.deleteProperty(URL, name)
        } else {
            Object.defineProperty(URL, name, { value: saved, configurable: true, writable: true })
        }
    }
}

function resetDocument(): void {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-theme-pack-base')
    const app = document.createElement('style')
    app.id = 'appcss'
    document.head.appendChild(app)
    const custom = document.createElement('style')
    custom.id = 'customcss'
    document.body.appendChild(custom)
}

const status = () => themePackApplyState()
const packElements = (): HTMLStyleElement[] => [...document.querySelectorAll<HTMLStyleElement>('style[data-theme-pack]')]
const packText = (): string => packElements()[0]?.textContent ?? ''
const baseAttribute = (): string | null => document.documentElement.getAttribute('data-theme-pack-base')
const bgcolor = (): string => document.documentElement.style.getPropertyValue('--risu-theme-bgcolor')
const db = (): Record<string, unknown> => DBState.db as unknown as Record<string, unknown>
const plain = <T>(value: T): T => $state.snapshot(value) as T

/** Runs the pending effects and waits macro tasks until `done` holds. */
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

async function settle(): Promise<void> {
    await until(() => status().phase !== 'pending', 'the apply to settle')
}

/** Releases every held judge answer, repeatedly, until the apply settles (a held run asks the judge more than once). */
async function releaseAll(): Promise<void> {
    await until(() => {
        while (channel.held.length > 0) {
            channel.held.shift()?.()
        }
        return status().phase !== 'pending'
    }, 'the held judge answers')
}

async function turnOn(id: string): Promise<void> {
    expect(selectThemePack(id, { notify: vi.fn() })).toBe('selected')
    await settle()
}

function turnOff(): void {
    expect(selectThemePack(undefined, { notify: vi.fn() })).toBe('selected')
    flushSync()
}

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

function archiveRecord(id: string, bytes: Uint8Array, stored: boolean): Record<string, unknown> {
    const archive = `assets/tp-${createHash('sha256').update(bytes).digest('hex')}.risutheme`
    if (stored) {
        world.files.set(archive, bytes.slice())
    }
    return { v: 1, id, name: `Pack ${id}`, version: '1.0.0', license: 'MIT', attribution: 'Test author', modes: ['dark'], fonts: [], archive, bytes: bytes.length, installedAt: 1 }
}

const schemeFields = (): { name: unknown, scheme: ColorScheme } => plain({ name: db().colorSchemeName, scheme: db().colorScheme as ColorScheme })

//#endregion

let errorLog: ReturnType<typeof vi.spyOn>
let shell: () => void = () => { }

beforeEach(() => {
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => { })
    world.files.clear()
    world.setDatabase.mockClear()
    channel.spawns = 0
    channel.deferred = false
    channel.held.length = 0
    blobs.minted.length = 0
    blobs.revoked.length = 0
    resetBusyActionsForTest()
    resetRestoreInProgressForTests()
    resetPageStorageModeForTests()
    resetThemePackInstallFlowForTests()
    resetDocument()
    installUrlFake()
    SafeModeStore.set(false)
    DBState.db = freshDb()
    installThemePackGate(() => false)
    shell = declareSurface('chat')
    flushSync()
    startThemePackApply()
    flushSync()
})

afterEach(() => {
    errorLog.mockRestore()
    shell()
    resetThemePackApplyForTests()
    resetPackSheetForTests()
    resetThemePackGateForTests()
    restoreUrlFake()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-theme-pack-base')
})

describe('lite (A18)', () => {
    it('lite on gives shape mode with no write; lite off returns colour mode', async () => {
        await turnOn('builtin:origin-navy')
        expect(baseAttribute()).toBe('')
        const before = schemeFields()
        const snap = plain(db().themePackSchemeSnapshot)
        isLite.set(true)
        flushSync()
        expect(baseAttribute()).toBeNull()
        expect(packText()).not.toContain('--nexus-canvas')
        expect(schemeFields()).toEqual(before)
        expect(plain(db().themePackSchemeSnapshot)).toEqual(snap)
        isLite.set(false)
        flushSync()
        expect(baseAttribute()).toBe('')
        expect(packText()).toContain('--nexus-canvas')
        expect(schemeFields()).toEqual(before)
    })
    it('Safe Mode with a pending turn-on writes nothing and clears the request', async () => {
        channel.deferred = true
        expect(selectThemePack('builtin:origin-navy', { notify: vi.fn() })).toBe('selected')
        await until(() => channel.held.length > 0, 'the judge to be held')
        const before = schemeFields()
        SafeModeStore.set(true)
        flushSync()
        while (channel.held.length > 0) channel.held.shift()?.()
        await until(() => status().phase === 'none', 'none')
        expect(schemeFields()).toEqual(before)
        expect('themePackSchemeSnapshot' in db()).toBe(false)
        expect(pendingPackSchemeRequestForTests()).toBeNull()
        channel.deferred = false
        SafeModeStore.set(false)
        await until(() => status().phase === 'applied', 'reapplied')
        expect(schemeFields()).toEqual(before)
        expect(baseAttribute()).toBeNull()
    })
})
describe('Safe Mode from the pack scheme (Invariant 10)', () => {
    it('Safe Mode while a switch A to B is pending keeps the theme-pack name and the snapshot', async () => {
        await turnOn('builtin:origin-navy')
        expect(db().colorSchemeName).toBe('theme-pack')
        const before = schemeFields()
        const snap = plain(db().themePackSchemeSnapshot)
        channel.deferred = true
        expect(selectThemePack('builtin:banana-cocoa', { notify: vi.fn() })).toBe('selected')
        await until(() => channel.held.length > 0, 'the judge to be held')
        SafeModeStore.set(true)
        flushSync()
        while (channel.held.length > 0) channel.held.shift()?.()
        await until(() => status().phase === 'none', 'none')
        expect(schemeFields()).toEqual(before)
        expect(plain(db().themePackSchemeSnapshot)).toEqual(snap)
        expect(pendingPackSchemeRequestForTests()).toBeNull()
    })
})
describe('broken update keeps the copy (Invariant 11, MC-2953)', () => {
    it('an update whose archive the driver cannot verify keeps the name, copy and snapshot', async () => {
        await installPack(archive(CORE_V1, 'X', 'x'))
        expect(db().colorSchemeName).toBe('theme-pack')
        const before = schemeFields()
        const snap = plain(db().themePackSchemeSnapshot)
        const bytes = archive(CORE_V2, 'X', 'x')
        const key = `assets/tp-${createHash('sha256').update(bytes).digest('hex')}.risutheme`
        const realGet = world.files.get.bind(world.files)
        let reads = 0
        world.files.get = ((k: string) => {
            if (k === key) { reads += 1; if (reads >= 2) return new Uint8Array([1, 2, 3]) }
            return realGet(k)
        }) as typeof world.files.get
        await installPack(bytes)
        world.files.get = realGet
        expect(reads).toBeGreaterThanOrEqual(2)
        expect(status().phase).toBe('broken')
        expect(schemeFields()).toEqual(before)
        expect(plain(db().themePackSchemeSnapshot)).toEqual(snap)
    })
})
describe('a turn-on whose commit fails is left (SC.7)', () => {
    it('reproducer: a missing #customcss anchor leaves the entered scheme, the name and the snapshot', async () => {
        channel.deferred = true
        const before = schemeFields()
        expect(selectThemePack('builtin:origin-navy', { notify: vi.fn() })).toBe('selected')
        await until(() => channel.held.length > 0, 'the judge to be held')
        document.getElementById('customcss')?.remove()
        await releaseAll()
        expect(status().phase).toBe('broken')
        expect(schemeFields()).toEqual(before)
        expect('themePackSchemeSnapshot' in db()).toBe(false)
        expect(packElements()).toHaveLength(0)
    })
})

describe('a commit failure leaves only a scheme that request entered', () => {
    it('an update whose commit fails keeps the theme-pack name and the snapshot (no leave)', async () => {
        await installPack(archive(CORE_V1, 'X', 'x'))
        expect(db().colorSchemeName).toBe('theme-pack')
        const snap = plain(db().themePackSchemeSnapshot)
        expect(snap).toBeTruthy()
        channel.deferred = true
        const bytes = archive(CORE_V2, 'X', 'x')
        await runThemePackInstall({
            pickFile: async () => ({ name: 'pack.risutheme', size: bytes.length }) as unknown as File,
            readFile: async () => bytes,
            intake: (verified) => intakePackBytes(verified, async (sheets) => judgePackSheets(sheets)),
            install: installThemePack,
            confirm: async () => true,
            notify: vi.fn(),
        })
        await until(() => channel.held.length > 0, 'the judge to be held')
        expect(pendingPackSchemeRequestForTests()?.kind).toBe('update')
        document.getElementById('customcss')?.remove()
        await releaseAll()
        expect(status().phase).toBe('broken')
        expect(db().colorSchemeName).toBe('theme-pack')
        expect(plain(db().themePackSchemeSnapshot)).toEqual(snap)
    })
})
