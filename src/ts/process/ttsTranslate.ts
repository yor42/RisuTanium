/**
 * Translates `text` for auto speech. Resolves to null as soon as any of `signals` aborts (the translator request is not
 * cancelled and settles on its own), otherwise to the translation or, on any failure, to `text`. Never rejects.
 */
export async function translateForSpeech(text: string, signals: readonly AbortSignal[], translatorNote?: string): Promise<string | null> {
    if(signals.some((signal) => signal.aborted)){
        return null
    }
    // The handler is attached before the race, so a failure that arrives after an abort is still handled.
    // Loaded through import() so that send-path tests which mock `./tts` do not evaluate the real translator. In the
    // app the translator is already in the static graph (through `tts.ts`), so this adds no chunk or delay.
    const translation = import("../translator/translator").then(({ translateWholeText }) => translateWholeText(text, { translatorNote })).catch((error: unknown) => {
        console.warn('Speech translation failed; speaking the original text', error)
        return text
    })
    const listeners: [AbortSignal, () => void][] = []
    const aborted = new Promise<null>((resolve) => {
        for(const signal of signals){
            const onAbort = () => resolve(null)
            signal.addEventListener('abort', onAbort, { once: true })
            listeners.push([signal, onAbort])
        }
    })
    try {
        return await Promise.race([translation, aborted])
    }
    finally {
        for(const [signal, onAbort] of listeners){
            signal.removeEventListener('abort', onAbort)
        }
    }
}
