import { language } from '../../../lang'
import type { Database } from '../../storage/database.svelte'
import { chroMemoryOn, type LegacyEngineFields } from './memoryEngine'

/** The per-chat memory toggle's name: ChroMemory when selected, otherwise the legacy engine's. */
export function memoryToggleLabel(db: LegacyEngineFields & Pick<Database, 'ltmEngine'>): string {
    if (chroMemoryOn(db)) return language.chroMemory
    return db.hanuraiEnable ? language.hanuraiMemory : (db.hypav2 || db.hypaV3 || db.hypaMemory) ? language.ToggleHypaMemory : language.ToggleSuperMemory
}
