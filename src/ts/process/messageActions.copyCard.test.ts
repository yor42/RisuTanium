// @vitest-environment jsdom
/**
 * Copy as card hands the card controller one text: it becomes the `text/plain` companion, the minimal
 * card's body and the rich card's source. That text leaves out `<Thoughts>` sections, as the plain Copy
 * button does, so pasting as plain text never carries the thinking the card hides.
 *
 * REAL: `stripThoughtsForCopy` and the thoughts scan. MOCKED: `startCardCopy`, which only records the
 * request; the controller's use of `captureText` for the `text/plain` blob is pinned in `chatCard.test.ts`.
 */
import { beforeEach, expect, test, vi } from 'vitest'
import type { CardCopyRequest } from '../chatCard'

vi.mock('../stores.svelte', () => ({ DBState: { db: { characters: [] } }, selIdState: { selId: 0 }, ReloadChatPointer: { update: vi.fn() }, CurrentTriggerIdStore: { set: vi.fn() } }))
vi.mock('../storage/database.svelte', () => ({ getCurrentCharacter: vi.fn(() => ({})), getCurrentChat: vi.fn() }))
vi.mock('../alert', () => ({ alertConfirm: vi.fn(), alertSelect: vi.fn(), alertInput: vi.fn() }))
vi.mock('../../lang', () => ({ language: {} }))
vi.mock('./scriptings', () => ({ runLuaButtonTrigger: vi.fn(), runLuaInteractionTrigger: vi.fn() }))
vi.mock('./triggers', () => ({ runTrigger: vi.fn() }))
vi.mock('./moduleEnsure', () => ({ ensureModulesOrAlert: vi.fn() }))
vi.mock('./moduleRefList', () => ({ hasModuleStubs: vi.fn(() => false) }))
vi.mock('../util', () => ({ getUserName: vi.fn(() => 'User'), getUserIcon: vi.fn(() => ''), capitalize: vi.fn((value: string) => value), sleep: vi.fn(async () => {}) }))
vi.mock('../chatCard', () => ({ captureCardTheme: vi.fn(() => ({})), noteNewerPlainCopy: vi.fn(), startCardCopy: vi.fn() }))
vi.mock('./tts', () => ({ sayTTS: vi.fn() }))
vi.mock('./ttsSpeechText', () => ({ speakerSpeechText: vi.fn() }))
vi.mock('../model/modellist', () => ({ getModelInfo: vi.fn(() => ({ shortName: 'm' })) }))
vi.mock('../globalApi.svelte', () => ({ getFileSrc: vi.fn() }))
vi.mock('../parser/parser.svelte', () => ({ ParseMarkdown: vi.fn() }))

import { startCardCopy } from '../chatCard'
import { copyMessageAsCard } from './messageActions.svelte'

const WITH_THOUGHTS = 'Before.\n\n<Thoughts>hidden reasoning</Thoughts>\n\nAfter.'

function cardRequestFor(shown: string): CardCopyRequest {
    copyMessageAsCard({
        owner: {},
        captureText: () => shown,
        report: () => {},
        role: () => 'char',
        name: () => 'Bot',
        messageGenerationInfo: () => null,
        idx: () => 0,
        getCbsCondition: () => ({}),
    })
    expect(vi.mocked(startCardCopy)).toHaveBeenCalledTimes(1)
    return vi.mocked(startCardCopy).mock.calls[0][0]
}

beforeEach(() => {
    vi.mocked(startCardCopy).mockReset()
})

test('CHORE-92 the card text leaves out the thinking section, as plain Copy does', () => {
    const text = cardRequestFor(WITH_THOUGHTS).captureText()

    expect(text).toBe('Before.\n\nAfter.')
    expect(text).not.toContain('hidden reasoning')
})

test('guard: the card is built from the text it was handed', () => {
    const request = cardRequestFor(WITH_THOUGHTS)
    const text = request.captureText()

    expect(request.captureCard(text).copyText).toBe(text)
})

test('guard: a message without thoughts reaches the card unchanged', () => {
    expect(cardRequestFor('Line one.\nLine two.').captureText()).toBe('Line one.\nLine two.')
})

test('guard: a message that is only a thinking section keeps its text, as plain Copy does', () => {
    const onlyThoughts = '<Thoughts>all of it</Thoughts>'

    expect(cardRequestFor(onlyThoughts).captureText()).toBe(onlyThoughts)
})
