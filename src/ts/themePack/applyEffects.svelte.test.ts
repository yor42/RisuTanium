// @vitest-environment jsdom
/**
 * The fallback tail of an applied pack (effectsFallback.ts, apply.ts withFallbackTails). REAL: apply.ts, intake, the validator
 * (through judgePackSheets), the surface gate and the packs `zipPack` builds. FAKED: the page store (an in-memory read).
 * F4 and F7 are syntax guards: jsdom's CSSOM does not model the cascade, so they prove the text parses and its order, not that it wins.
 * D2 survey note: under OS reduce-motion an app animationend/transitionend handler on or above a pack-animated part fires at the first
 * style application (the toast div has no timer fallback).
 */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { judgeSessionOverForTests } from './judgeClient'
import { judgePackSheets } from './index'
import { POPUPS_SAFE } from './registries/popups'
import { commitPackSheet, preparePackSheet, resetPackSheetForTests, type Prepared } from './apply'
import { resetThemePackGateForTests } from './surfaceGate.svelte'
import { manifestText, PLAIN_CHAT_SHEET, validPackFiles, zipPack, type PackFile } from './fixtures/packBuilder'

const world = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), tailThrows: false }))

vi.mock('../storage/store/appStore', () => ({
    getAppStore: async () => ({ read: async (key: string) => ({ bytes: world.files.get(key) ?? null, version: null }) }),
}))
vi.mock('../globalApi.svelte', () => ({ getFileSrc: vi.fn() }))
vi.mock('./effectsFallback', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./effectsFallback')>()
    return { ...actual, fallbackTail: (text: string) => { if (world.tailThrows) throw new Error('tail failed'); return actual.fallbackTail(text) } }
})

const A = '[data-part="chat-message-avatar"]'
const NAME = '[data-part="chat-message-name"]'
const HEADER = '[data-part="chat-header"]'
const ANIM_DECL = 'animation-duration:.01ms!important;animation-iteration-count:1!important;animation-delay:0s!important'
const TRANS_DECL = 'transition-duration:.01ms!important;transition-delay:0s!important'
const MOTION = (rules: string): string => `@media (prefers-reduced-motion: reduce){${rules}}`
const TRANSPARENCY = (rules: string): string => `@media (prefers-reduced-transparency: reduce){${rules}}`
type Area = 'chat' | 'studio' | 'settings' | 'home' | 'popups'
const SAFE_PART: Readonly<Record<Area, string>> = {
    chat: 'chat-message-avatar', studio: 'studio-asset-row', settings: 'settings-section-heading', home: 'home-brand', popups: POPUPS_SAFE[0],
}
const K = '@keyframes pack-chat-pulse{from{opacity:.6}to{opacity:1}}'
const PULSE = 'animation:pack-chat-pulse 1.2s infinite alternate'

function zip(files: Readonly<Record<string, PackFile>>): Uint8Array {
    return zipPack(validPackFiles({ 'manifest.json': manifestText({ name: 'Effects Pack' }), ...files }))
}

async function prepare(files: Readonly<Record<string, PackFile>>): Promise<Awaited<ReturnType<typeof preparePackSheet>>> {
    const bytes = zip(files)
    const key = `assets/tp-${createHash('sha256').update(bytes).digest('hex')}.risutheme`
    world.files.set(key, bytes.slice())
    return preparePackSheet({ kind: 'archive', key }, judgeSessionOverForTests(async (sheets) => judgePackSheets(sheets)), () => true)
}

async function accepted(files: Readonly<Record<string, PackFile>>): Promise<Extract<Prepared, { ok: true }>> {
    const prepared = await prepare(files)
    if (prepared.ok !== true) throw new Error(`expected an accepted pack, got ${JSON.stringify(prepared)}`)
    return prepared
}

const chatOf = (prepared: Extract<Prepared, { ok: true }>) => {
    const chat = prepared.elements.find((element) => element.area === 'chat')
    if (!chat) throw new Error('no chat element')
    return chat
}
const tailPart = (text: string | null): string => (text ?? '').slice((text ?? '').indexOf('\n@media') + 1)

beforeEach(() => {
    world.files.clear()
    world.tailThrows = false
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    const custom = document.createElement('style')
    custom.id = 'customcss'
    document.body.appendChild(custom)
})
afterEach(() => {
    resetPackSheetForTests()
    resetThemePackGateForTests()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
})

