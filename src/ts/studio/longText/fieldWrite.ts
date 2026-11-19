import type { StudioResult } from '../history/ownerHistory.svelte'
import { detectEol } from './exampleBlocks'

/**
 * The write path of one Studio long-text field, free of the DOM and of the history service.
 *
 * A field writes only what its user typed: `owed` is set by an `input` event and by nothing else, so a
 * focus, a blur, a hide or a composition without input never rewrites the owner. A composing `input` is held
 * until the composition ends, the field blurs or a flush point asks for it. `base` is the owner's value when
 * the held text started, so text typed against one value is never written over another.
 */

export type LongTextKind = 'desc' | 'greeting' | 'note' | 'firstMessage' | 'example' | 'exampleText'
export type LongTextMode = 'cbs' | 'html+cbs' | 'plain'

export interface LongTextWritePort {
    // The owner's current stored value; null when the target is gone.
    read(): string | null
    // Null when there is no write path now (no service, not editable, target gone).
    write(value: string): StudioResult | null
    closeStep(): void
}

export interface FieldSurface {
    value(): string
    reset(value: string): void
}

export interface FieldWriteController {
    input(composing: boolean): void
    compositionStart(): void
    compositionEnd(): void
    blur(): void
    flush(reason: 'hide' | 'leave'): void
    dispose(): void
    readonly composing: boolean
    readonly owed: boolean
}

/** The text as a textarea shows it: every line ending is one LF. */
export function lf(text: string): string {
    return text.replace(/\r\n?/g, '\n')
}

/** The field's text in the line-ending style the stored text uses. `fieldValue` never holds a CR. */
export function toStored(fieldValue: string, stored: string): string {
    return detectEol(stored) === '\r\n' ? fieldValue.replace(/\n/g, '\r\n') : fieldValue
}

export function createFieldWriteController(
    port: LongTextWritePort,
    surface: FieldSurface,
    onResult: (result: StudioResult | null) => void,
): FieldWriteController {
    let owed = false
    let composing = false
    let base: string | null = null

    // Any refusal, a null write and a stale base end here. While composing nothing changes: a reset would end
    // the user's composition, so it waits for compositionend or blur.
    function resetRule(reset: boolean): void {
        if (composing) return
        if (reset) surface.reset(port.read() ?? '')
        owed = false
    }

    function commit(reset: boolean): void {
        if (!owed) return
        const stored = port.read()
        if (stored === null) {
            owed = false
            return
        }
        if (stored !== base) {
            onResult({ ok: false, reason: 'precondition' })
            resetRule(reset)
            return
        }
        const shown = surface.value()
        if (shown === lf(stored)) {
            owed = false
            return
        }
        const result = port.write(toStored(shown, stored))
        onResult(result)
        if (result !== null && result.ok) {
            owed = false
            base = port.read()
            return
        }
        resetRule(reset)
    }

    return {
        input(isComposing) {
            if (!owed) {
                owed = true
                base = port.read()
            }
            if (isComposing) {
                composing = true
                return
            }
            composing = false
            commit(true)
        },
        compositionStart() {
            composing = true
        },
        compositionEnd() {
            composing = false
            commit(true)
        },
        blur() {
            composing = false
            commit(true)
            port.closeStep()
        },
        flush(reason) {
            commit(true)
            if (reason === 'leave') port.closeStep()
        },
        dispose() {
            owed = false
            composing = false
        },
        get composing() {
            return composing
        },
        get owed() {
            return owed
        },
    }
}
