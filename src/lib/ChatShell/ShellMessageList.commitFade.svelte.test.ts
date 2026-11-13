// @vitest-environment jsdom
// A committed swipe step swaps the message, which mounts a successor row under a new key. Where motion is reduced or power is low the step shows the
// commit animation, so every assertion here is made on the body that is in the document after the step has remounted the row, and on the animation the
// stylesheet gives that element under the root condition of each mode. A test that read only data-commit, or only the predecessor, would pass while the screen shows nothing.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss, { type AtRule, type ChildNode, type Rule } from 'postcss'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Chat, ChatAlt, Message } from '../../ts/storage/database.svelte'
import type { TreeView } from '../../ts/process/chatTreeView'
import { siblingsAt, switchTo } from '../../ts/process/chatTree'
import { applyMotionClasses, type MotionState } from '../../ts/chatShell/motionPrefs.svelte'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
const bodyAtMount = vi.hoisted(() => ({ on: false }))
const surface = vi.hoisted(() => ({ installed: false }))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [] as unknown[], username: 'User', userIcon: '', translator: '', swipe: true, autoTranslate: false,
        autoScrollToNewMessage: true, alwaysScrollToNewMessage: false, chatLoadInitialPages: 3, chatLoadAdditionalPages: 3 } })
    const selIdState = $state({ selId: 0 })
    const ScrollToMessageStore = $state({ value: -1 })
    return { DBState, selIdState, HideIconStore: writable(false), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0), ScrollToMessageStore, createSimpleCharacter: () => null }
})
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling, regenerateNewest }))
vi.mock('../../ts/chatShell/haptics', () => ({ tickHaptic: vi.fn(), readHaptics: () => true }))
vi.mock('../../ts/android/hostBridge', () => ({ gestureInsetLeft: () => 0 }))
vi.mock('../../ts/backHandlers', () => ({ registerBackHandler: () => () => {}, backCloseHandler: () => () => false }))
vi.mock('../../ts/globalApi.svelte', () => {
    const chatFoldedState = $state<{ data: null }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return { chatFoldedState, chatFoldedStateMessageIndex, aiLawApplies: () => false }
})
vi.mock('../../ts/process/firstMessage', () => ({ firstMessageOf: () => 'Greeting', firstMessageIndexOf: () => -1, nextFirstMessageIndex: () => -1 }))
vi.mock('../../ts/process/activeStreams', () => ({ isActiveStreamReply: () => false }))
vi.mock('../../ts/localDrafts', () => ({ hasMessageEditorDrafts: () => false, onDraftsChanged: () => () => {} }))
vi.mock('../../ts/storage/database.svelte', () => ({ getCurrentCharacter: () => null }))
vi.mock('../../ts/parser/parser.svelte', () => ({ ParseMarkdown: async (text: string) => text }))
vi.mock('../../ts/parser/chatML', () => ({}))
vi.mock('../../ts/process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('../../ts/process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true }))
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: async () => null }))
vi.mock('../../ts/process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('../../ts/process/tts', () => ({ stopTTS: vi.fn() }))
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../../ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), alertRequestData: vi.fn(), alertConfirm: vi.fn(), alertNormal: vi.fn(), alertSelect: vi.fn() }))
vi.mock('../../ts/process/messageActions.svelte', () => ({
    handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS: vi.fn(),
    requestRemove: vi.fn(), deleteNow: vi.fn(), copyMessageText: vi.fn(), copyMessageAsCard: vi.fn(),
    branchMessage: vi.fn(), toggleMessageDisabled: vi.fn(), toggleBookmark: vi.fn(),
}))
vi.mock('../../ts/process/messageEditorController.svelte', () => ({ createMessageEditorController: () => ({
    editMode: false, editTranslationMode: false, discardConfirmOpen: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false, dispose: () => {},
}) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('./TranslationEditor.svelte', () => ({ default: () => ({}) }))
// The body is empty until a test fills it, like ChatBody before its asynchronous parse ends; a test may also have it render text at mount.
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: (anchor: Comment) => {
    if (bodyAtMount.on) anchor.before(document.createTextNode('Reply'))
    return {}
} }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ rebuildEpoch: 0, closeEpoch: 0, hidden: false, heldGui: 0, heldChat: {} })
    return { chatSurface, isChatSurfaceInstalled: () => surface.installed, onSurfaceHiding: () => () => {} }
})
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../../lang', () => ({ language: {
    loadMore: 'Load more', messageRenderFailed: 'Failed', messageRenderRetry: 'Retry', messageInterrupted: 'Interrupted',
    chatShellMoreActions: 'More actions', chatShellNewReply: 'New reply', bookmark: 'Bookmark',
    chatShellStillWriting: 'Still writing the reply', chatShellNoSavedReplies: 'No more saved replies',
    chatShellReleaseNewReply: 'Let go to generate a new reply', chatShellGenerateReply: 'Generate a reply',
    chatShellPreviousReply: 'Previous', chatShellNextReply: 'Next', chatShellFirstReply: 'First', chatShellLastReply: 'Last',
    chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`,
    chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}`,
    chatShellEndControl: (count: number) => `Bring back ${count}`,
} }))

