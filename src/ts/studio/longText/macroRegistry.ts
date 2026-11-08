/**
 * Heavy half of the macro list: it imports the CBS registry, which pulls the
 * stores module. Callers load it lazily; `macroIndex.ts` stays pure.
 */
import { defaultCBSRegisterArg, registerCBS } from '../../cbs'
import { buildMacroEntries, type MacroEntry } from './macroIndex'

export function collectMacroEntries(): MacroEntry[] {
    return buildMacroEntries(registerCBS, defaultCBSRegisterArg)
}
