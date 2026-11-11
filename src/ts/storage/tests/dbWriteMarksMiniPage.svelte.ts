import { flushSync } from 'svelte'
import { createSaveScheduler } from 'src/ts/storage/saveScheduler'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { registerDbChangeEffects } from 'src/ts/storage/dbChangeEffects.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'

// Mirrors saveDbStore2's wiring from the real save pieces: one scheduler whose onMark sets the page dirty flag,
// the explicit-mark install, and the change effects calling the same schedule. The caller owns DBState.db.
export function startMiniPage() {
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    let dirty = false
    let marks = 0
    let effectMarks = 0
    const scheduler = createSaveScheduler({
        debounceMs: 500,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        hooks: {
            onMark(markDirty) { marks++; if (markDirty) dirty = true },
            onDue() {},
            onRequestNow() { marks++; dirty = true },
        },
    })
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => scheduler.schedule() })
    const stopEffects = $effect.root(() => {
        registerDbChangeEffects({ tracker, markChanged: (markDirty) => { effectMarks++; scheduler.schedule(markDirty) } })
    })
    flushSync()
    return {
        tracker,
        get dirty() { return dirty },
        get marks() { return marks },
        get effectMarks() { return effectMarks },
        /** What the snapshot-taken step plus the tracker trim do to the page state. */
        snapshot() {
            dirty = false
            tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]
            tracker.botPreset = tracker.modules = tracker.loadouts = tracker.plugins = tracker.pluginCustomStorage = false
        },
        stop() { stopEffects(); resetCharacterSaveMarksForTest() },
    }
}

export function makeDb() {
    const chat = (id: string) => ({ id, message: [{ role: 'char', data: 'base', chatId: id + '-m0' }] })
    return {
        characters: [
            { chaId: 'cA', type: 'character', name: 'A', personality: '', chatPage: 0, chats: [chat('A0')] },
            { chaId: 'cB', type: 'character', name: 'B', personality: '', chatPage: 0, chats: [chat('B0')] },
        ],
        botPresets: [], botPresetsId: 0, modules: [], loadouts: [], plugins: [], pluginCustomStorage: {}, theme: '',
    }
}
