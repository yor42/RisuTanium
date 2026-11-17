import type { Database } from '../../storage/database.svelte'

export type MemoryEngine = 'none' | 'supaMemory' | 'hypaV2' | 'hanuraiMemory' | 'hypaV3'

type EngineFields = Pick<Database, 'hanuraiEnable' | 'hypav2' | 'hypaV3' | 'supaModelType' | 'memoryAlgorithmType'>

/**
 * The engine the chat runtime dispatches to. Each flag is tested by truthiness
 * in the runtime's precedence order (hanurai, V2, V3, then SupaMemory when a
 * summary model is set), so an undefined `supaModelType` reads as SupaMemory
 * exactly as it runs.
 */
export function memoryEngineOf(db: Pick<EngineFields, 'hanuraiEnable' | 'hypav2' | 'hypaV3' | 'supaModelType'>): MemoryEngine {
    if (db.hanuraiEnable) return 'hanuraiMemory'
    if (db.hypav2) return 'hypaV2'
    if (db.hypaV3) return 'hypaV3'
    if (db.supaModelType !== 'none') return 'supaMemory'
    return 'none'
}

/**
 * Selects an engine by writing all five fields every time, so no stale flag
 * from a previous choice survives.
 */
export function setMemoryEngine(db: EngineFields, engine: MemoryEngine): void {
    switch (engine) {
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
}
