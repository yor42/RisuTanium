// Decorator counting for lorebook content. It runs the real `CCardLib.decorator.parse` with a callback that
// mirrors the return values of the application's callback in `lorebook.svelte.ts` (the `activateLoreFull`
// parse): a `false` return makes the parser run the following `@@@` fallback line, `undefined` skips it.
// The mirror table below is copied from that callback; when the callback changes, this table must follow.
import { CCardLib } from '@risuai/ccardlib'
import { DECORATOR_NAMES, type DecoratorKey } from './schema'

export type DecoratorCount = {
    /** Keys from the fixed label list, one per callback invocation, in order. */
    keys: DecoratorKey[]
    /** Length in code points of the body the parser returned; null when the application's callback would throw. */
    bodyLength: number | null
    threw: boolean
}

class MirrorThrow {}

const NAMES: readonly string[] = DECORATOR_NAMES

/** The fixed label of a decorator name; never the name itself. */
export function decoratorKey(name: string): DecoratorKey {
    const index = NAMES.indexOf(name)
    return index >= 0 ? DECORATOR_NAMES[index] : 'other'
}

const notANumber = (arg: readonly string[]): boolean => Number.isNaN(parseInt(arg[0]))

/** Whether the application's callback returns `false` for this decorator and argument list. */
function returnsFalse(name: string, arg: readonly string[]): boolean {
    switch (name) {
        case 'activate_only_after':
        case 'activate_only_every':
        case 'depth':
        case 'reverse_depth':
        case 'is_greeting':
            return notANumber(arg)
        case 'keep_activate_after_match':
        case 'dont_activate_after_match':
        case 'instruct_depth':
        case 'reverse_instruct_depth':
        case 'instruct_scan_depth':
        case 'is_user_icon':
            return true
        case 'role':
            return !(arg[0] === 'user' || arg[0] === 'assistant' || arg[0] === 'system')
        case 'scan_depth':
            return notANumber(arg) || parseInt(arg[0]) < 0
        case 'position': {
            // The application reads `arg[0].startsWith` and throws when the argument is missing.
            if (arg[0] === undefined) throw new MirrorThrow()
            return !(arg[0].startsWith('pt_') || ['after_desc', 'before_desc', 'personality', 'scenario'].includes(arg[0]))
        }
        case 'disable_ui_prompt':
            return !(arg[0] === 'post_history_instructions' || arg[0] === 'system_prompt')
        case 'end':
        case 'inject_lore':
        case 'inject_at':
        case 'inject_replace':
        case 'inject_prepend':
        case 'ignore_on_max_context':
        case 'additional_keys':
        case 'exclude_keys':
        case 'exclude_keys_all':
        case 'match_full_word':
        case 'match_partial_word':
        case 'activate':
        case 'dont_activate':
        case 'probability':
        case 'priority':
        case 'unrecursive':
        case 'recursive':
        case 'no_recursive_search':
            return false
        default:
            return true
    }
}

export function codePointLength(text: string): number {
    let length = 0
    for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i)
        if (unit >= 0xD800 && unit <= 0xDBFF && i + 1 < text.length) {
            const next = text.charCodeAt(i + 1)
            if (next >= 0xDC00 && next <= 0xDFFF) i++
        }
        length++
    }
    return length
}

/** Counts the callback invocations and the body length of one lore entry's content. Any other error propagates. */
export function countDecorators(content: string): DecoratorCount {
    const keys: DecoratorKey[] = []
    try {
        const body = CCardLib.decorator.parse(content, (name, arg) => {
            keys.push(decoratorKey(name))
            return returnsFalse(name, arg) ? false : undefined
        })
        return { keys, bodyLength: codePointLength(body), threw: false }
    } catch (error) {
        if (error instanceof MirrorThrow) return { keys, bodyLength: null, threw: true }
        throw error
    }
}
