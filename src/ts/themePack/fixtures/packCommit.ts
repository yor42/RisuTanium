// Test-only builders over the apply core's commit input and prepared elements (not part of the app bundle).
import type { SchemeTone } from '../../gui/surfaceTone'
import type { CommitInput, Prepared } from '../apply'

/** A commit input with one chat element whose colour text is `text`; the shape text defaults to none and the base to dark. */
export function chatCommitInput(text: string, options: { blobs?: readonly string[]; base?: SchemeTone; shapeText?: string | null; colours?: boolean } = {}): CommitInput {
    const input: CommitInput = {
        elements: [{ area: 'chat', text, shapeText: options.shapeText ?? null, base: options.base ?? 'dark' }],
        blobs: options.blobs ?? [],
    }
    return options.colours === undefined ? input : { ...input, colours: options.colours }
}

/** The chat element of an accepted pack, or an element with no text when the pack has no chat sheet. */
export function chatElementOf(prepared: Extract<Prepared, { ok: true }>): { text: string | null; shapeText: string | null; base: SchemeTone } {
    const chat = prepared.elements.find((element) => element.area === 'chat')
    return { text: chat?.text ?? null, shapeText: chat?.shapeText ?? null, base: chat?.base ?? 'dark' }
}