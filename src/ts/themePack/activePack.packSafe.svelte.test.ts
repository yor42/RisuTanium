// @vitest-environment jsdom
/**
 * Pack safe mode through the real driver (`activePack.svelte.ts`): TA-7 (the URL flag; a regression reproducer, red on the
 * base where `?nothemepack` means nothing), TA-9 (entering and leaving the flag live, which kills "flag read inside untrack")
 * and TA-18 (`selectThemePack` leaves safe mode, and a busy refusal keeps it). REAL: the driver, the apply core, the intake,
 * the validator behind a fake worker channel, the surface gate, `colorscheme.ts` and the install flow. FAKED: the page store, the
 * object URL functions and `DBState`, which is a real `$state` object. Same recipe as activePack.svelte.test.ts.
 */
import { createHash } from 'node:crypto'
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../storage/database.svelte'
import { validPackFiles, zipPack } from './fixtures/packBuilder'

const world = vi.hoisted(() => ({ files: new Map<string, Uint8Array>() }))

vi.mock('../storage/store/appStore', () => ({ getAppStore: async () => ({ read: async (key: string) => ({ bytes: world.files.get(key) ?? null, version: null }) }) }))
vi.mock('../globalApi.svelte', () => ({ getFileSrc: vi.fn(), downloadFile: vi.fn(), requestSaveNow: vi.fn(), saveAsset: vi.fn(async () => '') }))
vi.mock('../storage/database.svelte', async () => {
    const { DBState } = await import('../stores.svelte')
    return { getDatabase: () => DBState.db, setDatabase: vi.fn() }
})
vi.mock('../util', () => ({ BufferToText: vi.fn(), selectSingleFile: vi.fn(), sleep: vi.fn(async () => { }) }))
vi.mock('../alert', () => ({ alertError: vi.fn(), alertConfirm: vi.fn(async () => true), alertNormal: vi.fn() }))
vi.mock('../stores.svelte', () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state, SafeModeStore: writable(false), CustomCSSStore: writable('') }
})
vi.mock('./worker/spawnJudgeWorker', async () => {
    const { handleJudgeRequest } = await import('./worker/judgeHandler')
    class FakeWorker {
        private readonly listeners: Array<(event: Event) => void> = []
        private terminated = false
        postMessage(message: Parameters<typeof handleJudgeRequest>[0]): void {
            const answer = handleJudgeRequest(message)
            setTimeout(() => {
                if (this.terminated) return
                for (const listener of this.listeners) listener(new MessageEvent('message', { data: answer }))
            }, 0)
        }
        terminate(): void { this.terminated = true }
        addEventListener(type: string, listener: (event: Event) => void): void {
            if (type === 'message') this.listeners.push(listener)
        }
    }
    return { spawnJudgeWorker: () => new FakeWorker() }
})

type Modules = {
    stores: typeof import('../stores.svelte')
    colorscheme: typeof import('../gui/colorscheme')
    driver: typeof import('./activePack.svelte')
    gate: typeof import('./surfaceGate.svelte')
    safeMode: typeof import('./packSafeMode.svelte')
    flag: typeof import('./packSafeFlag.svelte')
    flow: typeof import('../../lib/Setting/Pages/Display/themePackInstallFlow.svelte')
}

/** A fresh module graph, so the flag module reads the URL as it is now. */
async function load(search: string): Promise<Modules> {
    vi.resetModules()
    history.replaceState(null, '', `/${search}`)
    const [stores, colorscheme, driver, gate, safeMode, flag, flow] = await Promise.all([
        import('../stores.svelte'), import('../gui/colorscheme'), import('./activePack.svelte'), import('./surfaceGate.svelte'),
        import('./packSafeMode.svelte'), import('./packSafeFlag.svelte'), import('../../lib/Setting/Pages/Display/themePackInstallFlow.svelte'),
    ])
    return { stores, colorscheme, driver, gate, safeMode, flag, flow }
}

