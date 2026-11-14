// @vitest-environment jsdom
/**
 * The driver (`activePack.svelte.ts`: T3D-1 to T3D-9, T3D-11, T3D-12, T3G-7), all GUARD: no driver exists at the base, so a
 * red run would only be a missing module. REAL: the driver, the apply core, the intake, the validator (through the real worker
 * handler behind a fake channel), the surface gate, `install.ts`, `SafeModeStore`'s writable semantics and `colorscheme.ts`'s
 * `updateTextThemeAndCSS`. FAKED: the page store (an in-memory read and write), `URL.createObjectURL` and `revokeObjectURL`
 * (jsdom has neither), the worker channel (real verdicts, no real Worker; the WebView worker is a device row) and `DBState`,
 * which is a real `$state` object. The channel answers on a later task, or holds each answer until the test releases it.
 */
import { createHash } from 'node:crypto'
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../storage/database.svelte'
import { resetBusyActionsForTest } from '../process/memory/busyActions'
import { resetRestoreInProgressForTests } from '../drive/restoreInProgress'
import { resetPageStorageModeForTests } from '../storage/pageStorageMode'
import {
    fakeFont, manifestText, PLAIN_CHAT_SHEET, validPackFiles, zipPack, type PackFile,
} from './fixtures/packBuilder'
import bananaCocoaChat from '../../../docs/design/chat/themes/banana-cocoa.css?raw'
import originNavyStudio from '../../../docs/design/studio/themes/origin-navy.css?raw'

//#region module mocks

const world = vi.hoisted(() => ({
    files: new Map<string, Uint8Array>(),
    reads: [] as string[],
}))

/** The judge channel: every spawn is counted, and `deferred` holds each answer until the test releases it. */
const channel = vi.hoisted(() => ({
    spawns: 0,
    deferred: false,
    held: [] as Array<() => void>,
}))

