import type { language } from 'src/lang'

type PlainTextKey = {
    [K in keyof typeof language]: (typeof language)[K] extends string ? K : never
}[keyof typeof language]

export type StudioFlipBlock = {
    kind: 'draft'
    reasonKey: PlainTextKey
}

// Seam for the switch row: a pending Studio draft refuses a flip. Studio has no drafts yet,
// so there is never a blocker; the editing stage fills this in.
export function studioFlipBlocker(): StudioFlipBlock | null {
    return null
}
