import { updateInlayScreen } from '../../process/inlayScreenFill'
import type { character } from '../../storage/database.svelte'
import type { FieldValue, LiveReader, Op, WriteOp } from '../history/historyModel'
import type { SetPath } from '../history/fieldRegistry'
import type { EditBuildResult } from './studioSetters'

// The classic mode-switch fill, as one history step: the mode (or inlay) switch plus the `newGenData` keys the classic
// `updateInlayScreen` would change. The fill is computed by running `updateInlayScreen` itself on a plain copy of the
// three fields it reads, so the wording and the keep-author-text rule stay in one place.

export type ScreenMode = character['viewScreen']

export type NewGenPath = 'newGenData.prompt' | 'newGenData.negative' | 'newGenData.instructions' | 'newGenData.emotionInstructions'
type GenKey = 'prompt' | 'negative' | 'instructions' | 'emotionInstructions'

export const NEW_GEN_PATHS: readonly NewGenPath[] = [
    'newGenData.prompt',
    'newGenData.negative',
    'newGenData.instructions',
    'newGenData.emotionInstructions',
]

const KEY_OF: { readonly [P in NewGenPath]: GenKey } = {
    'newGenData.prompt': 'prompt',
    'newGenData.negative': 'negative',
    'newGenData.instructions': 'instructions',
    'newGenData.emotionInstructions': 'emotionInstructions',
}

export type ScreenModeChange = { viewScreen: ScreenMode } | { inlay: boolean }

type FillInput = Pick<character, 'viewScreen' | 'inlayViewScreen' | 'newGenData'>

function modeOf(value: FieldValue): ScreenMode {
    return value.had === true && (value.value === 'emotion' || value.value === 'imggen') ? value.value : 'none'
}

function textOf(value: FieldValue): string {
    return value.had === true && typeof value.value === 'string' ? value.value : ''
}

// The classic result of `updateInlayScreen` for a plain copy; a missing key reads as '' (which the classic code treats
// like a missing one).
function classicFill(viewScreen: ScreenMode, inlay: boolean, current: Readonly<Record<GenKey, string>>): Record<GenKey, string> {
    const copy: FillInput = { viewScreen, inlayViewScreen: inlay, newGenData: { ...current } }
    const filled = updateInlayScreen(copy).newGenData
    return {
        prompt: filled?.prompt ?? '',
        negative: filled?.negative ?? '',
        instructions: filled?.instructions ?? '',
        emotionInstructions: filled?.emotionInstructions ?? '',
    }
}

const EMPTY_GEN: Readonly<Record<GenKey, string>> = { prompt: '', negative: '', instructions: '', emotionInstructions: '' }

// The default wording of one `newGenData` path under a mode and inlay setting: what the fill writes when the key is empty.
export function modeDefaultOf(path: NewGenPath, viewScreen: ScreenMode, inlay: boolean): string {
    return classicFill(viewScreen, inlay, EMPTY_GEN)[KEY_OF[path]]
}

export function buildScreenModeSwitch(change: ScreenModeChange, live: LiveReader): EditBuildResult {
    const switchPath: SetPath = 'viewScreen' in change ? 'viewScreen' : 'inlayViewScreen'
    const beforeSwitch = live.field(switchPath)
    // An absent required `viewScreen` cannot be put back by an undo.
    if (switchPath === 'viewScreen' && !beforeSwitch.had) {
        return { ok: false, reason: 'precondition' }
    }
    const afterSwitchValue = 'viewScreen' in change ? change.viewScreen : change.inlay
    if (beforeSwitch.had && beforeSwitch.value === afterSwitchValue) {
        return { ok: false, reason: 'unchanged' }
    }
    const viewScreen = 'viewScreen' in change ? change.viewScreen : modeOf(live.field('viewScreen'))
    const inlayBefore = live.field('inlayViewScreen')
    const inlay = 'inlay' in change ? change.inlay : inlayBefore.had === true && inlayBefore.value === true
    const readings = NEW_GEN_PATHS.map((path) => ({ path, reading: live.field(path) }))
    const current: Record<GenKey, string> = {
        prompt: textOf(readings[0].reading),
        negative: textOf(readings[1].reading),
        instructions: textOf(readings[2].reading),
        emotionInstructions: textOf(readings[3].reading),
    }
    const filled = classicFill(viewScreen, inlay, current)

    const afterSwitch: FieldValue = { had: true, value: afterSwitchValue }
    const ops: Op[] = [{ op: 'set', path: switchPath, before: beforeSwitch, after: afterSwitch }]
    const writes: WriteOp[] = [{ op: 'set', path: switchPath, value: afterSwitch }]
    for (const { path, reading } of readings) {
        const target = filled[KEY_OF[path]]
        // A key whose live reading already equals the classic string gets no op.
        if (reading.had === true && reading.value === target) {
            continue
        }
        const after: FieldValue = { had: true, value: target }
        ops.push({ op: 'set', path, before: reading, after })
        writes.push({ op: 'set', path, value: after })
    }
    return {
        ok: true,
        label: { kind: 'field', field: switchPath },
        ops,
        writes,
        coalesceKey: null,
        pageFm: null,
    }
}
