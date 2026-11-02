// What is spoken for a reply the user sees translated. Dependency-free so the speaker button and the tests can use it
// without loading the translator or a provider.

interface SpeechProviderSettings {
    ttsMode?: string
    hfTTS?: { language?: string }
}

/**
 * True when the provider translates the text itself before speaking (VOICEVOX, and Hugging Face with a target language
 * other than English), so the caller must hand it the original text.
 */
export function providerTranslatesItself(character: SpeechProviderSettings | null | undefined): boolean {
    if(!character){
        return false
    }
    if(character.ttsMode === 'VOICEVOX'){
        return true
    }
    if(character.ttsMode === 'huggingface'){
        const targetLanguage = (character.hfTTS?.language ?? '').trim().toLowerCase()
        return targetLanguage !== '' && targetLanguage !== 'en'
    }
    return false
}

const SPEECH_SKIPPED_SELECTOR = 'details, style, script, template, noscript'
const SPEECH_BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TR'])

/**
 * The text a reader sees in `root`: collapsed blocks (including the rendered Thoughts), styles and scripts are left
 * out, a line break and the end of a block element give a newline. `root` itself is not modified.
 */
export function shownSpeechText(root: ParentNode): string {
    const clone = (root as Node).cloneNode(true) as ParentNode
    for(const skipped of Array.from(clone.querySelectorAll(SPEECH_SKIPPED_SELECTOR))){
        skipped.remove()
    }
    let out = ''
    const walk = (node: Node) => {
        for(const child of Array.from(node.childNodes)){
            if(child.nodeType === 3){
                out += child.textContent ?? ''
            }
            else if(child.nodeType === 1){
                const tag = (child as Element).tagName.toUpperCase()
                walk(child)
                if(tag === 'BR' || SPEECH_BLOCK_TAGS.has(tag)){
                    out += '\n'
                }
            }
        }
    }
    walk(clone as Node)
    return out.trim()
}

/**
 * The speaker button's text: the translation the bubble shows when there is one, otherwise `original`. A provider that
 * translates by itself, a missing bubble and a blank bubble (a pending translation) all keep `original`.
 */
export function speakerSpeechText(args: {
    translated: boolean
    shownRoot: ParentNode | null | undefined
    original: string
    character: SpeechProviderSettings | null | undefined
}): string {
    if(!args.translated || !args.shownRoot || providerTranslatesItself(args.character)){
        return args.original
    }
    const shown = shownSpeechText(args.shownRoot)
    return shown.trim() ? shown : args.original
}
