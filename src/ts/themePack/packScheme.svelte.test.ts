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
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../storage/database.svelte'
import { resetBusyActionsForTest } from '../process/memory/busyActions'
import { resetRestoreInProgressForTests } from '../drive/restoreInProgress'
import { resetPageStorageModeForTests, setPageStorageMode } from '../storage/pageStorageMode'
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
import ThemePackRow from '../../lib/Setting/Pages/Display/ThemePackRow.svelte'
import { requestSaveNow } from '../globalApi.svelte'
import { syncSystemBars } from '../gui/systemBars'
import { isLite } from '../lite'
import { bootThemePackStep, enterPackSafeMode, holdPackUntilDecided, releasePackHold, resetPackSafeModeForTests, tapTurnOff } from './packSafeMode.svelte'
import { packSafe } from './packSafeFlag.svelte'
import { judgePackSheets, judgeAreaSheet } from './index'
import { installThemePack } from './install'
import { intakePackBytes } from './intake'
import { listThemePacks } from './packRecord'
import { BUILTIN_PACKS } from './builtins'
import { resetPackSheetForTests } from './apply'
import {
    adoptActivePackScheme, cancelPackSchemeRequest, pendingPackSchemeRequestForTests, resetThemePackApplyForTests, startThemePackApply, themePackApplyState,
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

describe('#629 leaving pack safe mode paints nothing of the pack (RS-1 to RS-3)', () => {
    const PACK_BG = '#101820'
    let painted: string[] = []
    let setProperty: CSSStyleDeclaration['setProperty'] | null = null

    /** Records every value the root receives and every system bar colour from now on. */
    function watchPaint(): void {
        painted = []
        vi.mocked(syncSystemBars).mockClear()
        const style = document.documentElement.style
        setProperty = style.setProperty.bind(style)
        const original = setProperty
        style.setProperty = (name: string, value: string | null, priority?: string): void => {
            painted.push(`${name}=${String(value)}`)
            original(name, value, priority)
        }
    }

    /** Every root value or system bar colour that carried the pack colour. */
    function packPaints(): string[] {
        const bars = vi.mocked(syncSystemBars).mock.calls.map((call) => `bar=${String(call[0])}`)
        return [...painted, ...bars].filter((entry) => entry.toLowerCase().includes(PACK_BG))
    }

    async function packActiveInSafeMode(): Promise<void> {
        changeColorScheme('light')
        flushSync()
        await installPack(archive(CORE_V1, 'R', 'r'))
        expect(bgcolor()).toBe(PACK_BG)
        enterPackSafeMode('shortcut')
        flushSync()
        expect(bgcolor()).not.toBe(PACK_BG)
    }

    afterEach(() => {
        delete (document.documentElement.style as { setProperty?: unknown }).setProperty
        resetPackSafeModeForTests()
    })

    it('RS-1 reproducer: choosing None in a pack-free session never paints the pack colour, reads no archive and ends in the own scheme', async () => {
        await packActiveInSafeMode()
        const reads = vi.spyOn(world.files, 'get')
        watchPaint()
        expect(selectThemePack(undefined, { notify: vi.fn() })).toBe('selected')
        flushSync()
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
        flushSync()
        expect(packPaints()).toEqual([])
        expect(reads).not.toHaveBeenCalled()
        expect(packElements()).toHaveLength(0)
        expect(packSafe.on).toBe(false)
        expect('activeThemePack' in db()).toBe(false)
        expect('themePackSchemeSnapshot' in db()).toBe(false)
        expect(db().colorSchemeName).toBe('light')
        expect(bgcolor()).toBe(colorSchemePresets.light.bgcolor)
    })

    it('RS-1 guard: picking another installed pack in a pack-free session ends safe mode and paints that pack', async () => {
        await installPack(archive(CORE_V2, 'Other', 'other'))
        const other = db().activeThemePack as string
        await packActiveInSafeMode()
        watchPaint()
        expect(selectThemePack(other, { notify: vi.fn() })).toBe('selected')
        await settle()
        expect(packSafe.on).toBe(false)
        expect(bgcolor()).toBe('#203040')
    })

    it('RS-2 guard: removing the active pack in a pack-free session paints no pack colour and restores the own scheme', async () => {
        await packActiveInSafeMode()
        watchPaint()
        const item = listThemePacks(db().themePacks)[0]
        expect(await removeThemePack(item.entry, 'R', { confirm: async () => true, notify: vi.fn() })).toBe('removed')
        flushSync()
        expect(packPaints()).toEqual([])
        expect(db().colorSchemeName).toBe('light')
        expect('activeThemePack' in db()).toBe(false)
    })

    it('RS-3 guard: the banner turn-off paints no pack colour and ends in the own scheme with the pack off', async () => {
        await packActiveInSafeMode()
        watchPaint()
        tapTurnOff()
        flushSync()
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
        flushSync()
        expect(packPaints()).toEqual([])
        expect(packSafe.on).toBe(false)
        expect('activeThemePack' in db()).toBe(false)
        expect(db().colorSchemeName).toBe('light')
    })
})

describe('IS-5 activating the checked pack in a pack-free session turns it on, colours included (MC-3758)', () => {
    afterEach(() => {
        resetPackSafeModeForTests()
    })

    for (const kind of ['first', 'updateInPackScheme', 'updateInOwnScheme'] as const) {
        it(`IS-5 reproducer: a tap on the checked installed pack ends pack safe mode and applies it, then None and a new pick work (${kind})`, async () => {
            changeColorScheme('light')
            if (kind !== 'first') {
                await installPack(archive(CORE_V1, 'Example pack', 'pk.example'))
                if (kind === 'updateInOwnScheme') {
                    changeColorScheme('light')
                }
            }
            flushSync()
            enterPackSafeMode('shortcut')
            flushSync()
            const oldId = db().activeThemePack
            await installPack(archive(CORE_V2, 'Example pack', 'pk.example'))
            const id = db().activeThemePack as string
            expect(id).not.toBe(oldId)
            expect(packElements()).toHaveLength(0)
            expect(pendingPackSchemeRequestForTests()).toBeNull()

            const target = document.createElement('div')
            document.body.appendChild(target)
            const row = mount(ThemePackRow, { target })
            flushSync()
            try {
                const radio = target.querySelector<HTMLInputElement>(`input[value="${id}"]`)!
                expect(radio.checked).toBe(true)
                radio.closest('label')!.click()
                flushSync()
                expect(packSafe.on, 'a tap on the checked pack must leave pack safe mode').toBe(false)
                await until(() => status().phase === 'applied', 'the tapped apply')
                expect(bgcolor()).toBe('#203040')
                expect(db().colorSchemeName).toBe('theme-pack')
                expect(plain(db().themePackSchemeSnapshot)).toMatchObject({ name: 'light' })

                expect(selectThemePack(undefined, { notify: vi.fn() })).toBe('selected')
                flushSync()
                expect(radio.checked).toBe(false)
                vi.mocked(requestSaveNow).mockClear()
                radio.closest('label')!.click()
                flushSync()
                expect(vi.mocked(requestSaveNow)).toHaveBeenCalledTimes(1)
            } finally {
                unmount(row)
                target.remove()
            }
        })
    }
})

describe('#629 the stored pack colours never outlive their pack (CS-1 to CS-10)', () => {
    const A = '#101820'
    const LIGHT = colorSchemePresets.light
    let seen: string[] = []
    let backgrounds: string[] = []
    const watch = (): void => {
        seen = []
        backgrounds = []
        vi.mocked(syncSystemBars).mockClear()
        const style = document.documentElement.style
        Reflect.deleteProperty(style, 'setProperty')
        const original = style.setProperty.bind(style)
        style.setProperty = (name: string, value: string | null, priority?: string): void => {
            if (name === '--risu-theme-bgcolor') {
                backgrounds.push(String(value).toLowerCase())
            }
            seen.push(String(value).toLowerCase())
            original(name, value, priority)
        }
    }
    const ofA = (): string[] => [...seen, ...vi.mocked(syncSystemBars).mock.calls.map((call) => String(call[0]).toLowerCase())].filter((value) => value === A)
    const tick = async (): Promise<void> => {
        flushSync()
        await new Promise<void>((resolve) => setTimeout(resolve, 6))
        flushSync()
    }
    /** A page start from the saved profile: the stored JSON, the boot hold, then the boot step; `source` enters pack safe mode first. */
    const boot = (source?: 'shortcut' | 'noAnswer', edit?: () => void): void => {
        const saved = JSON.parse(JSON.stringify(plain(db())))
        channel.held.length = 0
        channel.deferred = false
        resetThemePackApplyForTests()
        resetPackSheetForTests()
        resetPackSafeModeForTests()
        resetPageStorageModeForTests()
        DBState.db = saved
        edit?.()
        document.documentElement.removeAttribute('style')
        watch()
        if (holdPackUntilDecided()) {
            if (source === undefined) {
                releasePackHold()
            } else {
                enterPackSafeMode(source)
            }
        }
        bootThemePackStep(DBState.db, async () => ({ startThemePackApply }))
    }
    const normalStart = async (): Promise<void> => {
        boot()
        await tick()
        await settle()
    }
    const sha = (bytes: Uint8Array): string => `assets/tp-${createHash('sha256').update(bytes).digest('hex')}.risutheme`
    const rec = (id: string): Record<string, unknown> => (DBState.db.themePacks as Array<Record<string, unknown>>).find((record) => record.id === id)!
    const remove = async (id: string): Promise<void> => {
        const item = listThemePacks(db().themePacks).find((entry) => (entry.entry as { id?: string }).id === id)!
        expect(await removeThemePack(item.entry, 'x', { confirm: async () => true, notify: vi.fn() })).toBe('removed')
    }
    /** Installs an inactive pack: installs it, then turns the pack off. Returns its id. */
    const offPack = async (sheet: string, name = 'Other', packId = 'other'): Promise<string> => {
        await installPack(archive(sheet, name, packId))
        const id = db().activeThemePack as string
        turnOff()
        return id
    }
    const install = async (bytes: Uint8Array, yes = true): Promise<void> => {
        await runThemePackInstall({
            pickFile: async () => ({ name: 'p.risutheme', size: bytes.length }) as unknown as File,
            readFile: async () => bytes,
            intake: (verified) => intakePackBytes(verified, async (sheets) => judgePackSheets(sheets)),
            install: installThemePack,
            confirm: async () => yes,
            notify: vi.fn(),
        })
    }
    /** From its second read on, the archive `bytes` is unreadable: the install stores it, then the driver cannot verify it. */
    const failSecondRead = (bytes: Uint8Array, onFail?: () => void): void => {
        const key = sha(bytes)
        const real = world.files.get.bind(world.files)
        let reads = 0
        world.files.get = ((requested: string) => {
            if (requested === key) {
                reads += 1
                if (reads >= 2) {
                    if (reads === 2) {
                        onFail?.()
                    }
                    return new Uint8Array([1, 2, 3])
                }
            }
            return real(requested)
        }) as typeof world.files.get
    }
    afterEach(() => {
        Reflect.deleteProperty(document.documentElement.style, 'setProperty')
        Reflect.deleteProperty(world.files, 'get')
        isLite.set(false)
        SafeModeStore.set(false)
        channel.deferred = false
        resetPackSafeModeForTests()
        resetPageStorageModeForTests()
    })

    const OPS = ['pickCore', 'pickNoCore', 'pickBuiltin', 'pickLost', 'newCore', 'newNoCore', 'newLost', 'updateCore', 'updateNoCore', 'updateLost'] as const
    async function act(op: typeof OPS[number], other: string): Promise<string> {
        if (op.startsWith('pick')) {
            const id = op === 'pickBuiltin' ? 'builtin:banana-cocoa' : other
            expect(selectThemePack(id, { notify: vi.fn() })).toBe('selected')
            return id
        }
        const name = op.startsWith('new') ? 'N' : 'R'
        await install(archive(op.endsWith('NoCore') ? NO_CORE : CORE_V2, name, name.toLowerCase()))
        return db().activeThemePack as string
    }

    for (const op of OPS) {
        for (const way of ['safe', 'restart', 'warm', 'ctrl'] as const) {
            it(`CS-1 reproducer: ${op} then ${way} stores no colour of the pack left`, async () => {
                changeColorScheme('light')
                const other = op.startsWith('pick') && op !== 'pickBuiltin' ? await offPack(op === 'pickNoCore' ? NO_CORE : CORE_V2) : ''
                await installPack(archive(CORE_V1, 'R', 'r'))
                const left = db().activeThemePack as string
                const snapshot = plain(db().themePackSchemeSnapshot)
                if (op === 'pickLost') {
                    world.files.delete(rec(other).archive as string)
                }
                if (way === 'safe') {
                    boot('noAnswer')
                    await tick()
                }
                if (way === 'ctrl') {
                    SafeModeStore.set(true)
                    await tick()
                }
                channel.deferred = true
                watch()
                const id = await act(op, other)
                flushSync()
                if (way === 'safe') {
                    expect(ofA(), 'a pack-free pick or install paints no colour of the pack left').toEqual([])
                }
                expect(db().colorSchemeName).toBe('theme-pack')
                expect(plain(db().colorScheme), 'the stored copy of the pack left is gone').toEqual(LIGHT)
                expect(plain(db().themePackSchemeSnapshot)).toEqual(snapshot)
                if (op === 'newLost' || op === 'updateLost') {
                    world.files.delete(rec(id).archive as string)
                }
                if (way === 'warm') {
                    enterPackSafeMode('shortcut')
                    await tick()
                }
                if (way === 'ctrl') {
                    SafeModeStore.set(false)
                }
                await normalStart()
                expect(ofA(), 'a pack that is off never paints at a later start').toEqual([])
                if (op === 'pickCore' || op === 'newCore' || op === 'updateCore') {
                    expect(bgcolor()).toBe('#203040')
                }
                if (op.endsWith('NoCore') || op.endsWith('Lost')) {
                    expect(bgcolor()).toBe(LIGHT.bgcolor)
                }
                if (!op.startsWith('update')) {
                    boot('shortcut')
                    await tick()
                    await remove(left)
                    await normalStart()
                    expect(ofA(), 'a removed pack never paints').toEqual([])
                }
                turnOff()
                expect(db().colorSchemeName).toBe('light')
                expect(plain(db().customColorScheme)).toEqual(CUSTOM)
            })
        }
    }

    it('CS-1 guard: picking a record this build cannot read stores no colour of the pack left (passes before and after)', async () => {
        changeColorScheme('light')
        await installPack(archive(CORE_V1, 'A', 'a'))
        ;(db().themePacks as unknown[]).push({ v: 99, id: 'unreadable-record' })
        selectThemePack('unreadable-record', { notify: vi.fn() })
        flushSync()
        updateColorScheme()
        expect((db().colorScheme as ColorScheme).bgcolor, 'the stored copy of the pack left is gone').toBe(LIGHT.bgcolor)
        expect(bgcolor()).toBe(LIGHT.bgcolor)
    })

    for (const env of ['plain', 'lite', 'readOnly', 'ctrl', 'noAnswer', 'builtin'] as const) {
        it(`CS-2 reproducer: a held pick in pack safe mode cleans the copy at the pick (${env})`, async () => {
            changeColorScheme('light')
            const id = env === 'builtin' ? 'builtin:banana-cocoa' : await offPack(CORE_V2)
            await installPack(archive(CORE_V1, 'R', 'r'))
            boot(env === 'noAnswer' ? 'noAnswer' : 'shortcut')
            await tick()
            if (env === 'lite') {
                isLite.set(true)
                updateColorScheme()
            }
            if (env === 'readOnly') {
                setPageStorageMode({ kind: 'read-only', reason: 'too-new' } as never)
            }
            if (env === 'ctrl') {
                SafeModeStore.set(true)
                flushSync()
            }
            channel.deferred = true
            watch()
            expect(selectThemePack(id, { notify: vi.fn() })).toBe('selected')
            await tick()
            expect(plain(db().colorScheme), 'the copy is clean at the pick').toEqual(LIGHT)
            if (env === 'lite') {
                isLite.set(false)
                updateColorScheme()
            }
            if (env === 'ctrl') {
                SafeModeStore.set(false)
                await tick()
            }
            await releaseAll()
            expect(ofA(), 'no colour of the pack being left').toEqual([])
            const colour = env === 'builtin' ? '#b2c7da' : '#203040'
            expect(bgcolor()).toBe(colour)
            if (env !== 'ctrl') {
                expect((db().colorScheme as ColorScheme).bgcolor).toBe(colour)
            }
        })
    }

    it('CS-3 reproducer: tapping the checked pack of a profile that holds the residue cleans the copy', async () => {
        changeColorScheme('light')
        const other = await offPack(NO_CORE)
        await installPack(archive(CORE_V1, 'R', 'r'))
        boot('shortcut', () => { db().activeThemePack = other })
        await tick()
        const target = document.createElement('div')
        document.body.appendChild(target)
        const row = mount(ThemePackRow, { target })
        flushSync()
        try {
            channel.deferred = true
            watch()
            target.querySelector<HTMLInputElement>(`input[value="${other}"]`)!.closest('label')!.click()
            await tick()
            expect(packSafe.on).toBe(false)
            expect(ofA(), 'a checked tap cleans the copy').toEqual([])
            expect(plain(db().colorScheme)).toEqual(LIGHT)
            await releaseAll()
            expect(db().colorSchemeName).toBe('light')
        } finally {
            unmount(row)
            target.remove()
        }
    })

    for (const left of ['live', 'broken'] as const) {
        for (const kind of ['pick', 'install', 'update'] as const) {
            it(`CS-4 guard: an ordinary ${kind} keeps the paint while pending, left ${left} (passes before and after)`, async () => {
                changeColorScheme('light')
                const other = kind === 'pick' ? await offPack(CORE_V2) : ''
                await installPack(archive(CORE_V1, 'R', 'r'))
                if (left === 'broken') {
                    world.files.delete(rec(db().activeThemePack as string).archive as string)
                    await normalStart()
                }
                expect(bgcolor()).toBe(A)
                const base = baseAttribute()
                const snapshot = plain(db().themePackSchemeSnapshot)
                channel.deferred = true
                watch()
                await act(kind === 'pick' ? 'pickCore' : kind === 'install' ? 'newCore' : 'updateCore', other)
                await until(() => channel.held.length > 0, 'held')
                updateColorScheme()
                expect(bgcolor(), 'same page, same paint').toBe(A)
                expect(backgrounds.filter((value) => value === LIGHT.bgcolor), 'no own paint in between').toEqual([])
                expect(baseAttribute()).toBe(base)
                expect(db().colorSchemeName).toBe('theme-pack')
                expect(plain(db().themePackSchemeSnapshot)).toEqual(snapshot)
                await releaseAll()
                expect((db().colorScheme as ColorScheme).bgcolor).toBe('#203040')
                expect(plain(db().themePackSchemeSnapshot)).toEqual(snapshot)
            })
        }
    }

    for (const left of ['live', 'broken'] as const) {
        it(`CS-5 reproducer: a failed update of B during a switch from ${left} A never brings A's colours back`, async () => {
            changeColorScheme('light')
            const other = await offPack(CORE_V2, 'b', 'b')
            const first = archive(CORE_V1, 'A', 'a')
            await installPack(first)
            if (left === 'broken') {
                world.files.delete(sha(first))
                await normalStart()
            }
            expect(bgcolor()).toBe(A)
            channel.deferred = true
            selectThemePack(other, { notify: vi.fn() })
            await until(() => channel.held.length > 0, 'held')
            const next = archive(coreSheet('#183040'), 'b', 'b')
            failSecondRead(next)
            await install(next)
            await releaseAll()
            expect(status().phase).toBe('broken')
            expect((db().colorScheme as ColorScheme).bgcolor, 'the colours of A never return').toBe(LIGHT.bgcolor)
            expect(bgcolor()).toBe(LIGHT.bgcolor)
            await normalStart()
            expect(bgcolor(), 'the next start').toBe(LIGHT.bgcolor)
        })
    }

    it('CS-5 guard: a pick made while an update is pending wins over the displaced copy when the update fails (passes before and after)', async () => {
        changeColorScheme('light')
        await installPack(archive(CORE_V1, 'A', 'a'))
        const next = archive(CORE_V2, 'A', 'a')
        failSecondRead(next, () => changeColorScheme('dark'))
        await install(next)
        await settle()
        expect(status().phase).toBe('broken')
        expect(db().colorSchemeName, 'a pick made while the update was pending wins').toBe('dark')
        expect(plain(db().colorScheme)).toEqual(colorSchemePresets.dark)
    })

    it('CS-5 guard: a failed update with no pick keeps the previous version\'s colours under the pack scheme (passes before and after)', async () => {
        changeColorScheme('light')
        await installPack(archive(CORE_V1, 'A', 'a'))
        const next = archive(CORE_V2, 'A', 'a')
        failSecondRead(next)
        await install(next)
        await settle()
        expect(status().phase).toBe('broken')
        expect(db().colorSchemeName).toBe('theme-pack')
        expect((db().colorScheme as ColorScheme).bgcolor).toBe(A)
    })

    it('CS-6 guard: a broken turn-on leaves the pack scheme (passes before and after)', async () => {
        changeColorScheme('light')
        const other = await offPack(CORE_V2)
        await installPack(archive(CORE_V1, 'R', 'r'))
        world.files.delete(rec(other).archive as string)
        await turnOn(other)
        expect(schemeFields()).toEqual({ name: 'light', scheme: LIGHT })
    })

    for (const from of ['own', 'pack'] as const) {
        it(`CS-7 reproducer: the tile during a pending switch stores no colour of the pack being left, from ${from}`, async () => {
            changeColorScheme('light')
            const other = await offPack(from === 'own' ? NO_CORE : CORE_V2)
            await installPack(archive(CORE_V1, 'R', 'r'))
            if (from === 'own') {
                changeColorScheme('light')
                flushSync()
            }
            channel.deferred = true
            selectThemePack(other, { notify: vi.fn() })
            await until(() => channel.held.length > 0, 'held')
            adoptActivePackScheme()
            expect(bgcolor()).toBe(A)
            expect(plain(db().colorScheme), 'the tile stores no colour of the pack being left').toEqual(LIGHT)
            await releaseAll()
            if (from === 'pack') {
                expect((db().colorScheme as ColorScheme).bgcolor, 'no cancel').toBe('#203040')
                return
            }
            expect(db().colorSchemeName).toBe('theme-pack')
            await normalStart()
            expect(ofA()).toEqual([])
        })
    }

    it('CS-8 guard: the tile of a settled pack stores its colours (passes before and after)', async () => {
        await installPack(archive(CORE_V1, 'R', 'r'))
        changeColorScheme('light')
        adoptActivePackScheme()
        expect((db().colorScheme as ColorScheme).bgcolor).toBe(A)
    })

    for (const own of ['custom', 'unknown'] as const) {
        it(`CS-9 reproducer: an install in pack safe mode, then None, restores the user's ${own} scheme`, async () => {
            if (own === 'custom') {
                changeColorScheme('custom')
            } else {
                db().colorSchemeName = 'future-scheme'
                db().colorScheme = structuredClone(OWN_COPY)
            }
            const before = schemeFields()
            await installPack(archive(CORE_V1, 'R', 'r'))
            enterPackSafeMode('shortcut')
            flushSync()
            await install(archive(NO_CORE, 'N', 'n'))
            expect(plain(db().colorScheme), 'the stored colours are not the pack\'s').toEqual(before.scheme)
            turnOff()
            expect(schemeFields()).toEqual(before)
            expect(plain(db().customColorScheme)).toEqual(CUSTOM)
        })
    }

    for (const kind of ['busy', 'declined', 'decision'] as const) {
        it(`CS-10 guard: ${kind} writes nothing (passes before and after)`, async () => {
            changeColorScheme('light')
            await installPack(archive(CORE_V1, 'R', 'r'))
            const before = plain(db())
            boot('shortcut')
            await tick()
            if (kind === 'busy') {
                expect(selectThemePack('builtin:banana-cocoa', { notify: vi.fn(), isBusy: () => true })).toBe('busy')
            }
            if (kind === 'declined') {
                await install(archive(CORE_V2, 'N', 'n'), false)
            }
            expect(plain(db())).toEqual(before)
        })
    }

    it('CS-12 guard: a live default paints over a waiting request\'s displaced copy (passes before and after)', async () => {
        changeColorScheme('light')
        const other = await offPack(CORE_V2, 'b', 'b')
        await installPack(archive(CORE_V1, 'A', 'a'))
        ;(db().colorScheme as ColorScheme).bgcolor = '#0d141c'
        updateColorScheme()
        expect(bgcolor()).toBe(A)
        channel.deferred = true
        selectThemePack(other, { notify: vi.fn() })
        updateColorScheme()
        expect(bgcolor(), 'the live default of the applied pack, not the stale copy').toBe(A)
        await releaseAll()
        expect(bgcolor()).toBe('#203040')
    })

    it('CS-13 reproducer: a cancelled request leaves no displaced copy to paint', async () => {
        changeColorScheme('light')
        const other = await offPack(CORE_V2)
        const first = archive(CORE_V1, 'R', 'r')
        await installPack(first)
        world.files.delete(sha(first))
        await normalStart()
        channel.deferred = true
        selectThemePack(other, { notify: vi.fn() })
        await until(() => channel.held.length > 0, 'held')
        expect(pendingPackSchemeRequestForTests()).not.toBeNull()
        cancelPackSchemeRequest()
        updateColorScheme()
        expect(pendingPackSchemeRequestForTests()).toBeNull()
        expect(bgcolor(), 'with no request and no live pack the stored copy paints').toBe(LIGHT.bgcolor)
    })
})
