import { alertConfirm } from "../alert"
import { language } from "src/lang"

/**
 * The user chose not to import a module: they declined its low-level-access prompt (`declined`) or left a duplicate
 * out (`skipped`). It is not an error: nothing is shown for it, and the batch counts it.
 *
 * This lives apart from `modules.ts` because tests that mock `src/ts/process/modules` wholesale would leave the class
 * and the prompt undefined, and a caller in `dropImport.ts` or `characterCards.ts` would then throw on them.
 */
export class ModuleImportStopped extends Error {
    reason: 'declined' | 'skipped'

    constructor(reason: 'declined' | 'skipped') {
        super(`module import stopped: ${reason}`)
        this.name = 'ModuleImportStopped'
        this.reason = reason
    }
}

/**
 * Asks the low-level-access question for a `.risum` module before any of its assets is saved. A module without the
 * flag asks nothing. A declined prompt throws `ModuleImportStopped('declined')`; the caller saves nothing and adds no
 * module. The prompt names the module, and `file` when the import is one of several files.
 */
export async function confirmRisumLowLevel(module: {name?: string, lowLevelAccess?: boolean}, file?: string): Promise<void> {
    if (!module.lowLevelAccess) {
        return
    }
    const prompt = `${language.moduleLowLevelNamed(module.name ?? '', file)}\n${language.lowLevelAccessConfirm}`
    if (!await alertConfirm(prompt)) {
        throw new ModuleImportStopped('declined')
    }
}