describe('F1 the motion tail of a chat pack (REPRO)', () => {
    it('F1 an animated entry gets the reduce-motion group with the 0.01ms durations, and the colour and shape texts both carry it', async () => {
        const chat = chatOf(await accepted({ 'chat.css': `${K}${A}{${PULSE};color:#ffffff}` }))
        const expected = `\n${MOTION(`${A}{${ANIM_DECL}}`)}${TRANSPARENCY(`${A}{filter:none!important}`)}`
        expect(chat.text?.endsWith(expected)).toBe(true)
        expect(chat.shapeText?.endsWith(expected)).toBe(true)
        expect(chat.text).not.toContain('animation:none')
    })
    it('F1b only the families an entry sets are emitted, per entry', async () => {
        const chat = chatOf(await accepted({ 'chat.css': `${K}${A}{${PULSE}}${NAME}{transition:opacity 1s}` }))
        expect(tailPart(chat.text)).toBe(`${MOTION(`${A}{${ANIM_DECL}}${NAME}{${TRANS_DECL}}`)}${TRANSPARENCY(`${A}{filter:none!important}`)}`)
    })
    it('F1c a root-attribute entry is copied verbatim and nothing is prefixed or merged (exact text)', async () => {
        const entry = `[data-layout="phone"] ${A}`
        const chat = chatOf(await accepted({ 'chat.css': `${K}${entry}{${PULSE}}` }))
        expect(tailPart(chat.text)).toBe(`${MOTION(`${entry}{${ANIM_DECL}}`)}${TRANSPARENCY(`${entry}{filter:none!important}`)}`)
    })
})

describe('F2 the transparency tail (REPRO)', () => {
    it('F2 a filter-only entry gets filter:none and a backdrop-only entry gets backdrop-filter:none, and neither is in the motion group', async () => {
        const chat = chatOf(await accepted({ 'chat.css': `${A}{filter:blur(4px)}${HEADER}{backdrop-filter:blur(12px)}` }))
        expect(tailPart(chat.text)).toBe(TRANSPARENCY(`${A}{filter:none!important}${HEADER}{backdrop-filter:none!important}`))
    })
    it('F2b an animation whose keyframes carry a filter is in the transparency group', async () => {
        const chat = chatOf(await accepted({ 'chat.css': `@keyframes pack-chat-glow{to{filter:blur(8px)}}${A}{animation:pack-chat-glow 2s infinite}` }))
        expect(chat.text).toContain(TRANSPARENCY(`${A}{filter:none!important}`))
    })
    it('F2c every animated entry is in the transparency group, whatever its keyframes hold', async () => {
        const chat = chatOf(await accepted({ 'chat.css': `${K}${A}{${PULSE}}` }))
        expect(chat.text).toContain(TRANSPARENCY(`${A}{filter:none!important}`))
    })
})