import ShellMessageList from './ShellMessageList.svelte'
import { chatSurface } from '../ChatScreens/chatSurface.svelte'
import { DBState } from '../../ts/stores.svelte'

// The stylesheet as the browser sees it: the rules of ShellMessage.svelte's style block, with the selectors unwrapped from :global().
type Specificity = [number, number, number]
interface Declared { specificity: Specificity, order: number, name: string | null, duration: string | null, selector: string, osOnly: boolean }
interface CommitAnimation { name: string, durationRule: string | null }

function unwrapGlobal(selector: string): string {
    let out = ''
    let at = 0
    while (at < selector.length) {
        if (selector.startsWith(':global(', at)) {
            let depth = 1
            let end = at + ':global('.length
            const start = end
            while (end < selector.length && depth > 0) {
                if (selector[end] === '(') depth++
                else if (selector[end] === ')') depth--
                end++
            }
            out += selector.slice(start, end - 1)
            at = end
        } else out += selector[at++]
    }
    return out
}
function specificityOf(selector: string): Specificity {
    const total: Specificity = [0, 0, 0]
    let rest = selector
    for (;;) {
        const found = /:(?:not|is)\(([^()]*)\)/.exec(rest)
        if (!found) break
        const inner = specificityOf(found[1])
        total[0] += inner[0]; total[1] += inner[1]; total[2] += inner[2]
        rest = rest.replace(found[0], '')
    }
    rest = rest.replace(/\[[^\]]*\]/g, () => { total[1]++; return '' })
    total[0] += (rest.match(/#[\w-]+/g) ?? []).length
    total[1] += (rest.match(/\.[\w-]+/g) ?? []).length + (rest.match(/(?<!:):(?!:)[\w-]+/g) ?? []).length
    total[2] += (rest.match(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length + (rest.match(/::[\w-]+/g) ?? []).length
    return total
}
function isReducedMedia(node: ChildNode | Rule['parent']): node is AtRule {
    return node?.type === 'atrule' && (node as AtRule).name === 'media' && /prefers-reduced-motion:\s*reduce/.test((node as AtRule).params)
}
function parseStylesheet(): { declared: Declared[], keyframes: Set<string> } {
    const source = readFileSync(path.resolve(process.cwd(), 'src/lib/ChatShell/ShellMessage.svelte'), 'utf8')
    const style = /<style>([\s\S]*?)<\/style>/.exec(source)![1]
    const declared: Declared[] = []
    const keyframes = new Set<string>()
    let order = 0
    postcss.parse(style).walk((node) => {
        if (node.type === 'atrule' && node.name.endsWith('keyframes')) keyframes.add(node.params.trim())
        if (node.type !== 'rule') return
        const parent = node.parent
        const osOnly = isReducedMedia(parent)
        if (parent && parent.type === 'atrule' && !osOnly) return
        let name: string | null = null
        let duration: string | null = null
        node.walkDecls((decl) => {
            if (decl.prop === 'animation') {
                const tokens = decl.value.match(/[^\s(]+(?:\([^)]*\))?/g) ?? []
                name = tokens[0] ?? null
                duration = tokens[1] ?? null
            } else if (decl.prop === 'animation-name') name = decl.value.trim()
            else if (decl.prop === 'animation-duration') duration = decl.value.trim()
        })
        order++
        if (name === null && duration === null) return
        for (const raw of node.selectors) {
            const selector = unwrapGlobal(raw)
            declared.push({ specificity: specificityOf(selector), order, name, duration, selector, osOnly })
        }
    })
    return { declared, keyframes }
}
const stylesheet = parseStylesheet()

function stronger(a: Declared, b: Declared): boolean {
    for (let i = 0; i < 3; i++) if (a.specificity[i] !== b.specificity[i]) return a.specificity[i] > b.specificity[i]
    return a.order > b.order
}
// The animation the stylesheet gives an element that is attached under the document element: the matching rule that wins by specificity, then by source order.
// The duration is the winning declaration of the duration, which a later rule may set on its own.
function commitAnimationOf(element: Element, options: { osReduced: boolean }): CommitAnimation | null {
    const matching = stylesheet.declared.filter((entry) => (!entry.osOnly || options.osReduced) && element.matches(entry.selector))
    let name: Declared | null = null
    let duration: Declared | null = null
    for (const entry of matching) {
        if (entry.name !== null && (name === null || stronger(entry, name))) name = entry
        if (entry.duration !== null && (duration === null || stronger(entry, duration))) duration = entry
    }
    return name === null ? null : { name: name.name!, durationRule: duration?.duration ?? null }
}

const FULL: MotionState = { lowPower: false, reducedMotion: 'off', systemReduced: false }
const REDUCED: MotionState = { lowPower: false, reducedMotion: 'on', systemReduced: false }
const LOW_POWER: MotionState = { lowPower: true, reducedMotion: 'system', systemReduced: false }
const NEUTRAL: MotionState = { lowPower: false, reducedMotion: 'system', systemReduced: false }
function setMotion(state: MotionState): void { applyMotionClasses(document.documentElement, state) }

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
const frames = new Map<number, () => void>()
let frameId = 0
let stepGate: Promise<void> | null = null
let postSwitchGate: Promise<void> | null = null
let refuseFirstStep = false
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0, alternateGreetings: ['Second'],
    chats: [{ id: 'room', message: [] as Message[], alt: [] as ChatAlt[] }] }) as unknown as Character

class FakeObserver {
    observe(): void {}
    disconnect(): void {}
}
function activeChat(): Chat { return character.chats[character.chatPage] }
// A chat of `length` messages m0.. where position `at` has a sibling chain of `siblingLength` records that departs from m{at-1}.
function seedChat(chat: Chat, length: number, at: number, siblingLength: number): void {
    chat.message = Array.from({ length }, (_, i): Message => ({ role: i % 2 === 0 ? 'user' : 'char', data: `m${i}`, chatId: `m${i}` }))
    chat.alt = Array.from({ length: siblingLength }, (_, k): ChatAlt => ({
        m: { role: (at + k) % 2 === 0 ? 'user' : 'char', data: `alt${k}`, chatId: `m${at}b${k}` },
        p: k === 0 ? `m${at - 1}` : `m${at}b${k - 1}`, a: 1,
    }))
}
// Three messages whose newest reply has one alternative; `current` 2 shows the alternative (reply 2 of 2), 1 shows the original (reply 1 of 2).
function seedNewestReply(current: 1 | 2): void {
    const chat = activeChat()
    seedChat(chat, 3, 2, 1)
    if (current === 2) switchTo(chat, 2, 'm2b0')
}
const view: TreeView = {
    at: (position) => {
        const chat = activeChat()
        const heads = siblingsAt(chat, position)
        if (heads.length < 2) return { index: 1, count: 1 }
        return { index: heads.findIndex((message) => message.chatId === chat.message[position]?.chatId) + 1, count: heads.length }
    },
    continuation: 0,
}
function articleAt(index: number): HTMLElement { return host.querySelector<HTMLElement>(`article[data-chat-index="${index}"]`)! }
function bodyOf(index: number): HTMLElement { return articleAt(index).querySelector<HTMLElement>('[data-part="chat-message-body"]')! }
function firstMessageBody(): HTMLElement { return host.querySelector<HTMLElement>('[data-part="chat-first-message"] [data-part="chat-message-body"]')! }
function runFrames(): void {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback() }
}
async function settle(): Promise<void> {
    flushSync()
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    runFrames()
    await tick()
    flushSync()
}
async function show(): Promise<void> {
    DBState.db.characters = [character]
    target = document.createElement('div')
    host = document.createElement('main')
    Object.defineProperty(host, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: 100, configurable: true })
    Object.defineProperty(host, 'scrollTop', { value: 0, writable: true, configurable: true })
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host, getTreeView: () => view } })
    await settle()
    frames.clear()
}
function pointer(kind: string, x: number, time: number, on: Element): void {
    const event = new MouseEvent(kind, { bubbles: true, clientX: x, clientY: 100 })
    Object.defineProperties(event, { pointerType: { value: 'touch' }, timeStamp: { value: time }, pointerId: { value: 1 } })
    on.dispatchEvent(event)
    flushSync()
}
// A touch drag over half the body's width, released: it commits the step. The returned element is the predecessor's body.
function swipeCommit(body: HTMLElement, from: number, to: number): HTMLElement {
    Object.defineProperty(body, 'clientWidth', { value: 300 })
    pointer('pointerdown', from, 0, body)
    pointer('pointermove', to, 100, body)
    pointer('pointerup', to, 200, body)
    return body
}
async function fillBody(body: HTMLElement): Promise<void> {
    const reply = document.createElement('p')
    reply.textContent = 'reply'
    body.append(reply)
    await settle()
}
function tapStep(index: number, which: 'prev' | 'next'): void {
    articleAt(index).querySelector<HTMLButtonElement>(`[data-step="${which}"]`)!.click()
    flushSync()
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frameId += 1; frames.set(frameId, callback); return frameId })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true, writable: true })
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
    frames.clear(); stepGate = null; postSwitchGate = null; refuseFirstStep = false
    bodyAtMount.on = false
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }))
    character.chatPage = 0
    stepSibling.mockImplementation(async (_source: unknown, index: number, _id: string | undefined, direction: 'back' | 'forward') => {
        if (stepGate) await stepGate
        if (refuseFirstStep) { refuseFirstStep = false; return }
        const chat = character.chats[0]
        const heads = siblingsAt(chat, index)
        const at = heads.findIndex((message) => message.chatId === chat.message[index]?.chatId)
        const head = heads[at + (direction === 'forward' ? 1 : -1)]
        if (head?.chatId) switchTo(chat, index, head.chatId)
        if (postSwitchGate) {
            const gate = postSwitchGate
            postSwitchGate = null
            await gate
        }
    })
})
afterEach(async () => {
    vi.useRealTimers()
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    setMotion(NEUTRAL)
    delete (window as { matchMedia?: unknown }).matchMedia
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    surface.installed = false
    chatSurface.hidden = false
    chatSurface.rebuildEpoch = 0
    stepSibling.mockReset(); regenerateNewest.mockClear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('G-W4-HELPER the stylesheet reader answers differently for different root conditions', () => {
    // COMPATIBILITY GUARD: a reader that returned one fixed answer would make every reproducer below vacuous.
    function attachedBody(commit?: 'back' | 'forward'): HTMLElement {
        const body = document.createElement('div')
        body.setAttribute('data-part', 'chat-message-body')
        if (commit) body.setAttribute('data-commit', commit)
        document.body.appendChild(body)
        return body
    }
    afterEach(() => { document.querySelectorAll('body > [data-part="chat-message-body"]').forEach((element) => element.remove()) })
    test('without data-commit nothing animates', () => {
        const body = attachedBody()
        expect(commitAnimationOf(body, { osReduced: false })).toBeNull()
        setMotion(REDUCED)
        expect(commitAnimationOf(body, { osReduced: false })).toBeNull()
    })
    test('with no motion class the base rule gives the directional animation', () => {
        expect(commitAnimationOf(attachedBody('back'), { osReduced: false })).toEqual({ name: 'commit-in-back', durationRule: 'var(--chat-dur-base)' })
        expect(commitAnimationOf(attachedBody('forward'), { osReduced: false })).toEqual({ name: 'commit-in-forward', durationRule: 'var(--chat-dur-base)' })
    })
    test('the rm class gives the fade, and the OS query alone gives it only when the query is reported', () => {
        const body = attachedBody('back')
        setMotion(REDUCED)
        expect(commitAnimationOf(body, { osReduced: false })).toEqual({ name: 'commit-fade', durationRule: 'var(--chat-dur-fast)' })
        setMotion(NEUTRAL)
        expect(commitAnimationOf(body, { osReduced: true })).toEqual({ name: 'commit-fade', durationRule: 'var(--chat-dur-fast)' })
        expect(commitAnimationOf(body, { osReduced: false })).toEqual({ name: 'commit-in-back', durationRule: 'var(--chat-dur-base)' })
        setMotion(FULL)
        expect(commitAnimationOf(body, { osReduced: true })).toEqual({ name: 'commit-in-back', durationRule: 'var(--chat-dur-base)' })
    })
    test('low power keeps the directional animation and caps its duration', () => {
        const body = attachedBody('forward')
        setMotion(LOW_POWER)
        expect(commitAnimationOf(body, { osReduced: false })).toEqual({ name: 'commit-in-forward', durationRule: 'var(--dur-lowpower-cap)' })
    })
    test('reduced motion and low power together keep the fade and take the capped duration, the later rule of equal specificity', () => {
        const body = attachedBody('back')
        setMotion({ lowPower: true, reducedMotion: 'on', systemReduced: false })
        expect(commitAnimationOf(body, { osReduced: false })).toEqual({ name: 'commit-fade', durationRule: 'var(--dur-lowpower-cap)' })
    })
    test('the keyframes the rules name are defined', () => {
        for (const name of ['commit-fade', 'commit-in-forward', 'commit-in-back']) expect(stylesheet.keyframes.has(name), name).toBe(true)
    })
})

describe('a committed swipe under reduced motion fades the successor', () => {
    test('T-W4-RM the new body carries data-commit once rendered and the stylesheet gives it the fade', async () => {
        setMotion(REDUCED)
        seedNewestReply(2)
        await show()
        const before = swipeCommit(bodyOf(2), 100, 250)
        await settle()
        const after = bodyOf(2)
        expect(activeChat().message[2].chatId).toBe('m2')
        expect(after).not.toBe(before)
        expect(before.isConnected).toBe(false)
        await fillBody(after)
        expect(after.getAttribute('data-commit')).toBe('back')
        expect(commitAnimationOf(after, { osReduced: false })).toEqual({ name: 'commit-fade', durationRule: 'var(--chat-dur-fast)' })
    })
    test('T-W4-OS the OS query alone selects the same fade', async () => {
        const reportOsReduced = (query: string): Partial<MediaQueryList> => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener: () => {}, removeEventListener: () => {} })
        Object.defineProperty(window, 'matchMedia', { value: reportOsReduced, configurable: true, writable: true })
        seedNewestReply(2)
        await show()
        const before = swipeCommit(bodyOf(2), 100, 250)
        await settle()
        const after = bodyOf(2)
        expect(after).not.toBe(before)
        await fillBody(after)
        expect(after.getAttribute('data-commit')).toBe('back')
        expect(commitAnimationOf(after, { osReduced: true })).toEqual({ name: 'commit-fade', durationRule: 'var(--chat-dur-fast)' })
    })
    test('T-W4-LATE no fade is applied before the body has rendered, and it is applied when it renders', async () => {
        setMotion(REDUCED)
        seedNewestReply(2)
        await show()
        swipeCommit(bodyOf(2), 100, 250)
        await settle()
        const after = bodyOf(2)
        expect(after.hasAttribute('data-commit')).toBe(false)
        expect(commitAnimationOf(after, { osReduced: false })).toBeNull()
        await fillBody(after)
        expect(after.getAttribute('data-commit')).toBe('back')
    })
    test('T-W4-NOW a body that renders at mount fades at once', async () => {
        setMotion(REDUCED)
        bodyAtMount.on = true
        seedNewestReply(2)
        await show()
        swipeCommit(bodyOf(2), 100, 250)
        await settle()
        expect(bodyOf(2).getAttribute('data-commit')).toBe('back')
    })
})

