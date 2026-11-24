import type { character } from "../storage/database.svelte";

// The pure mode fill of the view screen: it reads three fields and writes the four generation texts. It imports no image
// pipeline, so the Studio history core can use it without loading one.
// Built-in default strings, defined once. '' is also a built-in default that
// updateInlayScreen assigns directly; the KNOWN_*_DEFAULTS sets below must be
// built from '' plus exactly these constants, matching every value the
// function assigns, so a never-edited field is always recognised.
const EMOTION_INSTRUCTIONS_DEFAULT = `You must always output the character's emotional image as a command. The command must be selected from a given list, only output the command, depending on the character's emotion. List of commands: {{slot}}`
const EMOTION_INSTRUCTIONS_INLAY_DEFAULT = `You must always output the character's emotional image as a command at the end of a conversation. The command must be selected from a given list, and it's better to have variety than to repeat images used in previous chats. Use one image, depending on the character's emotion. See the list below. Form: <Emotion="<image command>"> Example: <Emotion="Agree"> List of commands: {{slot}}`
const IMGGEN_PROMPT_DEFAULT = 'best quality, {{slot}}'
const IMGGEN_NEGATIVE_DEFAULT = 'worse quality'
const IMGGEN_INSTRUCTIONS_DEFAULT = 'You must always output the character\'s image as a keyword-formatted prompts that can be used in stable diffusion. only output the that prompt, depending on character, place, situation, etc. keyword should be long enough.'
const IMGGEN_INSTRUCTIONS_INLAY_DEFAULT = 'You must always output the character\'s image as a keyword-formatted prompts that can be used in stable diffusion  at the end of a conversation. Use one image, depending on character, place, situation, etc. keyword should be long enough. Form: <ImgGen="<keyword-formatted prompt>">'

// Every built-in default a field can take across all modes and inlay variants.
// A field matching one of these is treated as never-edited; anything else
// non-empty is user-authored and must be preserved across a mode change.
const KNOWN_PROMPT_DEFAULTS = new Set<string>(['', IMGGEN_PROMPT_DEFAULT])
const KNOWN_NEGATIVE_DEFAULTS = new Set<string>(['', IMGGEN_NEGATIVE_DEFAULT])
const KNOWN_INSTRUCTIONS_DEFAULTS = new Set<string>(['', IMGGEN_INSTRUCTIONS_DEFAULT, IMGGEN_INSTRUCTIONS_INLAY_DEFAULT])
const KNOWN_EMOTION_INSTRUCTIONS_DEFAULTS = new Set<string>(['', EMOTION_INSTRUCTIONS_DEFAULT, EMOTION_INSTRUCTIONS_INLAY_DEFAULT])

// current comes from a save file and may be missing, of the wrong type, or a
// leftover built-in default from a previous mode; only a non-empty string
// absent from knownDefaults counts as user-authored and is kept as-is.
function resolveGenDataField(current:unknown, targetDefault:string, knownDefaults:Set<string>):string {
    if(typeof current === 'string' && current !== '' && !knownDefaults.has(current)){
        return current
    }
    return targetDefault
}

export function updateInlayScreen<T extends Pick<character, 'viewScreen' | 'inlayViewScreen' | 'newGenData'>>(char:T):T {
    const current = char.newGenData
    switch(char.viewScreen){
        case 'emotion': {
            const emotionDefault = char.inlayViewScreen ? EMOTION_INSTRUCTIONS_INLAY_DEFAULT : EMOTION_INSTRUCTIONS_DEFAULT
            char.newGenData = {
                prompt: resolveGenDataField(current?.prompt, '', KNOWN_PROMPT_DEFAULTS),
                negative: resolveGenDataField(current?.negative, '', KNOWN_NEGATIVE_DEFAULTS),
                instructions: resolveGenDataField(current?.instructions, '', KNOWN_INSTRUCTIONS_DEFAULTS),
                emotionInstructions: resolveGenDataField(current?.emotionInstructions, emotionDefault, KNOWN_EMOTION_INSTRUCTIONS_DEFAULTS),
            }
            return char
        }
        case 'imggen': {
            const instructionsDefault = char.inlayViewScreen ? IMGGEN_INSTRUCTIONS_INLAY_DEFAULT : IMGGEN_INSTRUCTIONS_DEFAULT
            char.newGenData = {
                prompt: resolveGenDataField(current?.prompt, IMGGEN_PROMPT_DEFAULT, KNOWN_PROMPT_DEFAULTS),
                negative: resolveGenDataField(current?.negative, IMGGEN_NEGATIVE_DEFAULT, KNOWN_NEGATIVE_DEFAULTS),
                instructions: resolveGenDataField(current?.instructions, instructionsDefault, KNOWN_INSTRUCTIONS_DEFAULTS),
                emotionInstructions: resolveGenDataField(current?.emotionInstructions, '', KNOWN_EMOTION_INSTRUCTIONS_DEFAULTS),
            }
            return char
        }
        default:
            char.newGenData = {
                prompt: resolveGenDataField(current?.prompt, '', KNOWN_PROMPT_DEFAULTS),
                negative: resolveGenDataField(current?.negative, '', KNOWN_NEGATIVE_DEFAULTS),
                instructions: resolveGenDataField(current?.instructions, '', KNOWN_INSTRUCTIONS_DEFAULTS),
                emotionInstructions: resolveGenDataField(current?.emotionInstructions, '', KNOWN_EMOTION_INSTRUCTIONS_DEFAULTS),
            }
            return char
    }
}
