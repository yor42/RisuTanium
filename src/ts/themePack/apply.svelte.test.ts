// @vitest-environment jsdom
/**
 * The apply core (T3-1 to T3-17, T3A-1, T3G-6), all GUARD: no apply code exists at the base, so a red run would only be a
 * missing module. REAL: apply.ts, intake, the validator (through the real worker handler behind a fake channel), the surface
 * gate and the packs `zipPack` builds. FAKED: the page store (an in-memory read), `URL.createObjectURL` and `revokeObjectURL`
 * (jsdom has neither), and the worker channel (real verdicts, no real Worker; the WebView worker is a device row).
 */
import { createHash } from 'node:crypto'
import { flushSync } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalStylesheet } from './canonical'
import { shapeOnlySheet, shapeTokenNames } from './shapeMode'
import { judgeAreaSheet, type PackSheetsJudgement } from './index'
import { builtinPackById, type BuiltinPack } from './builtins'
import { judgeSessionOverForTests, openJudgeSession, type JudgeRequest, type JudgeSession, type JudgeWorkerLike } from './judgeClient'
import type { IntakeRefusal, PackJudge } from './intake'
import { handleJudgeRequest, type JudgeResponse } from './worker/judgeHandler'
import {
    BLOB_URL_PATTERN, brokenReasonOf, buildAppliedText, commitPackSheet, preparePackSheet, resetPackSheetForTests, setPackSheetColours,
    type ApplySource, type Prepared,
} from './apply'
import studioScratchWhite from '../../../docs/design/studio/themes/scratch-white.css?raw'
import { declareSurface, installThemePackGate, registerThemePackElement, resetThemePackGateForTests } from './surfaceGate.svelte'
import { getFileSrc } from '../globalApi.svelte'
import { packBaseTone } from '../gui/surfaceTone'
import { chatCommitInput, chatElementOf } from './fixtures/packCommit'
import {
    CHAT_SHEET, concat, fakeFont, manifestText, PLAIN_CHAT_SHEET, PNG_1X1, utf8, validPackFiles, zipPack, type PackFile,
} from './fixtures/packBuilder'
import { CascadeModel, compileAppStyles, compileRules } from '../../styles/tests/cascadeModel'

//#region module mocks

const world = vi.hoisted(() => ({
    files: new Map<string, Uint8Array>(),
    readFailure: null as Error | null,
    wrapRead: null as ((bytes: Uint8Array) => Uint8Array) | null,
    reads: [] as string[],
    /** `readVerifiedFile` calls so far, and the call (1-based) that throws or answers a refusal instead. */
    verifiedCalls: 0,
    verifiedThrowAt: 0,
    verifiedRefuseAt: 0,
}))

vi.mock('../storage/store/appStore', () => ({
    getAppStore: async () => ({
        read: async (key: string) => {
            world.reads.push(key)
            if (world.readFailure !== null) {
                throw world.readFailure
            }
            const stored = world.files.get(key) ?? null
            return { bytes: stored !== null && world.wrapRead !== null ? world.wrapRead(stored) : stored, version: null }
        },
    }),
}))
vi.mock('../globalApi.svelte', () => ({ getFileSrc: vi.fn() }))
vi.mock('./intake', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./intake')>()
    return {
        ...actual,
        readVerifiedFile: vi.fn(async (...args: Parameters<typeof actual.readVerifiedFile>) => {
            world.verifiedCalls += 1
            if (world.verifiedCalls === world.verifiedThrowAt) {
                throw new Error('readVerifiedFile threw')
            }
            if (world.verifiedCalls === world.verifiedRefuseAt) {
                return { ok: false as const, refusal: { code: 'wrongContent' as const, name: args[2] } }
            }
            return actual.readVerifiedFile(...args)
        }),
    }
})

//#endregion

//#region fixtures

const cover = $state({ on: false })

const FONT_A = 'fonts/a.woff2'
const FONT_B = 'fonts/b.woff2'
const FACE_A = '@font-face{font-family:"pack-a";src:url(fonts/a.woff2) format("woff2")}'
const FACE_B = '@font-face{font-family:"pack-b";src:url(fonts/b.woff2) format("woff2")}'
const LEAF = '[data-part="chat-message-avatar"]{opacity:1}'
const TWO_FONTS_SHEET = FACE_A + FACE_B + LEAF
/** Two fonts and one image: an upper-case `URL(` token, a quoted string inside `url(`, and one image named twice in both forms. */
const MIXED_SHEET = '@font-face{font-family:"pack-a";src:URL(fonts/a.woff2) format("woff2")}'
    + '@font-face{font-family:"pack-b";src:url("fonts/b.woff2") format("woff2")}'
    + '[data-part="chat-message-avatar"]{background-image:url(images/a.png),image-set("images/a.png" 1x)}'
const ALT_SHEET = '[data-part="chat-message-avatar"]{opacity:0.5}'

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

/** Stores `bytes` under the key of their own hash (or `key`) and answers the key. */
function store(bytes: Uint8Array, key: string = keyOf(bytes)): string {
    world.files.set(key, bytes.slice())
    return key
}

/** The offset of `needle` inside `haystack`, or -1. */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
    for (let at = 0; at + needle.length <= haystack.length; at++) {
        if (needle.every((byte, i) => haystack[at + i] === byte)) {
            return at
        }
    }
    return -1
}

/** A stored array whose own `subarray` (the source's read) counts and can throw; derived arrays are plain. */
const subarrayProbe = { calls: 0, throwAt: 0 }
class ProbedBytes extends Uint8Array {
    static get [Symbol.species](): Uint8ArrayConstructor { return Uint8Array }
    override subarray(begin?: number, end?: number) {
        subarrayProbe.calls += 1
        if (subarrayProbe.calls === subarrayProbe.throwAt) {
            throw new Error('the store array failed')
        }
        return super.subarray(begin, end)
    }
}

class AnsweringWorker implements JudgeWorkerLike {
    private readonly listeners: Record<string, Array<(event: Event) => void>> = {}

    constructor(private readonly posts: JudgeRequest[], private readonly silent: boolean, private readonly rewrite: (response: JudgeResponse) => JudgeResponse = (response) => response) {}

    postMessage(message: JudgeRequest): void {
        this.posts.push(message)
        if (!this.silent) {
            const answer = this.rewrite(handleJudgeRequest(message))
            setTimeout(() => {
                for (const listener of this.listeners.message ?? []) listener(new MessageEvent('message', { data: answer }))
            }, 0)
        }
    }

    terminate(): void {}

    addEventListener(type: 'message' | 'messageerror' | 'error', listener: (event: Event) => void): void {
        (this.listeners[type] ??= []).push(listener)
    }
}

interface JudgeRig { session: JudgeSession; judge: PackJudge; posts: JudgeRequest[]; spawns: () => number }

/** The real session over a channel that answers with the real handler; `silent` never answers (the session times out). */
function judgeRig(options: { silent?: boolean; timeoutMs?: number; rewrite?: (response: JudgeResponse) => JudgeResponse } = {}): JudgeRig {
    const posts: JudgeRequest[] = []
    let spawned = 0
    const session = openJudgeSession({
        spawn: () => {
            spawned += 1
            return new AnsweringWorker(posts, options.silent === true, options.rewrite)
        },
        timeoutMs: options.timeoutMs,
    })
    return { session, judge: session.judge, posts, spawns: () => spawned }
}

const blobs = { minted: [] as string[], revoked: [] as string[], types: [] as string[], failMintAt: 0, nextUrl: (n: number): string => `blob:http://localhost/${n}` }
let savedCreate: typeof URL.createObjectURL | undefined
let savedRevoke: typeof URL.revokeObjectURL | undefined

