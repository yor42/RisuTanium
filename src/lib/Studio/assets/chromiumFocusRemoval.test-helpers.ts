// Chromium (desktop Chrome, WebView2 and the Android WebView) reports the removal of a focused element, or of an
// ancestor of it, as `blur` and then `focusout` on that element while it is still in the page, with a null
// `relatedTarget`. jsdom reports nothing, so a suite that wants the browser's event order installs this shim: every
// route that removes a node (`remove`, `removeChild`, `textContent = ''`) dispatches the two events first.

function dispatchRemovalEvents(node: Node): void {
    const active = document.activeElement
    if (active === null || active === document.body || !node.contains(active)) return
    active.dispatchEvent(new FocusEvent('blur', { bubbles: false, relatedTarget: null }))
    active.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
}

// Puts a property back as it was: its own descriptor, or no own property when it was inherited.
function restoreProperty(target: object, name: string, own: PropertyDescriptor | undefined): void {
    if (own) Object.defineProperty(target, name, own)
    else Reflect.deleteProperty(target, name)
}

/** Installs the shim and returns the function that removes it again. */
export function installChromiumFocusRemoval(): () => void {
    const ownRemove = Object.getOwnPropertyDescriptor(Element.prototype, 'remove')
    const originalRemove = Element.prototype.remove
    Element.prototype.remove = function (this: Element): void {
        dispatchRemovalEvents(this)
        originalRemove.call(this)
    }

    const ownRemoveChild = Object.getOwnPropertyDescriptor(Node.prototype, 'removeChild')
    const originalRemoveChild = Node.prototype.removeChild
    Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
        dispatchRemovalEvents(child)
        return originalRemoveChild.call(this, child) as T
    }

    const ownTextContent = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')
    const originalGet = ownTextContent?.get
    const originalSet = ownTextContent?.set
    if (originalGet && originalSet) {
        Object.defineProperty(Node.prototype, 'textContent', {
            configurable: true,
            get: originalGet,
            set(this: Node, value: string) {
                if (this.nodeType === 1) dispatchRemovalEvents(this)
                originalSet.call(this, value)
            },
        })
    }

    return () => {
        restoreProperty(Element.prototype, 'remove', ownRemove)
        restoreProperty(Node.prototype, 'removeChild', ownRemoveChild)
        restoreProperty(Node.prototype, 'textContent', ownTextContent)
    }
}