vi.mock('../storage/store/appStore', () => ({
    getAppStore: async () => ({
        read: async (key: string) => {
            world.reads.push(key)
            return { bytes: world.files.get(key) ?? null, version: null }
        },
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
vi.mock('../storage/database.svelte', () => ({ getDatabase: vi.fn(), setDatabase: vi.fn() }))
vi.mock('../util', () => ({ BufferToText: vi.fn(), selectSingleFile: vi.fn(), sleep: vi.fn(async () => { }) }))
vi.mock('../alert', () => ({ alertError: vi.fn(), alertConfirm: vi.fn(async () => true) }))
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
import { updateTextThemeAndCSS } from '../gui/colorscheme'
import { installThemePack, removeThemePackAt, setActiveThemePack, type InstallRequest } from './install'
import { listThemePacks, type PackManifestFields } from './packRecord'
import { resetPackSheetForTests } from './apply'
import { applyKeyOf, resetThemePackApplyForTests, startThemePackApply, themePackApplyState } from './activePack.svelte'
import { declareSurface, installThemePackGate, resetThemePackGateForTests } from './surfaceGate.svelte'

//#region fixtures

const cover = $state({ on: false })

const FONT_A = 'fonts/a.woff2'
const FONT_B = 'fonts/b.woff2'
const FACE_A = '@font-face{font-family:"pack-a";src:url(fonts/a.woff2) format("woff2")}'
const FACE_B = '@font-face{font-family:"pack-b";src:url(fonts/b.woff2) format("woff2")}'

function leaf(opacity: string): string {
    return `[data-part="chat-message-avatar"]{opacity:${opacity}}`
}

function fontManifest(name: string, files: readonly string[]): string {
    return manifestText({ name, fonts: files.map((file) => ({ file, license: 'OFL-1.1' })) })
}

/** An archive over `zipPack`, the golden producer: the sheet, the fonts it names and any extra entries. */
function packOf(sheet: PackFile, fonts: readonly string[] = [], extra: Readonly<Record<string, PackFile>> = {}, name = 'Test Pack'): Uint8Array {
    const entries: Record<string, PackFile> = { 'manifest.json': fontManifest(name, fonts), 'chat.css': sheet }
    for (const font of fonts) {
        entries[font] = fakeFont()
    }
    return zipPack(validPackFiles({ ...entries, ...extra }))
}

function keyOf(bytes: Uint8Array): string {
    return `assets/tp-${createHash('sha256').update(bytes).digest('hex')}.risutheme`
}

/** A stored record in the exact shape `installThemePack` emits; the archive is also put in the store unless `stored` is false. */
function archiveRecord(id: string, bytes: Uint8Array, fonts: readonly string[] = [], stored = true): Record<string, unknown> {
    const archive = keyOf(bytes)
    if (stored) {
        world.files.set(archive, bytes.slice())
    }
    return {
        v: 1, id, name: `Pack ${id}`, version: '1.0.0', license: 'MIT', attribution: 'Test author', modes: ['dark'],
        fonts: fonts.map((file) => ({ file, license: 'OFL-1.1' })), archive, bytes: bytes.length, installedAt: 1,
    }
}

function addRecord(record: Record<string, unknown>): void {
    DBState.db.themePacks?.push(record)
}

const PACK_A = packOf(FACE_A + leaf('1'), [FONT_A], {}, 'Pack A')
const PACK_B = packOf(FACE_B + leaf('0'), [FONT_B], { 'studio.css': 'body{color:red}' }, 'Pack B')
const PACK_C = packOf(leaf('0.5'), [], {}, 'Pack C')
/** A refused sheet: `body` is outside the chat scope. */
const PACK_REFUSED = packOf('body{color:red}', [], {}, 'Pack Refused')

function freshDb(): Database {
    return {
        themePacks: [], colorScheme: { type: 'dark' }, textTheme: 'standard', font: 'default', customCSS: '',
    } as unknown as Database
}

const blobs = {
    minted: [] as string[],
    revoked: [] as string[],
    failMintAt: 0,
    onMint: null as (() => void) | null,
}
let savedCreate: typeof URL.createObjectURL | undefined
let savedRevoke: typeof URL.revokeObjectURL | undefined

function installUrlFake(): void {
    savedCreate = URL.createObjectURL
    savedRevoke = URL.revokeObjectURL
    URL.createObjectURL = (): string => {
        if (blobs.failMintAt !== 0 && blobs.minted.length + 1 === blobs.failMintAt) {
            throw new Error('createObjectURL failed')
        }
        const url = `blob:http://localhost/${blobs.minted.length + 1}`
        blobs.minted.push(url)
        blobs.onMint?.()
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

/** Every URL minted is revoked, except the ones the applied element still holds. */
function expectOnlyAppliedBlobsLive(): void {
    const held = packElements().flatMap((element) => element.textContent?.match(/blob:[^")]+/g) ?? [])
    const live = blobs.minted.filter((url) => !blobs.revoked.includes(url))
    expect([...live].sort()).toEqual([...held].sort())
}

function resetDocument(): void {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    const app = document.createElement('style')
    app.id = 'appcss'
    document.head.appendChild(app)
    const custom = document.createElement('style')
    custom.id = 'customcss'
    document.body.appendChild(custom)
}

function packElements(): HTMLStyleElement[] {
    return [...document.querySelectorAll<HTMLStyleElement>('style[data-theme-pack]')]
}

function status() {
    return themePackApplyState()
}

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

async function macroTicks(count: number): Promise<void> {
    for (let tick = 0; tick < count; tick++) {
        flushSync()
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
}

/** Writes the active id the way the callers do, then runs the effects. */
function activate(id: string | undefined): void {
    if (id === undefined) {
        delete DBState.db.activeThemePack
    } else {
        DBState.db.activeThemePack = id
    }
    flushSync()
}

interface Recorder { take(): MutationRecord[] }

const recorders: MutationObserver[] = []

function startRecording(): Recorder {
    const collected: MutationRecord[] = []
    const observer = new MutationObserver((records) => { collected.push(...records) })
    const options: MutationObserverInit = { childList: true, subtree: true, attributes: true, attributeFilter: ['media'], attributeOldValue: true }
    observer.observe(document.head, options)
    observer.observe(document.body, options)
    recorders.push(observer)
    return { take: () => { collected.push(...observer.takeRecords()); return collected } }
}

interface ReplayStep {
    type: 'add' | 'remove' | 'media'
    element: HTMLStyleElement
    /** The media value a `media` step wrote. */
    value?: string | null
    /** Registered elements and the registered elements that are `all`, after this record. */
    registered: HTMLStyleElement[]
    on: HTMLStyleElement[]
}

/**
 * Replays the records in order. An element the apply module created is registered from the record that adds it to the
 * record that removes it; an element in `held` is registered throughout. A media record's new value is the old value of
 * the next media record on that element, else its media at the end.
 */
function replay(records: readonly MutationRecord[], held: ReadonlySet<Element> = new Set()): ReplayStep[] {
    const isPackStyle = (node: Node): node is HTMLStyleElement => node instanceof HTMLStyleElement && node.hasAttribute('data-theme-pack')
    const initialOf = (element: Element): string | null => {
        const first = records.find((record) => record.type === 'attributes' && record.target === element)
        return first === undefined ? element.getAttribute('media') : first.oldValue
    }
    const newValueAt = (index: number): string | null => {
        const target = records[index].target
        const next = records.slice(index + 1).find((record) => record.type === 'attributes' && record.target === target)
        return next === undefined ? (target as Element).getAttribute('media') : next.oldValue
    }
    const live = new Set<HTMLStyleElement>()
    const media = new Map<Element, string | null>()
    for (const element of held) {
        live.add(element as HTMLStyleElement)
        media.set(element, initialOf(element))
    }
    const steps: ReplayStep[] = []
    const push = (type: ReplayStep['type'], element: HTMLStyleElement, value?: string | null): void => {
        const registered = [...live]
        steps.push({ type, element, value, registered, on: registered.filter((candidate) => media.get(candidate) === 'all') })
    }
    records.forEach((record, index) => {
        if (record.type === 'childList') {
            for (const node of record.addedNodes) {
                if (isPackStyle(node)) {
                    live.add(node)
                    media.set(node, initialOf(node))
                    push('add', node)
                }
            }
            for (const node of record.removedNodes) {
                if (isPackStyle(node) && live.has(node)) {
                    live.delete(node)
                    push('remove', node)
                }
            }
        } else if (live.has(record.target as HTMLStyleElement)) {
            const value = newValueAt(index)
            media.set(record.target as Element, value)
            push('media', record.target as HTMLStyleElement, value)
        }
    })
    return steps
}

function childListRecordsOn(records: readonly MutationRecord[], element: Element): MutationRecord[] {
    return records.filter((record) => record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].includes(element))
}

function mediaRecords(records: readonly MutationRecord[]): MutationRecord[] {
    return records.filter((record) => record.type === 'attributes')
}

function manifestOf(name: string, fonts: readonly string[] = []): PackManifestFields {
    return {
        packId: undefined, name, version: '1.0.0', license: 'MIT', attribution: 'Test author', modes: ['dark'],
        fonts: fonts.map((file) => ({ file, license: 'OFL-1.1' })),
    }
}

function installRequestOf(bytes: Uint8Array, name: string, newId: string, fonts: readonly string[] = []): InstallRequest<string> {
    return {
        bytes,
        verify: async () => ({ ok: true, manifest: manifestOf(name, fonts) }),
        confirmReplace: async () => true,
        newId: () => newId,
    }
}

//#endregion

let errorLog: ReturnType<typeof vi.spyOn>
/** Releases the shell's own declaration of the chat surface. */
let shell: () => void = () => { }

beforeEach(() => {
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => { })
    world.files.clear()
    world.reads.length = 0
    channel.spawns = 0
    channel.deferred = false
    channel.held.length = 0
    blobs.minted.length = 0
    blobs.revoked.length = 0
    blobs.failMintAt = 0
    blobs.onMint = null
    resetBusyActionsForTest()
    resetRestoreInProgressForTests()
    resetPageStorageModeForTests()
    resetDocument()
    installUrlFake()
    SafeModeStore.set(false)
    DBState.db = freshDb()
    cover.on = false
    installThemePackGate(() => cover.on)
    shell = declareSurface('chat')
    flushSync()
})

afterEach(() => {
    errorLog.mockRestore()
    for (const observer of recorders.splice(0)) observer.disconnect()
    resetThemePackApplyForTests()
    resetPackSheetForTests()
    resetThemePackGateForTests()
    restoreUrlFake()
    cover.on = false
    document.head.innerHTML = ''
    document.body.innerHTML = ''
})

describe('applyKeyOf', () => {
    it('maps the active id, Safe Mode and the record list to one key', () => {
        const record = archiveRecord('rec-a', PACK_A, [FONT_A])
        const packs = [record, { ...archiveRecord('rec-x', PACK_C), v: 2 }]
        expect(applyKeyOf(undefined, false, packs)).toBe('none')
        expect(applyKeyOf('', false, packs)).toBe('none')
        expect(applyKeyOf(7, false, packs)).toBe('none')
        expect(applyKeyOf('rec-a', true, packs)).toBe('none')
        expect(applyKeyOf('builtin:banana-cocoa', false, packs)).toBe('builtin:banana-cocoa')
        expect(applyKeyOf('builtin:nope', false, packs)).toBe('none')
        expect(applyKeyOf('rec-a', false, packs)).toBe(`archive:${record.archive as string}`)
        expect(applyKeyOf('rec-x', false, packs)).toBe('unreadable:rec-x')
        expect(applyKeyOf('rec-none', false, packs)).toBe('none')
        expect(applyKeyOf('rec-a', false, 'not a list')).toBe('none')
    })
})

describe('T3D-1 boot', () => {
    it('applies the active built-in once the judge settles, and a second start changes nothing', async () => {
        DBState.db.activeThemePack = 'builtin:banana-cocoa'
        startThemePackApply()
        flushSync()
        expect(status().phase).toBe('pending')
        await until(() => status().phase === 'applied', 'the boot apply')
        const [element] = packElements()
        expect(packElements()).toHaveLength(1)
        expect(element.getAttribute('media')).toBe('all')
        expect(status()).toMatchObject({ activeId: 'builtin:banana-cocoa', phase: 'applied', empty: false })
        const spawns = channel.spawns
        startThemePackApply()
        await macroTicks(3)
        expect(channel.spawns).toBe(spawns)
        expect(packElements()).toEqual([element])
        expect(status().phase).toBe('applied')
    })
})

describe('T3D-2 callers', () => {
    it('applies on a first key addition, setActiveThemePack, a real install and removeThemePackAt', async () => {
        startThemePackApply()
        flushSync()
        expect(status().phase).toBe('none')
        expect(packElements()).toHaveLength(0)

        // First key addition: the database has no `activeThemePack` key yet.
        expect('activeThemePack' in DBState.db).toBe(false)
        DBState.db.activeThemePack = 'builtin:banana-cocoa'
        await until(() => status().phase === 'applied', 'the first key addition')
        expect(packElements()).toHaveLength(1)

        setActiveThemePack('builtin:origin-navy')
        await until(() => status().phase === 'applied' && status().activeId === 'builtin:origin-navy' && channel.spawns === 2, 'the setActiveThemePack apply')
        expect(packElements()).toHaveLength(1)
        expect(packElements()[0].getAttribute('media')).toBe('all')

        const outcome = await installThemePack(installRequestOf(PACK_A, 'Pack A', 'rec-a', [FONT_A]))
        expect(outcome.ok).toBe(true)
        await until(() => status().phase === 'applied' && status().activeId === 'rec-a' && channel.spawns === 3, 'the install apply')
        expect(packElements()).toHaveLength(1)
        expect(packElements()[0].textContent).toContain('blob:http://localhost/1')
        expect(world.reads).toHaveLength(2)

        const [{ index, entry }] = listThemePacks(DBState.db.themePacks)
        expect(removeThemePackAt(index, entry)).toEqual({ ok: true })
        await until(() => status().phase === 'none', 'the removal')
        expect(packElements()).toHaveLength(0)
        expect(blobs.revoked).toEqual(blobs.minted)
        expect(status().activeId).toBeUndefined()
    })
})

describe('T3D-3 an unchanged pack is not re-applied while the shell is shown', () => {
    it('does no store read, no spawn, no element change and writes media only at cover transitions', async () => {
        addRecord(archiveRecord('rec-a', PACK_A, [FONT_A]))
        startThemePackApply()
        activate('rec-a')
        await until(() => status().phase === 'applied', 'the apply')
        const element = packElements()[0]
        expect(element.getAttribute('media')).toBe('all')
        const readsBefore = world.reads.length
        const spawnsBefore = channel.spawns
        const recorder = startRecording()
        const mediaSoFar = (): number => mediaRecords(recorder.take()).length

        for (let toggle = 0; toggle < 10; toggle++) {
            cover.on = !cover.on
            flushSync()
            await macroTicks(1)
        }
        expect(mediaSoFar()).toBe(10)

        shell()
        shell = declareSurface('chat')
        flushSync()
        await macroTicks(1)
        expect(mediaSoFar()).toBe(10)

        DBState.db.temperature = 0.5
        DBState.db.maxResponse = 300
        DBState.db.mainPrompt = 'changed'
        DBState.db.aiModel = 'other'
        DBState.db.jailbreak = 'changed'
        flushSync()
        await macroTicks(1)

        DBState.db = structuredClone($state.snapshot(DBState.db))
        flushSync()
        await macroTicks(1)

        addRecord(archiveRecord('rec-other', PACK_C))
        flushSync()
        await macroTicks(1)

        document.documentElement.style.removeProperty('--risu-font-family')
        updateTextThemeAndCSS()
        updateTextThemeAndCSS()
        // The real function ran against the stand-in: it wrote the root's font family.
        expect(document.documentElement.style.getPropertyValue('--risu-font-family')).toBe('Arial, sans-serif')
        flushSync()
        await macroTicks(3)

        const records = recorder.take()
        expect(world.reads).toHaveLength(readsBefore)
        expect(channel.spawns).toBe(spawnsBefore)
        expect(packElements()).toEqual([element])
        expect(replay(records).filter((step) => step.type !== 'media')).toEqual([])
        expect(childListRecordsOn(records, element)).toEqual([])
        expect(mediaRecords(records)).toHaveLength(10)
        const written = replay(records, new Set([element])).map((step) => step.value)
        expect(written).toEqual(['not all', 'all', 'not all', 'all', 'not all', 'all', 'not all', 'all', 'not all', 'all'])
        expect(status()).toMatchObject({ phase: 'applied', activeId: 'rec-a' })
        expectOnlyAppliedBlobsLive()
    })
})

describe('T3D-4 Safe Mode', () => {
    it('removes the pack and revokes its blobs, then re-judges and applies it again', async () => {
        addRecord(archiveRecord('rec-a', PACK_A, [FONT_A]))
        startThemePackApply()
        activate('rec-a')
        await until(() => status().phase === 'applied', 'the apply')
        expect(blobs.minted).toHaveLength(1)

        SafeModeStore.set(true)
        flushSync()
        expect(packElements()).toHaveLength(0)
        expect(blobs.revoked).toEqual(blobs.minted)
        expect(status().phase).toBe('none')

        const spawns = channel.spawns
        SafeModeStore.set(false)
        await until(() => status().phase === 'applied', 'the re-apply')
        expect(channel.spawns).toBe(spawns + 1)
        expect(packElements()).toHaveLength(1)
        expect(packElements()[0].getAttribute('media')).toBe('all')
    })

    it('never has a pack element on while covered, through Safe Mode off and on', async () => {
        cover.on = true
        flushSync()
        const recorder = startRecording()
        addRecord(archiveRecord('rec-a', PACK_A, [FONT_A]))
        startThemePackApply()
        activate('rec-a')
        await until(() => status().phase === 'applied', 'the covered apply')
        SafeModeStore.set(true)
        flushSync()
        SafeModeStore.set(false)
        await until(() => status().phase === 'applied' && packElements().length === 1, 'the re-apply')
        const steps = replay(recorder.take())
        expect(steps.filter((step) => step.type === 'add').length).toBeGreaterThanOrEqual(2)
        expect(steps.every((step) => step.on.length === 0)).toBe(true)
        expect(packElements()[0].getAttribute('media')).toBe('not all')
        cover.on = false
        flushSync()
        expect(packElements()[0].getAttribute('media')).toBe('all')
    })
})

describe('T3D-5 unknown ids mean None', () => {
    it('leaves no element, no reason and the stored id unchanged', async () => {
        startThemePackApply()
        for (const id of ['builtin:nope', 'f3c9a0a2-4d3e-4e33-9d0b-1e0f0a0b0c0d']) {
            activate(id)
            await macroTicks(2)
            expect(packElements()).toHaveLength(0)
            expect(status().phase).toBe('none')
            expect(status().reason).toBeUndefined()
            expect(DBState.db.activeThemePack).toBe(id)
            expect(status().activeId).toBe(id)
        }
        expect(channel.spawns).toBe(0)
        expect(world.reads).toHaveLength(0)
    })
})

describe('T3D-6 races', () => {
    function seedPacks(): void {
        addRecord(archiveRecord('rec-a', PACK_A, [FONT_A]))
        addRecord(archiveRecord('rec-b', PACK_B, [FONT_B]))
        addRecord(archiveRecord('rec-c', PACK_C))
    }

    function release(index: number): void {
        channel.held[index]()
    }

    it('(a) picking B before A is judged inserts only B', async () => {
        seedPacks()
        channel.deferred = true
        const recorder = startRecording()
        startThemePackApply()
        activate('rec-a')
        await until(() => channel.held.length === 1, 'A at its judge')
        activate('rec-b')
        await until(() => channel.held.length === 2, 'B at its judge')
        release(0)
        release(1)
        await until(() => status().phase === 'applied', 'B applied')
        await macroTicks(3)
        const adds = replay(recorder.take()).filter((step) => step.type === 'add')
        expect(adds).toHaveLength(1)
        expect(adds[0].element.textContent).toContain('opacity:0')
        expect(adds[0].element.textContent).not.toContain('pack-a')
        expect(status()).toMatchObject({ phase: 'applied', activeId: 'rec-b' })
        expectOnlyAppliedBlobsLive()
    })

    it('(b) returning to the applied B while A is in flight leaves B on and never inserts A', async () => {
        seedPacks()
        startThemePackApply()
        activate('rec-b')
        await until(() => status().phase === 'applied', 'B applied')
        const elementB = packElements()[0]
        const spawnsBefore = channel.spawns
        channel.deferred = true
        const recorder = startRecording()
        activate('rec-a')
        await until(() => channel.held.length === 1, 'A at its judge')
        activate('rec-b')
        release(0)
        await macroTicks(5)
        const records = recorder.take()
        expect(replay(records).filter((step) => step.type === 'add')).toEqual([])
        expect(childListRecordsOn(records, elementB)).toEqual([])
        expect(packElements()).toEqual([elementB])
        expect(status()).toMatchObject({ phase: 'applied', activeId: 'rec-b', skippedAreas: ['studio'], empty: false })
        expect(channel.spawns - spawnsBefore).toBe(1)
        expectOnlyAppliedBlobsLive()
    })

    it('(c) a cancelled run settling does not free the newer run, so an equal database replacement starts nothing', async () => {
        seedPacks()
        channel.deferred = true
        const recorder = startRecording()
        startThemePackApply()
        activate('rec-a')
        await until(() => channel.held.length === 1, 'A at its judge')
        activate('rec-b')
        await until(() => channel.held.length === 2, 'B at its judge')
        release(0)
        await macroTicks(5)
        DBState.db = structuredClone($state.snapshot(DBState.db))
        flushSync()
        await macroTicks(3)
        expect(channel.spawns).toBe(2)
        release(1)
        await until(() => status().phase === 'applied', 'B applied')
        await macroTicks(3)
        expect(replay(recorder.take()).filter((step) => step.type === 'add')).toHaveLength(1)
        expect(packElements()).toHaveLength(1)
        expect(status()).toMatchObject({ phase: 'applied', activeId: 'rec-b' })
        expectOnlyAppliedBlobsLive()
    })

    it('(d) a stale settle never lets a superseded run commit over the key that came back', async () => {
        seedPacks()
        startThemePackApply()
        activate('rec-b')
        await until(() => status().phase === 'applied', 'B applied')
        const elementB = packElements()[0]
        const spawnsBefore = channel.spawns
        channel.deferred = true
        const recorder = startRecording()
        activate('rec-a')
        await until(() => channel.held.length === 1, 'A at its judge')
        activate('rec-c')
        await until(() => channel.held.length === 2, 'C at its judge')
        release(0)
        await macroTicks(5)
        activate('rec-b')
        release(1)
        await macroTicks(5)
        const records = recorder.take()
        expect(replay(records).filter((step) => step.type === 'add')).toEqual([])
        expect(childListRecordsOn(records, elementB)).toEqual([])
        expect(packElements()).toEqual([elementB])
        expect(status()).toMatchObject({ phase: 'applied', activeId: 'rec-b' })
        expect(channel.spawns - spawnsBefore).toBe(2)
        expectOnlyAppliedBlobsLive()
    })
})

describe('T3D-7 a broken key', () => {
    it('removes the previous element, keeps the record, and leaves no stale status field behind', async () => {
        addRecord(archiveRecord('rec-a', PACK_A, [FONT_A]))
        addRecord(archiveRecord('rec-b', PACK_B, [FONT_B], false))
        addRecord(archiveRecord('rec-c', PACK_REFUSED))
        startThemePackApply()
        activate('rec-a')
        await until(() => status().phase === 'applied', 'A applied')
        const recordB = JSON.stringify($state.snapshot(DBState.db.themePacks?.[1]))

        activate('rec-b')
        await until(() => status().phase === 'broken', 'B broken')
        expect(status().reason).toBe('files')
        expect(packElements()).toHaveLength(0)
        expect(blobs.revoked).toEqual(blobs.minted)
        expect(JSON.stringify($state.snapshot(DBState.db.themePacks?.[1]))).toBe(recordB)
        expect(DBState.db.activeThemePack).toBe('rec-b')

        activate('rec-a')
        await until(() => status().phase === 'applied', 'A applied again')
        expect(status().reason).toBeUndefined()
        expect(status().refusals).toBeUndefined()
        expect(status().skippedAreas).toEqual([])
        expect(status().empty).toBe(false)

        activate('rec-c')
        await until(() => status().phase === 'broken', 'C broken')
        expect(status().reason).toBe('refused')
        expect(status().refusals?.length).toBeGreaterThan(0)
        expect(status().skippedAreas).toBeUndefined()
        expect(status().empty).toBeUndefined()
        expect(packElements()).toHaveLength(0)
    })
})

describe('T3D-8 Replace with identical bytes', () => {
    it('does no read, no spawn and no element change, and the status follows the new record id', async () => {
        startThemePackApply()
        flushSync()
        const first = await installThemePack(installRequestOf(PACK_A, 'Pack A', 'rec-1', [FONT_A]))
        expect(first.ok).toBe(true)
        await until(() => status().phase === 'applied' && status().activeId === 'rec-1', 'the first install')
        const element = packElements()[0]
        const readsBefore = world.reads.length
        const spawnsBefore = channel.spawns
        const recorder = startRecording()

        cover.on = true
        flushSync()
        const second = await installThemePack(installRequestOf(PACK_A, 'Pack A', 'rec-2', [FONT_A]))
        expect(second).toMatchObject({ ok: true, replaced: true })
        await until(() => status().activeId === 'rec-2', 'the replaced id')
        await macroTicks(3)

        expect(DBState.db.activeThemePack).toBe('rec-2')
        expect(world.reads.slice(readsBefore)).toEqual(world.reads.slice(readsBefore).filter((key) => key === keyOf(PACK_A)))
        expect(channel.spawns).toBe(spawnsBefore)
        expect(packElements()).toEqual([element])
        expect(childListRecordsOn(recorder.take(), element)).toEqual([])
        expect(status().phase).toBe('applied')
    })
})

describe('T3D-9 unreadable and refused stored packs', () => {
    it('shows an unreadable active entry as broken and leaves it untouched', async () => {
        const entry = { ...archiveRecord('rec-u', PACK_A, [FONT_A]), v: 2 }
        addRecord(entry)
        const before = JSON.stringify($state.snapshot(DBState.db.themePacks))
        startThemePackApply()
        activate('rec-u')
        await macroTicks(3)
        expect(status()).toMatchObject({ phase: 'broken', reason: 'unreadable', activeId: 'rec-u' })
        expect(packElements()).toHaveLength(0)
        expect(JSON.stringify($state.snapshot(DBState.db.themePacks))).toBe(before)
        expect(channel.spawns).toBe(0)
    })

    it('carries the refusals of a refused stored pack', async () => {
        addRecord(archiveRecord('rec-c', PACK_REFUSED))
        startThemePackApply()
        activate('rec-c')
        await until(() => status().phase === 'broken', 'the refused pack')
        expect(status().reason).toBe('refused')
        expect(status().refusals?.[0]).toMatchObject({ code: 'sheetRefused', sheet: 'chat.css' })
        expect(packElements()).toHaveLength(0)
    })
})

describe('T3D-11 a failed commit and a throwing mint', () => {
    it('(a) a missing #customcss answers broken couldNotCheck, removes the previous pack and retries on a database replacement', async () => {
        addRecord(archiveRecord('rec-a', PACK_A, [FONT_A]))
        startThemePackApply()
        activate('rec-a')
        await until(() => status().phase === 'applied', 'A applied')
        expect(blobs.minted).toHaveLength(1)

        document.getElementById('customcss')?.remove()
        activate('builtin:origin-navy')
        await until(() => status().phase === 'broken', 'the failed commit')
        expect(status().reason).toBe('couldNotCheck')
        expect(packElements()).toHaveLength(0)
        expect(blobs.revoked).toEqual(blobs.minted)

        const spawns = channel.spawns
        DBState.db = structuredClone($state.snapshot(DBState.db))
        await until(() => channel.spawns === spawns + 1, 'the retry')
        await until(() => status().phase === 'broken', 'the retry settles')
        expect(status().reason).toBe('couldNotCheck')
    })

    it('(b) a throwing mint answers broken couldNotCheck, never pending, and a replacement starts a new run', async () => {
        addRecord(archiveRecord('rec-two', packOf(FACE_A + FACE_B + leaf('1'), [FONT_A, FONT_B], {}, 'Two Fonts'), [FONT_A, FONT_B]))
        blobs.failMintAt = 2
        startThemePackApply()
        activate('rec-two')
        await until(() => status().phase !== 'pending', 'the failed mint')
        expect(status()).toMatchObject({ phase: 'broken', reason: 'couldNotCheck' })
        expect(packElements()).toHaveLength(0)
        expect(blobs.minted).toHaveLength(1)
        expect(blobs.revoked).toEqual(blobs.minted)

        blobs.failMintAt = 0
        const spawns = channel.spawns
        DBState.db = structuredClone($state.snapshot(DBState.db))
        await until(() => channel.spawns === spawns + 1, 'the new run')
        await until(() => status().phase === 'applied', 'the retry applies')
        expect(packElements()).toHaveLength(1)
    })
})

describe('T3D-12 the re-check before commit', () => {
    it('does not insert a pack whose active id was removed during its last mint', async () => {
        addRecord(archiveRecord('rec-a', PACK_A, [FONT_A]))
        const recorder = startRecording()
        blobs.onMint = () => { delete DBState.db.activeThemePack }
        startThemePackApply()
        activate('rec-a')
        await until(() => channel.spawns === 1, 'the judge')
        await until(() => blobs.minted.length === 1, 'the mint')
        await macroTicks(5)
        expect(replay(recorder.take()).filter((step) => step.type === 'add')).toEqual([])
        expect(packElements()).toHaveLength(0)
        expect(status().phase).toBe('none')
        expect(status().activeId).toBeUndefined()
        expect(blobs.revoked).toEqual(blobs.minted)
    })
})

describe('T3G-7 a {chat Banana Cocoa, studio Origin Navy} pack', () => {
    const MANIFEST = {
        kind: 'risutheme', format: 1, id: 'risutanium.mixed', name: 'Mixed', version: '1.0.0', license: 'GPL-3.0',
        attribution: 'RisuTanium contributors', modes: ['light'], fonts: [],
    }

    function mixedPack(): Uint8Array {
        return zipPack({
            'manifest.json': `${JSON.stringify(MANIFEST, null, 2)}\n`,
            'chat.css': bananaCocoaChat.replace(/\r\n/g, '\n'),
            'studio.css': originNavyStudio.replace(/\r\n/g, '\n'),
        })
    }

    it('applies chat only and never has two sheets on through cover toggles and a remount', async () => {
        addRecord(archiveRecord('rec-mixed', mixedPack()))
        const recorder = startRecording()
        startThemePackApply()
        activate('rec-mixed')
        await until(() => status().phase === 'applied', 'the apply')
        expect(status().skippedAreas).toEqual(['studio'])
        expect(packElements()).toHaveLength(1)
        expect(packElements()[0].getAttribute('data-theme-pack')).toBe('chat')
        expect(document.querySelectorAll('style[data-theme-pack]:not([data-theme-pack="chat"])')).toHaveLength(0)
        expect(packElements()[0].getAttribute('media')).toBe('all')

        // Settings over the shell, then Studio over the shell: each is one cover transition pair.
        for (let pass = 0; pass < 2; pass++) {
            cover.on = true
            flushSync()
            expect(packElements()[0].getAttribute('media')).toBe('not all')
            cover.on = false
            flushSync()
            expect(packElements()[0].getAttribute('media')).toBe('all')
        }
        // The shell unmounts and mounts again.
        shell()
        flushSync()
        expect(packElements()[0].getAttribute('media')).toBe('not all')
        shell = declareSurface('chat')
        flushSync()
        expect(packElements()[0].getAttribute('media')).toBe('all')
        await macroTicks(2)

        const steps = replay(recorder.take())
        expect(steps.length).toBeGreaterThan(0)
        expect(steps.every((step) => step.on.length <= 1)).toBe(true)
        expect(steps.filter((step) => step.type === 'add')).toHaveLength(1)
    })
})
