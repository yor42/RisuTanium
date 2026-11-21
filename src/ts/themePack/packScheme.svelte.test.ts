// @vitest-environment jsdom
/**
 * The theme-pack scheme end to end through the driver and the install flow (T1-T4, T13, T15, T18-T22, T29, T30, T32-T36).
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
import studioScratchWhite from '../../../docs/design/studio/themes/scratch-white.css?raw'

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

describe('turn-on, the live scheme and the mode (T1, T2, T4, T13, T29)', () => {
    it('T1 reproducer: turning on a built-in enters the theme-pack scheme, keeps the snapshot and never touches the Custom slot', async () => {
        const custom = plain(db().customColorScheme)
        await turnOn('builtin:origin-navy')
        expect(status().phase).toBe('applied')
        expect(db().colorSchemeName).toBe('theme-pack')
        expect((db().colorScheme as ColorScheme).bgcolor).toBe('#21222c')
        expect(plain(db().themePackSchemeSnapshot)).toMatchObject({ name: 'default' })
        expect(plain(db().customColorScheme)).toEqual(custom)
        expect(bgcolor()).toBe('#21222c')
        expect(baseAttribute()).toBe('')
    })

    it('T2 reproducer: after a later pick the live sheet has no paint property, no base attribute and keeps its shape tokens', async () => {
        await turnOn('builtin:origin-navy')
        changeColorScheme('light')
        flushSync()
        expect(baseAttribute()).toBeNull()
        const text = packText()
        expect(text).not.toContain('--nexus-canvas')
        expect(text).toContain('--radius-control: 8px')
        for (const decl of decls(text)) {
            expect(decl.prop.startsWith('--') || SHAPE_PROPERTY.some((rule) => rule.test(decl.prop)), decl.prop).toBe(true)
        }
        expect(bgcolor()).toBe(colorSchemePresets.light.bgcolor)
    })

    for (const pack of BUILTIN_PACKS) {
        it(`T4 guard: ${pack.slug} in colour mode applies today's judged text with today's base`, async () => {
            await turnOn(pack.id)
            expect(packText()).toBe(judgeAreaSheet('chat', pack.chatCss, undefined, 'chat').canonical)
            expect(baseAttribute()).toBe(pack.modes.length === 1 && pack.modes[0] === 'light' ? 'light' : '')
        })
    }

    it('T13 unit: the Custom slot is identical across every path', async () => {
        const custom = plain(db().customColorScheme)
        await turnOn('builtin:origin-navy')
        await turnOn('builtin:banana-cocoa')
        changeColorScheme('ocean')
        adoptActivePackScheme()
        turnOff()
        await installPack(archive(CORE_V1, 'X', 'x'))
        await installPack(archive(CORE_V2, 'X', 'x'))
        expect(plain(db().customColorScheme)).toEqual(custom)
    })

    it('T29 reproducer: a Custom slot that equals the derived pack scheme still ends colour mode', async () => {
        await turnOn('builtin:origin-navy')
        db().customColorScheme = structuredClone(plain(db().colorScheme))
        changeColorScheme('custom')
        flushSync()
        expect(db().colorSchemeName).toBe('custom')
        expect(baseAttribute()).toBeNull()
    })
})

describe('boot (T3)', () => {
    it('T3a reproducer: a profile on another scheme boots the pack in shape mode and writes nothing', async () => {
        resetThemePackApplyForTests()
        DBState.db = freshDb({ colorSchemeName: 'light', colorScheme: structuredClone(colorSchemePresets.light), activeThemePack: 'builtin:origin-navy' })
        const before = schemeFields()
        startThemePackApply()
        await settle()
        expect(status().phase).toBe('applied')
        expect(baseAttribute()).toBeNull()
        expect(schemeFields()).toEqual(before)
        expect('themePackSchemeSnapshot' in db()).toBe(false)
        expect(world.setDatabase).not.toHaveBeenCalled()
    })

    it('T3c guard: a profile named theme-pack boots in colour mode with no write', async () => {
        resetThemePackApplyForTests()
        const copy = { ...structuredClone(CUSTOM), bgcolor: '#123456' }
        DBState.db = freshDb({ colorSchemeName: 'theme-pack', colorScheme: copy, activeThemePack: 'builtin:origin-navy' })
        startThemePackApply()
        await settle()
        expect(baseAttribute()).toBe('')
        expect(plain(db().colorScheme)).toEqual(copy)
        expect(world.setDatabase).not.toHaveBeenCalled()
    })
})

describe('the driver outcome table (T15, T18-T22)', () => {
    it('T15: switching from pack A to pack B keeps the snapshot and the name', async () => {
        changeColorScheme('ocean')
        await turnOn('builtin:origin-navy')
        const snapshot = plain(db().themePackSchemeSnapshot)
        await turnOn('builtin:banana-cocoa')
        expect(db().colorSchemeName).toBe('theme-pack')
        expect(plain(db().themePackSchemeSnapshot)).toEqual(snapshot)
        expect(snapshot).toMatchObject({ name: 'ocean' })
        expect(baseAttribute()).toBe('light')
    })

    it('T15 (A8): a pack without core colours turned on from an own scheme writes nothing and applies shape mode', async () => {
        await installPack(archive(NO_CORE, 'No core', 'nocore'))
        expect(db().colorSchemeName).toBe('default')
        expect('themePackSchemeSnapshot' in db()).toBe(false)
        expect(baseAttribute()).toBeNull()
        expect(status().phase).toBe('applied')
    })

    it('T15 (A8b): a pack without core colours turned on from the pack scheme restores the snapshot', async () => {
        changeColorScheme('ocean')
        await turnOn('builtin:origin-navy')
        await installPack(archive(NO_CORE, 'No core', 'nocore'))
        expect(db().colorSchemeName).toBe('ocean')
        expect(plain(db().colorScheme)).toEqual(colorSchemePresets.ocean)
        expect('themePackSchemeSnapshot' in db()).toBe(false)
    })

    it('T15 (A13): a broken turn-on from the pack scheme restores, and the request is cleared', async () => {
        changeColorScheme('ocean')
        await turnOn('builtin:origin-navy')
        DBState.db.themePacks?.push(archiveRecord('missing', new Uint8Array([1, 2, 3]), false))
        await turnOn('missing')
        expect(status().phase).toBe('broken')
        expect(db().colorSchemeName).toBe('ocean')
        expect(pendingPackSchemeRequestForTests()).toBeNull()
    })

    it('T15: turning on a record this build cannot read restores from the pack scheme', async () => {
        changeColorScheme('ocean')
        await turnOn('builtin:origin-navy')
        DBState.db.themePacks?.push({ ...archiveRecord('future', new Uint8Array([4, 5, 6]), true), v: 2 })
        await turnOn('future')
        expect(status()).toMatchObject({ phase: 'broken', reason: 'unreadable' })
        expect(db().colorSchemeName).toBe('ocean')
        expect(pendingPackSchemeRequestForTests()).toBeNull()
    })
    it('T15: a broken turn-on from an own scheme writes nothing', async () => {
        const before = schemeFields()
        DBState.db.themePacks?.push(archiveRecord('missing', new Uint8Array([1, 2, 3]), false))
        await turnOn('missing')
        expect(status().phase).toBe('broken')
        expect(schemeFields()).toEqual(before)
        expect(pendingPackSchemeRequestForTests()).toBeNull()
    })

    for (const [label, setup, expectName] of [
        ['a preset', () => changeColorScheme('sky-light'), 'sky-light'],
        ['the Custom slot', () => changeColorScheme('custom'), 'custom'],
        ['an unknown saved name', () => { db().colorSchemeName = 'retired-x'; db().colorScheme = structuredClone(OWN_COPY); updateColorScheme() }, 'retired-x'],
    ] as const) {
        it(`T18: None restores ${label}, and the snapshot key is gone`, async () => {
            setup()
            const before = schemeFields()
            await turnOn('builtin:origin-navy')
            expect(db().colorSchemeName).toBe('theme-pack')
            turnOff()
            expect(db().colorSchemeName).toBe(expectName)
            expect(plain(db().colorScheme)).toEqual(before.scheme)
            expect('themePackSchemeSnapshot' in db()).toBe(false)
            expect(bgcolor()).toBe(before.scheme.bgcolor)
        })
    }

    it('T18: removing the active pack restores like None', async () => {
        changeColorScheme('ocean')
        await installPack(archive(CORE_V1, 'X', 'x'))
        expect(db().colorSchemeName).toBe('theme-pack')
        const [{ entry }] = listThemePacks(DBState.db.themePacks)
        await expect(removeThemePack(entry, 'X', { confirm: async () => true, notify: vi.fn() })).resolves.toBe('removed')
        expect(db().colorSchemeName).toBe('ocean')
        expect('themePackSchemeSnapshot' in db()).toBe(false)
    })

    it('T18: a missing snapshot restores default', async () => {
        await turnOn('builtin:origin-navy')
        delete db().themePackSchemeSnapshot
        turnOff()
        expect(db().colorSchemeName).toBe('default')
        expect(plain(db().colorScheme)).toEqual(defaultColorScheme)
    })

    it('T19: a pick after turn-on wins over None, and the snapshot key is gone', async () => {
        await turnOn('builtin:origin-navy')
        changeColorScheme('ocean')
        turnOff()
        expect(db().colorSchemeName).toBe('ocean')
        expect(plain(db().colorScheme)).toEqual(colorSchemePresets.ocean)
        expect('themePackSchemeSnapshot' in db()).toBe(false)
    })

    it('T20: re-entering through the tile refreshes the snapshot to the scheme left', async () => {
        await turnOn('builtin:origin-navy')
        changeColorScheme('ocean')
        adoptActivePackScheme()
        flushSync()
        expect(db().colorSchemeName).toBe('theme-pack')
        expect(plain(db().themePackSchemeSnapshot)).toMatchObject({ name: 'ocean' })
        expect(baseAttribute()).toBe('')
        turnOff()
        expect(db().colorSchemeName).toBe('ocean')
    })

    it('T21: an update refreshes the copy while following, keeps the snapshot, and writes nothing when not following', async () => {
        await installPack(archive(CORE_V1, 'X', 'x'))
        const snapshot = plain(db().themePackSchemeSnapshot)
        expect((db().colorScheme as ColorScheme).bgcolor).toBe('#101820')
        await installPack(archive(CORE_V2, 'X', 'x'))
        expect(db().colorSchemeName).toBe('theme-pack')
        expect((db().colorScheme as ColorScheme).bgcolor).toBe('#203040')
        expect(plain(db().themePackSchemeSnapshot)).toEqual(snapshot)

        changeColorScheme('light')
        const before = schemeFields()
        const activeBefore = db().activeThemePack
        await installPack(archive(coreSheet('#141c28'), 'X', 'x'))
        expect(db().activeThemePack, 'the update installed').not.toBe(activeBefore)
        expect(schemeFields()).toEqual(before)
    })

    it('T21: an update to a version without core colours restores the snapshot while following', async () => {
        changeColorScheme('ocean')
        await installPack(archive(CORE_V1, 'X', 'x'))
        await installPack(archive(NO_CORE, 'X', 'x'))
        expect(db().colorSchemeName).toBe('ocean')
        expect('themePackSchemeSnapshot' in db()).toBe(false)
    })

    it('T22: replacing a pack that is not active is a turn-on, replacing the active one is an update', async () => {
        await installPack(archive(CORE_V1, 'A', 'a'))
        await installPack(archive(coreSheet('#302010'), 'B', 'b'))
        changeColorScheme('light')
        await installPack(archive(CORE_V2, 'A', 'a'))
        expect(db().colorSchemeName).toBe('theme-pack')
        expect((db().colorScheme as ColorScheme).bgcolor).toBe('#203040')

        changeColorScheme('light')
        const before = schemeFields()
        const activeBefore = db().activeThemePack
        await installPack(archive(coreSheet('#141c28'), 'A', 'a'))
        expect(db().activeThemePack, 'the replacement installed').not.toBe(activeBefore)
        expect(schemeFields()).toEqual(before)
    })

    it('T34: re-installing the identical archive keeps the copy and the snapshot and leaves no request behind', async () => {
        const bytes = archive(CORE_V1, 'X', 'x')
        await installPack(bytes)
        const before = plain({ copy: db().colorScheme, snapshot: db().themePackSchemeSnapshot })
        await installPack(bytes)
        expect(pendingPackSchemeRequestForTests()).toBeNull()
        expect(db().colorSchemeName).toBe('theme-pack')
        expect(plain({ copy: db().colorScheme, snapshot: db().themePackSchemeSnapshot })).toEqual(before)
    })

    it('T35: a pack that declares only an accent turned on from default leaves the scheme, shows no base and still applies shape text', async () => {
        await installPack(archive(NO_CORE, 'No core', 'nocore'))
        expect(db().colorSchemeName).toBe('default')
        expect('themePackSchemeSnapshot' in db()).toBe(false)
        expect(baseAttribute()).toBeNull()
        expect(packElements()).toHaveLength(1)
    })
})

describe('what the sheet may carry once the scheme is no longer the pack\'s (T30, T36)', () => {
    it('T30 reproducer: a judged P5 sheet applied in shape mode keeps neither its background nor its text colour', async () => {
        await installPack(archive(`${CORE_V1}${P5}`, 'P5', 'p5'))
        changeColorScheme('light')
        flushSync()
        const text = packText().replace(/blob:[^")\s]+/g, '')
        expect(judgeAreaSheet('chat', text, undefined, 'chat').result.ok).toBe(true)
        expect(text).not.toMatch(/background-color\s*:/)
        expect(text).not.toMatch(/(^|[;{\s])color\s*:/)
    })

    it('T36 reproducer: after a later pick the live text carries no image or gradient background', async () => {
        const sheet = `${CORE_V1}[data-part="chat-message-avatar"]{background-image:url(images/a.png),linear-gradient(#000000,#111111)}`
        await installPack(archive(sheet, 'Img', 'img', { 'images/a.png': PNG_1X1 }))
        expect(packText()).toContain('linear-gradient')
        changeColorScheme('light')
        flushSync()
        expect(packText()).not.toContain('linear-gradient')
        expect(packText()).not.toMatch(/background-image\s*:/)
    })
})

describe('a pick while a turn-on is pending, and build drift (T32, T33)', () => {
    it('T32a: a pick made before the judge answers wins', async () => {
        channel.deferred = true
        expect(selectThemePack('builtin:origin-navy', { notify: vi.fn() })).toBe('selected')
        await until(() => channel.held.length > 0, 'the held judge')
        changeColorScheme('ocean')
        channel.deferred = false
        await releaseAll()
        expect(db().colorSchemeName).toBe('ocean')
        expect('themePackSchemeSnapshot' in db()).toBe(false)
        expect(plain(db().colorScheme)).toEqual(colorSchemePresets.ocean)
        expect(baseAttribute()).toBeNull()
    })

    it('T32b: a Custom edit made before the judge answers wins, with the name unchanged, so only the colours differ', async () => {
        changeColorScheme('custom')
        channel.deferred = true
        expect(selectThemePack('builtin:origin-navy', { notify: vi.fn() })).toBe('selected')
        await until(() => channel.held.length > 0, 'the held judge')
        db().customColorScheme = { ...structuredClone(CUSTOM), bgcolor: '#abcdef' }
        const { updateCustomColorScheme } = await import('../gui/colorscheme')
        updateCustomColorScheme()
        channel.deferred = false
        await releaseAll()
        expect(db().colorSchemeName).toBe('custom')
        expect((db().colorScheme as ColorScheme).bgcolor).toBe('#abcdef')
        expect(baseAttribute()).toBeNull()
    })

    it('T33: a stale stored copy paints until the pack is read, then the live default paints, with no write', async () => {
        resetThemePackApplyForTests()
        const stale = { ...structuredClone(CUSTOM), bgcolor: '#123456' }
        DBState.db = freshDb({ colorSchemeName: 'theme-pack', colorScheme: stale, activeThemePack: 'builtin:origin-navy' })
        updateColorScheme()
        expect(bgcolor()).toBe('#123456')
        channel.deferred = true
        startThemePackApply()
        await until(() => channel.held.length > 0, 'the held judge')
        expect(bgcolor()).toBe('#123456')
        channel.deferred = false
        await releaseAll()
        expect(bgcolor()).toBe('#21222c')
        expect(baseAttribute()).toBe('')
        expect(plain(db().colorScheme)).toEqual(stale)
        expect(world.setDatabase).not.toHaveBeenCalled()

        SafeModeStore.set(true)
        await settle()
        expect(bgcolor()).toBe('#123456')
        expect(packElements()).toHaveLength(0)
    })
})

describe('S4a the swap never gives the studio element a base (MC-3121)', () => {
    const STUDIO_DESIGN = studioScratchWhite.replace(/\r\n/g, '\n')
    const studioElement = (): HTMLStyleElement | undefined => packElements().find((element) => element.getAttribute('data-theme-pack') === 'studio')

    it('A4: a scheme pick flips chat to its shape text and leaves studio unchanged; picking the pack scheme back adds no base attribute while Studio is shown', async () => {
        const releaseStudio = declareSurface('studio')
        flushSync()
        await installPack(archive(CORE_V1, 'S', 's', { 'studio.css': STUDIO_DESIGN }))
        expect(db().colorSchemeName).toBe('theme-pack')
        const studio = studioElement()
        expect(studio).toBeDefined()
        const chat = packElements()[0]
        const studioText = studio!.textContent
        expect(studioText).not.toBe('')
        expect(studio!.getAttribute('media')).toBe('all')
        expect(baseAttribute()).toBeNull()
        expect(chat.textContent).toContain('--nexus-canvas')

        changeColorScheme('light')
        flushSync()
        expect(chat.textContent).not.toContain('--nexus-canvas')
        expect(studio!.textContent).toBe(studioText)
        expect(baseAttribute()).toBeNull()

        adoptActivePackScheme()
        flushSync()
        expect(chat.textContent).toContain('--nexus-canvas')
        expect(studio!.textContent).toBe(studioText)
        expect(studio!.getAttribute('media')).toBe('all')
        expect(baseAttribute()).toBeNull()

        releaseStudio()
        flushSync()
        expect(chat.getAttribute('media')).toBe('all')
        expect(baseAttribute()).toBe('')
    })
})