function installUrlFake(): void {
    savedCreate = URL.createObjectURL
    savedRevoke = URL.revokeObjectURL
    URL.createObjectURL = (object: Blob | MediaSource): string => {
        if (blobs.failMintAt !== 0 && blobs.minted.length + 1 === blobs.failMintAt) {
            throw new Error('createObjectURL failed')
        }
        if (object instanceof Blob) {
            blobs.types.push(object.type)
        }
        const url = blobs.nextUrl(blobs.minted.length + 1)
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

function expectBalanced(): void {
    expect([...blobs.revoked].sort()).toEqual([...blobs.minted].sort())
}

function resetWorld(): void {
    world.files.clear()
    world.readFailure = null
    world.wrapRead = null
    world.reads.length = 0
    world.verifiedCalls = 0
    world.verifiedThrowAt = 0
    world.verifiedRefuseAt = 0
    blobs.minted.length = 0
    blobs.revoked.length = 0
    blobs.types.length = 0
    blobs.failMintAt = 0
    blobs.nextUrl = (n) => `blob:http://localhost/${n}`
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

/** `isCurrent` that answers true `times` times and false after. */
function currentTimes(times: number): () => boolean {
    let asked = 0
    return () => {
        asked += 1
        return asked <= times
    }
}

const ALWAYS = (): boolean => true

async function prepare(source: ApplySource, rig: JudgeRig = judgeRig(), isCurrent: () => boolean = ALWAYS): Promise<Prepared | { ok: false; stale: true }> {
    return preparePackSheet(source, rig.session, isCurrent)
}

async function prepareArchive(bytes: Uint8Array, rig: JudgeRig = judgeRig(), isCurrent: () => boolean = ALWAYS): Promise<Prepared | { ok: false; stale: true }> {
    return prepare({ kind: 'archive', key: store(bytes) }, rig, isCurrent)
}

function accepted(prepared: Prepared | { ok: false; stale: true }): Extract<Prepared, { ok: true }> {
    if (prepared.ok !== true) {
        throw new Error(`expected an accepted sheet, got ${JSON.stringify(prepared)}`)
    }
    return prepared
}

function commitPrepared(prepared: Extract<Prepared, { ok: true }>): void {
    expect(commitPackSheet({ elements: prepared.elements, blobs: prepared.blobs })).toEqual({ ok: true })
}

/** Commits every prepared element of an accepted pack, as the driver does. */
function commitAll(prepared: Extract<Prepared, { ok: true }>, colours = false): void {
    expect(commitPackSheet({ elements: prepared.elements, blobs: prepared.blobs, colours })).toEqual({ ok: true })
}

function packElements(): HTMLStyleElement[] {
    return [...document.querySelectorAll<HTMLStyleElement>('style[data-theme-pack]')]
}

function openGate(covered = false): void {
    cover.on = covered
    installThemePackGate(() => cover.on)
    declareSurface('chat')
    flushSync()
}

/** No pack element is ever switched off through `disabled`. */
function expectNeverDisabled(): void {
    for (const element of packElements()) {
        expect(element.disabled).not.toBe(true)
        expect(element.sheet?.disabled).not.toBe(true)
    }
}

interface Recorder { take(): MutationRecord[] }

function startRecording(): Recorder {
    const collected: MutationRecord[] = []
    const observer = new MutationObserver(() => {})
    const options: MutationObserverInit = { childList: true, subtree: true, attributes: true, attributeFilter: ['media'], attributeOldValue: true }
    observer.observe(document.head, options)
    observer.observe(document.body, options)
    recorders.push(observer)
    return { take: () => { collected.push(...observer.takeRecords()); return collected } }
}

const recorders: MutationObserver[] = []

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
 * record that removes it; an element in `held` is registered throughout; an element in `ignored` is never counted. A media
 * record's new value is the old value of the next media record on that element, else its media at the end.
 */
function replay(records: readonly MutationRecord[], held: ReadonlySet<Element> = new Set(), ignored: ReadonlySet<Element> = new Set()): ReplayStep[] {
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
                if (isPackStyle(node) && !held.has(node) && !ignored.has(node)) {
                    live.add(node)
                    media.set(node, initialOf(node))
                    push('add', node)
                }
            }
            for (const node of record.removedNodes) {
                if (isPackStyle(node) && live.has(node) && !held.has(node)) {
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

//#endregion

let errorLog: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    resetWorld()
    resetDocument()
    installUrlFake()
    cover.on = false
})

afterEach(() => {
    errorLog.mockRestore()
    for (const observer of recorders.splice(0)) observer.disconnect()
    resetPackSheetForTests()
    resetThemePackGateForTests()
    restoreUrlFake()
    vi.mocked(getFileSrc).mockClear()
    cover.on = false
    document.head.innerHTML = ''
    document.body.innerHTML = ''
})

describe('T3-1 document order', () => {
    it('puts the pack element after the app CSS and directly before #customcss', async () => {
        const prepared = accepted(await prepareArchive(packOf(PLAIN_CHAT_SHEET)))
        commitPrepared(prepared)
        const [element] = packElements()
        expect(packElements()).toHaveLength(1)
        expect(element.nextElementSibling?.id).toBe('customcss')
        const app = document.getElementById('appcss') as HTMLElement
        const custom = document.getElementById('customcss') as HTMLElement
        expect(app.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(element.compareDocumentPosition(custom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
})

describe('T3-1b the anchor is the app style element', () => {
    it('inserts before the body-level #customcss, never before a card element carrying the same id', () => {
        document.body.innerHTML = ''
        const app = document.createElement('div')
        app.id = 'app'
        const card = document.createElement('div')
        card.id = 'customcss'
        app.appendChild(card)
        const appStyle = document.createElement('style')
        appStyle.id = 'customcss'
        document.body.append(app, appStyle)
        expect(commitPackSheet(chatCommitInput(LEAF))).toEqual({ ok: true })
        const [element] = packElements()
        expect(packElements()).toHaveLength(1)
        expect(element.parentElement).toBe(document.body)
        expect(element.nextElementSibling).toBe(appStyle)
        expect(card.previousElementSibling).toBeNull()
        expect(app.contains(element)).toBe(false)
    })

    it('a card element alone does not count as the anchor: nothing inserted, couldNotCheck', () => {
        document.body.innerHTML = ''
        const app = document.createElement('div')
        app.id = 'app'
        const card = document.createElement('div')
        card.id = 'customcss'
        app.appendChild(card)
        document.body.appendChild(app)
        expect(commitPackSheet(chatCommitInput(LEAF))).toEqual({ ok: false, reason: 'couldNotCheck' })
        expect(packElements()).toHaveLength(0)
    })
})

describe('T3-2 the text is text', () => {
    it('keeps a closing style tag inside a string as text and creates no element from it', () => {
        const text = '[data-part="chat-message-avatar"]{content:"</style><img src=x onerror=1>"}'
        expect(commitPackSheet(chatCommitInput(text))).toEqual({ ok: true })
        expect(document.querySelectorAll('img')).toHaveLength(0)
        const [element] = packElements()
        expect(packElements()).toHaveLength(1)
        expect(element.textContent).toBe(text)
        expect(element.children).toHaveLength(0)
    })
})

describe('T3-3 judged is applied', () => {
    it('replaces each resource span by its blob URL and keeps every other character, one blob per distinct target', async () => {
        const bytes = packOf(MIXED_SHEET, [FONT_A, FONT_B], { 'images/a.png': PNG_1X1 })
        const prepared = accepted(await prepareArchive(bytes))
        const judged = judgeAreaSheet('chat', MIXED_SHEET, undefined, 'chat')
        expect(judged.result.ok).toBe(true)
        expect(judged.resources.map((span) => span.form)).toEqual(['url-token', 'string', 'url-token', 'string'])
        // One blob per distinct target, minted in text order: the two fonts, then the image used twice.
        expect(blobs.minted).toEqual(['blob:http://localhost/1', 'blob:http://localhost/2', 'blob:http://localhost/3'])
        expect(prepared.blobs).toEqual(blobs.minted)
        expect(blobs.types).toEqual(['font/woff2', 'font/woff2', 'image/png'])
        const urlOf: Record<string, string> = { [FONT_A]: blobs.minted[0], [FONT_B]: blobs.minted[1], 'images/a.png': blobs.minted[2] }
        let expected = ''
        let at = 0
        for (const span of judged.resources) {
            expected += judged.canonical.slice(at, span.start) + (span.form === 'url-token' ? `url("${urlOf[span.raw]}")` : `"${urlOf[span.raw]}"`)
            at = span.end
        }
        expected += judged.canonical.slice(at)
        expect(chatElementOf(prepared).text).toBe(expected)
        expect(chatElementOf(prepared).text).toContain('src:url("blob:http://localhost/1") format("woff2")')
        expect(chatElementOf(prepared).text).toContain('src:url("blob:http://localhost/2") format("woff2")')
        expect(chatElementOf(prepared).text).toContain('background-image:url("blob:http://localhost/3"),image-set("blob:http://localhost/3" 1x)')
        expect(chatElementOf(prepared).text).not.toMatch(/fonts\/|images\//)
        expect(canonicalStylesheet(chatElementOf(prepared).text as string).resources.map((span) => span.raw)).toEqual([blobs.minted[0], blobs.minted[1], blobs.minted[2], blobs.minted[2]])
    })

    it('buildAppliedText replaces from the last span to the first so earlier offsets stay valid', () => {
        const judged = judgeAreaSheet('chat', MIXED_SHEET, undefined, 'chat')
        const text = buildAppliedText(judged, (raw) => `blob:null/${raw.length}${'x'.repeat(raw.length)}`)
        expect(text.startsWith('@font-face{font-family:"pack-a";src:url("blob:null/13')).toBe(true)
        expect(text.endsWith('1x)}')).toBe(true)
        expect(text).not.toContain('fonts/a.woff2')
    })
})

describe('T3-4 a pack that cannot apply', () => {
    it('refused verdict: reason refused with the refusals carried, store untouched', async () => {
        const bytes = packOf('body{color:red}')
        const key = store(bytes)
        const before = new Map(world.files)
        const prepared = await prepare({ kind: 'archive', key })
        expect(prepared).toMatchObject({ ok: false, reason: 'refused' })
        expect(prepared.ok === false && 'refusals' in prepared ? prepared.refusals : undefined).toEqual([
            expect.objectContaining({ code: 'sheetRefused', sheet: 'chat.css' }),
        ])
        expect(world.files).toEqual(before)
        expectBalanced()
    })

    // A ring over the 4 px cap is a layout note since #560 PR2 (MC-2320); the ring token that cannot be ruled out is still refused, and the stored archive stays untouched.
    it('R12 a chat ring that cannot be ruled out: refused for the limit reason, the stored archive untouched (MC-2320)', async () => {
        const bytes = packOf(':root{--focus-ring-w:var(--nope)}')
        const key = store(bytes)
        const before = new Map(world.files)
        const prepared = await prepare({ kind: 'archive', key })
        expect(prepared).toMatchObject({ ok: false, reason: 'refused' })
        const refusals = prepared.ok === false && 'refusals' in prepared ? prepared.refusals : []
        expect(JSON.stringify(refusals)).toMatch(/--focus-ring-w cannot be resolved.*the ceiling is 4px|cannot be ruled out/)
        expect(world.files).toEqual(before)
        expectBalanced()
    })

    it('judge timeout: couldNotCheck, nothing minted', async () => {
        const rig = judgeRig({ silent: true, timeoutMs: 20 })
        const prepared = await prepareArchive(packOf(PLAIN_CHAT_SHEET), rig)
        expect(prepared).toEqual({ ok: false, reason: 'couldNotCheck' })
        expect(rig.spawns()).toBe(1)
        expect(blobs.minted).toEqual([])
    })

    it('archive sha mismatch: files, the bytes are never judged', async () => {
        const bytes = packOf(PLAIN_CHAT_SHEET)
        const rig = judgeRig()
        const prepared = await prepare({ kind: 'archive', key: store(bytes, `assets/tp-${'0'.repeat(64)}.risutheme`) }, rig)
        expect(prepared).toEqual({ ok: false, reason: 'files' })
        expect(rig.spawns()).toBe(0)
    })

    it('archive key that differs from the stored bytes digest in the last hex character only: files, never judged', async () => {
        const bytes = packOf(PLAIN_CHAT_SHEET)
        const digest = createHash('sha256').update(bytes).digest('hex')
        const lastDiffers = `${digest.slice(0, -1)}${digest.endsWith('0') ? '1' : '0'}`
        const rig = judgeRig()
        const prepared = await prepare({ kind: 'archive', key: store(bytes, `assets/tp-${lastDiffers}.risutheme`) }, rig)
        expect(prepared).toEqual({ ok: false, reason: 'files' })
        expect(rig.spawns()).toBe(0)
    })

    it('archive missing: files', async () => {
        const prepared = await prepare({ kind: 'archive', key: `assets/tp-${'1'.repeat(64)}.risutheme` })
        expect(prepared).toEqual({ ok: false, reason: 'files' })
    })

    it('store read throws: couldNotCheck', async () => {
        world.readFailure = new Error('the store is unavailable')
        const prepared = await prepare({ kind: 'archive', key: `assets/tp-${'1'.repeat(64)}.risutheme` })
        expect(prepared).toEqual({ ok: false, reason: 'couldNotCheck' })
    })

    it('a key that is not an archive key: unreadable, the store is never read', async () => {
        for (const key of ['assets/tp-xyz.risutheme', 'assets/other.bin', '', `assets/tp-${'A'.repeat(64)}.risutheme`, `x/assets/tp-${'1'.repeat(64)}.risutheme`]) {
            expect(await prepare({ kind: 'archive', key })).toEqual({ ok: false, reason: 'unreadable' })
        }
        expect(world.reads).toEqual([])
    })

    it('a built-in the validator refuses: refused with one synthetic sheetRefused refusal in intake form', async () => {
        const builtin: BuiltinPack = { id: 'builtin:bad', slug: 'bad', name: 'Bad', version: '1.0.0', license: 'MIT', attribution: 'x', modes: ['dark'], chatCss: 'body{color:red}' }
        const prepared = await prepare({ kind: 'builtin', pack: builtin })
        const judged = judgeAreaSheet('chat', 'body{color:red}', undefined, 'chat')
        expect(judged.result.ok).toBe(false)
        expect(prepared).toEqual({ ok: false, reason: 'refused', refusals: [{ code: 'sheetRefused', sheet: 'chat.css', errors: judged.result.errors }] })
    })

    it('a built-in that names a file is refused (a built-in bundles none)', async () => {
        const builtin: BuiltinPack = { id: 'builtin:files', slug: 'files', name: 'Files', version: '1.0.0', license: 'MIT', attribution: 'x', modes: ['dark'], chatCss: CHAT_SHEET }
        expect(await prepare({ kind: 'builtin', pack: builtin })).toEqual({ ok: false, reason: 'refused' })
        expect(blobs.minted).toEqual([])
    })

    it('a built-in whose judge rejects or answers without a chat verdict: couldNotCheck', async () => {
        const builtin: BuiltinPack = { id: 'builtin:ok', slug: 'ok', name: 'Ok', version: '1.0.0', license: 'MIT', attribution: 'x', modes: ['dark'], chatCss: PLAIN_CHAT_SHEET }
        const rejecting: PackJudge = async () => { throw new Error('no answer') }
        const empty: PackJudge = async (): Promise<PackSheetsJudgement> => ({ ok: true, areas: {} })
        expect(await preparePackSheet({ kind: 'builtin', pack: builtin }, judgeSessionOverForTests(rejecting), ALWAYS)).toEqual({ ok: false, reason: 'couldNotCheck' })
        expect(await preparePackSheet({ kind: 'builtin', pack: builtin }, judgeSessionOverForTests(empty), ALWAYS)).toEqual({ ok: false, reason: 'couldNotCheck' })
    })

    it('a built-in that the validator accepts applies its judged text with no blobs and no skipped areas', async () => {
        const builtin: BuiltinPack = { id: 'builtin:ok', slug: 'ok', name: 'Ok', version: '1.0.0', license: 'MIT', attribution: 'x', modes: ['dark'], chatCss: PLAIN_CHAT_SHEET }
        const prepared = accepted(await prepare({ kind: 'builtin', pack: builtin }))
        expect(prepared).toEqual({ ok: true, blobs: [], skippedAreas: [], defaultScheme: null, elements: [{ area: 'chat', text: judgeAreaSheet('chat', PLAIN_CHAT_SHEET, undefined, 'chat').canonical, shapeText: judgeAreaSheet('chat', PLAIN_CHAT_SHEET, undefined, 'chat').canonical, base: 'dark' }], popups: null })
    })

    it('a built-in whose raw text differs from its canonical text applies the judged canonical text, never the raw one', async () => {
        const raw = `/* note */ ${PLAIN_CHAT_SHEET}`
        const builtin: BuiltinPack = { id: 'builtin:commented', slug: 'commented', name: 'Commented', version: '1.0.0', license: 'MIT', attribution: 'x', modes: ['dark'], chatCss: raw }
        const canonical = judgeAreaSheet('chat', raw, undefined, 'chat').canonical
        expect(canonical).not.toBe(raw)
        const prepared = accepted(await prepare({ kind: 'builtin', pack: builtin }))
        expect(prepared).toEqual({ ok: true, blobs: [], skippedAreas: [], defaultScheme: null, elements: [{ area: 'chat', text: canonical, shapeText: canonical, base: 'dark' }], popups: null })
        expect(chatElementOf(prepared).text).not.toContain('note')
    })
})

describe('TB-3 the own-colour verdict carried by prepareBuiltin and prepareArchive', () => {
    // REPRODUCER for the carriage: no pack sheet tags a rule yet, so each case tags the judge's answer for one label.
    const tagged = (label: string, rule: 'contrast' | 'readability' | 'layout' | null) => (response: JudgeResponse): JudgeResponse => {
        if (!response.ok || !Object.hasOwn(response.results, label)) {
            return response
        }
        const verdict = response.results[label]
        const warning = { selector: 's', prop: 'color', why: 'w', ...(rule === null ? {} : { rule }) }
        return { ...response, results: { ...response.results, [label]: { ...verdict, warnings: [...verdict.warnings, warning] } } }
    }
    const builtin: BuiltinPack = { id: 'builtin:ok', slug: 'ok', name: 'Ok', version: '1.0.0', license: 'MIT', attribution: 'x', modes: ['dark'], chatCss: PLAIN_CHAT_SHEET }
    const lightCss = builtinPackById('builtin:scratch-white')!.chatCss
    const archiveOf = (modes: string[], chatCss: string): Uint8Array => zipPack(validPackFiles({ 'manifest.json': manifestText({ name: 'Tagged', modes }), 'chat.css': chatCss }))

    it('a builtin whose chat verdict carries a contrast or readability note: the trigger is carried', async () => {
        for (const rule of ['contrast', 'readability'] as const) {
            const prepared = accepted(await prepare({ kind: 'builtin', pack: builtin }, judgeRig({ rewrite: tagged('chat', rule) })))
            expect(prepared.ownColourTrigger, rule).toBe(true)
        }
    })

    it('a builtin whose chat verdict carries a layout note, an untagged note or none: the field is absent', async () => {
        for (const rewrite of [tagged('chat', 'layout'), tagged('chat', null), undefined]) {
            const prepared = accepted(await prepare({ kind: 'builtin', pack: builtin }, judgeRig({ rewrite })))
            expect(Object.hasOwn(prepared, 'ownColourTrigger')).toBe(false)
        }
    })

    it('an archive on the dark base reads the chat verdict: a contrast note on it is carried, a layout note is not', async () => {
        const bytes = archiveOf(['dark'], PLAIN_CHAT_SHEET)
        expect(accepted(await prepareArchive(bytes, judgeRig({ rewrite: tagged('chat', 'contrast') }))).ownColourTrigger).toBe(true)
        expect(Object.hasOwn(accepted(await prepareArchive(bytes, judgeRig({ rewrite: tagged('chat', 'layout') }))), 'ownColourTrigger')).toBe(false)
        expect(Object.hasOwn(accepted(await prepareArchive(bytes, judgeRig())), 'ownColourTrigger')).toBe(false)
    })

    it('an archive on the light base reads the light variant: its note is carried, a note on the chat sheet alone is not', async () => {
        const bytes = archiveOf(['light'], lightCss)
        const viaLight = accepted(await prepareArchive(bytes, judgeRig({ rewrite: tagged('chat#light', 'contrast') })))
        expect(chatElementOf(viaLight).base).toBe('light')
        expect(viaLight.ownColourTrigger).toBe(true)
        const viaChat = accepted(await prepareArchive(bytes, judgeRig({ rewrite: tagged('chat', 'contrast') })))
        expect(chatElementOf(viaChat).base).toBe('light')
        expect(Object.hasOwn(viaChat, 'ownColourTrigger')).toBe(false)
    })

    // A mid-tone canvas passes the chat judgement but is refused by the light proof, so a light-labelled archive lands on the dark base.
    const MID_TONE_SHEET = ':root { --nexus-canvas: #969fae; --color-surface-sheet: #ffffff; --color-surface-toast: #ffffff; --nexus-text: #000000; --nexus-text-secondary: #1a1d24; --nexus-text-muted: #2a2d34; --nexus-ring: #102a60; --nexus-accent-rgb: 16 42 96; --nexus-accent: rgb(var(--nexus-accent-rgb)); --nexus-danger-rgb: 138 0 24; --nexus-danger: rgb(var(--nexus-danger-rgb)); --color-on-accent: #ffffff; --danger: #6a0012; --color-scheme: light; }\n'

    it('a light-labelled archive whose light proof is refused falls back to the dark base and reads the chat verdict', async () => {
        const bytes = archiveOf(['light'], MID_TONE_SHEET)
        const viaChat = accepted(await prepareArchive(bytes, judgeRig({ rewrite: tagged('chat', 'contrast') })))
        expect(chatElementOf(viaChat).base).toBe('dark')
        expect(viaChat.ownColourTrigger).toBe(true)
        const viaLight = accepted(await prepareArchive(bytes, judgeRig({ rewrite: tagged('chat#light', 'contrast') })))
        expect(Object.hasOwn(viaLight, 'ownColourTrigger')).toBe(false)
    })

    // The real producer (MC-329): the real validator's contrast notes cross the worker as `result.notes`, never as a warning.
    it('T-APP: a sheet whose real judgement carries contrast notes applies without the own-colour trigger (MC-3642)', async () => {
        const bytes = archiveOf(['dark'], '[data-part="chat-header"]{color:#111111}')
        const prepared = accepted(await prepareArchive(bytes, judgeRig()))
        expect(Object.hasOwn(prepared, 'ownColourTrigger')).toBe(false)
    })

    it('a light-labelled archive whose real light proof carries a contrast note keeps the dark base', async () => {
        const bytes = archiveOf(['light'], MID_TONE_SHEET)
        const prepared = accepted(await prepareArchive(bytes, judgeRig()))
        expect(chatElementOf(prepared).base).toBe('dark')
        expect(Object.hasOwn(prepared, 'ownColourTrigger')).toBe(false)
    })
})

describe('T2b-2 a stored pack with malformed tile fields still applies', () => {
    // GUARD (passes before and after the tile fields exist): apply re-runs intake over the stored archive and never
    // judges `colors` or `icon`, so a pack installed before those keys were checked must not turn broken.
    it.each([
        ['an invalid colors.main', { colors: { main: 'not-a-colour' } }],
        ['a non-object colors', { colors: 'red' }],
        ['an empty icon', { icon: '' }],
    ])('%s applies the judged sheet', async (_label, over) => {
        const bytes = zipPack(validPackFiles({ 'manifest.json': manifestText(over) }))
        const prepared = accepted(await prepareArchive(bytes))
        expect(chatElementOf(prepared).text).toBe(judgeAreaSheet('chat', PLAIN_CHAT_SHEET, undefined, 'chat').canonical)
        expect(prepared.skippedAreas).toEqual([])
    })
})

describe('T3-5 blobs are revoked exactly once each', () => {
    const packA = (): Uint8Array => packOf(TWO_FONTS_SHEET, [FONT_A, FONT_B], {}, 'Pack A')
    const packB = (): Uint8Array => packOf(TWO_FONTS_SHEET, [FONT_A, FONT_B], {}, 'Pack B')

    it('(a) A then B revokes every A blob after B is committed; (b) then None revokes B', async () => {
        const a = accepted(await prepareArchive(packA()))
        commitPrepared(a)
        expect(blobs.revoked).toEqual([])
        const b = accepted(await prepareArchive(packB()))
        expect(blobs.revoked).toEqual([])
        commitPrepared(b)
        expect([...blobs.revoked].sort()).toEqual([...a.blobs].sort())
        expect(a.blobs).toHaveLength(2)
        expect(b.blobs.some((url) => a.blobs.includes(url))).toBe(false)
        expect(commitPackSheet(null)).toEqual({ ok: true })
        expect([...blobs.revoked].sort()).toEqual([...a.blobs, ...b.blobs].sort())
        expect(packElements()).toHaveLength(0)
        expectBalanced()
    })

    it('(c) a call made stale during the judge and (d) one made stale during the second file read revoke their own and insert nothing', async () => {
        // The archive path asks after the store read, the hash, the intake (the judge), then each file read.
        const duringJudge = await prepareArchive(packA(), judgeRig(), currentTimes(2))
        expect(duringJudge).toEqual({ ok: false, stale: true })
        expect(blobs.minted).toEqual([])
        const duringSecondRead = await prepareArchive(packB(), judgeRig(), currentTimes(4))
        expect(duringSecondRead).toEqual({ ok: false, stale: true })
        expect(blobs.minted).toHaveLength(1)
        expectBalanced()
        expect(packElements()).toHaveLength(0)
    })

    it('a second file that fails after the first was minted revokes the first', async () => {
        world.verifiedRefuseAt = 2
        const prepared = await prepareArchive(packA())
        expect(prepared).toEqual({ ok: false, reason: 'files' })
        expect(blobs.minted).toHaveLength(1)
        expectBalanced()
    })

    it('(e) a throw from the stored bytes is read as could-not-read, a control: couldNotCheck, resolved, revoke equals mint', async () => {
        const probe = subarrayProbe
        probe.calls = 0
        probe.throwAt = 0
        world.wrapRead = (bytes) => new ProbedBytes(bytes)
        const bytes = packA()
        const key = store(bytes)
        expect(accepted(await prepare({ kind: 'archive', key })).blobs).toHaveLength(2)
        // The clean pass's last source read is the second font's body.
        probe.throwAt = probe.calls
        probe.calls = 0
        blobs.minted.length = 0
        blobs.revoked.length = 0
        const prepared = await prepare({ kind: 'archive', key })
        expect(prepared).toEqual({ ok: false, reason: 'couldNotCheck' })
        expect(blobs.minted).toHaveLength(1)
        expectBalanced()
    })

    it('(f) createObjectURL throwing on the second mint: couldNotCheck, resolved, the first URL revoked, nothing inserted', async () => {
        blobs.failMintAt = 2
        const prepared = await prepareArchive(packA())
        expect(prepared).toEqual({ ok: false, reason: 'couldNotCheck' })
        expect(blobs.minted).toHaveLength(1)
        expectBalanced()
        expect(packElements()).toHaveLength(0)
    })

    it('(g) readVerifiedFile throwing on its second call, after the first font was minted: couldNotCheck, resolved, revoke equals mint', async () => {
        world.verifiedThrowAt = 2
        const prepared = await prepareArchive(packA())
        expect(prepared).toEqual({ ok: false, reason: 'couldNotCheck' })
        expect(blobs.minted).toHaveLength(1)
        expectBalanced()
        expect(packElements()).toHaveLength(0)
        expect(errorLog).toHaveBeenCalledWith('theme pack apply failed', expect.any(Error))
    })

    it('a call that is stale when it throws answers stale, not couldNotCheck', async () => {
        world.verifiedThrowAt = 2
        const prepared = await prepareArchive(packA(), judgeRig(), currentTimes(4))
        expect(prepared).toEqual({ ok: false, stale: true })
        expectBalanced()
    })
})

describe('T3-9 no asset URL path', () => {
    it('reads the stored bytes through the page store and never through getFileSrc', async () => {
        const bytes = packOf(MIXED_SHEET, [FONT_A, FONT_B], { 'images/a.png': PNG_1X1 })
        const key = store(bytes)
        accepted(await prepare({ kind: 'archive', key }))
        accepted(await prepare({ kind: 'builtin', pack: { id: 'builtin:p', slug: 'p', name: 'P', version: '1', license: 'MIT', attribution: 'x', modes: ['dark'], chatCss: PLAIN_CHAT_SHEET } }))
        expect(vi.mocked(getFileSrc)).not.toHaveBeenCalled()
        expect(world.reads).toEqual([key])
    })
})

describe('T3-11 a leading byte-order mark', () => {
    it('applies a chat sheet that starts with a BOM, and the applied text has no U+FEFF', async () => {
        const bytes = packOf(concat(Uint8Array.of(0xEF, 0xBB, 0xBF), utf8(PLAIN_CHAT_SHEET)))
        const prepared = accepted(await prepareArchive(bytes))
        expect(typeof chatElementOf(prepared).text).toBe('string')
        expect(chatElementOf(prepared).text).not.toContain('﻿')
        commitPrepared(prepared)
        expect(packElements()[0].textContent).not.toContain('﻿')
    })
})

describe('T3-13 the blob URL pattern', () => {
    it('accepts every origin form a WebView mints and rejects characters that could end a token', () => {
        for (const url of ['blob:http://[::1]:6001/0a1b2c3d-4e5f-6789-abcd-ef0123456789', 'blob:tauri://localhost/abc', 'blob:https://a.b/abc', 'blob:null/abc-def']) {
            expect(BLOB_URL_PATTERN.test(url), url).toBe(true)
        }
        for (const bad of ['blob:http://a/"x', 'blob:http://a/\\x', 'blob:http://a/x)', 'blob:http://a/x y', 'blob:http://a/x\ny', 'http://a/x', 'blob:']) {
            expect(BLOB_URL_PATTERN.test(bad), JSON.stringify(bad)).toBe(false)
        }
    })

    it('a minted URL that fails the pattern: couldNotCheck, nothing inserted, what was minted is revoked', async () => {
        blobs.nextUrl = (n) => (n === 1 ? 'blob:http://localhost/"quoted' : `blob:http://localhost/${n}`)
        const prepared = await prepareArchive(packOf(TWO_FONTS_SHEET, [FONT_A, FONT_B]))
        expect(prepared).toEqual({ ok: false, reason: 'couldNotCheck' })
        expect(blobs.revoked).toEqual(['blob:http://localhost/"quoted'])
        expect(packElements()).toHaveLength(0)
    })

    it('an IPv6-literal origin applies', async () => {
        blobs.nextUrl = (n) => `blob:http://[::1]:6001/${n}`
        const prepared = accepted(await prepareArchive(packOf(TWO_FONTS_SHEET, [FONT_A, FONT_B])))
        expect(chatElementOf(prepared).text).toContain('url("blob:http://[::1]:6001/1")')
    })
})

describe('T3-14 an empty chat sheet applies nothing', () => {
    it.each([['0 bytes', ''], ['a comment only', '/* nothing */']])('%s: text null, home skipped, and a previous pack is removed with its blobs', async (_label, sheet) => {
        const a = accepted(await prepareArchive(packOf(TWO_FONTS_SHEET, [FONT_A, FONT_B], {}, 'Pack A')))
        commitPrepared(a)
        expect(packElements()).toHaveLength(1)
        const empty = accepted(await prepareArchive(packOf(sheet, [], { 'home.css': PLAIN_CHAT_SHEET }, 'Pack E')))
        expect(chatElementOf(empty).text).toBeNull()
        expect(empty.blobs).toEqual([])
        expect(empty.skippedAreas).toEqual(['home'])
        commitPrepared(empty)
        expect(packElements()).toHaveLength(0)
        expect([...blobs.revoked].sort()).toEqual([...a.blobs].sort())
    })
})

describe('T3-15 only the chat sheet is applied', () => {
    it('judges the chat key only for a pack with only skipped areas besides chat, applies one element and reports the skipped areas', async () => {
        const rig = judgeRig()
        const hostile = '[data-part]{padding-inline:60px}'
        const prepared = accepted(await prepareArchive(packOf(PLAIN_CHAT_SHEET, [], { 'home.css': hostile, 'sidebar.css': hostile }), rig))
        expect(prepared.skippedAreas).toEqual(['home', 'sidebar'])
        expect(rig.posts.map((post) => post.jobs.map((job) => job.area))).toEqual([['chat']])
        commitPrepared(prepared)
        const elements = packElements()
        expect(elements).toHaveLength(1)
        expect(elements[0].getAttribute('data-theme-pack')).toBe('chat')
        expect(document.querySelectorAll('style').length).toBe(3)
    })

    it('judges studio.css with the chat sheet in one request and applies it as its own element after the chat one', async () => {
        const rig = judgeRig()
        const prepared = accepted(await prepareArchive(packOf(PLAIN_CHAT_SHEET, [], { 'studio.css': '[data-part="studio-asset-row"]{opacity:1}' }), rig))
        expect(prepared.skippedAreas).toEqual([])
        expect(rig.posts.map((post) => post.jobs.map((job) => job.area))).toEqual([['chat', 'studio']])
        commitAll(prepared)
        expect(packElements().map((element) => element.getAttribute('data-theme-pack'))).toEqual(['chat', 'studio'])
    })
})

describe('S4a the studio element (MC-3121: shape variant only, no base, in both modes)', () => {
    const FONT_X = 'fonts/x.woff2'
    const FACE_X = '@font-face{font-family:"pack-x";src:url(fonts/x.woff2) format("woff2")}'
    const CHAT_X = FACE_X + LEAF
    /** A studio sheet on a safe leaf: a font shared with chat, an image only studio names, a radius. */
    const STUDIO_X = '@font-face{font-family:"pack-x";src:url(fonts/x.woff2)}[data-part="studio-asset-row"]{font-family:"pack-x";background-image:url(images/s.png);border-radius:6px}'
    const STUDIO_LEAF = '[data-part="studio-asset-row"]{opacity:0.5}'
    const BASE = 'data-theme-pack-base'

    function studioOnlyPack(studio: string, fonts: readonly string[] = [], extra: Readonly<Record<string, PackFile>> = {}): Uint8Array {
        const entries: Record<string, PackFile> = { 'manifest.json': fontManifest('Studio Only', fonts), 'studio.css': studio, ...extra }
        for (const font of fonts) {
            entries[font] = fakeFont()
        }
        return zipPack(entries)
    }

    /** The text the studio element must carry: the judged shape variant, with each resource span replaced by its URL. */
    function expectedStudioText(studio: string, urlOf: Readonly<Record<string, string>> = {}): string {
        const whole = judgeAreaSheet('studio', studio, undefined, 'studio')
        const shape = judgeAreaSheet('studio', shapeOnlySheet(whole.canonical, shapeTokenNames('studio')), undefined, 'studio')
        expect(shape.result.ok).toBe(true)
        return buildAppliedText(shape, (raw) => urlOf[raw] ?? '')
    }

    it('A1: the studio element is the shape judgement with blob substitution, tagged studio, after chat and before #customcss', async () => {
        const prepared = accepted(await prepareArchive(packOf(CHAT_X, [FONT_X], { 'studio.css': STUDIO_X, 'images/s.png': PNG_1X1 })))
        commitAll(prepared)
        expect(packElements().map((element) => element.getAttribute('data-theme-pack'))).toEqual(['chat', 'studio'])
        const [chat, studio] = packElements()
        expect(chat.nextElementSibling).toBe(studio)
        expect(studio.nextElementSibling?.id).toBe('customcss')
        expect(studio.getAttribute('media')).toBe('not all')
        expect(studio.textContent).toBe(expectedStudioText(STUDIO_X, { [FONT_X]: blobs.minted[0] }))
        expect(studio.textContent).toContain('border-radius')
        expect(studio.textContent).not.toMatch(/background-image|images\//)
    })

    it('A2: a commit replaces both elements and revokes the previous blobs once; a chat-only commit leaves no studio element; null leaves none', async () => {
        const first = accepted(await prepareArchive(packOf(CHAT_X, [FONT_X], { 'studio.css': STUDIO_X, 'images/s.png': PNG_1X1 })))
        commitAll(first)
        const old = packElements()
        expect(old).toHaveLength(2)
        const second = accepted(await prepareArchive(packOf(LEAF, [], { 'studio.css': STUDIO_LEAF }, 'Second')))
        commitAll(second)
        expect(packElements()).toHaveLength(2)
        expect(old.some((element) => element.isConnected)).toBe(false)
        expect(blobs.revoked.filter((url) => first.blobs.includes(url))).toEqual([...first.blobs])
        const third = accepted(await prepareArchive(packOf(ALT_SHEET, [], {}, 'Third')))
        commitAll(third)
        expect(packElements().map((element) => element.getAttribute('data-theme-pack'))).toEqual(['chat'])
        expect(commitPackSheet(null)).toEqual({ ok: true })
        expect(packElements()).toHaveLength(0)
        expectBalanced()
    })

    it('A3: a light chat sheet beside a design studio sheet: chat keeps its light base, studio applies its shape text with no base in both modes', async () => {
        const light = builtinPackById('builtin:scratch-white')!
        const bytes = zipPack(validPackFiles({
            'manifest.json': manifestText({ name: 'Light', modes: ['light'] }),
            'chat.css': light.chatCss,
            'studio.css': studioScratchWhite.replace(/\r\n/g, '\n'),
        }))
        const prepared = accepted(await prepareArchive(bytes))
        openGate()
        const releaseStudio = declareSurface('studio')
        flushSync()
        commitAll(prepared, true)
        expect(packElements().map((element) => element.getAttribute('data-theme-pack'))).toEqual(['chat', 'studio'])
        const [chat, studio] = packElements()
        const shapeText = expectedStudioText(studioScratchWhite.replace(/\r\n/g, '\n'))
        expect(shapeText.trim()).not.toBe('')
        expect(studio.textContent).toBe(shapeText)
        expect(studio.getAttribute('media')).toBe('all')
        expect(chat.getAttribute('media')).toBe('not all')
        expect(document.documentElement.hasAttribute(BASE)).toBe(false)
        const chatElement = prepared.elements.find((element) => element.area === 'chat')
        const studioElement = prepared.elements.find((element) => element.area === 'studio')
        expect(chatElement?.base).toBe('light')
        expect(studioElement).toMatchObject({ area: 'studio', text: shapeText, shapeText, base: null })
        setPackSheetColours(false)
        expect(studio.textContent).toBe(shapeText)
        expect(document.documentElement.hasAttribute(BASE)).toBe(false)
        setPackSheetColours(true)
        expect(studio.textContent).toBe(shapeText)
        expect(document.documentElement.hasAttribute(BASE)).toBe(false)
        releaseStudio()
        flushSync()
        expect(chat.getAttribute('media')).toBe('all')
        expect(document.documentElement.getAttribute(BASE)).toBe('light')
    })

    it('A5: a refused studio shape judgement gives no studio element; chat applies (guard, kills a shape text taken without its own judgement)', async () => {
        const refused = judgeAreaSheet('studio', '[data-part="chat-header"]{opacity:1}', undefined, 'studio')
        const rig = judgeRig({
            rewrite: (response) => response.ok && Object.hasOwn(response.results, 'studio#shape')
                ? { ...response, results: { ...response.results, 'studio#shape': refused } }
                : response,
        })
        const prepared = accepted(await prepareArchive(packOf(PLAIN_CHAT_SHEET, [], { 'studio.css': studioScratchWhite.replace(/\r\n/g, '\n') }), rig))
        expect(rig.posts.flatMap((post) => post.jobs.map((job) => job.label))).toContain('studio#shape')
        commitAll(prepared)
        expect(packElements().map((element) => element.getAttribute('data-theme-pack'))).toEqual(['chat'])
    })

    it('A6: a font both sheets name is minted once and revoked once; an image only studio.css names is never minted', async () => {
        const prepared = accepted(await prepareArchive(packOf(CHAT_X, [FONT_X], { 'studio.css': STUDIO_X, 'images/s.png': PNG_1X1 })))
        commitAll(prepared)
        expect(blobs.minted).toHaveLength(1)
        expect(blobs.types).toEqual(['font/woff2'])
        expect(prepared.blobs).toEqual(blobs.minted)
        const [chat, studio] = packElements()
        expect(studio.textContent).toContain(`url("${blobs.minted[0]}")`)
        expect(chat.textContent).toContain(`url("${blobs.minted[0]}")`)
        expect(commitPackSheet(null)).toEqual({ ok: true })
        expect(blobs.revoked).toEqual(blobs.minted)
    })

    it('a font only studio.css names is minted after the chat resources, for the studio element', async () => {
        const prepared = accepted(await prepareArchive(packOf(PLAIN_CHAT_SHEET, [FONT_X], { 'studio.css': STUDIO_X, 'images/s.png': PNG_1X1 })))
        commitAll(prepared)
        expect(blobs.minted).toHaveLength(1)
        expect(prepared.blobs).toEqual(blobs.minted)
        const studio = packElements().find((element) => element.getAttribute('data-theme-pack') === 'studio')
        expect(studio?.textContent).toBe(expectedStudioText(STUDIO_X, { [FONT_X]: blobs.minted[0] }))
    })

    it('a damaged file only studio.css names is broken files, and nothing minted stays live', async () => {
        world.verifiedRefuseAt = 1
        const prepared = await prepareArchive(packOf(PLAIN_CHAT_SHEET, [FONT_X], { 'studio.css': STUDIO_X, 'images/s.png': PNG_1X1 }))
        expect(prepared).toEqual({ ok: false, reason: 'files' })
        expectBalanced()
    })

    it('A9: studio.css keeps its own geometry token and drops an app colour token, as its shape variant', async () => {
        const sheet = ':root{--studio-size-touch:40px;--nexus-text:#fff}'
        const prepared = accepted(await prepareArchive(packOf(PLAIN_CHAT_SHEET, [], { 'studio.css': sheet })))
        commitAll(prepared)
        const studio = packElements().find((element) => element.getAttribute('data-theme-pack') === 'studio')
        expect(studio?.textContent).toMatch(/--studio-size-touch:\s*40px/)
        expect(studio?.textContent).not.toContain('--nexus-text')
    })

    it('R4: a studio-only pack that sets the app shape tokens is accepted, and its element reshapes the legacy utilities (MC-3128)', async () => {
        const prepared = await prepareArchive(studioOnlyPack(':root{--ui-radius-md:2px;--ui-radius:0px;--ui-border-width:2px}'))
        expect(prepared.ok).toBe(true)
        const studio = accepted(prepared).elements.find((element) => element.area === 'studio')
        expect(studio).toBeDefined()
        expect(studio?.text).toMatch(/--ui-radius-md:\s*2px/)
        expect(studio?.text).toMatch(/--ui-radius:\s*0px/)
        expect(studio?.text).toMatch(/--ui-border-width:\s*2px/)
        const app = await compileAppStyles(['rounded-md', 'rounded', 'border'])
        document.body.innerHTML = '<div class="rounded-md"></div><div class="rounded"></div><div class="border"></div>'
        const model = new CascadeModel(compileRules([app, { name: 'studio', css: studio?.text ?? '' }]))
        const [md, bare, border] = [...document.body.children]
        expect([model.prop(md, 'border-radius'), model.prop(bare, 'border-radius'), model.prop(border, 'border-width')]).toEqual(['2px', '0px', '2px'])
    }, 60000)

    it('R6: studio.css keeps a studio radius token it reads in the same rule set (MC-3128)', async () => {
        const sheet = ':root{--studio-radius-card:18px}[data-part="studio-history-step"]{border-radius:var(--studio-radius-card)}'
        const prepared = accepted(await prepareArchive(studioOnlyPack(sheet)))
        const studio = prepared.elements.find((element) => element.area === 'studio')
        expect(studio?.text).toMatch(/--studio-radius-card:\s*18px/)
        expect(studio?.text).toMatch(/border-radius:\s*var\(--studio-radius-card\)/)
    })

    it('a studio-only pack applies only the studio element, with no chat text, no base and no default scheme', async () => {
        const prepared = accepted(await prepareArchive(studioOnlyPack(STUDIO_LEAF)))
        expect(prepared.defaultScheme).toBeNull()
        expect(chatElementOf(prepared).text).toBeNull()
        commitAll(prepared)
        expect(packElements().map((element) => element.getAttribute('data-theme-pack'))).toEqual(['studio'])
    })

    it('a studio shape variant of only empty blocks applies no element', async () => {
        const prepared = accepted(await prepareArchive(studioOnlyPack('[data-part="studio-asset-row"]{background-image:url(images/s.png)}', [], { 'images/s.png': PNG_1X1 })))
        commitAll(prepared)
        expect(packElements()).toHaveLength(0)
        expect(blobs.minted).toHaveLength(0)
    })

    it('A7: a chat-only built-in prepares one chat element with its judged text and its base (compatibility)', async () => {
        for (const slug of ['origin-navy', 'banana-cocoa', 'scratch-white', 'office-sheet']) {
            const prepared = accepted(await prepare({ kind: 'builtin', pack: builtinPackById(`builtin:${slug}`)! }))
            const pack = builtinPackById(`builtin:${slug}`)!
            expect(prepared.elements.map((element) => element.area)).toEqual(['chat'])
            expect(prepared.elements[0].text).toBe(judgeAreaSheet('chat', pack.chatCss, undefined, 'chat').canonical)
            expect(prepared.elements[0].base).toBe(pack.modes.length === 1 && pack.modes[0] === 'light' ? 'light' : 'dark')
        }
    })
})

describe('T3-16 a missing #customcss', () => {
    it('inserts nothing, answers couldNotCheck, revokes the passed blobs and leaves the previous element', () => {
        expect(commitPackSheet(chatCommitInput(LEAF, { blobs: ['blob:http://localhost/a'] }))).toEqual({ ok: true })
        const [previous] = packElements()
        document.getElementById('customcss')?.remove()
        expect(commitPackSheet(chatCommitInput(ALT_SHEET, { blobs: ['blob:http://localhost/b'] }))).toEqual({ ok: false, reason: 'couldNotCheck' })
        expect(packElements()).toEqual([previous])
        expect(previous.textContent).toBe(LEAF)
        expect(blobs.revoked).toEqual(['blob:http://localhost/b'])
    })
})

describe('T3-17 the broken reason of a refusal list', () => {
    const named = (name: string): IntakeRefusal[] => [{ code: 'unsafeName', name }]
    it('maps by precedence over the whole list: couldNotCheck, then files, then refused', () => {
        expect(brokenReasonOf([{ code: 'damaged', name: null }, { code: 'couldNotCheck' }])).toBe('couldNotCheck')
        expect(brokenReasonOf([{ code: 'target', sheet: 'chat.css', target: 'x' }, { code: 'wrongContent', name: 'fonts/a.woff2' }])).toBe('files')
        expect(brokenReasonOf([{ code: 'manifestUnreadable' }])).toBe('files')
        expect(brokenReasonOf([{ code: 'notUtf8', name: 'chat.css' }])).toBe('files')
        expect(brokenReasonOf([{ code: 'damaged', name: 'chat.css' }])).toBe('files')
        expect(brokenReasonOf([{ code: 'sheetRefused', sheet: 'chat.css', errors: [] }])).toBe('refused')
        expect(brokenReasonOf([{ code: 'wrongKind', sheet: 'chat.css', target: 'x' }, { code: 'svg', name: 'a.svg' }])).toBe('refused')
        expect(brokenReasonOf(named('x'))).toBe('refused')
        expect(brokenReasonOf([])).toBe('refused')
    })
})

describe('T3A-1 layout A: the stored bytes are checked, then judged once', () => {
    it('runs intake over the stored bytes with one judge call per apply', async () => {
        const rig = judgeRig()
        accepted(await prepareArchive(packOf(TWO_FONTS_SHEET, [FONT_A, FONT_B]), rig))
        expect(rig.spawns()).toBe(1)
        expect(rig.posts).toHaveLength(1)
    })

    it('a byte flipped inside the chat.css entry of an archive stored under its own hash: files (the entry CRC)', async () => {
        const bytes = zipPack(validPackFiles({ 'chat.css': { data: PLAIN_CHAT_SHEET, stored: true } }))
        const at = indexOfBytes(bytes, utf8('opacity:1'))
        expect(at).toBeGreaterThan(0)
        bytes[at + 8] = 0x32
        expect(await prepareArchive(bytes)).toEqual({ ok: false, reason: 'files' })
    })

    it('a byte flipped inside a font entry of an archive stored under its own hash: files', async () => {
        const bytes = packOf(TWO_FONTS_SHEET, [FONT_A, FONT_B], { [FONT_A]: { data: fakeFont(), stored: true } })
        const at = indexOfBytes(bytes, utf8('wOF2'))
        expect(at).toBeGreaterThan(0)
        bytes[at + 12] ^= 0xFF
        expect(await prepareArchive(bytes)).toEqual({ ok: false, reason: 'files' })
    })

    it('a font that fails its second read after intake: files, reported at the read', async () => {
        world.verifiedRefuseAt = 1
        expect(await prepareArchive(packOf(TWO_FONTS_SHEET, [FONT_A, FONT_B]))).toEqual({ ok: false, reason: 'files' })
        expect(blobs.minted).toEqual([])
    })
})

describe('T3G-6 the surface gate and the commit order', () => {
    it('(a) the element is created off: at the record that adds it, its media is not all', async () => {
        openGate()
        const recording = startRecording()
        commitPackSheet(chatCommitInput(LEAF))
        flushSync()
        const steps = replay(recording.take())
        const add = steps.find((step) => step.type === 'add')
        expect(add).toBeDefined()
        // The value at insertion is the old value of the element's first later media record, else its current value.
        const firstMedia = recording.take().find((record) => record.type === 'attributes')
        expect(firstMedia === undefined ? add?.element.getAttribute('media') : firstMedia.oldValue).toBe('not all')
        expectNeverDisabled()
    })

    it('(b) shown (declared, not covered): the element is all after the commit', () => {
        openGate()
        commitPackSheet(chatCommitInput(LEAF))
        expect(packElements()[0].getAttribute('media')).toBe('all')
        flushSync()
        expect(packElements()[0].getAttribute('media')).toBe('all')
        expectNeverDisabled()
    })

    it('(c) covered: A then B, and no registered element is ever written all; B is off after the commit and after the flush', () => {
        openGate(true)
        const recording = startRecording()
        commitPackSheet(chatCommitInput(LEAF))
        commitPackSheet(chatCommitInput(ALT_SHEET))
        expect(packElements()).toHaveLength(1)
        expect(packElements()[0].getAttribute('media')).toBe('not all')
        flushSync()
        expect(packElements()[0].getAttribute('media')).toBe('not all')
        const steps = replay(recording.take())
        expect(steps.filter((step) => step.type === 'media' && step.value === 'all')).toEqual([])
        expect(steps.every((step) => step.on.length === 0)).toBe(true)
        expectNeverDisabled()
    })

    it('(d) shown: A on then B; B gets exactly one all record and it follows the removal of A', () => {
        openGate()
        const recording = startRecording()
        commitPackSheet(chatCommitInput(LEAF))
        const [first] = packElements()
        expect(first.getAttribute('media')).toBe('all')
        commitPackSheet(chatCommitInput(ALT_SHEET))
        const steps = replay(recording.take())
        const second = packElements()[0]
        expect(second).not.toBe(first)
        expect(packElements()).toHaveLength(1)
        const allOnSecond = steps.filter((step) => step.type === 'media' && step.element === second && step.value === 'all')
        expect(allOnSecond).toHaveLength(1)
        const removalAt = steps.findIndex((step) => step.type === 'remove' && step.element === first)
        expect(removalAt).toBeGreaterThanOrEqual(0)
        expect(steps.indexOf(allOnSecond[0])).toBeGreaterThan(removalAt)
        expect(second.getAttribute('media')).toBe('all')
        expect(first.isConnected).toBe(false)
        expectNeverDisabled()
    })

    it('(e) committed while covered, then uncovered: all after the flush', () => {
        openGate(true)
        commitPackSheet(chatCommitInput(LEAF))
        flushSync()
        expect(packElements()[0].getAttribute('media')).toBe('not all')
        cover.on = false
        flushSync()
        expect(packElements()[0].getAttribute('media')).toBe('all')
        expectNeverDisabled()
    })

    it('(f) a null commit removes the element, unregisters it and revokes its blobs', () => {
        openGate(true)
        commitPackSheet(chatCommitInput(LEAF, { blobs: ['blob:http://localhost/1'] }))
        const [element] = packElements()
        expect(commitPackSheet(null)).toEqual({ ok: true })
        expect(element.isConnected).toBe(false)
        expect(packElements()).toHaveLength(0)
        expect(blobs.revoked).toEqual(['blob:http://localhost/1'])
        // A detached element is outside the observed subtree: its attribute shows whether the gate still holds it.
        cover.on = false
        flushSync()
        expect(element.getAttribute('media')).toBe('not all')
    })

    it('(g) a registered studio probe stays off: after a chat commit exactly one registered element is all, the chat one', () => {
        const probe = document.createElement('style')
        probe.setAttribute('data-theme-pack', 'studio')
        probe.setAttribute('media', 'not all')
        document.head.appendChild(probe)
        registerThemePackElement(probe, 'studio')
        openGate()
        commitPackSheet(chatCommitInput(LEAF))
        flushSync()
        const [chat] = packElements().filter((element) => element !== probe)
        expect(chat.getAttribute('media')).toBe('all')
        expect(probe.getAttribute('media')).toBe('not all')
        expect([chat, probe].filter((element) => element.getAttribute('media') === 'all')).toEqual([chat])
        expectNeverDisabled()
    })

    it('(h) a pack switch never has two registered elements on', () => {
        const probe = document.createElement('style')
        probe.setAttribute('data-theme-pack', 'studio')
        probe.setAttribute('media', 'not all')
        document.head.appendChild(probe)
        registerThemePackElement(probe, 'studio')
        openGate()
        const recording = startRecording()
        commitPackSheet(chatCommitInput(LEAF))
        flushSync()
        commitPackSheet(chatCommitInput(ALT_SHEET))
        flushSync()
        commitPackSheet(null)
        flushSync()
        cover.on = true
        flushSync()
        cover.on = false
        flushSync()
        const steps = replay(recording.take(), new Set([probe]))
        expect(steps.length).toBeGreaterThan(0)
        expect(Math.max(...steps.map((step) => step.on.length))).toBeLessThanOrEqual(1)
        expect(steps.every((step) => step.registered.includes(probe))).toBe(true)
        expectNeverDisabled()
    })

    it('(j) a style element the apply module did not register is never touched, by any commit or cover change', () => {
        const printOnly = document.createElement('style')
        printOnly.setAttribute('data-theme-pack', 'chat')
        printOnly.setAttribute('media', 'print')
        document.head.appendChild(printOnly)
        const bare = document.createElement('style')
        bare.setAttribute('data-theme-pack', 'chat')
        document.body.appendChild(bare)
        openGate()
        commitPackSheet(chatCommitInput(LEAF))
        commitPackSheet(chatCommitInput(ALT_SHEET))
        cover.on = true
        flushSync()
        cover.on = false
        flushSync()
        commitPackSheet(null)
        flushSync()
        expect(printOnly.isConnected).toBe(true)
        expect(printOnly.getAttribute('media')).toBe('print')
        expect(bare.isConnected).toBe(true)
        expect(bare.hasAttribute('media')).toBe(false)
    })
})

describe('T16b the shape variant is the judge\'s own canonical text with the same blob substitution', () => {
    // New field: `Prepared.shapeText` did not exist, so this fails only when the variant is built from anything but the second judgement.
    it('keeps the font blob URL and drops the image URL, equal to buildAppliedText of the shape judgement', async () => {
        const bytes = packOf(MIXED_SHEET, [FONT_A, FONT_B], { 'images/a.png': PNG_1X1 })
        const prepared = accepted(await prepareArchive(bytes))
        const full = judgeAreaSheet('chat', MIXED_SHEET, undefined, 'chat')
        const shapeJudged = judgeAreaSheet('chat', shapeOnlySheet(full.canonical), undefined, 'chat')
        expect(shapeJudged.result.ok).toBe(true)
        const urlOf: Record<string, string> = { [FONT_A]: blobs.minted[0], [FONT_B]: blobs.minted[1], 'images/a.png': blobs.minted[2] }
        expect(chatElementOf(prepared).shapeText).toBe(buildAppliedText(shapeJudged, (raw) => urlOf[raw]))
        expect(chatElementOf(prepared).shapeText).toContain(blobs.minted[0])
        expect(chatElementOf(prepared).shapeText).toContain(blobs.minted[1])
        expect(chatElementOf(prepared).shapeText).not.toContain(blobs.minted[2])
        expect(chatElementOf(prepared).shapeText).not.toContain('background-image')
        expect(chatElementOf(prepared).text).toContain(blobs.minted[2])
    })

    it('a sheet the strip leaves unchanged reuses the applied text without a second judgement', async () => {
        const rig = judgeRig()
        const prepared = accepted(await prepareArchive(packOf(TWO_FONTS_SHEET, [FONT_A, FONT_B]), rig))
        expect(chatElementOf(prepared).shapeText).toBe(chatElementOf(prepared).text)
        expect(rig.posts).toHaveLength(1)
    })
})

describe('T31 shape mode fails closed', () => {
    const originNavy = (): ApplySource => {
        const pack = builtinPackById('builtin:origin-navy')
        if (pack === null) {
            throw new Error('Origin Navy is missing')
        }
        return { kind: 'builtin', pack }
    }

    /** Answers the first call (the sheet itself) with the real verdict, and every later call with `later`. */
    function stubJudge(later: (sheets: Parameters<PackJudge>[0]) => ReturnType<PackJudge>): { judge: PackJudge; calls: () => number } {
        const real = judgeRig().judge
        let calls = 0
        return {
            judge: async (sheets) => {
                calls += 1
                return calls === 1 ? real(sheets) : later(sheets)
            },
            calls: () => calls,
        }
    }

    it('a refused shape variant gives shapeText null, and the colour variant is untouched', async () => {
        const real = judgeRig().judge
        const stub = stubJudge(() => real({ chat: 'body{color:red}' }))
        const prepared = accepted(await preparePackSheet(originNavy(), judgeSessionOverForTests(stub.judge), ALWAYS))
        expect(stub.calls()).toBe(2)
        expect(chatElementOf(prepared).shapeText).toBeNull()
        expect(chatElementOf(prepared).text).not.toBeNull()
        expect(prepared.defaultScheme).not.toBeNull()
    })

    it('a throwing shape judgement gives shapeText null', async () => {
        const stub = stubJudge(async () => { throw new Error('judge down') })
        const prepared = accepted(await preparePackSheet(originNavy(), judgeSessionOverForTests(stub.judge), ALWAYS))
        expect(chatElementOf(prepared).shapeText).toBeNull()
    })

    it('committed with colours off and a null shape variant, the element is empty and sets no base', async () => {
        openGate()
        const real = judgeRig().judge
        const stub = stubJudge(() => real({ chat: 'body{color:red}' }))
        const prepared = accepted(await preparePackSheet(originNavy(), judgeSessionOverForTests(stub.judge), ALWAYS))
        expect(commitPackSheet({ elements: prepared.elements, blobs: prepared.blobs, colours: false })).toEqual({ ok: true })
        expect(packElements()[0].textContent).toBe('')
        expect(document.documentElement.hasAttribute('data-theme-pack-base')).toBe(false)
    })

    it('committed with colours on, the full text applies with its base', async () => {
        openGate()
        const real = judgeRig().judge
        const stub = stubJudge(() => real({ chat: 'body{color:red}' }))
        const prepared = accepted(await preparePackSheet(originNavy(), judgeSessionOverForTests(stub.judge), ALWAYS))
        expect(commitPackSheet({ elements: prepared.elements, blobs: prepared.blobs, colours: true })).toEqual({ ok: true })
        expect(packElements()[0].textContent).toBe(chatElementOf(prepared).text)
        expect(document.documentElement.getAttribute('data-theme-pack-base')).toBe('')
    })

    it('a stale answer to the shape judgement is stale and revokes what was minted', async () => {
        const real = judgeRig().judge
        let calls = 0
        const judge: PackJudge = async (sheets) => { calls += 1; return real(sheets) }
        const bytes = packOf(MIXED_SHEET, [FONT_A, FONT_B], { 'images/a.png': PNG_1X1 })
        // The intake judgement is call 1 and the shape judgement call 2: every check before the shape answer passes.
        const outcome = await prepare({ kind: 'archive', key: store(bytes) }, { session: judgeSessionOverForTests(judge), judge, posts: [], spawns: () => 0 }, () => calls < 2)
        expect(outcome).toEqual({ ok: false, stale: true })
        expectBalanced()
    })
})

describe('T16 setPackSheetColours switches the variant in place', () => {
    it('swaps the text and the base on the same element and never revokes a blob', async () => {
        openGate()
        const prepared = accepted(await prepareArchive(packOf(MIXED_SHEET, [FONT_A, FONT_B], { 'images/a.png': PNG_1X1 })))
        expect(commitPackSheet({ elements: prepared.elements, blobs: prepared.blobs, colours: true })).toEqual({ ok: true })
        const [element] = packElements()
        expect(element.textContent).toBe(chatElementOf(prepared).text)
        expect(document.documentElement.getAttribute('data-theme-pack-base')).toBe('')

        setPackSheetColours(false)
        expect(packElements()).toEqual([element])
        expect(element.textContent).toBe(chatElementOf(prepared).shapeText)
        expect(document.documentElement.hasAttribute('data-theme-pack-base')).toBe(false)
        expect(element.getAttribute('media')).toBe('all')

        setPackSheetColours(true)
        expect(packElements()).toEqual([element])
        expect(element.textContent).toBe(chatElementOf(prepared).text)
        expect(document.documentElement.getAttribute('data-theme-pack-base')).toBe('')
        expect(blobs.revoked).toEqual([])
    })

    it('does nothing with no current element', () => {
        openGate()
        expect(() => setPackSheetColours(false)).not.toThrow()
        expect(packElements()).toHaveLength(0)
    })
})


describe('S3a-3 the settings element (MC-3121: shape variant only, no base, in both modes)', () => {
    const FONT_X = 'fonts/x.woff2'
    const FACE_X = '@font-face{font-family:"pack-x";src:url(fonts/x.woff2) format("woff2")}'
    const CHAT_X = FACE_X + LEAF
    /** A settings sheet with colours, an image only its colours name, a pattern token and two shape properties. */
    const SETTINGS_X = '@font-face{font-family:"pack-x";src:url(fonts/x.woff2)}:root{--pattern-warn-padding:20px;--nexus-touch:44px}'
        + '[data-part="settings-section-title"]{font-family:"pack-x";color:#ff0000;background-image:url(images/s.png);border-radius:6px}'
    const SETTINGS_WHOLE = '[data-part="settings-section-title"]{border-radius:6px}'
    const BASE = 'data-theme-pack-base'
    const pack = (extra: Readonly<Record<string, PackFile>>): Uint8Array => packOf(CHAT_X, [FONT_X], { 'images/s.png': PNG_1X1, ...extra })

    /** The text the settings element must carry: the judged shape variant, with each resource span replaced by its URL. */
    function expectedSettingsText(settings: string, urlOf: Readonly<Record<string, string>> = {}): string {
        const whole = judgeAreaSheet('settings', settings, undefined, 'settings')
        const shape = judgeAreaSheet('settings', shapeOnlySheet(whole.canonical, shapeTokenNames('settings')), undefined, 'settings')
        expect(shape.result.ok).toBe(true)
        return buildAppliedText(shape, (raw) => urlOf[raw] ?? '')
    }

    const tagged = (label: string, rule: 'contrast' | 'layout') => (response: JudgeResponse): JudgeResponse => {
        if (!response.ok || !Object.hasOwn(response.results, label)) {
            return response
        }
        const verdict = response.results[label]
        return { ...response, results: { ...response.results, [label]: { ...verdict, warnings: [...verdict.warnings, { selector: 's', prop: 'color', why: 'w', rule }] } } }
    }

    it('C5: the settings element is the shape judgement with blob substitution: no colour, no image, no pattern token, after chat and before #customcss', async () => {
        const prepared = accepted(await prepareArchive(pack({ 'settings.css': SETTINGS_X })))
        commitAll(prepared, true)
        expect(packElements().map((element) => element.getAttribute('data-theme-pack'))).toEqual(['chat', 'settings'])
        const [chat, settings] = packElements()
        expect(chat.nextElementSibling).toBe(settings)
        expect(settings.nextElementSibling?.id).toBe('customcss')
        expect(settings.getAttribute('media')).toBe('not all')
        expect(settings.textContent).toBe(expectedSettingsText(SETTINGS_X, { [FONT_X]: blobs.minted[0] }))
        expect(settings.textContent).toContain('border-radius')
        expect(settings.textContent).toContain('--nexus-touch')
        expect(settings.textContent).not.toMatch(/color:|#ff0000|background-image|images\/|--pattern-/)
        expect(prepared.elements.find((element) => element.area === 'settings')).toMatchObject({ area: 'settings', base: null })
    })

    it('an image only the settings colours name is never minted; only the shared font is', async () => {
        accepted(await prepareArchive(pack({ 'settings.css': SETTINGS_X })))
        expect(blobs.minted).toHaveLength(1)
    })

    it('the settings element is on while settings is the shown screen, in colour mode and shape mode alike, and sets no base', async () => {
        const prepared = accepted(await prepareArchive(pack({ 'settings.css': SETTINGS_X })))
        installThemePackGate(() => false)
        declareSurface('chat')
        declareSurface('settings')
        flushSync()
        commitAll(prepared, true)
        const [chat, settings] = packElements()
        const shapeText = expectedSettingsText(SETTINGS_X, { [FONT_X]: blobs.minted[0] })
        expect(settings.getAttribute('media')).toBe('all')
        expect(chat.getAttribute('media')).toBe('not all')
        expect(document.documentElement.hasAttribute(BASE)).toBe(false)
        setPackSheetColours(false)
        expect(settings.textContent).toBe(shapeText)
        setPackSheetColours(true)
        expect(settings.textContent).toBe(shapeText)
        expect(document.documentElement.hasAttribute(BASE)).toBe(false)
    })

    it('a sheet the settings allowlist leaves whole is its own shape variant and posts no settings#shape job; a stripped one posts one', async () => {
        const whole = judgeRig()
        accepted(await prepareArchive(pack({ 'settings.css': SETTINGS_WHOLE }), whole))
        expect(whole.posts.flatMap((post) => post.jobs.map((job) => job.label))).not.toContain('settings#shape')
        const stripped = judgeRig()
        accepted(await prepareArchive(pack({ 'settings.css': SETTINGS_X }), stripped))
        const job = stripped.posts.flatMap((post) => post.jobs).find((entry) => entry.label === 'settings#shape')
        expect(job?.area).toBe('settings')
    })

    it('C4 twin: a missing settings#shape verdict gives no settings element and chat applies (fail-closed, never the unjudged text)', async () => {
        const dropShape = (response: JudgeResponse): JudgeResponse => {
            if (!response.ok) return response
            const kept = Object.fromEntries(Object.entries(response.results).filter(([label]) => label !== 'settings#shape'))
            return { ...response, results: kept }
        }
        const prepared = accepted(await prepareArchive(pack({ 'settings.css': SETTINGS_X }), judgeRig({ rewrite: dropShape })))
        expect(prepared.elements.map((element) => element.area)).not.toContain('settings')
        expect(prepared.elements.map((element) => element.area)).toContain('chat')
    })

    it('a refused settings#shape verdict gives no settings element', async () => {
        const refuse = (response: JudgeResponse): JudgeResponse => {
            if (!response.ok || !Object.hasOwn(response.results, 'settings#shape')) return response
            const verdict = response.results['settings#shape']
            return { ...response, results: { ...response.results, 'settings#shape': { ...verdict, result: { ...verdict.result, ok: false, errors: [{ selector: 's', prop: 'p', why: 'refused' }] } } } }
        }
        const prepared = accepted(await prepareArchive(pack({ 'settings.css': SETTINGS_X }), judgeRig({ rewrite: refuse })))
        expect(prepared.elements.map((element) => element.area)).toEqual(['chat'])
    })

    it('the own-colour trigger carries a contrast or readability note on the settings judgement, as it does for studio; a layout note is not', async () => {
        const bytes = pack({ 'settings.css': SETTINGS_X })
        expect(accepted(await prepareArchive(bytes, judgeRig({ rewrite: tagged('settings', 'contrast') }))).ownColourTrigger).toBe(true)
        expect(Object.hasOwn(accepted(await prepareArchive(bytes, judgeRig({ rewrite: tagged('settings', 'layout') }))), 'ownColourTrigger')).toBe(false)
        expect(Object.hasOwn(accepted(await prepareArchive(bytes, judgeRig())), 'ownColourTrigger')).toBe(false)
    })
})

describe('S3c-B the popups overlays (MC-3009, MC-3126, MC-3247, MC-3660)', () => {
    const BASE = 'data-theme-pack-base'
    const CHAT_COLOURS = '[data-part="chat-message-avatar"]{color:#ffffff}'
    const FACE_P = '@font-face{font-family:"pack-p";src:url(fonts/p.woff2) format("woff2")}'
    const POPUPS_X = '[data-part="toast-text"]{background-color:#7a1f5c;background-image:url(images/p.png);border-radius:6px}'
    const STUDIO_LEAF = '[data-part="studio-asset-row"]{opacity:0.5}'
    const pack = (chat: string, extra: Readonly<Record<string, PackFile>>): Uint8Array => packOf(chat, [], { 'images/p.png': PNG_1X1, ...extra })
    const popupsOverlays = (): HTMLStyleElement[] => packElements().filter((element) => element.getAttribute('data-theme-pack') === 'popups')
    const overlayOf = (variant: 'colour' | 'shape'): HTMLStyleElement => {
        const found = popupsOverlays().find((element) => element.getAttribute('data-theme-pack-variant') === variant)
        if (found === undefined) {
            throw new Error(`no ${variant} popups overlay`)
        }
        return found
    }
    const commitWithPopups = (prepared: Extract<Prepared, { ok: true }>, colours: boolean): void => {
        expect(commitPackSheet({ elements: prepared.elements, popups: prepared.popups, blobs: prepared.blobs, colours })).toEqual({ ok: true })
    }
    const tagged = (label: string, rule: 'contrast' | 'readability') => (response: JudgeResponse): JudgeResponse => {
        if (!response.ok || !Object.hasOwn(response.results, label)) {
            return response
        }
        const verdict = response.results[label]
        return { ...response, results: { ...response.results, [label]: { ...verdict, warnings: [...verdict.warnings, { selector: 's', prop: 'color', why: 'w', rule }] } } }
    }
    /** Chat shown, in the given colour mode, over a chat plus popups pack. */
    async function chatShown(chat: string, colours: boolean, extra: Readonly<Record<string, PackFile>> = { 'popups.css': POPUPS_X }): Promise<Extract<Prepared, { ok: true }>> {
        const prepared = accepted(await prepareArchive(pack(chat, extra)))
        installThemePackGate(() => false)
        declareSurface('chat')
        flushSync()
        commitWithPopups(prepared, colours)
        return prepared
    }

    it('A-1 (acceptance): a chat plus popups pack prepares both texts and commits two off overlays before #customcss', async () => {
        const rig = judgeRig()
        const prepared = accepted(await prepareArchive(pack(LEAF, { 'popups.css': POPUPS_X }), rig))
        expect(prepared.popups?.colourText).not.toBeNull()
        expect(prepared.popups?.shapeText).not.toBeNull()
        expect(prepared.skippedAreas).toEqual([])
        commitWithPopups(prepared, true)
        const overlays = popupsOverlays()
        expect(overlays.map((element) => element.getAttribute('data-theme-pack-variant'))).toEqual(['colour', 'shape'])
        expect(overlays.every((element) => element.getAttribute('media') === 'not all')).toBe(true)
        expect(overlays[1].nextElementSibling?.id).toBe('customcss')
    })

    it('A-2 (acceptance): the colour text keeps the background and the minted image; the shape text keeps only the shape', async () => {
        const prepared = accepted(await prepareArchive(pack(LEAF, { 'popups.css': POPUPS_X })))
        expect(prepared.popups?.colourText).toContain('background-color')
        expect(prepared.popups?.colourText).toContain(blobs.minted[0])
        expect(prepared.popups?.shapeText).toContain('border-radius')
        expect(prepared.popups?.shapeText).not.toContain('background')
        expect(prepared.popups?.shapeText).not.toContain(blobs.minted[0])
    })

    it('A-3 (acceptance): studio plus popups, no chat sheet: no colour text, the image only the colours name is never minted', async () => {
        const bytes = zipPack({ 'manifest.json': fontManifest('No Chat', []), 'studio.css': STUDIO_LEAF, 'popups.css': POPUPS_X, 'images/p.png': PNG_1X1 })
        const prepared = accepted(await prepareArchive(bytes))
        expect(prepared.popups?.colourText).toBeNull()
        expect(prepared.popups?.shapeText).toContain('border-radius')
        expect(blobs.minted).toHaveLength(0)
    })

    it('E-8 (acceptance): a whitespace-only chat.css gives no colour overlay and mints no colour-only image', async () => {
        const prepared = accepted(await prepareArchive(pack('/* nothing */', { 'studio.css': STUDIO_LEAF, 'popups.css': POPUPS_X })))
        expect(prepared.popups?.colourText).toBeNull()
        expect(prepared.popups?.shapeText).not.toBeNull()
        expect(blobs.minted).toHaveLength(0)
        commitWithPopups(prepared, true)
        expect(popupsOverlays().map((element) => element.getAttribute('data-theme-pack-variant'))).toEqual(['shape'])
    })

    it('A-4 (guard, passes before and after): a contrast or readability warning on popups.css never carries the own-colour trigger', async () => {
        const bytes = pack(LEAF, { 'popups.css': POPUPS_X })
        for (const rule of ['contrast', 'readability'] as const) {
            const prepared = accepted(await prepareArchive(bytes, judgeRig({ rewrite: tagged('popups', rule) })))
            expect(Object.hasOwn(prepared, 'ownColourTrigger')).toBe(false)
        }
    })

    it('A-5 (acceptance): a null commit removes the popups overlays, revokes their blobs and unregisters them', async () => {
        const prepared = accepted(await prepareArchive(pack(LEAF, { 'popups.css': POPUPS_X })))
        commitWithPopups(prepared, true)
        expect(popupsOverlays()).toHaveLength(2)
        expect(commitPackSheet(null)).toEqual({ ok: true })
        expect(popupsOverlays()).toHaveLength(0)
        expectBalanced()
    })

    it('a commit with no screen element creates no popups overlay', async () => {
        const prepared = accepted(await prepareArchive(pack(LEAF, { 'popups.css': POPUPS_X })))
        expect(commitPackSheet({ elements: [], popups: prepared.popups, blobs: prepared.blobs })).toEqual({ ok: true })
        expect(popupsOverlays()).toHaveLength(0)
    })

    it('A-6 (acceptance): switching colour mode leaves the overlay texts as they are and re-reads the screen element as themed or not', async () => {
        await chatShown(CHAT_COLOURS, true)
        const colourText = overlayOf('colour').textContent
        const shapeText = overlayOf('shape').textContent
        expect(overlayOf('colour').getAttribute('media')).toBe('all')
        setPackSheetColours(false)
        expect(overlayOf('colour').textContent).toBe(colourText)
        expect(overlayOf('shape').textContent).toBe(shapeText)
        expect(overlayOf('colour').getAttribute('media')).toBe('not all')
        expect(overlayOf('shape').getAttribute('media')).toBe('not all')
        setPackSheetColours(true)
        expect(overlayOf('colour').getAttribute('media')).toBe('all')
        expect(overlayOf('shape').getAttribute('media')).toBe('not all')
    })

    it('G-1 (acceptance): chat shown in colour mode turns the colour overlay on and the shape overlay off', async () => {
        await chatShown(LEAF, true)
        expect(overlayOf('colour').getAttribute('media')).toBe('all')
        expect(overlayOf('shape').getAttribute('media')).toBe('not all')
    })

    it('G-2 (acceptance): chat shown in shape mode turns the shape overlay on and the colour overlay off', async () => {
        await chatShown(LEAF, false)
        expect(overlayOf('shape').getAttribute('media')).toBe('all')
        expect(overlayOf('colour').getAttribute('media')).toBe('not all')
    })

    it('G-2 (acceptance): studio shown with studio.css applied gives the shape overlay, whatever the colour mode', async () => {
        const prepared = accepted(await prepareArchive(pack(LEAF, { 'studio.css': STUDIO_LEAF, 'popups.css': POPUPS_X })))
        installThemePackGate(() => false)
        declareSurface('chat')
        declareSurface('studio')
        flushSync()
        commitWithPopups(prepared, true)
        expect(overlayOf('shape').getAttribute('media')).toBe('all')
        expect(overlayOf('colour').getAttribute('media')).toBe('not all')
    })

    it('G-3 (acceptance): a colours-only chat sheet in shape mode applies nothing, so both overlays stay off (MC-3247)', async () => {
        await chatShown(CHAT_COLOURS, false)
        expect(overlayOf('colour').getAttribute('media')).toBe('not all')
        expect(overlayOf('shape').getAttribute('media')).toBe('not all')
    })

    it('E-6 (acceptance): a chat sheet of only a font face and emptied blocks in shape mode is not themed, so both overlays stay off', async () => {
        const chat = FACE_P + CHAT_COLOURS
        const prepared = accepted(await prepareArchive(packOf(chat, ['fonts/p.woff2'], { 'images/p.png': PNG_1X1, 'popups.css': POPUPS_X })))
        installThemePackGate(() => false)
        declareSurface('chat')
        flushSync()
        commitWithPopups(prepared, false)
        const chatElement = packElements().find((element) => element.getAttribute('data-theme-pack') === 'chat')
        expect(chatElement?.textContent).toContain('@font-face')
        expect(overlayOf('shape').getAttribute('media')).toBe('not all')
        expect(overlayOf('colour').getAttribute('media')).toBe('not all')
    })

    it('G-4 (acceptance): Settings shown with no settings.css, or masked, leaves both overlays off', async () => {
        const prepared = accepted(await prepareArchive(pack(LEAF, { 'popups.css': POPUPS_X })))
        installThemePackGate((area) => area === 'chat')
        declareSurface('chat')
        declareSurface('settings')
        flushSync()
        commitWithPopups(prepared, true)
        expect(overlayOf('colour').getAttribute('media')).toBe('not all')
        expect(overlayOf('shape').getAttribute('media')).toBe('not all')
    })

    it('G-5 (acceptance): an overlay that is on never sets the base attribute or the base tone', async () => {
        const prepared = accepted(await prepareArchive(pack(LEAF, { 'studio.css': STUDIO_LEAF, 'popups.css': POPUPS_X })))
        installThemePackGate(() => false)
        declareSurface('studio')
        flushSync()
        commitWithPopups(prepared, true)
        expect(overlayOf('shape').getAttribute('media')).toBe('all')
        expect(document.documentElement.hasAttribute(BASE)).toBe(false)
        expect(get(packBaseTone)).toBeNull()
    })
})
