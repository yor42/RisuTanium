const MESSAGE_SELECTOR = 'article[data-part="chat-message"]'

export interface TranscriptEndKeyOptions {
    transcript: () => HTMLElement | undefined
    run: () => void
}

// End on the transcript or on a message travels to the newest message. The listener sits on the shell root in the capture phase, an ancestor
// of the transcript, so it runs before any listener on the transcript or a message: the reader-intent listener never sees this key
// (a reader-intent event would cancel the travel this key starts). Every other target keeps its own End: buttons and scrollers inside a
// message, text fields and the composer.
export function installTranscriptEndKey(shell: HTMLElement, options: TranscriptEndKeyOptions): () => void {
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'End' || event.altKey || event.shiftKey || event.metaKey) return
        if (event.isComposing || event.keyCode === 229) return
        const transcript = options.transcript()
        const target = event.target instanceof Element ? event.target : null
        if (!transcript || !target) return
        const onTranscript = target === transcript
        const onMessage = target.matches(MESSAGE_SELECTOR) && transcript.contains(target)
        if (!onTranscript && !onMessage) return
        event.preventDefault()
        event.stopPropagation()
        options.run()
    }
    shell.addEventListener('keydown', onKeyDown, { capture: true })
    return () => shell.removeEventListener('keydown', onKeyDown, { capture: true })
}
