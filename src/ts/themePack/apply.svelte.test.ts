// @vitest-environment jsdom
/**
 * The apply core (T3-1 to T3-17, T3A-1, T3G-6), all GUARD: no apply code exists at the base, so a red run would only be a
 * missing module. REAL: apply.ts, intake, the validator (through the real worker handler behind a fake channel), the surface
 * gate and the packs `zipPack` builds. FAKED: the page store (an in-memory read), `URL.createObjectURL` and `revokeObjectURL`
 * (jsdom has neither), and the worker channel (real verdicts, no real Worker; the WebView worker is a device row).
 */
import { createHash } from 'node:crypto'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalStylesheet } from './canonical'
import { judgeAreaSheet, type PackSheetsJudgement } from './index'
import type { BuiltinPack } from './builtins'
import { createJudgeClient, type JudgeRequest, type JudgeWorkerLike } from './judgeClient'
import type { IntakeRefusal, PackJudge } from './intake'
import { handleJudgeRequest } from './worker/judgeHandler'
import {
    BLOB_URL_PATTERN, brokenReasonOf, buildAppliedText, commitPackSheet, preparePackSheet, resetPackSheetForTests,
    type ApplySource, type Prepared,
} from './apply'
import { declareSurface, installThemePackGate, registerThemePackElement, resetThemePackGateForTests } from './surfaceGate.svelte'
import { getFileSrc } from '../globalApi.svelte'
import {
    CHAT_SHEET, concat, fakeFont, manifestText, PLAIN_CHAT_SHEET, PNG_1X1, utf8, validPackFiles, zipPack, type PackFile,
} from './fixtures/packBuilder'

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

    constructor(private readonly posts: JudgeRequest[], private readonly silent: boolean) {}

    postMessage(message: JudgeRequest): void {
        this.posts.push(message)
        if (!this.silent) {
            const answer = handleJudgeRequest(message)
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

interface JudgeRig { judge: PackJudge; posts: JudgeRequest[]; spawns: () => number }

/** The real client over a channel that answers with the real handler; `silent` never answers (the client times out). */
function judgeRig(options: { silent?: boolean; timeoutMs?: number } = {}): JudgeRig {
    const posts: JudgeRequest[] = []
    let spawned = 0
    const judge = createJudgeClient({
        spawn: () => {
            spawned += 1
            return new AnsweringWorker(posts, options.silent === true)
        },
        timeoutMs: options.timeoutMs,
    })
    return { judge, posts, spawns: () => spawned }
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
    return preparePackSheet(source, rig.judge, isCurrent)
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
    expect(commitPackSheet(prepared.text === null ? null : { text: prepared.text, blobs: prepared.blobs })).toEqual({ ok: true })
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

describe('T3-2 the text is text', () => {
    it('keeps a closing style tag inside a string as text and creates no element from it', () => {
        const text = '[data-part="chat-message-avatar"]{content:"</style><img src=x onerror=1>"}'
        expect(commitPackSheet({ text, blobs: [] })).toEqual({ ok: true })
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
        expect(prepared.text).toBe(expected)
        expect(prepared.text).toContain('src:url("blob:http://localhost/1") format("woff2")')
        expect(prepared.text).toContain('src:url("blob:http://localhost/2") format("woff2")')
        expect(prepared.text).toContain('background-image:url("blob:http://localhost/3"),image-set("blob:http://localhost/3" 1x)')
        expect(prepared.text).not.toMatch(/fonts\/|images\//)
        expect(canonicalStylesheet(prepared.text as string).resources.map((span) => span.raw)).toEqual([blobs.minted[0], blobs.minted[1], blobs.minted[2], blobs.minted[2]])
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
        expect(await preparePackSheet({ kind: 'builtin', pack: builtin }, rejecting, ALWAYS)).toEqual({ ok: false, reason: 'couldNotCheck' })
        expect(await preparePackSheet({ kind: 'builtin', pack: builtin }, empty, ALWAYS)).toEqual({ ok: false, reason: 'couldNotCheck' })
    })

    it('a built-in that the validator accepts applies its judged text with no blobs and no skipped areas', async () => {
        const builtin: BuiltinPack = { id: 'builtin:ok', slug: 'ok', name: 'Ok', version: '1.0.0', license: 'MIT', attribution: 'x', modes: ['dark'], chatCss: PLAIN_CHAT_SHEET }
        const prepared = accepted(await prepare({ kind: 'builtin', pack: builtin }))
        expect(prepared).toEqual({ ok: true, text: judgeAreaSheet('chat', PLAIN_CHAT_SHEET, undefined, 'chat').canonical, blobs: [], skippedAreas: [] })
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
        expect(typeof prepared.text).toBe('string')
        expect(prepared.text).not.toContain('﻿')
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
        expect(prepared.text).toContain('url("blob:http://[::1]:6001/1")')
    })
})

describe('T3-14 an empty chat sheet applies nothing', () => {
    it.each([['0 bytes', ''], ['a comment only', '/* nothing */']])('%s: text null, studio skipped, and a previous pack is removed with its blobs', async (_label, sheet) => {
        const a = accepted(await prepareArchive(packOf(TWO_FONTS_SHEET, [FONT_A, FONT_B], {}, 'Pack A')))
        commitPrepared(a)
        expect(packElements()).toHaveLength(1)
        const empty = accepted(await prepareArchive(packOf(sheet, [], { 'studio.css': PLAIN_CHAT_SHEET }, 'Pack E')))
        expect(empty.text).toBeNull()
        expect(empty.blobs).toEqual([])
        expect(empty.skippedAreas).toEqual(['studio'])
        commitPrepared(empty)
        expect(packElements()).toHaveLength(0)
        expect([...blobs.revoked].sort()).toEqual([...a.blobs].sort())
    })
})

describe('T3-15 only the chat sheet is judged and applied', () => {
    it('judges the chat key only, applies one element and reports the skipped areas', async () => {
        const rig = judgeRig()
        const hostile = '[data-part]{padding-inline:60px}'
        const prepared = accepted(await prepareArchive(packOf(PLAIN_CHAT_SHEET, [], { 'home.css': hostile, 'studio.css': hostile }), rig))
        expect(prepared.skippedAreas).toEqual(['home', 'studio'])
        expect(rig.posts.map((post) => Object.keys(post.sheets))).toEqual([['chat']])
        commitPrepared(prepared)
        const elements = packElements()
        expect(elements).toHaveLength(1)
        expect(elements[0].getAttribute('data-theme-pack')).toBe('chat')
        expect(document.querySelectorAll('style').length).toBe(3)
    })
})

describe('T3-16 a missing #customcss', () => {
    it('inserts nothing, answers couldNotCheck, revokes the passed blobs and leaves the previous element', () => {
        expect(commitPackSheet({ text: LEAF, blobs: ['blob:http://localhost/a'] })).toEqual({ ok: true })
        const [previous] = packElements()
        document.getElementById('customcss')?.remove()
        expect(commitPackSheet({ text: ALT_SHEET, blobs: ['blob:http://localhost/b'] })).toEqual({ ok: false, reason: 'couldNotCheck' })
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
        commitPackSheet({ text: LEAF, blobs: [] })
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
        commitPackSheet({ text: LEAF, blobs: [] })
        expect(packElements()[0].getAttribute('media')).toBe('all')
        flushSync()
        expect(packElements()[0].getAttribute('media')).toBe('all')
        expectNeverDisabled()
    })

    it('(c) covered: A then B, and no registered element is ever written all; B is off after the commit and after the flush', () => {
        openGate(true)
        const recording = startRecording()
        commitPackSheet({ text: LEAF, blobs: [] })
        commitPackSheet({ text: ALT_SHEET, blobs: [] })
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
        commitPackSheet({ text: LEAF, blobs: [] })
        const [first] = packElements()
        expect(first.getAttribute('media')).toBe('all')
        commitPackSheet({ text: ALT_SHEET, blobs: [] })
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
        commitPackSheet({ text: LEAF, blobs: [] })
        flushSync()
        expect(packElements()[0].getAttribute('media')).toBe('not all')
        cover.on = false
        flushSync()
        expect(packElements()[0].getAttribute('media')).toBe('all')
        expectNeverDisabled()
    })

    it('(f) a null commit removes the element, unregisters it and revokes its blobs', () => {
        openGate(true)
        commitPackSheet({ text: LEAF, blobs: ['blob:http://localhost/1'] })
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
        commitPackSheet({ text: LEAF, blobs: [] })
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
        commitPackSheet({ text: LEAF, blobs: [] })
        flushSync()
        commitPackSheet({ text: ALT_SHEET, blobs: [] })
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
        commitPackSheet({ text: LEAF, blobs: [] })
        commitPackSheet({ text: ALT_SHEET, blobs: [] })
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
