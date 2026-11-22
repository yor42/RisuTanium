import { ownColours } from '../../ts/themePack/ownColours.svelte'

export type OwnSchemeKind = 'escape' | 'prompt'

/**
 * Marks a node as an own-scheme island while the own colours are on: `data-own-scheme` plus the own scheme's root custom
 * properties inline, so styles/own-scheme.css and the token files resolve against them. Without the own colours (no pack, a
 * readable pack) or with a null kind the node carries neither, and the page paints exactly as without the island.
 */
export function ownScheme(node: HTMLElement, initial: OwnSchemeKind | null) {
    let kind = $state<OwnSchemeKind | null>(initial)
    let applied: string[] = []

    function clear() {
        node.removeAttribute('data-own-scheme')
        for (const name of applied) node.style.removeProperty(name)
        applied = []
    }

    $effect(() => {
        const wanted = kind
        const vars = ownColours.vars
        if (!wanted || !ownColours.on) {
            clear()
            return
        }
        node.setAttribute('data-own-scheme', wanted)
        const names = Object.keys(vars)
        for (const name of applied) {
            if (!(name in vars)) node.style.removeProperty(name)
        }
        for (const name of names) node.style.setProperty(name, vars[name])
        applied = names
    })

    return {
        update(next: OwnSchemeKind | null) {
            kind = next
        },
    }
}
