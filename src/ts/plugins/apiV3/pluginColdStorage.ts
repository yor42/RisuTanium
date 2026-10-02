import type { ColdStorageReadResult } from "src/ts/process/coldstorage.svelte"
import { coldStorageHeader, matchColdStorageLoadErrorKey } from "src/ts/process/coldstorageData"

/**
 * The slice of the database `_getPluginStorage`/`_setPluginStorage` touch.
 * Deliberately loose (not `Database` itself) so these functions can be unit
 * tested with a bare object instead of a full database fixture. `characters`
 * is only what `isPluginUnitLinkedElsewhere` reads: the links a character and
 * its chats hold to archived units.
 */
export type PluginColdStorageDb = {
    characters?: Array<{
        coldstorage?: string
        coldStoragedChats?: string[]
        chats?: Array<{ message?: Array<{ data?: string }> }>
    } | null | undefined>
    pluginCustomStorage?: {
        _coldplugin?: Record<string, string>
        [key: string]: unknown
    }
}

/**
 * True when the unit `coldId`, which the plugin slot `slotKey` maps to, is
 * linked from anything else in `db`: a character's `coldstorage`, an entry of
 * its `coldStoragedChats`, a chat's first-message pointer or legacy
 * load-error text, or another plugin slot mapped to the same unit. Writing a
 * plugin's value into such a unit would replace what that other link reads.
 *
 * One synchronous pass over `db` as it is when this is called, with no
 * storage read, so it must be called at the moment the write is decided.
 * Links held only inside an archived unit that has not been opened, or only
 * by a saved copy of the database, are not visible here.
 */
export function isPluginUnitLinkedElsewhere(db: PluginColdStorageDb, slotKey: string, coldId: string): boolean {
    const mapping = db.pluginCustomStorage?._coldplugin
    if (mapping && typeof mapping === 'object') {
        for (const otherKey of Object.keys(mapping)) {
            if (otherKey !== slotKey && mapping[otherKey] === coldId) {
                return true
            }
        }
    }
    const pointerText = coldStorageHeader + coldId
    const characters = Array.isArray(db.characters) ? db.characters : []
    for (const character of characters) {
        if (!character) {
            continue
        }
        if (character.coldstorage === coldId) {
            return true
        }
        if (Array.isArray(character.coldStoragedChats) && character.coldStoragedChats.includes(coldId)) {
            return true
        }
        const chats = Array.isArray(character.chats) ? character.chats : []
        for (const chat of chats) {
            const message = Array.isArray(chat?.message) ? chat.message[0] : undefined
            const data = message?.data
            if (typeof data === 'string' && (data === pointerText || matchColdStorageLoadErrorKey(data) === coldId)) {
                return true
            }
        }
    }
    return false
}

/**
 * Dependency-injected core of the v3 plugin API's `pluginStorage.getItem`
 * (CHORE-07 stage 7c-1, plan `Agents/Reports/13-chore07-cold-read-failure-plan.md`
 * §5.2 item 2). Factored out of `v3.svelte.ts`'s `_getPluginStorage` purely
 * so it is unit-testable without mocking that module's entire dependency
 * graph (DOMPurify, the TTS hooks, the MCP bridge, and so on) --
 * `_getPluginStorage` itself is a thin wrapper supplying the real
 * `getDatabase()` and `readColdStorageItem`.
 *
 * - no mapping for `key` -> `null`;
 * - `ok` -> the value, `?? null` (a plugin can store `null` itself, and this
 *   collapses that to `null` on the way out);
 * - `missing` -> `null`;
 * - `error` -> throws an `Error` naming `key`, but never the (possibly
 *   unreadable, or simply absent) value.
 */
export async function readPluginStorageValue(
    db: PluginColdStorageDb,
    key: string,
    readColdStorageItemFn: (coldId: string) => Promise<ColdStorageReadResult>,
): Promise<unknown> {
    const coldId = db.pluginCustomStorage?._coldplugin?.[key]
    if (!coldId) {
        return null
    }
    const result = await readColdStorageItemFn(coldId)
    if (result.status === 'missing') {
        return null
    }
    if (result.status === 'error') {
        throw new Error(`Failed to read plugin storage for key: ${key}`)
    }
    return result.value ?? null
}

/**
 * Dependency-injected core of `pluginStorage.setItem` (plan §5.2 item 2).
 *
 * - `value === undefined` is stored as `null` instead. `JSON.stringify`
 *   returns `undefined` (not a string) for `undefined`, and passing that to
 *   `TextEncoder.encode` hits its default parameter, encoding the empty
 *   string -- fflate still wraps that into a small but non-empty compressed
 *   blob, so the write itself would "succeed". The failure shows up only on
 *   the way back out: decompressing yields an empty string, and
 *   `JSON.parse('')` throws, so the blob would read back as `'error'`
 *   forever (a decode failure). Storing `null` instead avoids writing that
 *   unreadable blob at all, and `readPluginStorageValue` already turns a
 *   stored `null` back into `null` for plugins, so this is not an
 *   observable change for them.
 * - a failed write (`setColdStorageItemFn` resolving `false`) throws, and
 *   leaves `db`'s mapping untouched -- an existing mapping is left alone,
 *   and a brand-new key never gets one.
 * - a slot whose existing unit is linked from anything else in the database
 *   (`isPluginUnitLinkedElsewhere`, judged on `getLiveDb()` when the write is
 *   decided) is not written at all: it throws exactly as a failed write does
 *   and leaves the mapping and that unit as they are. A slot whose unit
 *   nothing else links is updated in place.
 * - a brand-new key's mapping is written only after the write succeeds, and
 *   into whatever `pluginCustomStorage._coldplugin` object `getLiveDb()`
 *   returns AT THAT POINT, not the one read from `db` at the top of this
 *   call -- `_clearPluginStorage` may have replaced `_coldplugin` with a
 *   fresh object while the write was in flight, and writing into the
 *   object captured before the `await` would silently undo that clear.
 */
export async function writePluginStorageValue(
    db: PluginColdStorageDb,
    getLiveDb: () => PluginColdStorageDb,
    key: string,
    value: unknown,
    setColdStorageItemFn: (coldId: string, value: unknown) => Promise<boolean>,
    newColdId: () => string,
): Promise<void> {
    db.pluginCustomStorage ??= {}
    db.pluginCustomStorage._coldplugin ??= {}
    // Falsy, not nullish: a stray empty-string mapping is treated the same
    // as no mapping (a fresh id is generated) rather than being reused as a
    // cold-storage key.
    const existingColdId = db.pluginCustomStorage._coldplugin[key]
    if (existingColdId && isPluginUnitLinkedElsewhere(getLiveDb(), key, existingColdId)) {
        throw new Error(`Failed to write plugin storage for key: ${key}`)
    }
    const coldId = existingColdId || newColdId()

    const writeSuccess = await setColdStorageItemFn(coldId, value === undefined ? null : value)

    if (!writeSuccess) {
        throw new Error(`Failed to write plugin storage for key: ${key}`)
    }

    if (!existingColdId) {
        const liveDb = getLiveDb()
        liveDb.pluginCustomStorage ??= {}
        liveDb.pluginCustomStorage._coldplugin ??= {}
        liveDb.pluginCustomStorage._coldplugin[key] = coldId
    }
}
