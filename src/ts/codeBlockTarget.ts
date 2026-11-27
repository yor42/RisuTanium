// A code block whose menu the chat observer owns: the nearest element carrying a non-empty highlight language.
// The message sheet and the observer both decide from this one test, so a gesture on a code block opens exactly one of them.
export function codeBlockOf(target: EventTarget | null): Element | null {
    if(!(target instanceof Element)){
        return null
    }
    const node = target.closest('[x-hl-lang]')
    return node?.getAttribute('x-hl-lang') ? node : null
}
