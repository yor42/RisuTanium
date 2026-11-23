/** Every sibling along the path from `node` up to the enclosing `<main>` (or the body). */
export function backgroundOf(node: HTMLElement): HTMLElement[] {
    const held: HTMLElement[] = []
    let current = node
    for (let parent = current.parentElement; parent && parent !== document.body; parent = current.parentElement) {
        for (const sibling of Array.from(parent.children)) {
            if (sibling !== current && sibling instanceof HTMLElement) held.push(sibling)
        }
        if (parent.tagName === 'MAIN') break
        current = parent
    }
    return held
}
