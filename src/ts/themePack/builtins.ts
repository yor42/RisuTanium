// The built-in packs: the two shipped chat themes, bundled as text. Only the chat sheet of each is bundled, because chat is
// the one applied area; the manifest values are those of the frozen golden packs built from the same sheets.
import originNavyChat from '../../../docs/design/chat/themes/origin-navy.css?raw'
import bananaCocoaChat from '../../../docs/design/chat/themes/banana-cocoa.css?raw'

export interface BuiltinPack {
    id: `builtin:${string}`
    slug: string
    name: string
    version: string
    license: string
    attribution: string
    modes: readonly ('light' | 'dark')[]
    chatCss: string
}

export const BUILTIN_PACKS: readonly BuiltinPack[] = [
    {
        id: 'builtin:origin-navy', slug: 'origin-navy', name: 'Origin Navy', version: '1.0.0', license: 'GPL-3.0',
        attribution: 'RisuTanium contributors', modes: ['dark'], chatCss: originNavyChat,
    },
    {
        id: 'builtin:banana-cocoa', slug: 'banana-cocoa', name: 'Banana Cocoa', version: '1.0.0', license: 'GPL-3.0',
        attribution: 'RisuTanium contributors', modes: ['light'], chatCss: bananaCocoaChat,
    },
]

/** An exact match on the id; an id of a newer build's built-in is not found. */
export function builtinPackById(id: string): BuiltinPack | null {
    return BUILTIN_PACKS.find((pack) => pack.id === id) ?? null
}
