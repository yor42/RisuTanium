// @vitest-environment jsdom

/**
 * The Utility screen and its Home card. (R) = regression reproducer: fails when the rule it names is removed;
 * (G) = guard that pins the new format and may pass before and after.
 *
 * REAL: the screen, the editor, the form components, the conversation engine, the run registry, the page-mode store
 * and `MainMenu.svelte`. MOCKED: the model request, the desktop-transport probe (so Android and web can be simulated),
 * the confirm dialog, `downloadFile`, `DBState` (a `$state` object, as the page holds it), the hub fetch and the realm
 * view. The native desktop probe is not exercised.
 */
import { flushSync, mount, unmount, type Component } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({
    desktop: true,
    request: vi.fn(),
    confirm: vi.fn(async (_message: string) => true),
    download: vi.fn(),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({
        db: { hideRealm: true, realmDirectOpen: false, hideAllImages: false } as unknown as Database,
    })
    return {
        DBState: state,
        OpenRealmStore: writable(false),
        RealmInitialOpenChar: writable(null),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: vi.fn(async () => ({ ok: true, cards: [], additionalHTML: '' })),
}) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getVersionString: vi.fn(() => 'test-version'),
    openURL: vi.fn(),
    downloadFile: h.download,
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriByteTransport')>()),
    isDesktopTransport: () => h.desktop,
}))
vi.mock('src/ts/process/request/request', () => ({ requestChatDataMain: h.request }))
vi.mock('src/ts/alert', () => ({ alertConfirm: h.confirm }))
vi.mock('src/ts/model/modellist', async () => {
    const types = await import('src/ts/model/types')
    return {
        LLMFormat: types.LLMFormat,
        getModelInfo: (id: string) => ({
            id,
            format: id.startsWith('pluginmodel:::') ? types.LLMFormat.Plugin : types.LLMFormat.OpenAICompatible,
        }),
    }
})
vi.mock('../UI/Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('../UI/ModelList.svelte', () => ({
    default: (_anchor: unknown) => {},
}))

import { language } from 'src/lang'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { newUtilityConversation, utilityConversation } from 'src/ts/process/utility/utilityConversation.svelte'
import { DBState } from 'src/ts/stores.svelte'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import MainMenu from '../UI/MainMenu.svelte'
import UtilityScreen, { utilityMarkdown } from './UtilityScreen.svelte'
import { utilityOpen } from './utilityGate'

const mounted: Array<{ instance: object, target: HTMLElement }> = []

function open(component: Component): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(component, { target, props: {} })
    mounted.push({ instance, target })
    flushSync()
    return target
}

function seed(presets: Array<Record<string, unknown>>) {
    DBState.db = {
        hideRealm: true,
        realmDirectOpen: false,
        hideAllImages: false,
        taskPresets: presets,
        customAPIFormat: 0,
        useInstructPrompt: false,
    } as never
}

const GOOD = { id: 'p1', name: 'Fixer', instructions: 'Fix it.', model: 'gpt4o' }

function byId<T extends HTMLElement>(root: HTMLElement, testId: string): T {
    const found = root.querySelector<T>(`[data-testid="${testId}"]`)
    if (!found) {
        throw new Error(`no element ${testId}`)
    }
    return found
}

function buttonWithText(root: HTMLElement, text: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll('button')).find((button) => button.textContent?.trim() === text)
    if (!found) {
        throw new Error(`no button "${text}"`)
    }
    return found
}

async function pickAndSend(root: HTMLElement, text: string) {
    const select = root.querySelector<HTMLSelectElement>('select')!
    select.value = 'p1'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    const input = byId<HTMLTextAreaElement>(root, 'utility-input')
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    buttonWithText(root, language.utility.send).click()
    flushSync()
}

function streamOf(chunks: Array<Record<string, string>>, hold: Promise<void>): ReadableStream<Record<string, string>> {
    let index = 0
    return new ReadableStream({
        async pull(controller) {
            if (index < chunks.length) {
                controller.enqueue(chunks[index])
                index += 1
                return
            }
            await hold
            controller.close()
        },
    })
}

