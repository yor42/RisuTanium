/**
 * A module file that is not usable: its message is the user-facing reason and is shown as text, without a stack trace.
 * Any other error out of a module import is an unexpected failure and is shown with its details.
 *
 * This lives apart from `modules.ts` because tests that mock `src/ts/process/modules` wholesale would leave the class
 * undefined, and `instanceof ModuleRefusal` in a caller would then throw.
 */
export class ModuleRefusal extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ModuleRefusal'
    }
}

/** The value to hand to `alertError` for an error out of a module import: a refusal as its text, anything else as is. */
export function importErrorMessage(error: unknown): string | Error {
    if (error instanceof ModuleRefusal) {
        return error.message
    }
    return error instanceof Error ? error : String(error)
}
