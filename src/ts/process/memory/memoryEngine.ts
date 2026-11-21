import type { Database } from '../../storage/database.svelte'

export type MemoryEngine = 'none' | 'supaMemory' | 'hypaV2' | 'hanuraiMemory' | 'hypaV3' | 'chroMemory'

type EngineFields = Pick<Database, 'hanuraiEnable' | 'hypav2' | 'hypaV3' | 'supaModelType' | 'memoryAlgorithmType' | 'ltmEngine'>

export type LegacyEngineFields = Pick<Database, 'hanuraiEnable' | 'hypav2' | 'hypaV3' | 'supaModelType' | 'hypaMemory'>

const NO_LEGACY: Readonly<LegacyEngineFields> = Object.freeze({
    hanuraiEnable: false,
    hypav2: false,
    hypaV3: false,
    supaModelType: 'none',
    hypaMemory: false,
})

/**
 * Strict on purpose: only the boolean `true` selects ChroMemory, so a bad
 * persisted shape reads as off and the legacy engines keep running.
 */
export function chroMemoryOn(db: Pick<Database, 'ltmEngine'>): boolean {
    return db.ltmEngine === true
}

/**
 * The legacy engine flags as the runtime and the UI must read them. While
 * ChroMemory is on it wins over whatever the legacy flags say (an imported
 * profile can hold any combination), so every legacy engine reads as off;
 * otherwise this is the database itself and every legacy chain is unchanged.
 */
export function legacyEngineFields<T extends LegacyEngineFields & Pick<Database, 'ltmEngine'>>(db: T): Readonly<LegacyEngineFields> {
    return chroMemoryOn(db) ? NO_LEGACY : db
}

/**
 * The engine the chat runtime dispatches to. ChroMemory wins when selected;
 * otherwise each flag is tested by truthiness in the runtime's precedence order
 * (hanurai, V2, V3, then SupaMemory when a summary model is set), so an
 * undefined `supaModelType` reads as SupaMemory exactly as it runs.
 */
export function memoryEngineOf(db: Pick<EngineFields, 'hanuraiEnable' | 'hypav2' | 'hypaV3' | 'supaModelType' | 'ltmEngine'>): MemoryEngine {
    if (chroMemoryOn(db)) return 'chroMemory'
    if (db.hanuraiEnable) return 'hanuraiMemory'
    if (db.hypav2) return 'hypaV2'
    if (db.hypaV3) return 'hypaV3'
    if (db.supaModelType !== 'none') return 'supaMemory'
    return 'none'
}

/**
 * Whether a legacy engine takes the chat. ChroMemory never does: it has no
 * dispatcher branch, so the send stays on the engine-off path.
 */
export function memoryTakesChatsOf(db: Pick<EngineFields, 'hanuraiEnable' | 'hypav2' | 'hypaV3' | 'supaModelType' | 'ltmEngine'>, memoryOn: boolean): boolean {
    if (!memoryOn) return false
    const engine = memoryEngineOf(db)
    return engine !== 'none' && engine !== 'chroMemory'
}

/** Whether the ChroMemory shadow retrieval runs for this send. */
export function chroMemoryShadowRuns(db: Pick<EngineFields, 'hanuraiEnable' | 'hypav2' | 'hypaV3' | 'supaModelType' | 'ltmEngine'>, memoryOn: boolean): boolean {
    return memoryOn && memoryEngineOf(db) === 'chroMemory'
}

/** Whether the per-chat memory toggle is offered: any engine, ChroMemory included. */
export function showsMemoryToggle(db: Pick<EngineFields, 'hanuraiEnable' | 'hypav2' | 'hypaV3' | 'supaModelType' | 'ltmEngine'>): boolean {
    return memoryEngineOf(db) !== 'none'
}

/**
 * Whether the active HypaV3 preset forces the per-character memory switch on.
 * Reads the legacy view, so an imported V3 preset cannot force it while
 * ChroMemory wins.
 */
export function alwaysToggleOnApplies(db: LegacyEngineFields & Pick<Database, 'ltmEngine' | 'hypaV3Presets' | 'hypaV3PresetId'>): boolean {
    return Boolean(legacyEngineFields(db).hypaV3 && db.hypaV3Presets?.[db.hypaV3PresetId]?.settings?.alwaysToggleOn)
}

/**
 * Selects an engine by writing all five legacy fields every time, so no stale
 * flag from a previous choice survives. ChroMemory also sets `ltmEngine`; a
 * legacy choice clears it only when the key exists, so a profile that never
 * chose ChroMemory gets no new key.
 */
export function setMemoryEngine(db: EngineFields, engine: MemoryEngine): void {
    switch (engine) {
        case 'chroMemory':
            db.supaModelType = 'none'
            db.memoryAlgorithmType = 'none'
            db.hypav2 = false
            db.hanuraiEnable = false
            db.hypaV3 = false
            db.ltmEngine = true
            return
        case 'supaMemory':
            db.supaModelType = 'distilbart'
            db.memoryAlgorithmType = 'supaMemory'
            db.hypav2 = false
            db.hanuraiEnable = false
            db.hypaV3 = false
            break
        case 'hanuraiMemory':
            db.supaModelType = 'none'
            db.memoryAlgorithmType = 'hanuraiMemory'
            db.hypav2 = false
            db.hanuraiEnable = true
            db.hypaV3 = false
            break
        case 'hypaV2':
            db.supaModelType = 'distilbart'
            db.memoryAlgorithmType = 'hypaMemoryV2'
            db.hypav2 = true
            db.hanuraiEnable = false
            db.hypaV3 = false
            break
        case 'hypaV3':
            db.supaModelType = 'none'
            db.memoryAlgorithmType = 'hypaMemoryV3'
            db.hypav2 = false
            db.hanuraiEnable = false
            db.hypaV3 = true
            break
        default:
            db.supaModelType = 'none'
            db.memoryAlgorithmType = 'none'
            db.hypav2 = false
            db.hanuraiEnable = false
            db.hypaV3 = false
            break
    }
    if (db.ltmEngine !== undefined) db.ltmEngine = false
}
