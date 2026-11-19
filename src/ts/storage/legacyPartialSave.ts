import { language } from 'src/lang'
import { describeOmittedCounts } from '../drive/describeOmitted'
import type { SalvageOmittedBlock } from './risuSave'
import { backupDate } from './store2/ui/bootText'

/**
 * What a read-only legacy page installed that is not the whole current save: the numbered backup it opened instead of the
 * main file (`backupTime`, in tenths of a second, or null when the main file was installed) and what the lenient decode
 * left out of the installed tree. Set once per page life by the boot, after the page may go live; the `.bin` export reads it
 * to ask before it writes.
 */
export interface LegacyPartialSave {
    backupTime: number | null
    omitted: ReadonlyMap<string, SalvageOmittedBlock>
}

let legacyPartialSave: LegacyPartialSave | null = null

export function getLegacyPartialSave(): LegacyPartialSave | null {
    return legacyPartialSave
}

export function setLegacyPartialSave(fact: LegacyPartialSave | null): void {
    legacyPartialSave = fact
}

export function resetLegacyPartialSaveForTests(): void {
    legacyPartialSave = null
}

/**
 * The fact of an installed tree, or null when it is the whole current save: a backup was not opened and nothing the person
 * cares about was left out. The same list decides the notice and the export prompt.
 */
export function legacyPartialFact(backupTime: number | null, omitted: ReadonlyMap<string, SalvageOmittedBlock>): LegacyPartialSave | null {
    if (backupTime === null && describeOmittedCounts(omitted).length === 0) {
        return null
    }
    return { backupTime, omitted }
}

/** The notice a page that opened from a backup or a partial tree posts once, after it may go live. */
export function legacyPartialNoticeText(fact: LegacyPartialSave): string {
    const items = describeOmittedCounts(fact.omitted)
    return fact.backupTime === null
        ? language.legacyPartialNotice(items)
        : language.legacyBackupNotice(backupDate(fact.backupTime), items)
}

/** The question a `.bin` export asks before it writes from such a page. */
export function legacyPartialExportText(fact: LegacyPartialSave): string {
    return language.legacyPartialExportConfirm(fact.backupTime === null ? null : backupDate(fact.backupTime), describeOmittedCounts(fact.omitted))
}
