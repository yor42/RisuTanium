// @vitest-environment jsdom

/**
 * The model tab's Claude key box holds one key per row. Mounts the REAL `BotSettings.svelte` on its
 * model tab over a real `$state` database with the model list stubbed to the Anthropic provider.
 * Values assigned to the input are the ones an engine settles on after a user insertion (a line
 * break becomes one space); a line break is never put into a jsdom value. Fixture events do not
 * bubble.
 *
 * MOCKED: `alert`, `stores.svelte`, `globalApi.svelte`, `secretKey`, `platform` (a web build), `util`,
 * `tokenizer`, `plugins.svelte`, the model-list modules, and every child component that is not
 * part of the key box.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = { alertStore: writable({ type: 'none', msg: '' }) }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        openPresetList: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/process/request/secretKey'), () => ({
    currentKey: vi.fn(() => ''),
    currentKeyForUi: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/process/request/secretKey'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/tokenizer'), () => ({
    tokenizeAccurate: vi.fn(async () => 0),
    tokenizerList: [],
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    customProviderStore: writable([]),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/model/openrouter'), () => ({
    getOpenRouterModels: vi.fn(async () => []),
    toModelGridItem: vi.fn(),
}) as unknown as typeof import('src/ts/model/openrouter'))

vi.mock(import('src/ts/model/nanogpt'), () => ({
    getNanoGPTModels: vi.fn(async () => []),
    getNanoGPTSubscriptionModels: vi.fn(async () => []),
    toModelGridItem: vi.fn(),
}) as unknown as typeof import('src/ts/model/nanogpt'))

vi.mock(import('src/ts/model/ollama'), () => ({
    getOllamaModels: vi.fn(async () => []),
}) as unknown as typeof import('src/ts/model/ollama'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ name: 'stub', flags: [], provider: 1, format: -1 })),
    LLMFlags: {},
    LLMFormat: {},
    LLMProvider: { Anthropic: 1 },
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/model/types'), () => ({
    resolveClaudeThinkingType: vi.fn((_flags: unknown, current: unknown) => current),
}) as unknown as typeof import('src/ts/model/types'))

vi.mock(import('src/ts/setting/botSettingsParamsData'), () => ({
    allBasicParameterItems: [],
}) as unknown as typeof import('src/ts/setting/botSettingsParamsData'))

vi.mock('src/lib/Others/Help.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/ModelList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SideBars/DropList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/ModelGrid.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/NanoGPTDashboard.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/NanoGPTProviderPicker.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/Accordion.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SideBars/Scripts/RegexList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/SettingRenderer.svelte', () => ({ default: () => {} }))
vi.mock('./OobaSettings.svelte', () => ({ default: () => {} }))
vi.mock('./OpenrouterSettings.svelte', () => ({ default: () => {} }))
vi.mock('./ChatFormatSettings.svelte', () => ({ default: () => {} }))
vi.mock('./PromptSettings.svelte', () => ({ default: () => {} }))
vi.mock('./SeparateParametersSection.svelte', () => ({ default: () => {} }))
vi.mock('./Model/AuxModelSelectors.svelte', () => ({ default: () => {} }))
vi.mock('./Model/ModelDataRefresh.svelte', () => ({ default: () => {} }))

import { DBState } from 'src/ts/stores.svelte'
import BotSettings from './BotSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountPage(hideApiKey: boolean): HTMLElement {
    DBState.db = {
        useLegacyGUI: false,
        aiModel: 'stub',
        subModel: 'stub',
        hideApiKey,
        nanogptRequestModel: '',
        nanogptRequestModelName: '',
        nanogptUseSubscriptionEndpoint: false,
        nanogptKey: '',
        thinkingType: '',
        mainPrompt: '',
        jailbreak: '',
        globalNote: '',
        textgenWebUIStreamURL: '',
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(BotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

/** The key the Claude connection holds; the field writes through the connection, never a legacy root field. */
function claudeKey(): string | undefined {
    return DBState.db.connections?.find((conn) => conn.provider === 'anthropic')?.key
}

function seedClaudeKey(key: string): void {
    DBState.db.connections = [{ id: 'conn-1', name: 'Claude', provider: 'anthropic', key }]
}

function keyInputs(target: HTMLElement, hideApiKey = true): HTMLInputElement[] {
    const selector = hideApiKey ? 'input[type=password]' : 'input[type=text]'
    return Array.from(target.querySelectorAll<HTMLInputElement>(selector))
}

function settle(node: HTMLInputElement, value: string, init: InputEventInit = {}) {
    node.focus()
    node.value = value
    node.setSelectionRange(value.length, value.length)
    node.dispatchEvent(new InputEvent('input', { inputType: 'insertText', ...init }))
    flushSync()
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('the Claude key box keeps one key per row', () => {
    test('BK1 an insertion that left two keys apart by a space ends as two masked rows', () => {
        const target = mountPage(true)
        settle(keyInputs(target)[0], 'sk-test-A sk-test-B')
        expect(claudeKey()).toBe('sk-test-A\nsk-test-B')
        expect(keyInputs(target).map((node) => node.value)).toEqual(['sk-test-A', 'sk-test-B', ''])
    })

    test('BK2 a composition commit splits at compositionend, not before', () => {
        const target = mountPage(false)
        const node = keyInputs(target)[0]
        node.focus()
        node.dispatchEvent(new CompositionEvent('compositionstart'))
        node.value = 'sk-test-A sk-test-B'
        node.setSelectionRange(19, 19)
        node.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', isComposing: true }))
        flushSync()
        expect(keyInputs(target).filter((row) => row.value !== '')).toHaveLength(1)
        node.dispatchEvent(new CompositionEvent('compositionend', { data: 'sk-test-A\nsk-test-B' }))
        flushSync()
        expect(claudeKey()).toBe('sk-test-A\nsk-test-B')
        expect(keyInputs(target).map((row) => row.value)).toEqual(['sk-test-A', 'sk-test-B', ''])
    })

    test('BK6 every key row is masked even when the saved hide-key value is off', () => {
        const target = mountPage(false)
        expect(keyInputs(target).length).toBeGreaterThanOrEqual(1)
        expect(keyInputs(target, false)).toHaveLength(0)
    })

    test('SK1 compatibility guard (passes before and after): a secret reference stays readable in its row', () => {
        for (const hideApiKey of [true, false]) {
            const target = mountPage(hideApiKey)
            seedClaudeKey('${OPENAI_KEY}')
            flushSync()
            const shown = keyInputs(target, false).filter((row) => row.value === '${OPENAI_KEY}')
            expect(shown).toHaveLength(1)
        }
    })

    test('BK3 three keys in one insertion end as three rows', () => {
        const target = mountPage(true)
        settle(keyInputs(target)[0], 'sk-test-A sk-test-B sk-test-C')
        expect(claudeKey()).toBe('sk-test-A\nsk-test-B\nsk-test-C')
        expect(keyInputs(target)).toHaveLength(4)
    })

    test('BK4 compatibility guard (passes before and after): a single key keeps its spaces', () => {
        const target = mountPage(true)
        settle(keyInputs(target)[0], ' sk-test-A ')
        expect(claudeKey()).toBe(' sk-test-A ')
    })

    test('BK5 compatibility guard (passes before and after): focus and blur leave a saved spaced value alone', () => {
        const target = mountPage(true)
        seedClaudeKey('pass word')
        flushSync()
        const node = keyInputs(target)[0]
        node.focus()
        node.dispatchEvent(new FocusEvent('focusout'))
        flushSync()
        expect(claudeKey()).toBe('pass word')
        expect(node.value).toBe('pass word')
    })
})
