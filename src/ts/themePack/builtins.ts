// The built-in packs: the shipped chat themes, bundled as text. Only the chat sheet of each is bundled, because chat is
// the one applied area; for Origin Navy and Banana Cocoa the manifest values are those of the frozen golden packs built
// from the same sheets. Scratch White and Office Sheet carry no golden: they are bundled as text and name no font file.
import originNavyChat from '../../../docs/design/chat/themes/origin-navy.css?raw'
import bananaCocoaChat from '../../../docs/design/chat/themes/banana-cocoa.css?raw'
import scratchWhiteChat from '../../../docs/design/chat/themes/scratch-white.css?raw'
import officeSheetChat from '../../../docs/design/chat/themes/office-sheet.css?raw'

export interface BuiltinPack {
    id: `builtin:${string}`
    slug: string
    name: string
    version: string
    license: string
    attribution: string
    modes: readonly ('light' | 'dark')[]
    chatCss: string
    /** The tile colours, equal to what the install derives from `chatCss` (pinned by the built-ins test for both shipped packs); optional so a test double needs none. */
    mainColor?: string
    secondaryColor?: string
}

export const BUILTIN_PACKS: readonly BuiltinPack[] = [
    {
        id: 'builtin:origin-navy', slug: 'origin-navy', name: 'Origin Navy', version: '1.0.0', license: 'GPL-3.0',
        attribution: 'RisuTanium contributors', modes: ['dark'], chatCss: originNavyChat, mainColor: '#8be9fd', secondaryColor: '#21222c',
    },
    {
        id: 'builtin:banana-cocoa', slug: 'banana-cocoa', name: 'Banana Cocoa', version: '1.0.0', license: 'GPL-3.0',
        attribution: 'RisuTanium contributors', modes: ['light'], chatCss: bananaCocoaChat, mainColor: '#6b3f18', secondaryColor: '#b2c7da',
    },
    {
        id: 'builtin:scratch-white', slug: 'scratch-white', name: 'Scratch White', version: '1.0.0', license: 'GPL-3.0',
        attribution: 'RisuTanium contributors', modes: ['light'], chatCss: scratchWhiteChat, mainColor: '#1f4aa8', secondaryColor: '#fdfdfa',
    },
    {
        id: 'builtin:office-sheet', slug: 'office-sheet', name: 'Office Sheet', version: '1.0.0', license: 'GPL-3.0',
        attribution: 'RisuTanium contributors', modes: ['light'], chatCss: officeSheetChat, mainColor: '#1a55ba', secondaryColor: '#f3f4f6',
    },
]

/** An exact match on the id; an id of a newer build's built-in is not found. */
export function builtinPackById(id: string): BuiltinPack | null {
    return BUILTIN_PACKS.find((pack) => pack.id === id) ?? null
}
