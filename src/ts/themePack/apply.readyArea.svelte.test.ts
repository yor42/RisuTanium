// @vitest-environment jsdom
/**
 * The apply core over a colour-ready set wider than production's (chat only). REAL: apply.ts, intake, the validator (through the
 * real worker handler behind a fake channel), the surface gate and the packs `zipPack` builds. FAKED: `./colourReady` (a mutable
 * set, read by apply at call time), the page store, `URL.createObjectURL` and `revokeObjectURL`.
 * R rows are reproducers against the chat-only engine: they fail at the base on the assertions named in their labels.
 */
import { createHash } from 'node:crypto'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JudgeResponse } from './worker/judgeHandler'
import { commitPackSheet, preparePackSheet, resetPackSheetForTests, setPackSheetColours, type Prepared } from './apply'
import { declareSurface, installThemePackGate, resetThemePackGateForTests } from './surfaceGate.svelte'
import { builtinSheetForTests } from './fixtures/bundledPacks'
import { judgeRig, type JudgeRig } from './fixtures/judgeRig'
import { manifestText, PNG_1X1, validPackFiles, zipPack, type PackFile } from './fixtures/packBuilder'

//#region module mocks

const ready = vi.hoisted(() => new Set<string>(['chat']))
const world = vi.hoisted(() => ({ files: new Map<string, Uint8Array>() }))

vi.mock('./colourReady', () => ({ COLOUR_READY_AREAS: ready }))
vi.mock('../storage/store/appStore', () => ({
    getAppStore: async () => ({ read: async (key: string) => ({ bytes: world.files.get(key) ?? null, version: null }) }),
}))
vi.mock('../globalApi.svelte', () => ({ getFileSrc: vi.fn() }))

//#endregion

//#region fixtures

const BASE = 'data-theme-pack-base'
const AREA = 'data-theme-pack-area'
const LEAF = '[data-part="chat-message-avatar"]{opacity:1}'
const HOME_X = ':root{--home-card-radius:4px}[data-part="home-greeting"]{letter-spacing:.08rem;color:#7a1f5c}[data-part="home-shelf"]{scroll-snap-type:none}'
const STUDIO_LEAF = '[data-part="studio-asset-row"]{opacity:0.5}'
const POPUPS_X = '[data-part="toast-text"]{background-color:#7a1f5c;border-radius:6px}'

function packOf(files: Readonly<Record<string, PackFile>>, modes: readonly string[] = ['dark']): Uint8Array {
    return zipPack(validPackFiles({ 'manifest.json': manifestText({ name: 'Test Pack', modes }), ...files }))
}

function store(bytes: Uint8Array): string {
    const key = `assets/tp-${createHash('sha256').update(bytes).digest('hex')}.risutheme`
    world.files.set(key, bytes.slice())
    return key
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
    const custom = document.createElement('style')
    custom.id = 'customcss'
    document.body.appendChild(custom)
}

const prepare = async (bytes: Uint8Array, rig: JudgeRig = judgeRig(), isCurrent: () => boolean = () => true): Promise<Prepared | { ok: false; stale: true }> =>
    preparePackSheet({ kind: 'archive', key: store(bytes) }, rig.session, isCurrent)

function accepted(prepared: Prepared | { ok: false; stale: true }): Extract<Prepared, { ok: true }> {
    if (prepared.ok !== true) {
        throw new Error(`expected an accepted sheet, got ${JSON.stringify(prepared)}`)
    }
    return prepared
}

const elementOf = (prepared: Extract<Prepared, { ok: true }>, area: string) => prepared.elements.find((element) => element.area === area)
const labelsOf = (rig: JudgeRig): string[] => rig.posts.flatMap((post) => post.jobs.map((job) => job.label))

const tagged = (label: string, rule: 'contrast' | 'readability') => (response: JudgeResponse): JudgeResponse => {
    if (!response.ok || !Object.hasOwn(response.results, label)) {
        return response
    }
    const verdict = response.results[label]
    return { ...response, results: { ...response.results, [label]: { ...verdict, warnings: [...verdict.warnings, { selector: 's', prop: 'color', why: 'w', rule }] } } }
}

const dropped = (label: string) => (response: JudgeResponse): JudgeResponse => response.ok
    ? { ...response, results: Object.fromEntries(Object.entries(response.results).filter(([name]) => name !== label)) }
    : response

//#endregion

beforeEach(() => {
    ready.clear()
    ready.add('chat')
    world.files.clear()
    blobs.minted.length = 0
    blobs.revoked.length = 0
    resetDocument()
    installUrlFake()
})

