// The wording of the three risky flags, read from the locale when asked so a language change shows at once.

import { language } from '../../../lang'
import type { RiskyFlagPath } from './riskyFlags'

export function riskyNameOf(path: RiskyFlagPath): string {
    switch (path) {
        case 'lowLevelAccess': return language.lowLevelAccess
        case 'utilityBot': return language.utilityBot
        case 'escapeOutput': return language.escapeOutput
    }
}

export function riskyExplainOf(path: RiskyFlagPath): string {
    switch (path) {
        case 'lowLevelAccess': return language.help.lowLevelAccess
        case 'utilityBot': return language.help.utilityBot
        case 'escapeOutput': return language.studioRiskyEscapeExplain
    }
}

export function riskyAskOf(path: RiskyFlagPath): string {
    switch (path) {
        case 'lowLevelAccess': return language.studioRiskyAskLow
        case 'utilityBot': return language.studioRiskyAskUtility
        case 'escapeOutput': return language.studioRiskyAskEscape
    }
}
