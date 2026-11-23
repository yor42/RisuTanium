import { describe, it, expect, vi } from 'vitest'
import type { character } from '../storage/database.svelte'

// updateInlayScreen itself never calls these, but inlayScreen.ts imports them
// at module scope for runInlayScreen, so they must be stubbed before import.
vi.mock('./files/inlays', () => ({
    writeInlayImage: vi.fn(),
}))
vi.mock('./stableDiff', () => ({
    generateAIImage: vi.fn(),
}))

import { runInlayScreen, updateInlayScreen } from './inlayScreen'
import { writeInlayImage } from './files/inlays'
import { generateAIImage } from './stableDiff'

type NewGenData = character['newGenData']
type NewGenDataShape = NonNullable<NewGenData>
type NewGenDataWithNumberPrompt = Omit<NewGenDataShape, 'prompt'> & { prompt: number }

interface MinimalCharacter {
    viewScreen: character['viewScreen']
    inlayViewScreen?: boolean
    newGenData?: NewGenData
}

function makeChar(overrides: MinimalCharacter): character {
    return { ...overrides } as unknown as character
}

// These are the exact built-in default texts: saved characters carry them byte
// for byte, and updateInlayScreen recognises a never-edited field by exact
// equality against one of them. This list must equal the function's named
// constants exactly, because saved characters hold this text byte for byte:
// if the constants stopped matching what saves hold, a never-edited field's
// saved default text would fail to match any known default and would be
// treated as user-authored, so it would stop following the mode.
const EMOTION_INLAY_DEFAULT = `You must always output the character's emotional image as a command at the end of a conversation. The command must be selected from a given list, and it's better to have variety than to repeat images used in previous chats. Use one image, depending on the character's emotion. See the list below. Form: <Emotion="<image command>"> Example: <Emotion="Agree"> List of commands: {{slot}}`
const EMOTION_DEFAULT = `You must always output the character's emotional image as a command. The command must be selected from a given list, only output the command, depending on the character's emotion. List of commands: {{slot}}`
const IMGGEN_PROMPT_DEFAULT = 'best quality, {{slot}}'
const IMGGEN_NEGATIVE_DEFAULT = 'worse quality'
const IMGGEN_INLAY_INSTRUCTIONS_DEFAULT = 'You must always output the character\'s image as a keyword-formatted prompts that can be used in stable diffusion  at the end of a conversation. Use one image, depending on character, place, situation, etc. keyword should be long enough. Form: <ImgGen="<keyword-formatted prompt>">'
const IMGGEN_DEFAULT_INSTRUCTIONS = 'You must always output the character\'s image as a keyword-formatted prompts that can be used in stable diffusion. only output the that prompt, depending on character, place, situation, etc. keyword should be long enough.'