afterEach(() => {
    resetPackSheetForTests()
    resetThemePackGateForTests()
    restoreUrlFake()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
})

describe('a colour-ready home area takes the chat colour path', () => {
    it('R1 (reproducer; fails at the base on the home base and text assertions): home text is the judged colour text on the dark base, its shape text is its own judgement, and it sets no default scheme', async () => {
        ready.add('home')
        const prepared = accepted(await prepare(packOf({ 'chat.css': LEAF, 'home.css': HOME_X })))
        const home = elementOf(prepared, 'home')
        expect(home?.base).toBe('dark')
        expect(home?.text).toMatch(/color:\s*#7a1f5c/i)
        expect(home?.shapeText).toContain('letter-spacing')
        expect(home?.shapeText).not.toMatch(/color:|#7a1f5c/)
        expect(prepared.defaultScheme).toBeNull()
    })

    it('R1b (guard, passes before and after): with the production set home keeps only its shape text and no base', async () => {
        const prepared = accepted(await prepare(packOf({ 'chat.css': LEAF, 'home.css': HOME_X })))
        const home = elementOf(prepared, 'home')
        expect(home?.base).toBeNull()
        expect(home?.text).toBe(home?.shapeText)
        expect(home?.text).not.toMatch(/color:/)
    })

    it('R1c (kills M9): the default scheme comes from the chat sheet whatever the other ready areas carry', async () => {
        const chatSheet = builtinSheetForTests('scratch-white', 'chat')
        const files = { 'manifest.json': manifestText({ name: 'Light', modes: ['light'] }), 'chat.css': chatSheet, 'home.css': HOME_X }
        const alone = accepted(await prepare(zipPack(validPackFiles(files))))
        expect(alone.defaultScheme).not.toBeNull()
        ready.add('home')
        const both = accepted(await prepare(zipPack(validPackFiles(files))))
        expect(both.defaultScheme).toEqual(alone.defaultScheme)
    })

    it('R2 (reproducer; only the base dark half fails at the base, the no-job half passes there): a light-only pack asks for chat#light and never home#light, and home sits on the dark base', async () => {
        ready.add('home')
        const rig = judgeRig()
        const prepared = accepted(await prepare(packOf({ 'chat.css': LEAF, 'home.css': HOME_X }, ['light']), rig))
        expect(labelsOf(rig)).toContain('chat#light')
        expect(labelsOf(rig)).not.toContain('home#light')
        expect(elementOf(prepared, 'home')?.base).toBe('dark')
    })

    it('R2b (guard): the jobs go out in screen order, each ready area before its own shape job, then popups', async () => {
        ready.add('home')
        const rig = judgeRig()
        accepted(await prepare(packOf({ 'chat.css': LEAF, 'studio.css': '[data-part="studio-asset-row"]{opacity:0.5;color:#7a1f5c}', 'home.css': HOME_X, 'popups.css': POPUPS_X }, ['light']), rig))
        expect(labelsOf(rig).filter((label) => label.includes('#'))).toEqual(['chat#light', 'studio#shape', 'home#shape', 'popups#shape'])
    })

    it('R4 (reproducer; fails at the base on colourText null): popups colour paints over a ready home area that has text, with no chat sheet', async () => {
        ready.add('home')
        const bytes = zipPack({ 'manifest.json': manifestText({ name: 'No Chat' }), 'home.css': HOME_X, 'popups.css': POPUPS_X })
        const prepared = accepted(await prepare(bytes))
        expect(prepared.popups?.colourText).toContain('background-color')
    })

    it('R4b (kills M4 and M10): popups colour needs a ready area with text, not any element: a studio element alone gives no colour text', async () => {
        ready.add('home')
        const bytes = zipPack({ 'manifest.json': manifestText({ name: 'No Chat' }), 'studio.css': STUDIO_LEAF, 'popups.css': POPUPS_X })
        const prepared = accepted(await prepare(bytes))
        expect(elementOf(prepared, 'studio')).toBeDefined()
        expect(prepared.popups?.colourText).toBeNull()
        expect(prepared.popups?.shapeText).toContain('border-radius')
    })

    it('R5 (reproducer at the base: no home colour element there; kills M7; a dropped verdict rejects the whole variant request): a dropped home#shape verdict gives no shape text and keeps the colour text', async () => {
        ready.add('home')
        const prepared = accepted(await prepare(packOf({ 'chat.css': LEAF, 'home.css': HOME_X }), judgeRig({ rewrite: dropped('home#shape') })))
        const home = elementOf(prepared, 'home')
        expect(home?.shapeText).toBeNull()
        expect(home?.text).toMatch(/color:\s*#7a1f5c/i)
    })

    it('R6 (guard, passes before; kills M8): a contrast or readability note on a ready home sheet sets no trigger, a studio one does', async () => {
        ready.add('home')
        for (const rule of ['contrast', 'readability'] as const) {
            const homeOnly = accepted(await prepare(packOf({ 'chat.css': LEAF, 'home.css': HOME_X }), judgeRig({ rewrite: tagged('home', rule) })))
            expect(Object.hasOwn(homeOnly, 'ownColourTrigger')).toBe(false)
            const studio = accepted(await prepare(packOf({ 'chat.css': LEAF, 'home.css': HOME_X, 'studio.css': STUDIO_LEAF }), judgeRig({ rewrite: tagged('studio', rule) })))
            expect(studio.ownColourTrigger).toBe(true)
        }
    })

    it('a stale answer after the variant judge revokes the blobs both ready areas minted', async () => {
        ready.add('home')
        const bytes = packOf({
            'chat.css': '[data-part="chat-message-avatar"]{background-image:url(images/a.png)}',
            'home.css': '[data-part="home-greeting"]{background-image:url(images/b.png)}',
            'images/a.png': PNG_1X1,
            'images/b.png': PNG_1X1,
        })
        const rig = judgeRig()
        const outcome = await prepare(bytes, rig, () => rig.posts.every((post) => !post.jobs.some((job) => job.label.endsWith('#shape') || job.label.endsWith('#light'))))
        expect(outcome).toEqual({ ok: false, stale: true })
        expect(blobs.minted.length).toBeGreaterThanOrEqual(2)
        expect([...blobs.revoked].sort()).toEqual([...blobs.minted].sort())
    })
})

describe('the gate names the area of the ready element that is on', () => {
    const rootAttr = (name: string): string | null => document.documentElement.getAttribute(name)

    async function committed(colours: boolean): Promise<void> {
        ready.add('home')
        const prepared = accepted(await prepare(packOf({ 'chat.css': LEAF, 'home.css': HOME_X })))
        installThemePackGate(() => false)
        declareSurface('home')
        flushSync()
        expect(commitPackSheet({ elements: prepared.elements, blobs: prepared.blobs, colours })).toEqual({ ok: true })
    }

    it('R3 (reproducer; fails at the base on the missing base attribute): home shown gives base empty and area home; chat then shown gives area chat; colours off removes both', async () => {
        await committed(true)
        expect(rootAttr(BASE)).toBe('')
        expect(rootAttr(AREA)).toBe('home')
        declareSurface('chat')
        flushSync()
        expect(rootAttr(BASE)).toBe('')
        expect(rootAttr(AREA)).toBe('chat')
        setPackSheetColours(false)
        expect(rootAttr(BASE)).toBeNull()
        expect(rootAttr(AREA)).toBeNull()
        setPackSheetColours(true)
        expect(rootAttr(AREA)).toBe('chat')
        expect(commitPackSheet(null)).toEqual({ ok: true })
        expect(rootAttr(BASE)).toBeNull()
        expect(rootAttr(AREA)).toBeNull()
    })

    it('G1 (guard for the inactive half): with the production set no non-chat area is ever named, and a chat sheet names chat', async () => {
        const prepared = accepted(await prepare(packOf({ 'chat.css': LEAF, 'studio.css': STUDIO_LEAF, 'home.css': HOME_X })))
        installThemePackGate(() => false)
        const releaseHome = declareSurface('home')
        flushSync()
        commitPackSheet({ elements: prepared.elements, blobs: prepared.blobs, colours: true })
        expect(rootAttr(AREA)).toBeNull()
        const releaseStudio = declareSurface('studio')
        flushSync()
        expect(rootAttr(AREA)).toBeNull()
        expect(document.documentElement.matches(':root[data-theme-pack-area="home"]')).toBe(false)
        releaseStudio()
        releaseHome()
        declareSurface('chat')
        flushSync()
        expect(rootAttr(AREA)).toBe('chat')
    })

    it('G2 (guard, kills M1): shape mode sets no area attribute', async () => {
        await committed(false)
        declareSurface('chat')
        flushSync()
        expect(rootAttr(BASE)).toBeNull()
        expect(rootAttr(AREA)).toBeNull()
    })
})
