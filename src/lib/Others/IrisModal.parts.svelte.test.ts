// @vitest-environment happy-dom

/**
 * `IrisModal.svelte` carries the overlay vocabulary on its real elements (#438 W3-4, MC-4160, MC-4210). The REAL component is mounted; each
 * element is found by tag, role, aria-label, title, text or structure, never by its part, and the part is asserted on it together with its
 * direct parent. The outline tests pin the whole nesting for the finished, unsupported-model, backlog and typing states, so a part that is
 * dropped, renamed, swapped with a sibling or its parent, moved into a comment or moved inward or outward fails. The modal has no opener in
 * this build (`irisStore.open` is set only by tests), so these tests are its only rendered evidence.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: `localforage` (an in-memory `current_dialogue` item), the model list lookup, `requestChatData`, `RisuAccessClient`, the Iris system
 * prompt, the alert module and the key-event filter, as in `IrisModal.i18n.svelte.test.ts`. No request is sent. Synthetic data only.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

const forage = vi.hoisted(() => ({
    saved: null as unknown,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => forage.saved),
            setItem: vi.fn(async (_key: string, value: unknown) => { forage.saved = value }),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        irisStore: { open: true },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/model/modellist'), () => ({
    LLMFormat: { Anthropic: 1, OpenAICompatible: 2, VertexAIGemini: 3, GoogleCloud: 4, Other: 99 },
    getModelInfo: (id: string) => ({ format: id.startsWith('supported') ? 2 : 99 }),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: vi.fn(),
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/process/moduleRefList'), () => ({
    hasModuleStubs: vi.fn(() => false),
}) as unknown as typeof import('src/ts/process/moduleRefList'))

vi.mock(import('src/ts/process/moduleEnsure'), () => ({
    ensureCurrentModulesOrAlert: vi.fn(async (): Promise<boolean> => true),
}) as unknown as typeof import('src/ts/process/moduleEnsure'))

vi.mock(import('src/ts/process/mcp/risuaccess'), () => ({
    RisuAccessClient: class { async getToolList() { return [] } },
}) as unknown as typeof import('src/ts/process/mcp/risuaccess'))

vi.mock(import('src/ts/iris'), () => ({
    getIrisSystemPrompt: vi.fn(async () => 'system'),
}) as unknown as typeof import('src/ts/iris'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/keyEventBlocked'), () => ({
    keyEventBlocked: vi.fn(() => false),
}) as unknown as typeof import('src/ts/keyEventBlocked'))

import { DBState, irisStore } from 'src/ts/stores.svelte'
import { changeLanguage, language } from 'src/lang'
import IrisModal from './IrisModal.svelte'

// happy-dom has no Web Animations API; Svelte transitions call `element.animate`. This stub reports each animation finished at once so that
// intro and outro blocks complete.
interface FinishedAnimation {
    onfinish: (() => void) | null
    cancel: () => void
    finish: () => void
    pause: () => void
    play: () => void
    currentTime: number
}
Element.prototype.animate = (() => {
    const animation: FinishedAnimation = {
        onfinish: null,
        cancel() {},
        finish() { animation.onfinish?.() },
        pause() {},
        play() {},
        currentTime: 0,
    }
    queueMicrotask(() => animation.onfinish?.())
    return animation
}) as unknown as typeof Element.prototype.animate

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

/** Mounts the modal; with `typing` the typewriter is left running after the stored-dialogue read has settled, else it is finished. */
async function mountIris(options: { subModel?: string, typing?: boolean } = {}): Promise<HTMLElement> {
    DBState.db = { language: 'en', subModel: options.subModel ?? 'supported-model', seperateModelsForAxModels: false, seperateModels: {} } as unknown as Database
    changeLanguage('en')
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(IrisModal, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    if (options.typing) {
        await vi.advanceTimersByTimeAsync(0)
    } else {
        await vi.advanceTimersByTimeAsync(5000)
    }
    flushSync()
    return target
}

beforeEach(() => {
    vi.useFakeTimers()
    forage.saved = null
    irisStore.open = true
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    vi.useRealTimers()
    changeLanguage('en')
})

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null

/** The only element of the selector whose trimmed text is exactly `text`. */
function byText(root: ParentNode, selector: string, text: string): HTMLElement {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => el.textContent?.trim() === text)
    expect(found, `${selector} with text ${text}`).toHaveLength(1)
    return found[0]
}

/** The names of the parted elements as a nested string: `name(child child)`; an element without a part is looked through. */
function outline(el: Element): string {
    const inner = Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')
    const name = partOf(el)
    if (name === null) return inner
    return inner === '' ? name : `${name}(${inner})`
}

const rootOf = (target: HTMLElement): HTMLElement => target.firstElementChild as HTMLElement
const backlogButton = (target: HTMLElement): HTMLElement => target.querySelector(`button[title="${language.iris.viewBacklog}"]`) as HTMLElement
const dialogueOf = (target: HTMLElement): HTMLElement => target.querySelector('[role="button"][aria-live]') as HTMLElement

async function openBacklog(target: HTMLElement): Promise<void> {
    backlogButton(target).click()
    flushSync()
    await vi.advanceTimersByTimeAsync(50)
    flushSync()
}

