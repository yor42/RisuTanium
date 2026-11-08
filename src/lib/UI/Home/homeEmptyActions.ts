import { SettingsMenuIndex, DBState, settingsOpen } from 'src/ts/stores.svelte'
import { firstIndexOf } from 'src/ts/settingsShell/settingsPages'

// The character modules are imported on demand: they pull in most of the app, and Home only needs
// them once an action runs.

/**
 * Creates a blank character and selects it. The selection is awaited here, not left to the hero:
 * the hero unmounts as soon as the new slot is pushed, and that must not skip the selection.
 */
export async function createCharacterFromHome(): Promise<void> {
    const { createNewCharacter, changeChar } = await import('src/ts/characters')
    const index = createNewCharacter()
    await changeChar(index)
}

/**
 * Runs the import picker and selects the new last slot only when a character was added. A cancelled
 * picker or a preset or module file adds none, and selecting then would open a trashed or hidden slot.
 * The length is read before the first await, so it is the length the user saw.
 */
export async function importCharacterFromHome(): Promise<void> {
    const before = DBState.db.characters.length
    const { importCharacter } = await import('src/ts/characterCards')
    await importCharacter()
    if (DBState.db.characters.length > before) {
        const { changeChar } = await import('src/ts/characters')
        await changeChar(DBState.db.characters.length - 1)
    }
}

/**
 * Opens Settings at the Personas page. This is a plain open, not the fix route: it marks no return to
 * the chat, so Back is the standard page, index, close sequence and the opener's focus is restored.
 */
export function openPersonaSettings(): void {
    SettingsMenuIndex.set(firstIndexOf('personas'))
    settingsOpen.set(true)
}