describe('a committed swipe under low power keeps the directional animation on the successor', () => {
    test('T-W4-LP data-commit back, commit-in-back and the low-power duration cap', async () => {
        setMotion(LOW_POWER)
        seedNewestReply(2)
        await show()
        const before = swipeCommit(bodyOf(2), 100, 250)
        await settle()
        const after = bodyOf(2)
        expect(after).not.toBe(before)
        expect(before.isConnected).toBe(false)
        await fillBody(after)
        expect(after.getAttribute('data-commit')).toBe('back')
        expect(commitAnimationOf(after, { osReduced: false })).toEqual({ name: 'commit-in-back', durationRule: 'var(--dur-lowpower-cap)' })
    })
    test('T-W4-DIR a left swipe commits forward and the successor gets commit-in-forward', async () => {
        setMotion(LOW_POWER)
        seedNewestReply(1)
        await show()
        swipeCommit(bodyOf(2), 400, 250)
        await settle()
        expect(activeChat().message[2].chatId).toBe('m2b0')
        const after = bodyOf(2)
        await fillBody(after)
        expect(after.getAttribute('data-commit')).toBe('forward')
        expect(commitAnimationOf(after, { osReduced: false })).toEqual({ name: 'commit-in-forward', durationRule: 'var(--dur-lowpower-cap)' })
    })
})

