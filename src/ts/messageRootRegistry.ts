export interface MessageRootInfo {
    index: number
    chatId: string
}

// Only `Chat` populates this registry, so card or plugin markup can never claim
// a message rank or keep a hold alive through authored attributes.
const roots = new Map<Element, MessageRootInfo>()
const listeners = new Set<() => void>()

function notify(){
    for(const listener of [...listeners]){
        listener()
    }
}

/** Svelte action for the root element of one rendered message. */
export function registerMessageRoot(node: Element, info: MessageRootInfo){
    roots.set(node, { index: info.index, chatId: info.chatId })
    notify()
    return {
        update(next: MessageRootInfo){
            roots.set(node, { index: next.index, chatId: next.chatId })
            notify()
        },
        destroy(){
            roots.delete(node)
            notify()
        },
    }
}

/** The nearest registered ancestor-or-self of `el`, or null outside any message. */
export function messageRootOf(el: Element): { root: Element, info: MessageRootInfo } | null {
    let cur: Element | null = el
    while(cur){
        const info = roots.get(cur)
        if(info){
            return { root: cur, info }
        }
        cur = cur.parentElement
    }
    return null
}

/** Registered roots that are currently attached to the document. */
export function connectedMessageRoots(): { root: Element, info: MessageRootInfo }[] {
    const out: { root: Element, info: MessageRootInfo }[] = []
    for(const [root, info] of roots){
        if(root.isConnected){
            out.push({ root, info })
        }
    }
    return out
}

export function onMessageRootsChanged(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}
