// The owners of the app, other than the open character and the active preset, that define each toggle key: the combined
// toggles view names them beside a shared key. Reads only. A private, group or cold-storage character is skipped, so
// neither its keys nor its name leave it; modules are not read here because every module row is an owner of the
// model itself.
import { DBState } from '../stores.svelte'
import { workingPresetsOf } from './itemText'
import { keysOfText } from './toggleKeys'

/** Key to the display names of the other owners that define it, in character then preset order. */
export function appToggleOwners(boundChaId: string, activePreset: number): ReadonlyMap<string, readonly string[]> {
    const owners = new Map<string, string[]>()
    const add = (text: unknown, name: string) => {
        if (typeof text !== 'string') {
            return
        }
        for (const key of keysOfText(text)) {
            const names = owners.get(key)
            if (!names) {
                owners.set(key, [name])
            } else if (!names.includes(name)) {
                names.push(name)
            }
        }
    }
    for (const character of DBState.db.characters ?? []) {
        if (!character || character.type === 'group' || character.coldstorage || character.license === 'private' || character.chaId === boundChaId) {
            continue
        }
        add(character.customModuleToggle, character.name)
    }
    const db = DBState.db
    const working = workingPresetsOf(db)
    working.forEach((preset, index) => {
        if (index !== activePreset) {
            add(preset.toggles, db.botPresets[index]?.name ?? '')
        }
    })
    return owners
}
