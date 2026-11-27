// What the latest reported commit says about one preset's toggle edit, for the preset save ack. Pure: the commit's
// unsavable-item set and the live preset lookup are injected (`productionPresetAckSubject` wires the real ones).
// An edit lands in the preset's slot or, for the active preset, in the working settings, so both homes are judged.

import type { SkippedItemScope } from '../../storage/store2/codec/types'
import { PRESET_FIELDS } from './presetFields'

// `saved`: the commit stored the change. `unsavable`: a working setting the preset's fields live in is refused, so its
// saved copy is kept. `blocked`: the change is not confirmed in the store, because the preset list was carried whole or
// the preset is not one live preset now.
export type PresetCommitVerdict = 'saved' | 'unsavable' | 'blocked'

export interface PresetVerdictProbe {
    isItemUnsavable(scope: SkippedItemScope, key: string): boolean
    // Whether exactly one preset holds the id now.
    presetLive(presetId: string): boolean
}

// Every working setting a preset field can be live in: the union over the table, not only the active preset's, because
// the verdict runs after the plan was encoded and a switch may have moved the edit between the two homes.
const WORKING_KEYS: readonly string[] = [...new Set(
    Object.values(PRESET_FIELDS).flatMap((spec) => (spec.db === 'slotOnly' ? [] : [spec.db])),
)]

// The order is load-bearing: a refused working setting is a refusal Retry cannot help, so it is judged before the
// carried list; a carried list or a missing preset is only unconfirmed.
export function presetCommitVerdict(presetId: string, probe: PresetVerdictProbe): PresetCommitVerdict {
    for (const key of WORKING_KEYS) {
        if (probe.isItemUnsavable('settings', key)) {
            return 'unsavable'
        }
    }
    if (probe.isItemUnsavable('presets', 'presets')) {
        return 'blocked'
    }
    if (!probe.presetLive(presetId)) {
        return 'blocked'
    }
    return 'saved'
}