describe('F4 and F7 the tail parses and follows the rule (GUARD, syntax only)', () => {
    it('F4 the committed element holds the two media groups after the pack rules', async () => {
        const prepared = await accepted({ 'chat.css': `${K}${A}{${PULSE}}${HEADER}{backdrop-filter:blur(12px)}` })
        expect(commitPackSheet({ elements: prepared.elements, blobs: prepared.blobs })).toEqual({ ok: true })
        const element = document.querySelector<HTMLStyleElement>('style[data-theme-pack="chat"]')
        const rules = [...(element?.sheet?.cssRules ?? [])]
        expect(rules.filter((rule) => rule instanceof CSSMediaRule)).toHaveLength(2)
        expect(rules[rules.length - 1]).toBeInstanceOf(CSSMediaRule)
    })
    it('F7 the tail comes after the pack rule and every tail declaration is important', async () => {
        const text = chatOf(await accepted({ 'chat.css': `${A}{transition:color 1s !important}` })).text ?? ''
        expect(text.indexOf('@media (prefers-reduced-motion')).toBeGreaterThan(text.indexOf('transition:color'))
        const declarations = tailPart(text).replace(/@media[^{]*\{/g, '').split(/[{};]/).filter((piece) => piece.includes(':'))
        expect(declarations.length).toBeGreaterThan(0)
        for (const declaration of declarations) expect(declaration, declaration).toContain('!important')
    })
})

describe('F5 shape mode and the shape-only areas keep motion and the tail, and drop blur', () => {
    const sheetOf = (area: Area): string => {
        const part = `[data-part="${SAFE_PART[area]}"]`
        return `@keyframes pack-${area}-pulse{from{opacity:.6;animation-timing-function:ease-in;filter:blur(2px)}to{opacity:1}}${part}{animation:pack-${area}-pulse 1.2s infinite alternate;filter:blur(4px);color:#ffffff}`
    }
    for (const area of ['chat', 'studio', 'settings', 'home'] as const) {
        it(`F5 ${area} the shape text carries the motion, the frame opacity and easing and the tail, and no blur`, async () => {
            const files: Record<string, PackFile> = area === 'chat' ? { 'chat.css': sheetOf('chat') } : { 'chat.css': PLAIN_CHAT_SHEET, [`${area}.css`]: sheetOf(area) }
            const prepared = await accepted(files)
            const element = prepared.elements.find((candidate) => candidate.area === area)
            expect(element, area).toBeDefined()
            const text = element?.shapeText
            const part = `[data-part="${SAFE_PART[area]}"]`
            expect(text, area).toContain(`animation:pack-${area}-pulse 1.2s infinite alternate`)
            expect(text, area).toContain('opacity:.6;animation-timing-function:ease-in')
            expect(text, area).toContain(MOTION(`${part}{${ANIM_DECL}}`))
            expect(text, area).toContain(TRANSPARENCY(`${part}{filter:none!important}`))
            expect((text ?? '').replace(/filter:none!important/g, ''), area).not.toContain('filter:')
        })
    }
    it('F5b an emptied keyframes block still applies: a filter-only block in studio keeps its frames, emptied, in the element', async () => {
        const css = `@keyframes pack-studio-x{from{filter:blur(2px)}to{filter:blur(4px)}}[data-part="${SAFE_PART.studio}"]{animation:pack-studio-x 1s infinite}`
        const studio = (await accepted({ 'studio.css': css })).elements.find((element) => element.area === 'studio')
        expect(studio, 'studio').toBeDefined()
        expect(studio?.shapeText).toContain('@keyframes pack-studio-x{from{}to{}}')
    })
    it('F6 compatibility guard: blur is dropped in chat shape text, in the rule and in the frames', async () => {
        const chat = chatOf(await accepted({ 'chat.css': `@keyframes pack-chat-glow{to{filter:blur(8px)}}${A}{filter:blur(4px);animation:pack-chat-glow 2s infinite;color:#ffffff}` }))
        expect((chat.shapeText ?? '').replace(/filter:none!important/g, '')).not.toContain('filter:')
    })
})

describe('F8 the popups texts carry the tail (REPRO)', () => {
    it('F8 both the colour and the shape popups text end with the tail of their own effects', async () => {
        const part = `[data-part="${SAFE_PART.popups}"]`
        const popups = `@keyframes pack-popups-pulse{from{opacity:.6}to{opacity:1}}${part}{animation:pack-popups-pulse 1.2s infinite alternate;background-color:#7a1f5c}`
        const prepared = await accepted({ 'chat.css': `${A}{opacity:.9}`, 'popups.css': popups })
        const tail = `\n${MOTION(`${part}{${ANIM_DECL}}`)}${TRANSPARENCY(`${part}{filter:none!important}`)}`
        expect(prepared.popups?.colourText?.endsWith(tail)).toBe(true)
        expect(prepared.popups?.shapeText?.endsWith(tail)).toBe(true)
    })
})

describe('F9 turn-off leaves nothing behind (GUARD, vacuous before the tail existed)', () => {
    it('F9 commit(null) removes every pack element and the tail with them, and the apply path adds no root attribute', async () => {
        const rootBefore = [...document.documentElement.attributes].map((attribute) => `${attribute.name}=${attribute.value}`)
        const prepared = await accepted({ 'chat.css': `${K}${A}{${PULSE}}` })
        expect(commitPackSheet({ elements: prepared.elements, blobs: prepared.blobs })).toEqual({ ok: true })
        expect(document.querySelectorAll('style[data-theme-pack]').length).toBeGreaterThan(0)
        expect(commitPackSheet(null)).toEqual({ ok: true })
        expect(document.querySelectorAll('style[data-theme-pack]').length).toBe(0)
        expect(document.documentElement.outerHTML).not.toContain('prefers-reduced')
        expect([...document.documentElement.attributes].map((attribute) => `${attribute.name}=${attribute.value}`)).toEqual(rootBefore)
    })
})

describe('F10b a tail failure applies no sheet (GUARD: no pre-change seam exists)', () => {
    it('F10b a throwing tail gives couldNotCheck and nothing is committed', async () => {
        world.tailThrows = true
        expect(await prepare({ 'chat.css': `${K}${A}{${PULSE}}` })).toEqual({ ok: false, reason: 'couldNotCheck' })
        expect(document.querySelectorAll('style[data-theme-pack]').length).toBe(0)
    })
})

describe('F11 a pack with no effects gets no tail (GUARD)', () => {
    it('F11 the plain chat sheet is applied exactly as judged', async () => {
        const chat = chatOf(await accepted({ 'chat.css': PLAIN_CHAT_SHEET }))
        expect(chat.text).not.toContain('@media')
        expect(chat.shapeText ?? '').not.toContain('prefers-reduced')
    })
})