const USER = { bgcolor: '#101820', darkbg: '#0a1016', borderc: '#445566', selected: '#223344', draculared: '#ff5555', textcolor: '#e0e8f0', textcolor2: '#a0a8b0', darkBorderc: '#334455', darkbutton: '#203040', type: 'dark' } as const
const PACK_SCHEME = { ...USER, bgcolor: '#ff00ff', textcolor: '#123456', type: 'light' } as const

let savedCreate: typeof URL.createObjectURL | undefined
let savedRevoke: typeof URL.revokeObjectURL | undefined
let m: Modules
let releaseSurface: () => void = () => { }

function packElements(): HTMLStyleElement[] {
    return [...document.querySelectorAll<HTMLStyleElement>('style[data-theme-pack]')]
}

async function until(done: () => boolean, what: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt++) {
        flushSync()
        if (done()) return
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    throw new Error(`timed out waiting for ${what}`)
}

async function ticks(count: number): Promise<void> {
    for (let tick = 0; tick < count; tick++) {
        flushSync()
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
}

function rootText(): string {
    return document.documentElement.style.getPropertyValue('--risu-theme-textcolor')
}

/** The state a user turn-on leaves: the pack scheme entered over the user's own scheme, the pack active. */
function packOn(): void {
    m.stores.DBState.db = {
        themePacks: [], colorScheme: structuredClone(USER), colorSchemeName: 'custom', customColorScheme: structuredClone(USER),
        textTheme: 'standard', font: 'default', customCSS: '',
    } as unknown as Database
    m.colorscheme.enterPackScheme(PACK_SCHEME)
    m.stores.DBState.db.activeThemePack = 'builtin:banana-cocoa'
}

async function start(search: string): Promise<void> {
    m = await load(search)
    document.head.innerHTML = ''
    document.body.innerHTML = '<style id="customcss"></style>'
    document.documentElement.removeAttribute('style')
    m.gate.installThemePackGate(() => false)
    releaseSurface = m.gate.declareSurface('chat')
    packOn()
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => { })
    savedCreate = URL.createObjectURL
    savedRevoke = URL.revokeObjectURL
    let counter = 0
    URL.createObjectURL = (): string => `blob:http://localhost/${++counter}`
    URL.revokeObjectURL = (): void => { }
})