beforeEach(async () => {
    h.desktop = true
    h.request.mockReset()
    h.confirm.mockReset()
    h.confirm.mockResolvedValue(true)
    h.download.mockReset()
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    resetPageStorageModeForTests()
    seed([GOOD])
    setPageStorageMode({ kind: 'store2' })
    await newUtilityConversation(async () => true)
    utilityOpen.set(false)
})

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    resetPageStorageModeForTests()
})

describe('the Home card follows the desktop transport and the page mode', () => {
    test('(R) T30: absent while the mode is unset, present on store2, absent again on read-only', () => {
        resetPageStorageModeForTests()
        const root = open(MainMenu)
        expect(root.querySelector('[data-testid="utility-card"]')).toBeNull()

        setPageStorageMode({ kind: 'store2' })
        flushSync()
        expect(root.querySelector('[data-testid="utility-card"]')).not.toBeNull()

        setPageStorageMode({ kind: 'read-only', reason: 'too-new', source: 'manifest' } as never)
        flushSync()
        expect(root.querySelector('[data-testid="utility-card"]')).toBeNull()
    })

    test('(R) a non-store2 page shows no card', () => {
        for (const kind of ['legacy', 'block'] as const) {
            setPageStorageMode(kind === 'legacy' ? { kind: 'legacy', convertedFrom: null } : { kind: 'block' })
            const root = open(MainMenu)
            expect(root.querySelector('[data-testid="utility-card"]'), kind).toBeNull()
        }
    })

    test('(R) M14: Android, hosted web and Node show no card even on store2', () => {
        h.desktop = false
        const root = open(MainMenu)
        expect(root.querySelector('[data-testid="utility-card"]')).toBeNull()
    })

    test('(R) clicking the card opens the Utility screen', () => {
        const root = open(MainMenu)
        byId<HTMLButtonElement>(root, 'utility-card').click()
        expect(get(utilityOpen)).toBe(true)
    })
})

describe('sending, stopping and errors', () => {
    test('(R) a reply is shown as plain text and never as markup', async () => {
        const reply = '<img src=x onerror="window.pwned=1"> <b>bold</b>'
        h.request.mockResolvedValue({ type: 'success', result: reply })
        const root = open(UtilityScreen)

        await pickAndSend(root, 'hello')
        await vi.waitFor(() => expect(utilityConversation.runId).toBeNull())
        flushSync()

        const texts = Array.from(root.querySelectorAll('[data-testid="utility-turn-text"]'))
        expect(texts.map((node) => node.textContent)).toEqual(['hello', reply])
        expect(root.querySelector('[data-testid="utility-turns"] img')).toBeNull()
        expect(root.querySelector('[data-testid="utility-turns"] b')).toBeNull()
    })

    test('(R) a stopped reply keeps its partial text and says it was stopped', async () => {
        let release!: () => void
        const hold = new Promise<void>((resolve) => { release = resolve })
        h.request.mockResolvedValue({ type: 'streaming', result: streamOf([{ '0': 'par' }, { '0': 'partial' }], hold) })
        const root = open(UtilityScreen)

        await pickAndSend(root, 'hello')
        await vi.waitFor(() => {
            flushSync()
            expect(root.textContent).toContain('partial')
        })
        buttonWithText(root, language.utility.stop).click()
        await vi.waitFor(() => expect(utilityConversation.runId).toBeNull())
        release()
        flushSync()

        expect(byId(root, 'utility-turn-stopped').textContent).toBe(language.utility.stopped)
        expect(root.textContent).toContain('partial')
        expect(buttonWithText(root, language.utility.send)).toBeTruthy()
    })

    test('(R) a provider failure shows inline on the turn', async () => {
        h.request.mockResolvedValue({ type: 'fail', result: 'rate limited' })
        const root = open(UtilityScreen)

        await pickAndSend(root, 'hello')
        await vi.waitFor(() => expect(utilityConversation.runId).toBeNull())
        flushSync()

        expect(byId(root, 'utility-turn-error').textContent).toContain('rate limited')
    })

    test('(R) a refusal shows inline on the turn', async () => {
        seed([{ ...GOOD, model: 'pluginmodel:::x' }])
        const root = open(UtilityScreen)

        await pickAndSend(root, 'hello')
        await vi.waitFor(() => expect(utilityConversation.runId).toBeNull())
        flushSync()

        expect(byId(root, 'utility-turn-error').textContent).toContain('plugin')
        expect(h.request).not.toHaveBeenCalled()
    })

    test('(R) a damaged preset shows the notice and cannot be sent', () => {
        seed([{ ...GOOD, temperature: 9 }])
        const root = open(UtilityScreen)
        const select = root.querySelector<HTMLSelectElement>('select')!
        select.value = 'p1'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        const input = byId<HTMLTextAreaElement>(root, 'utility-input')
        input.value = 'hello'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()

        expect(byId(root, 'utility-damaged-preset').textContent).toContain(language.utility.damagedPreset)
        expect(buttonWithText(root, language.utility.send).disabled).toBe(true)
        expect(h.request).not.toHaveBeenCalled()
    })

    test('(G) with no presets the screen says so', () => {
        seed([])
        const root = open(UtilityScreen)
        expect(byId(root, 'utility-no-presets').textContent).toBe(language.utility.noPresets)
    })
})