describe('IrisModal overlay parts', () => {
    test('acceptance: the finished dialogue carries the root, close, frame, backlog button, speaker tag, text, tip, field and send', async () => {
        const target = await mountIris()
        const root = rootOf(target)
        expect(partOf(root)).toBe('modal-iris')
        const close = Array.from(root.children).find((el) => el.tagName === 'BUTTON' && el.getAttribute('aria-label') === language.uiCommon.close) as HTMLElement
        expect(partOf(close)).toBe('modal-close')
        const backlog = backlogButton(target)
        expect(partOf(backlog)).toBe('modal-action')
        const frame = backlog.parentElement as HTMLElement
        expect(partOf(frame)).toBe('modal-frame')
        const position = frame.parentElement as HTMLElement
        expect(partOf(position)).toBeNull()
        expect(position.parentElement).toBe(root)
        const speaker = byText(frame, 'div', 'Iris')
        expect(partOf(speaker)).toBe('modal-title')
        expect(speaker.parentElement).toBe(frame)
        const dialogue = dialogueOf(target)
        expect(partOf(dialogue)).toBe('modal-body')
        expect(dialogue.parentElement).toBe(frame)
        const tip = byText(frame, 'div', language.iris.introTip)
        expect(partOf(tip)).toBe('modal-text')
        expect(tip.parentElement).toBe(dialogue)
        const field = target.querySelector('input[type="text"]') as HTMLElement
        expect(partOf(field)).toBe('modal-field')
        const send = byText(frame, 'button', language.uiCommon.send)
        expect(partOf(send)).toBe('modal-action')
        const controls = field.parentElement as HTMLElement
        expect(partOf(controls)).toBe('modal-controls')
        expect(send.parentElement).toBe(controls)
        expect(controls.parentElement).toBe(frame)
        expect(outline(target)).toBe('modal-iris(modal-close modal-frame(modal-action modal-title modal-body(modal-text) modal-controls(modal-field modal-action)))')
    })

    test('acceptance: the unsupported-model notice is a text part inside the dialogue body', async () => {
        const target = await mountIris({ subModel: 'unsupported-model' })
        const notice = byText(target, 'div', language.iris.unsupportedModel)
        expect(partOf(notice)).toBe('modal-text')
        expect(notice.parentElement).toBe(dialogueOf(target))
        expect(partOf(dialogueOf(target))).toBe('modal-body')
        expect(outline(target)).toBe('modal-iris(modal-close modal-frame(modal-action modal-title modal-body(modal-text modal-text) modal-controls(modal-field modal-action)))')
    })

    test('acceptance: the backlog panel carries the header, Reset, close, list, line and its texts', async () => {
        const target = await mountIris()
        await openBacklog(target)
        const root = rootOf(target)
        const reset = target.querySelector(`button[aria-label="${language.reset}"]`) as HTMLElement
        const closeBacklog = target.querySelector(`button[aria-label="${language.iris.closeBacklog}"]`) as HTMLElement
        expect(partOf(reset)).toBe('modal-action')
        expect(partOf(closeBacklog)).toBe('modal-close')
        const header = reset.parentElement as HTMLElement
        expect(partOf(header)).toBe('modal-header')
        expect(closeBacklog.parentElement).toBe(header)
        const panel = header.parentElement as HTMLElement
        expect(partOf(panel)).toBe('modal-frame')
        const scrim = panel.parentElement as HTMLElement
        expect(partOf(scrim)).toBeNull()
        expect(scrim.parentElement).toBe(root)
        const list = header.nextElementSibling as HTMLElement
        expect(partOf(list)).toBe('modal-list')
        expect(list.parentElement).toBe(panel)
        const speaker = byText(list, 'span', 'Iris')
        expect(partOf(speaker)).toBe('modal-text')
        const row = speaker.parentElement as HTMLElement
        expect(partOf(row)).toBe('modal-row')
        expect(row.parentElement).toBe(list)
        const line = byText(list, 'div', language.iris.introText)
        expect(partOf(line)).toBe('modal-text')
        expect(line.parentElement).toBe(row)
        expect(outline(target)).toBe('modal-iris(modal-close modal-frame(modal-header(modal-action modal-close) modal-list(modal-row(modal-text modal-text))) modal-frame(modal-action modal-title modal-body(modal-text) modal-controls(modal-field modal-action)))')
    })

    test('acceptance: while typing only the root, close, frame, backlog button, speaker tag and dialogue body carry parts', async () => {
        const target = await mountIris({ typing: true })
        expect(dialogueOf(target).getAttribute('aria-label')).toBe(language.iris.dialogueLoading)
        const advanceOverlay = target.querySelector(`button[aria-label="${language.iris.advanceDialogue}"]`) as HTMLElement
        expect(advanceOverlay).toBeTruthy()
        expect(partOf(advanceOverlay)).toBeNull()
        expect(outline(target)).toBe('modal-iris(modal-close modal-frame(modal-action modal-title modal-body))')
    })

    test('guard: the sprite, its image, the dialogue position wrapper, the backlog scrim and the typing cursor carry no part', async () => {
        const target = await mountIris({ typing: true })
        const image = target.querySelector('img[alt="Iris"]') as HTMLElement
        expect(partOf(image)).toBeNull()
        expect(partOf(image.parentElement)).toBeNull()
        const frame = backlogButton(target).parentElement as HTMLElement
        expect(partOf(frame.parentElement)).toBeNull()
        const cursor = dialogueOf(target).querySelector('span.animate-pulse') as HTMLElement
        expect(cursor).toBeTruthy()
        expect(partOf(cursor)).toBeNull()
        const finished = await mountIris()
        await openBacklog(finished)
        const scrim = (finished.querySelector(`button[aria-label="${language.reset}"]`) as HTMLElement).parentElement!.parentElement!.parentElement as HTMLElement
        expect(partOf(scrim)).toBeNull()
    })

    test('guard: the Close button hides the modal', async () => {
        const target = await mountIris()
        const close = Array.from(rootOf(target).children).find((el) => el.tagName === 'BUTTON') as HTMLElement
        close.click()
        flushSync()
        expect(irisStore.open).toBe(false)
    })
})