afterEach(() => {
    m?.driver.resetThemePackApplyForTests()
    m?.gate.resetThemePackGateForTests()
    releaseSurface()
    for (const [name, saved] of [['createObjectURL', savedCreate], ['revokeObjectURL', savedRevoke]] as const) {
        if (saved === undefined) Reflect.deleteProperty(URL, name)
        else Object.defineProperty(URL, name, { value: saved, configurable: true, writable: true })
    }
    history.replaceState(null, '', '/')
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

describe('TA-7: ?nothemepack keeps every sheet off and paints the user scheme', () => {
    it('with the flag in the URL: no committed sheet, the root variables are the user scheme, and the database is unchanged', async () => {
        await start('?nothemepack')
        const before = $state.snapshot(m.stores.DBState.db)
        expect(m.flag.packSafe.on).toBe(true)
        expect(m.flag.packSafe.source).toBe('url')
        m.driver.startThemePackApply()
        await ticks(6)
        expect(packElements()).toHaveLength(0)
        const own = m.colorscheme.schemeWithoutPack(m.stores.DBState.db).colorScheme
        expect(own.textcolor).toBe(USER.textcolor)
        expect(rootText()).toBe(own.textcolor)
        expect($state.snapshot(m.stores.DBState.db)).toEqual(before)
    })

    it('without the flag the same state commits the pack and paints its scheme', async () => {
        await start('')
        expect(m.flag.packSafe.on).toBe(false)
        m.driver.startThemePackApply()
        await until(() => m.driver.themePackApplyState().phase === 'applied', 'the apply')
        expect(packElements()).toHaveLength(1)
        expect(rootText()).not.toBe(USER.textcolor)
    })
})

describe('TA-9: the flag is live', () => {
    it('entering safe mode removes a committed sheet and repaints; leaving re-applies it', async () => {
        await start('')
        m.driver.startThemePackApply()
        await until(() => m.driver.themePackApplyState().phase === 'applied', 'the first apply')
        expect(packElements()).toHaveLength(1)

        m.safeMode.enterPackSafeMode('boot')
        await until(() => m.driver.themePackApplyState().phase === 'none', 'the removal')
        expect(packElements()).toHaveLength(0)
        expect(rootText()).toBe(USER.textcolor)

        m.safeMode.leavePackSafeMode()
        await until(() => m.driver.themePackApplyState().phase === 'applied', 'the re-apply')
        expect(packElements()).toHaveLength(1)
    })
})

describe('TA-18: picking a pack in safe mode', () => {
    const deps = (busy: boolean) => ({ isBusy: () => busy, restoreInProgress: () => false, notify: vi.fn() })

    it('selectThemePack leaves safe mode and the driver applies the key', async () => {
        await start('')
        m.driver.startThemePackApply()
        m.safeMode.enterPackSafeMode('boot')
        await ticks(4)
        expect(packElements()).toHaveLength(0)

        expect(m.flow.selectThemePack('builtin:origin-navy', deps(false))).toBe('selected')
        expect(m.flag.packSafe.on).toBe(false)
        await until(() => m.driver.themePackApplyState().phase === 'applied' && m.driver.themePackApplyState().activeId === 'builtin:origin-navy', 'the pick')
        expect(packElements()).toHaveLength(1)
    })

    it('a busy refusal keeps safe mode, applies nothing and leaves the active id alone', async () => {
        await start('')
        m.driver.startThemePackApply()
        m.safeMode.enterPackSafeMode('boot')
        await ticks(4)

        expect(m.flow.selectThemePack('builtin:origin-navy', deps(true))).toBe('busy')
        expect(m.flag.packSafe.on).toBe(true)
        await ticks(4)
        expect(packElements()).toHaveLength(0)
        expect(m.stores.DBState.db.activeThemePack).toBe('builtin:banana-cocoa')
    })
})

describe('S-1: the popups overlays follow the pack (AS-12)', () => {
    const POPUPS = '[data-part="toast-text"]{background-color:#7a1f5c;border-radius:6px}'

    /** An installed archive with chat.css and popups.css, active in the database; returns nothing, the driver reads the record. */
    function activateArchive(): void {
        const bytes = zipPack(validPackFiles({ 'popups.css': POPUPS }))
        const archive = `assets/tp-${createHash('sha256').update(bytes).digest('hex')}.risutheme`
        world.files.set(archive, bytes.slice())
        m.stores.DBState.db.themePacks?.push({
            v: 1, id: 'rec-p', name: 'Pack P', version: '1.0.0', license: 'MIT', attribution: 'Test author', modes: ['dark'],
            fonts: [], archive, bytes: bytes.length, installedAt: 1,
        })
        m.stores.DBState.db.activeThemePack = 'rec-p'
    }
    const popupsElements = (): HTMLStyleElement[] => packElements().filter((element) => element.getAttribute('data-theme-pack') === 'popups')

    it('a plain launch applies the popups overlays beside the chat element', async () => {
        await start('')
        activateArchive()
        m.driver.startThemePackApply()
        await until(() => m.driver.themePackApplyState().phase === 'applied', 'the apply')
        expect(packElements().map((element) => element.getAttribute('data-theme-pack'))).toEqual(['chat', 'popups', 'popups'])
    })

    it('a pack-free start applies no popups element', async () => {
        await start('?nothemepack')
        activateArchive()
        m.driver.startThemePackApply()
        await ticks(8)
        expect(popupsElements()).toHaveLength(0)
        expect(packElements()).toHaveLength(0)
    })

    it('leaving the pack removes the overlays with the screen element', async () => {
        await start('')
        activateArchive()
        m.driver.startThemePackApply()
        await until(() => m.driver.themePackApplyState().phase === 'applied', 'the apply')
        expect(popupsElements()).toHaveLength(2)
        m.safeMode.enterPackSafeMode('boot')
        await until(() => m.driver.themePackApplyState().phase === 'none', 'the removal')
        expect(packElements()).toHaveLength(0)
    })
})