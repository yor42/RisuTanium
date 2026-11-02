// @vitest-environment happy-dom
/**
 * `shownSpeechText` and `speakerSpeechText`: what the speaker button speaks for a bubble that shows a translation.
 * No sanitizer is involved; the DOM is built from literal markup.
 */
import { describe, expect, test } from 'vitest'
import { providerTranslatesItself, shownSpeechText, speakerSpeechText } from '../ttsSpeechText'

function rootOf(markup: string): HTMLElement {
    const root = document.createElement('div')
    root.innerHTML = markup
    return root
}

describe('shownSpeechText', () => {
    test('TS-1 guard: blocks give newlines, BR gives a newline, and details and styles are left out', () => {
        expect(shownSpeechText(rootOf('<p>A</p><p>B</p>'))).toBe('A\nB')
        expect(shownSpeechText(rootOf('x<br>y'))).toBe('x\ny')
        expect(shownSpeechText(rootOf('<details><summary>Thoughts</summary>secret</details><p>Shown</p>'))).toBe('Shown')
        expect(shownSpeechText(rootOf('<style>.a{color:red}</style><span>Shown</span>'))).toBe('Shown')
        expect(shownSpeechText(rootOf('<script>var a=1</script><template>t</template><noscript>n</noscript>ok'))).toBe('ok')
    })

    test('guard: the root is not modified', () => {
        const root = rootOf('<details>d</details><p>A</p>')

        shownSpeechText(root)

        expect(root.querySelector('details')).not.toBeNull()
    })
})

describe('speakerSpeechText', () => {
    const shown = rootOf('<p>[T] Hallo</p>')

    test('TS-2 guard: untranslated, blank-shown and self-translating providers speak the original; a translated bubble speaks the shown text', () => {
        const character = { ttsMode: 'webspeech' }

        expect(speakerSpeechText({ translated: false, shownRoot: shown, original: 'Hello', character })).toBe('Hello')
        expect(speakerSpeechText({ translated: true, shownRoot: null, original: 'Hello', character })).toBe('Hello')
        expect(speakerSpeechText({ translated: true, shownRoot: rootOf('<style>x</style>  '), original: 'Hello', character })).toBe('Hello')
        expect(speakerSpeechText({ translated: true, shownRoot: shown, original: 'Hello', character: { ttsMode: 'VOICEVOX' } })).toBe('Hello')
        expect(speakerSpeechText({ translated: true, shownRoot: shown, original: 'Hello', character })).toBe('[T] Hallo')
    })
})

describe('providerTranslatesItself', () => {
    test('guard: VOICEVOX and Hugging Face with a non-English language translate by themselves', () => {
        expect(providerTranslatesItself({ ttsMode: 'VOICEVOX' })).toBe(true)
        expect(providerTranslatesItself({ ttsMode: 'huggingface', hfTTS: { language: ' KO ' } })).toBe(true)
        expect(providerTranslatesItself({ ttsMode: 'huggingface', hfTTS: { language: 'en' } })).toBe(false)
        expect(providerTranslatesItself({ ttsMode: 'huggingface', hfTTS: { language: '' } })).toBe(false)
        expect(providerTranslatesItself({ ttsMode: 'webspeech' })).toBe(false)
        expect(providerTranslatesItself(null)).toBe(false)
    })
})
