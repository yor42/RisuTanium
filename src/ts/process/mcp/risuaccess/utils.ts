import { getCurrentCharacter, type character, type groupChat } from 'src/ts/storage/database.svelte'
import { DBState } from 'src/ts/stores.svelte'
import type { MCPToolCallContext } from '../mcplib'
import type { RunSubject } from '../../chatOrigin'
import { readArchivedCharacter, restoreArchivedForWrite } from '../../coldCharacterAccess'
import { findChaIdHolders } from '../../coldCharacterRestore'

/**
 * With an `id`, the character with that id or name. Without one, the subject's owner when the call
 * carries a subject (undefined when the subject is gone or ambiguous -- never the selection), and the
 * selected character when it does not.
 */
export function getCharacter(id: string, subject?: RunSubject): character | groupChat {
  if (id) {
    return DBState.db.characters.find((c) => c.chaId === id || c.name === id)
  }
  if (subject) {
    return subject.resolve()?.owner
  }
  return getCurrentCharacter()
}

/**
 * Fork-specific internal API: `getCharacter` for a READ tool. An archived character (a placeholder in
 * the list) comes back as the full character read from its unit, as an independent copy: the
 * placeholder stays in its slot and nothing is marked for save. A missing, unreadable or mismatched
 * unit throws, which `RisuAccessClient.callTool` reports as error text; the user gets one alert that
 * names the character. A group placeholder comes back as it is, since no tool reads a group's data.
 */
export async function getCharacterForRead(id: string, subject?: RunSubject): Promise<character | groupChat> {
  const found = getCharacter(id, subject)
  if (!found?.coldstorage || found.type === 'group') {
    return found
  }
  const copy = await readArchivedCharacter(found)
  if (copy.status === 'failed') {
    throw new Error(copy.message)
  }
  return copy.character
}

/**
 * Fork-specific internal API (CHORE-01): resolves a character for a MUTATING risuaccess tool. The user's
 * approval is asked at the gate before the handler runs, and a handler can still await a cold restore
 * before it writes, so the write goes through `recheckCharacterForWrite` first; this only names the
 * character the handler is about.
 */
export function getCharacterForWrite(id: string, ctx: MCPToolCallContext): character | groupChat {
  return getCharacter(id, ctx.subject)
}

/**
 * Fork-specific internal API (CHORE-01): the character a mutating tool writes, resolved again before the
 * write. Records its chaId in the per-call context (`touched`); the save marks of a whole call
 * are flushed in one place, `RisuAccessClient.callTool`'s `finally` (client.ts), which also covers a
 * handler that throws after a partial write. A refused write records nothing.
 *
 * A call that carries a subject and no `id` resolves the subject again: null when it is gone or
 * ambiguous. The check that the result still has the chaId chosen earlier is defensive only, since a
 * subject's owner is found by its origin's chaId.
 *
 * Any other call finds the character in the list again: the character chosen earlier while
 * it is still there, else the sole holder of its chaId, because the character may have been restored,
 * replaced or deleted since. Null when none is found (the tool then reports that
 * the character is gone). When that character is still an archived placeholder it is restored
 * from its unit first and the write goes to the restored character, found again by chaId; a failed
 * restore throws (reported as error text by `callTool`), leaves the placeholder unchanged and shows
 * the user one alert naming the character.
 */
export async function recheckCharacterForWrite(id: string, ctx: MCPToolCallContext, chosen: character): Promise<character | null> {
  let current = !id && ctx.subject ? getCharacter(id, ctx.subject) : findLiveCharacter(chosen)
  if (!current || current.type === 'group' || current.chaId !== chosen.chaId) {
    return null
  }
  if (current.coldstorage) {
    const ready = await restoreArchivedForWrite(current.chaId)
    if (ready.status === 'failed') {
      throw new Error(ready.message)
    }
    if (ready.status === 'gone') {
      return null
    }
    current = ready.character as character
  }
  if (current.chaId) {
    ctx.touched.add(current.chaId)
  }
  return current
}

/**
 * The character in the list that `chosen` stood for: `chosen` itself while it is still in the list,
 * else the sole holder of its chaId.
 */
function findLiveCharacter(chosen: character): character | groupChat | undefined {
  const characters = DBState.db.characters
  if (characters.includes(chosen)) {
    return chosen
  }
  if (!chosen.chaId) {
    return undefined
  }
  const holders = findChaIdHolders(chosen.chaId)
  return holders.length === 1 ? characters[holders[0]] : undefined
}