describe('New, Copy and Save', () => {
    test('(R) New asks first when there are turns, and clears them when confirmed', async () => {
        h.request.mockResolvedValue({ type: 'success', result: 'fixed' })
        const root = open(UtilityScreen)
        await pickAndSend(root, 'hello')
        await vi.waitFor(() => expect(utilityConversation.runId).toBeNull())
        flushSync()

        h.confirm.mockResolvedValueOnce(false)
        buttonWithText(root, language.utility.newConversation).click()
        await vi.waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1))
        expect(utilityConversation.turns).toHaveLength(2)

        buttonWithText(root, language.utility.newConversation).click()
        await vi.waitFor(() => expect(utilityConversation.turns).toHaveLength(0))
    })

    test('(R) Copy as Markdown writes the transcript to the clipboard', async () => {
        h.request.mockResolvedValue({ type: 'success', result: 'fixed' })
        const writeText = vi.fn(async (_text: string) => {})
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
        const root = open(UtilityScreen)
        await pickAndSend(root, 'hello')
        await vi.waitFor(() => expect(utilityConversation.runId).toBeNull())
        flushSync()

        buttonWithText(root, language.utility.copyMarkdown).click()
        await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))

        expect(writeText.mock.calls[0][0]).toBe(utilityMarkdown('Fixer', utilityConversation.turns))
        expect(writeText.mock.calls[0][0]).toContain('fixed')
    })

    test('(R) Save as .md downloads the transcript under the .md name', async () => {
        h.request.mockResolvedValue({ type: 'success', result: 'fixed' })
        const root = open(UtilityScreen)
        await pickAndSend(root, 'hello')
        await vi.waitFor(() => expect(utilityConversation.runId).toBeNull())
        flushSync()

        buttonWithText(root, language.utility.saveMarkdown).click()
        await vi.waitFor(() => expect(h.download).toHaveBeenCalledTimes(1))

        expect(h.download.mock.calls[0][0]).toBe('utility-conversation.md')
        expect(h.download.mock.calls[0][1]).toContain('fixed')
    })

    test('(G) T32: the Markdown format', () => {
        const markdown = utilityMarkdown('Fixer', [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'partial', state: 'stopped' },
            { role: 'user', content: 'again' },
            { role: 'assistant', content: '', state: 'failed', error: 'boom' },
            { role: 'assistant', content: '', state: 'streaming' },
        ])

        expect(markdown).toBe([
            '# Utility conversation: Fixer',
            '## You\n\nhi',
            '## Assistant\n\npartial\n\n_(stopped)_',
            '## You\n\nagain',
            '## Assistant\n\n_Failed: boom_',
        ].join('\n\n') + '\n')
    })
})
