// The database side of update all: which owners a rename's update reaches, and the port that reads and writes their
// texts. Every write goes through the guards of a Studio write (`resolveLiveTarget`, `writeLiveModule`) and records no
// history step. A character write marks through `writeLiveCharacter`; a module write adds an explicit `modules` mark.
//
// Invariants:
// - A character is an owner only when `resolveLiveTarget` accepts it (selected, one holder, not a group, not private,
//   not archived); a module only when exactly one slot holds its id and that slot is not a stub.
// - The live module object is never mutated: a write assigns a new object to its slot.
// - A landed character write marks the character once; a landed module write marks `modules` and arms `settle`.
import { markDbWrite } from '../../storage/characterSaveMarks'
import { writeLiveCharacter } from '../../liveCharacterWrite'
import { isModuleStub } from '../../storage/moduleStub'
import { DBState } from '../../stores.svelte'
import { cbsPatternTargets } from '../toggleUses'
import { enumerateClassifiedTargets, rewritableTextAt, type ClassifiedTarget } from '../assets/referenceTargets'
import { characterOwnerKey, moduleOwnerKey } from '../history/ownerPhase'
import { primeStudioModuleSlots, studioModuleSlotReplaced } from '../history/studioHistoryService.svelte'
import { readOwnerModel } from '../ownerSource.svelte'
import type { ToggleTarget } from '../toggleBuilder.svelte'
import { writeOpFor, type Unreached, type UpdatePort, type UpdateReach, type UseOwner, type UseOwnerRef } from '../toggleUpdateAll'
import { moduleSlotsWithId } from './assetSetters'
import { applyCharacterWrites, buildWrittenModule, isModuleTarget, resolveLiveTarget, writeLiveModule, type SetterRefusal } from './studioSetters'

function unreachedReason(refusal: SetterRefusal): Unreached['reason'] {
    if (refusal === 'duplicate-id') {
        return 'duplicateCharacter'
    }
    return refusal === 'restricted' || refusal === 'group' ? 'restricted' : 'notLoaded'
}

function characterNameOf(chaId: string): string {
    return DBState.db.characters?.find((slot) => slot?.chaId === chaId)?.name ?? chaId
}

/**
 * The owners an update of this toggle owner's renames reads: the bound character when a Studio write may address it,
 * the toggle owner module, and every active module that is resident and has a unique id. Every other owner is named
 * in `unreached` with the reason, and none of its text is read.
 */
export function readUpdateReach(target: ToggleTarget, chaId: string): UpdateReach {
    const owners: UseOwner[] = []
    const unreached: Unreached[] = []
    const model = readOwnerModel(chaId)
    if (!model) {
        return { owners, unreached: [{ name: characterNameOf(chaId), reason: 'restricted' }] }
    }

    const character = resolveLiveTarget(characterOwnerKey(chaId))
    if (character.ok === true) {
        const live = character.target.character
        const targets: ClassifiedTarget[] = [
            ...enumerateClassifiedTargets({ kind: 'character', source: live }),
            ...cbsPatternTargets({ kind: 'character', source: live }),
        ]
        owners.push({
            ref: { kind: 'character', chaId },
            key: characterOwnerKey(chaId),
            name: live.name,
            toggleText: typeof live.customModuleToggle === 'string' ? live.customModuleToggle : '',
            targets,
        })
    } else {
        unreached.push({ name: characterNameOf(chaId), reason: unreachedReason(character.reason) })
    }

    const seen = new Set<string>()
    const addModule = (id: string, name: string, stubNode: boolean) => {
        if (seen.has(id)) {
            return
        }
        seen.add(id)
        if (stubNode) {
            unreached.push({ name, reason: 'notLoaded' })
            return
        }
        const slots = moduleSlotsWithId(DBState.db.modules, id)
        // A slot count other than one covers a shared id and a row-suffixed owner id; a stub slot is the `writeLiveModule` refusal.
        if (slots.length !== 1 || isModuleStub(slots[0].module)) {
            unreached.push({ name, reason: 'sharedId' })
            return
        }
        const live = slots[0].module as Parameters<typeof buildWrittenModule>[0]
        owners.push({
            ref: { kind: 'module', moduleId: id },
            key: moduleOwnerKey(id),
            name,
            toggleText: typeof live.customModuleToggle === 'string' ? live.customModuleToggle : '',
            targets: [
                ...enumerateClassifiedTargets({ kind: 'module', source: live }),
                ...cbsPatternTargets({ kind: 'module', source: live }),
            ],
        })
    }
    if (target.kind === 'module') {
        const ownSlots = moduleSlotsWithId(DBState.db.modules, target.moduleId)
        const own = ownSlots[0]?.module as { name?: string } | undefined
        // A lone stub slot is a module that is not loaded, as it is for an active node.
        addModule(target.moduleId, own?.name ?? target.moduleId, ownSlots.length === 1 && isModuleStub(own))
    }
    for (const node of model.modules) {
        addModule(node.id, node.name, node.stub)
    }
    if (owners.some((owner) => owner.ref.kind === 'module')) {
        void primeStudioModuleSlots()
    }
    return { owners, unreached }
}

/** The port over the live database. `settle` runs the module slot port once when a module write landed. */
export function createUpdateDbPort(): UpdatePort {
    let moduleWritten = false
    return {
        read(ref: UseOwnerRef, path: string): string | null | 'gone' {
            if (ref.kind === 'character') {
                const resolved = resolveLiveTarget(characterOwnerKey(ref.chaId))
                return resolved.ok ? rewritableTextAt({ kind: 'character', source: resolved.target.character }, path) : 'gone'
            }
            const resolved = resolveLiveTarget(moduleOwnerKey(ref.moduleId), () => ref.moduleId)
            if (!resolved.ok || !isModuleTarget(resolved.target)) {
                return 'gone'
            }
            return rewritableTextAt({ kind: 'module', source: resolved.target.module }, path)
        },
        write(ref, writes) {
            const ops = writes.map((write) => writeOpFor(ref.kind, write.path, write.value))
            if (ref.kind === 'character') {
                if (!resolveLiveTarget(characterOwnerKey(ref.chaId)).ok) {
                    return false
                }
                return writeLiveCharacter(ref.chaId, (live) => applyCharacterWrites(live, ops, null))
            }
            const landed = writeLiveModule(ref.moduleId, (live) => buildWrittenModule(live, ops, { folder: { kind: 'keep' }, retained: null }))
            if (landed) {
                moduleWritten = true
                markDbWrite({ kind: 'setting', key: 'modules' })
            }
            return landed
        },
        settle() {
            if (moduleWritten) {
                moduleWritten = false
                studioModuleSlotReplaced()
            }
        },
    }
}