describe('updateInlayScreen', () => {
    describe('user-authored text survives mode and inlay changes', () => {
        it('keeps a user-authored emotionInstructions across toggling inlayViewScreen on and off', () => {
            const custom = 'Only ever output a single sparkle emoji, nothing else.'
            const char = makeChar({
                viewScreen: 'emotion',
                inlayViewScreen: false,
                newGenData: { prompt: '', negative: '', instructions: '', emotionInstructions: custom },
            })

            updateInlayScreen(char)
            expect(char.newGenData.emotionInstructions).toBe(custom)

            char.inlayViewScreen = true
            updateInlayScreen(char)
            expect(char.newGenData.emotionInstructions).toBe(custom)

            char.inlayViewScreen = false
            updateInlayScreen(char)
            expect(char.newGenData.emotionInstructions).toBe(custom)
        })

        it('keeps user-authored imggen prompt, negative and instructions across an inlay toggle and a round trip through emotion mode', () => {
            const prompt = 'a lush enchanted forest, dappled sunlight, painterly'
            const negative = 'blurry, low quality, watermark'
            const instructions = 'Describe the scene as a single stable-diffusion-ready keyword list.'
            const char = makeChar({
                viewScreen: 'imggen',
                inlayViewScreen: false,
                newGenData: { prompt, negative, instructions, emotionInstructions: '' },
            })

            updateInlayScreen(char)
            expect(char.newGenData.prompt).toBe(prompt)
            expect(char.newGenData.negative).toBe(negative)
            expect(char.newGenData.instructions).toBe(instructions)

            char.inlayViewScreen = true
            updateInlayScreen(char)
            expect(char.newGenData.prompt).toBe(prompt)
            expect(char.newGenData.negative).toBe(negative)
            expect(char.newGenData.instructions).toBe(instructions)

            char.inlayViewScreen = false
            updateInlayScreen(char)
            expect(char.newGenData.prompt).toBe(prompt)
            expect(char.newGenData.negative).toBe(negative)
            expect(char.newGenData.instructions).toBe(instructions)

            char.viewScreen = 'emotion'
            updateInlayScreen(char)
            char.viewScreen = 'imggen'
            updateInlayScreen(char)
            expect(char.newGenData.prompt).toBe(prompt)
            expect(char.newGenData.negative).toBe(negative)
            expect(char.newGenData.instructions).toBe(instructions)
        })

        it('keeps a user-authored emotionInstructions across a switch to none and back to emotion', () => {
            const custom = 'Whisper the mood in one poetic sentence instead of an emoji.'
            const char = makeChar({
                viewScreen: 'emotion',
                inlayViewScreen: true,
                newGenData: { prompt: '', negative: '', instructions: '', emotionInstructions: custom },
            })

            updateInlayScreen(char)
            expect(char.newGenData.emotionInstructions).toBe(custom)

            char.viewScreen = 'none'
            updateInlayScreen(char)
            expect(char.newGenData.emotionInstructions).toBe(custom)

            char.viewScreen = 'emotion'
            updateInlayScreen(char)
            expect(char.newGenData.emotionInstructions).toBe(custom)
        })
    })

    describe('never-edited defaults switch with the mode', () => {
        // Coverage, not proof: the input holds no user-authored text, so this passes
        // whether or not user-authored text is distinguished; it pins that
        // emotionInstructions follows the non-inlay/inlay default when
        // inlayViewScreen toggles.
        it('switches emotionInstructions between the non-inlay and inlay defaults for a never-edited value', () => {
            const char = makeChar({ viewScreen: 'emotion', inlayViewScreen: false })

            updateInlayScreen(char)
            expect(char.newGenData.emotionInstructions).toBe(EMOTION_DEFAULT)

            char.inlayViewScreen = true
            updateInlayScreen(char)
            expect(char.newGenData.emotionInstructions).toBe(EMOTION_INLAY_DEFAULT)
        })

        // Coverage, not proof: the input holds no user-authored text, so this passes
        // whether or not user-authored text is distinguished; it pins that imggen
        // instructions follows the non-inlay/inlay default when inlayViewScreen
        // toggles.
        it('switches imggen instructions between the non-inlay and inlay defaults for a never-edited value', () => {
            const char = makeChar({ viewScreen: 'imggen', inlayViewScreen: false })

            updateInlayScreen(char)
            expect(char.newGenData.instructions).toBe(IMGGEN_DEFAULT_INSTRUCTIONS)

            char.inlayViewScreen = true
            updateInlayScreen(char)
            expect(char.newGenData.instructions).toBe(IMGGEN_INLAY_INSTRUCTIONS_DEFAULT)
        })

        // Coverage, not proof: this proves the inlay emotionInstructions default is
        // recognised as a known default and replaced by the non-inlay default when
        // inlay turns off; an implementation that always overwrites the field with
        // the target default regardless of its current value would also pass this
        // test, so it doesn't by itself prove that user-authored text survives.
        it('restores the non-inlay emotionInstructions default when inlay turns off for a never-edited value', () => {
            const char = makeChar({
                viewScreen: 'emotion',
                inlayViewScreen: true,
                newGenData: { prompt: '', negative: '', instructions: '', emotionInstructions: EMOTION_INLAY_DEFAULT },
            })

            char.inlayViewScreen = false
            updateInlayScreen(char)

            expect(char.newGenData.emotionInstructions).toBe(EMOTION_DEFAULT)
        })

        // Coverage, not proof: this proves the inlay imggen instructions default is
        // recognised as a known default and replaced by the non-inlay default when
        // inlay turns off; an implementation that always overwrites the field with
        // the target default regardless of its current value would also pass this
        // test, so it doesn't by itself prove that user-authored text survives.
        it('restores the non-inlay imggen instructions default when inlay turns off for a never-edited value', () => {
            const char = makeChar({
                viewScreen: 'imggen',
                inlayViewScreen: true,
                newGenData: { prompt: '', negative: '', instructions: IMGGEN_INLAY_INSTRUCTIONS_DEFAULT, emotionInstructions: '' },
            })

            char.inlayViewScreen = false
            updateInlayScreen(char)

            expect(char.newGenData.instructions).toBe(IMGGEN_DEFAULT_INSTRUCTIONS)
        })

        // Coverage, not proof: the input holds no user-authored text, so this passes
        // whether or not user-authored text is distinguished; it pins that empty
        // fields receive the mode default.
        it('fills empty imggen fields with the mode defaults', () => {
            const char = makeChar({
                viewScreen: 'imggen',
                inlayViewScreen: false,
                newGenData: { prompt: '', negative: '', instructions: '', emotionInstructions: '' },
            })

            updateInlayScreen(char)

            expect(char.newGenData).toEqual({
                prompt: IMGGEN_PROMPT_DEFAULT,
                negative: IMGGEN_NEGATIVE_DEFAULT,
                instructions: IMGGEN_DEFAULT_INSTRUCTIONS,
                emotionInstructions: '',
            })
        })
    })

    describe('a missing or partial newGenData is filled with string defaults', () => {
        // Coverage, not proof: the input holds no user-authored text (there is no
        // newGenData at all), so this passes whether or not user-authored text is
        // distinguished; it pins that a missing newGenData is filled with the mode's
        // string defaults for every field.
        it('fills every field with a string default when newGenData is undefined', () => {
            const char = makeChar({ viewScreen: 'imggen', inlayViewScreen: true, newGenData: undefined })

            updateInlayScreen(char)

            expect(char.newGenData).toEqual({
                prompt: IMGGEN_PROMPT_DEFAULT,
                negative: IMGGEN_NEGATIVE_DEFAULT,
                instructions: IMGGEN_INLAY_INSTRUCTIONS_DEFAULT,
                emotionInstructions: '',
            })
            for (const value of Object.values(char.newGenData)) {
                expect(typeof value).toBe('string')
            }
        })

        it('fills the missing fields of a partial newGenData with mode defaults, keeping the user-authored field that is present', () => {
            const prompt = 'a lighthouse at dusk, long exposure'
            const char = makeChar({
                viewScreen: 'imggen',
                inlayViewScreen: false,
                newGenData: { prompt } as NewGenData,
            })

            updateInlayScreen(char)

            expect(char.newGenData.prompt).toBe(prompt)
            expect(char.newGenData.negative).toBe(IMGGEN_NEGATIVE_DEFAULT)
            expect(char.newGenData.instructions).toBe(IMGGEN_DEFAULT_INSTRUCTIONS)
            expect(char.newGenData.emotionInstructions).toBe('')
            for (const value of Object.values(char.newGenData)) {
                expect(typeof value).toBe('string')
            }
        })
    })

    describe('switching to none', () => {
        // Coverage, not proof: the input holds no user-authored text, so this passes
        // whether or not user-authored text is distinguished; it pins that built-in
        // default fields become '' when switching to none.
        it('resets built-in-default fields to empty strings when switching to none', () => {
            const char = makeChar({
                viewScreen: 'emotion',
                inlayViewScreen: true,
                newGenData: { prompt: '', negative: '', instructions: '', emotionInstructions: EMOTION_INLAY_DEFAULT },
            })

            char.viewScreen = 'none'
            updateInlayScreen(char)

            expect(char.newGenData).toEqual({ prompt: '', negative: '', instructions: '', emotionInstructions: '' })
        })

        // Coverage, not proof: this proves the imggen prompt and negative defaults
        // are recognised as known defaults and reset to '' when switching to none;
        // an implementation that always overwrites these fields with the none-mode
        // default regardless of their current value would also pass this test, so
        // it doesn't by itself prove that user-authored text survives.
        it('resets the imggen prompt and negative defaults to empty strings when switching to none', () => {
            const char = makeChar({
                viewScreen: 'imggen',
                inlayViewScreen: false,
                newGenData: { prompt: IMGGEN_PROMPT_DEFAULT, negative: IMGGEN_NEGATIVE_DEFAULT, instructions: '', emotionInstructions: '' },
            })

            char.viewScreen = 'none'
            updateInlayScreen(char)

            expect(char.newGenData.prompt).toBe('')
            expect(char.newGenData.negative).toBe('')
        })
    })

    describe('a non-string field is replaced with the mode default', () => {
        // Coverage, not proof: this proves a non-string current value is never
        // kept; an implementation that always overwrites the field with the mode
        // default regardless of current would also pass this test, so it doesn't
        // by itself prove that user-authored text survives.
        it('replaces a non-string imggen prompt with the mode default string', () => {
            const corrupted: NewGenDataWithNumberPrompt = {
                prompt: 42,
                negative: '',
                instructions: '',
                emotionInstructions: '',
            }
            const char = makeChar({
                viewScreen: 'imggen',
                inlayViewScreen: false,
                newGenData: corrupted as unknown as NewGenData,
            })

            updateInlayScreen(char)

            expect(char.newGenData.prompt).toBe(IMGGEN_PROMPT_DEFAULT)
            expect(typeof char.newGenData.prompt).toBe('string')
        })
    })
})

describe('runInlayScreen', () => {
    it.each([
        ['release', 'Command plugin:fs|read_file not allowed by ACL'],
        ['debug', 'fs.read_file not allowed. Permissions associated with this command: fs:allow-read-file'],
    ])('G: an image tag whose generation rejects with the access control list string (%s wording) rejects the promise with that string and writes no inlay', async (_wording, refusal) => {
        vi.mocked(generateAIImage).mockReset()
        vi.mocked(writeInlayImage).mockReset()
        vi.mocked(generateAIImage).mockRejectedValue(refusal)
        const char = makeChar({
            viewScreen: 'imggen',
            inlayViewScreen: true,
            newGenData: { prompt: 'best quality, {{slot}}', negative: 'worse quality', instructions: '', emotionInstructions: '' },
        })

        const result = runInlayScreen(char, 'Hello <ImgGen="a cat">')

        expect(result.promise).toBeDefined()
        const outcome = await result.promise!.then(() => 'resolved' as const, (error: unknown) => error)
        expect(outcome).toBe(refusal)
        expect(generateAIImage).toHaveBeenCalledTimes(1)
        expect(writeInlayImage).not.toHaveBeenCalled()
    })
})
