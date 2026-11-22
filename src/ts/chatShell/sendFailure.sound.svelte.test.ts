// @vitest-environment jsdom
/**
 * The error cue of the new shell's pre-flight refusal (#246 S1b, Q6): `shellGenerationSource().refuseGeneration` plays
 * `error` when it refuses (no model or no key) and nothing when the generation passes. Mocks as in
 * `sendFailure.svelte.test.ts`; the fake Web Audio of `uiSound.testKit.ts` is installed before the module is imported.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { installFakeAudio, warmUiSounds, type FakeAudio } from 'src/ts/uiSound/uiSound.testKit'

const modelInfoMock = vi.hoisted(() => vi.fn((_id: string): { provider: number, keyIdentifier?: string } => ({ provider: 1 })))
const dbBox = vi.hoisted(() => ({ db: {} as Record<string, unknown> }))

vi.mock(import('src/ts/process/composerActions.svelte'), () => ({
    sendMain: vi.fn(async () => {}),
    regenerateNewest: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/composerActions.svelte'))
vi.mock(import('src/ts/model/modellist'), () => ({ getModelInfo: modelInfoMock }) as unknown as typeof import('src/ts/model/modellist'))
vi.mock(import('src/ts/stores.svelte'), () => ({ DBState: dbBox, selIdState: { selId: -1 } }) as unknown as typeof import('src/ts/stores.svelte'))

const ORIGIN = { chaId: 'cha-a', chatId: 'chat-a' }

let shellGenerationSource: typeof import('./sendFailure.svelte').shellGenerationSource
let resetSendFailuresForTests: typeof import('./sendFailure.svelte').resetSendFailuresForTests
let absorbLegacyForTest: typeof import('../connections/tests/legacyFixture').absorbLegacyForTest
let audio: FakeAudio

const cueOf = (url: string): string => url.match(/\/(?:scifi|studio)\/([\w-]+)\.mp3$/)?.[1] ?? url

function install(overrides: Record<string, unknown> = {}): void {
    dbBox.db = absorbLegacyForTest({
        aiModel: 'claude-test', customModels: [], presetChain: '', fallbackModels: { model: [] },
        openAIKey: '', openrouterKey: '', claudeAPIKey: '', mistralKey: '', cohereAPIKey: '', OaiCompAPIKeys: {},
        google: { accessToken: '' }, novelai: { token: '' },
        ...overrides,
    })
}

beforeAll(async () => {
    audio = installFakeAudio()
    vi.useFakeTimers({ toFake: ['performance'] })
    const failure = await import('./sendFailure.svelte')
    shellGenerationSource = failure.shellGenerationSource
    resetSendFailuresForTests = failure.resetSendFailuresForTests
    absorbLegacyForTest = (await import('../connections/tests/legacyFixture')).absorbLegacyForTest
}, 120_000)

afterAll(() => {
    vi.useRealTimers()
    audio.uninstall()
})

beforeEach(async () => {
    localStorage.clear()
    audio.endVoices()
    audio.started.length = 0
    vi.advanceTimersByTime(10000)
    await warmUiSounds()
    resetSendFailuresForTests()
    install()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('T22 the refusal cue', () => {
    test('reproducer (T22): a refused generation plays one error cue', () => {
        const source = shellGenerationSource(() => {})

        expect(source.refuseGeneration?.({ origin: ORIGIN, action: 'send' })).toBe(true)

        expect(audio.startedUrls().map(cueOf)).toEqual(['error'])
    })

    test('guard: a generation that passes plays nothing', () => {
        install({ claudeAPIKey: 'synthetic-key' })
        const source = shellGenerationSource(() => {})

        expect(source.refuseGeneration?.({ origin: ORIGIN, action: 'send' })).toBe(false)

        expect(audio.started).toEqual([])
    })

    test('guard (T17): the switch off silences the refusal cue', () => {
        localStorage.setItem('risutanium.uiSounds', '0')
        const source = shellGenerationSource(() => {})

        expect(source.refuseGeneration?.({ origin: ORIGIN, action: 'send' })).toBe(true)

        expect(audio.started).toEqual([])
    })
})