describe('the handover window', () => {
    // The window is measured on the page clock; the tests move it by hand.
    let clock = 5000
    beforeEach(() => {
        clock = 5000
        vi.spyOn(performance, 'now').mockImplementation(() => clock)
    })
    test('T-W4-WINDOW-MOUNT a successor that mounts after the window gets no fade even with a rendered body', async () => {
        setMotion(REDUCED)
        bodyAtMount.on = true
        seedNewestReply(2)
        await show()
        let release: () => void = () => {}
        stepGate = new Promise<void>((resolve) => { release = resolve })
        swipeCommit(bodyOf(2), 100, 250)
        clock += 1600
        release()
        await settle()
        expect(activeChat().message[2].chatId).toBe('m2')
        expect(bodyOf(2).textContent).toBe('Reply')
        expect(bodyOf(2).hasAttribute('data-commit')).toBe(false)
    })
    test('T-W4-WINDOW-LATE a body that renders after the window gets no fade', async () => {
        setMotion(REDUCED)
        seedNewestReply(2)
        await show()
        swipeCommit(bodyOf(2), 100, 250)
        await settle()
        const after = bodyOf(2)
        clock += 1600
        await fillBody(after)
        expect(after.hasAttribute('data-commit')).toBe(false)
    })
    test('T-W4-WINDOW-EDGE a body that renders inside the window still fades', async () => {
        setMotion(REDUCED)
        seedNewestReply(2)
        await show()
        swipeCommit(bodyOf(2), 100, 250)
        await settle()
        const after = bodyOf(2)
        clock += 1400
        await fillBody(after)
        expect(after.getAttribute('data-commit')).toBe('back')
    })
})

describe('the wait for the successor body ends cleanly', () => {
    // The observers that are watching, by the element they watch.
    const watching = new Set<{ target: Node | null }>()
    class RecordingObserver extends MutationObserver {
        target: Node | null = null
        override observe(target: Node, options?: MutationObserverInit): void {
            this.target = target
            watching.add(this)
            super.observe(target, options)
        }
        override disconnect(): void {
            watching.delete(this)
            super.disconnect()
        }
    }
    const watchersOf = (element: Element): number => [...watching].filter((observer) => observer.target === element).length
    beforeEach(() => {
        watching.clear()
        vi.stubGlobal('MutationObserver', RecordingObserver)
    })
    test('T-W4-DISCONNECT the observer watches the empty successor and is gone once the body has rendered', async () => {
        setMotion(REDUCED)
        seedNewestReply(2)
        await show()
        swipeCommit(bodyOf(2), 100, 250)
        await settle()
        const after = bodyOf(2)
        expect(watchersOf(after)).toBe(1)
        await fillBody(after)
        expect(after.getAttribute('data-commit')).toBe('back')
        expect(watchersOf(after)).toBe(0)
    })
    test('T-W4-DESTROY the observer is gone when the row goes away before its body renders', async () => {
        setMotion(REDUCED)
        seedNewestReply(2)
        await show()
        swipeCommit(bodyOf(2), 100, 250)
        await settle()
        const after = bodyOf(2)
        expect(watchersOf(after)).toBe(1)
        await unmount(app!)
        app = undefined
        expect(watchersOf(after)).toBe(0)
    })
    test('T-W4-TIMEOUT the observer is gone when the window ends with the body still empty', async () => {
        setMotion(REDUCED)
        seedNewestReply(2)
        await show()
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
            swipeCommit(bodyOf(2), 100, 250)
            await tick()
            await vi.advanceTimersByTimeAsync(0)
            flushSync()
            const after = bodyOf(2)
            expect(watchersOf(after)).toBe(1)
            await vi.advanceTimersByTimeAsync(1600)
            expect(watchersOf(after)).toBe(0)
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('a handover is taken once', () => {
    test('T-W4-ONCE a second step at the same position, while the first act is still pending, gets no fade', async () => {
        setMotion(REDUCED)
        const chat = activeChat()
        seedChat(chat, 3, 2, 1)
        chat.alt!.push({ m: { role: 'char', data: 'alt2', chatId: 'm2c0' }, p: 'm1', a: 1 })
        const order = siblingsAt(chat, 2).map((message) => message.chatId!)
        expect(order).toHaveLength(3)
        switchTo(chat, 2, order[2])
        await show()
        // The first step switches the chain and then stays pending, so the swipe's act has not settled when the successor is already mounted.
        let finish: () => void = () => {}
        postSwitchGate = new Promise<void>((resolve) => { finish = resolve })
        swipeCommit(bodyOf(2), 100, 250)
        await settle()
        expect(activeChat().message[2].chatId).toBe(order[1])
        tapStep(2, 'prev')
        await settle()
        expect(activeChat().message[2].chatId).toBe(order[0])
        const third = bodyOf(2)
        await fillBody(third)
        expect(third.hasAttribute('data-commit')).toBe(false)
        finish()
        await settle()
    })
})

describe('only the row that replaces the stepped one takes the fade', () => {
    test('T-W4-OTHER-ROWS rows of a longer chain mounted by the same step at other positions get none', async () => {
        setMotion(REDUCED)
        seedChat(activeChat(), 6, 2, 3)
        await show()
        // Reply 1 of 2 at position 2; the alternative chain is three messages long, so the step mounts rows 4 and 3 as well as 2.
        swipeCommit(bodyOf(2), 400, 250)
        await settle()
        expect(activeChat().message.length).toBe(5)
        for (const index of [4, 3, 2]) await fillBody(bodyOf(index))
        expect(bodyOf(2).getAttribute('data-commit')).toBe('forward')
        expect(bodyOf(3).hasAttribute('data-commit')).toBe(false)
        expect(bodyOf(4).hasAttribute('data-commit')).toBe(false)
    })
})

describe('no fade where none is specified', () => {
    test('G-W4-FULL full motion slides out and the successor has no commit fade', async () => {
        setMotion(FULL)
        seedNewestReply(2)
        await show()
        const before = swipeCommit(bodyOf(2), 100, 250)
        // The slide-out lands the step after the nominal settle time.
        await new Promise((resolve) => setTimeout(resolve, 400))
        await settle()
        const after = bodyOf(2)
        expect(after).not.toBe(before)
        expect(activeChat().message[2].chatId).toBe('m2')
        await fillBody(after)
        expect(after.hasAttribute('data-commit')).toBe(false)
        expect(commitAnimationOf(after, { osReduced: false })).toBeNull()
    })
    test('G-W4-TAP an arrow tap under reduced motion steps instantly: no fade on the successor', async () => {
        setMotion(REDUCED)
        seedNewestReply(2)
        await show()
        const before = bodyOf(2)
        tapStep(2, 'prev')
        await settle()
        const after = bodyOf(2)
        expect(activeChat().message[2].chatId).toBe('m2')
        expect(after).not.toBe(before)
        await fillBody(after)
        expect(after.hasAttribute('data-commit')).toBe(false)
        expect(commitAnimationOf(after, { osReduced: false })).toBeNull()
    })
    test('G-W4-TAP-LP an arrow tap under low power gives no animation either', async () => {
        setMotion(LOW_POWER)
        seedNewestReply(2)
        await show()
        tapStep(2, 'prev')
        await settle()
        const after = bodyOf(2)
        await fillBody(after)
        expect(after.hasAttribute('data-commit')).toBe(false)
    })
    test('G-W4-REFUSED a step that mounts nothing leaves no handover for a later row', async () => {
        setMotion(REDUCED)
        seedNewestReply(2)
        await show()
        refuseFirstStep = true
        const stayed = swipeCommit(bodyOf(2), 100, 250)
        await settle()
        // The row did not remount: its own body carries the fade.
        expect(bodyOf(2)).toBe(stayed)
        expect(stayed.getAttribute('data-commit')).toBe('back')
        expect(activeChat().message[2].chatId).toBe('m2b0')
        tapStep(2, 'prev')
        await settle()
        const after = bodyOf(2)
        expect(after).not.toBe(stayed)
        expect(activeChat().message[2].chatId).toBe('m2')
        await fillBody(after)
        expect(after.hasAttribute('data-commit')).toBe(false)
    })
    test('G-W4-FIRST the first message never remounts and carries its own fade', async () => {
        setMotion(REDUCED)
        seedNewestReply(2)
        await show()
        const first = firstMessageBody()
        expect(first).not.toBeNull()
        swipeCommit(first, 400, 250)
        await settle()
        expect(firstMessageBody()).toBe(first)
        expect(first.getAttribute('data-commit')).toBe('forward')
        // A reply row stepping later gets nothing from it.
        tapStep(2, 'prev')
        await settle()
        const after = bodyOf(2)
        await fillBody(after)
        expect(after.hasAttribute('data-commit')).toBe(false)
    })
})

describe('a rebuild while the step is pending', () => {
    test('T-W4-REBUILD the remounted same-key row does not take the handover; the real successor does', async () => {
        setMotion(REDUCED)
        surface.installed = true
        seedNewestReply(2)
        await show()
        let release: () => void = () => {}
        stepGate = new Promise<void>((resolve) => { release = resolve })
        const before = swipeCommit(bodyOf(2), 100, 250)
        await settle()
        chatSurface.rebuildEpoch += 1
        await settle()
        const remounted = bodyOf(2)
        expect(remounted).not.toBe(before)
        expect(activeChat().message[2].chatId).toBe('m2b0')
        await fillBody(remounted)
        expect(remounted.hasAttribute('data-commit')).toBe(false)
        release()
        await settle()
        expect(activeChat().message[2].chatId).toBe('m2')
        const after = bodyOf(2)
        await fillBody(after)
        expect(after.getAttribute('data-commit')).toBe('back')
    })
})

describe('a list that is not active', () => {
    // The step runs without the list's hold while the surface is hidden, so the act settles without the tick that follows a hold and the rows are not re-rendered until the surface shows again.
    test('T-W4-INACTIVE the handover does not outlive its step: a row mounted after the surface returns gets no fade', async () => {
        setMotion(REDUCED)
        surface.installed = true
        seedNewestReply(2)
        await show()
        chatSurface.hidden = true
        flushSync()
        const before = swipeCommit(bodyOf(2), 100, 250)
        await settle()
        expect(activeChat().message[2].chatId).toBe('m2')
        expect(bodyOf(2)).toBe(before)
        chatSurface.hidden = false
        await settle()
        const after = bodyOf(2)
        expect(after).not.toBe(before)
        await fillBody(after)
        expect(after.hasAttribute('data-commit')).toBe(false)
    })
})

describe('CHORE-736 the reduced-motion commit mark on the successor', () => {
    const MARK = '[data-part="chat-swipe-commit-mark"]'
    function markOf(index: number): HTMLElement | null { return articleAt(index).querySelector<HTMLElement>(MARK) }
    // REPRODUCER (R-D11-SUCC): the mark belongs to the row that stays in the document after the step remounts the row.
    test('R-D11-SUCC a committed swipe under reduced motion shows the mark on the successor row once its body has rendered', async () => {
        setMotion(REDUCED)
        seedNewestReply(2)
        await show()
        const before = swipeCommit(bodyOf(2), 100, 250)
        await settle()
        const after = bodyOf(2)
        expect(after).not.toBe(before)
        expect(markOf(2)).toBeNull()
        await fillBody(after)
        expect(after.getAttribute('data-commit')).toBe('back')
        expect(markOf(2)).not.toBeNull()
    })
    // REPRODUCER (R-D11-OS): the OS query alone selects the mark, like the fade.
    test('R-D11-OS the OS query alone shows the mark', async () => {
        const reportOsReduced = (query: string): Partial<MediaQueryList> => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener: () => {}, removeEventListener: () => {} })
        Object.defineProperty(window, 'matchMedia', { value: reportOsReduced, configurable: true, writable: true })
        seedNewestReply(2)
        await show()
        swipeCommit(bodyOf(2), 100, 250)
        await settle()
        await fillBody(bodyOf(2))
        expect(markOf(2)).not.toBeNull()
    })
    // COMPATIBILITY GUARD (G-D11-FULL): passes before and after.
    test('G-D11-FULL full motion has no mark on the successor', async () => {
        setMotion(FULL)
        seedNewestReply(2)
        await show()
        swipeCommit(bodyOf(2), 100, 250)
        await new Promise((resolve) => setTimeout(resolve, 400))
        await settle()
        await fillBody(bodyOf(2))
        expect(markOf(2)).toBeNull()
    })
    // COMPATIBILITY GUARD (G-D11-LP): passes before and after; low power keeps its directional animation and gets no mark.
    test('G-D11-LP low power without reduced motion has no mark on the successor', async () => {
        setMotion(LOW_POWER)
        seedNewestReply(2)
        await show()
        swipeCommit(bodyOf(2), 100, 250)
        await settle()
        await fillBody(bodyOf(2))
        expect(bodyOf(2).getAttribute('data-commit')).toBe('back')
        expect(markOf(2)).toBeNull()
    })
    // COMPATIBILITY GUARD (G-D11-RMOFF): passes before and after; the app setting Off wins over the OS preference, so a bare query must not show the mark.
    test('G-D11-RMOFF reduced motion off with the OS reducing motion has no mark', async () => {
        const reportOsReduced = (query: string): Partial<MediaQueryList> => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener: () => {}, removeEventListener: () => {} })
        Object.defineProperty(window, 'matchMedia', { value: reportOsReduced, configurable: true, writable: true })
        setMotion({ lowPower: true, reducedMotion: 'off', systemReduced: true })
        seedNewestReply(2)
        await show()
        swipeCommit(bodyOf(2), 100, 250)
        await settle()
        await fillBody(bodyOf(2))
        expect(bodyOf(2).getAttribute('data-commit')).toBe('back')
        expect(markOf(2)).toBeNull()
    })
    // COMPATIBILITY GUARD (G-D11-KEYS): passes before and after; a pager tap steps with no mark.
    test('G-D11-KEYS a pager tap under reduced motion shows no mark', async () => {
        setMotion(REDUCED)
        seedNewestReply(2)
        await show()
        tapStep(2, 'prev')
        await settle()
        await fillBody(bodyOf(2))
        expect(markOf(2)).toBeNull()
    })
})
