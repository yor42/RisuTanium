import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../database.svelte'
import { registerDbChangeEffects } from '../dbChangeEffects.svelte'
import type { DbChangeEffectOptions } from '../dbChangeEffects.svelte'
import type { RisuModule } from '../../process/modules'
import type { toSaveType } from '../risuSave'
import { coldStorageHeader } from '../../process/coldstorageData'
import { toAssetList } from '../assetList'

// Guards for registerDbChangeEffects()'s preset effect
// (src/ts/storage/dbChangeEffects.svelte.ts): it must deep-read via
// `$state.snapshot(DBState.db.botPresets)`, not shallowly via
// `botPresetsId`/`.length` -- an in-place mutation of a preset object that
// changes neither the id nor the array length must still be flagged dirty,
// or `saveDb()` skips re-encoding the preset block and the change is
// silently absent after a reload.
//
// Of the eight tests below, the five that exercise in-place preset mutations
// (rename, element-write self-reassign, same-id reselect, image, nested
// promptTemplate) are the guards for that invariant. The other three --
// whole-array reorder, the first-run markChanged(false) check, and the
// effect-6 character/chat coverage -- are plain coverage unrelated to it, as
// noted in their own comments below.

//#region module mocks

// dbChangeEffects.svelte.ts only reaches into DBState/selectedCharID from
// stores.svelte, but that module also re-exports (transitively, via
// process/modules and globalApi.svelte) the full app dependency graph —
// Tauri plugins, AI providers, drive sync, etc. Replace it with a minimal
// stand-in, matching the mocking pattern in
// src/ts/parser/tests/chatVar.svelte.test.ts and
// src/ts/process/mcp/risuaccess/tests/modules.test.ts.
//
// Unlike those two files, the object here has to be genuinely reactive
// (built with $state) rather than a plain object literal, because the code
// under test is a set of $effects that must actually re-run on mutation.
vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as typeof import('../../stores.svelte')
})

//#endregion

import { DBState, selectedCharID } from '../../stores.svelte'

function makePromptItem(text: string) {
    return { type: 'plain', type2: 'main', text, role: 'user' }
}

function makePreset(name: string) {
    return {
        name,
        mainPrompt: '',
        jailbreak: '',
        globalNote: '',
        temperature: 1,
        maxContext: 4096,
        maxResponse: 500,
        frequencyPenalty: 0,
        PresensePenalty: 0,
        formatingOrder: [],
        promptPreprocess: false,
        bias: [],
        ooba: {},
        ainconfig: {},
        image: '',
        promptTemplate: [makePromptItem('a'), makePromptItem('b'), makePromptItem('c')],
    }
}

function installDb() {
    DBState.db = {
        botPresetsId: 0,
        botPresets: [makePreset('Preset 0'), makePreset('Preset 1')],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters: [],
    } as unknown as Database
}

function makeTracker(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

let cleanup: (() => void) | undefined

afterEach(() => {
    cleanup?.()
    cleanup = undefined
    selectedCharID.set(-1)
})

describe('registerDbChangeEffects — botPreset deep-read guards', () => {

    test('renaming a preset in place dirties botPreset', () => {
        installDb()
        const tracker = makeTracker()
        const markChanged = vi.fn()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.botPreset = false
        markChanged.mockClear()

        // botPresetsId and botPresets.length are both unchanged by this mutation.
        DBState.db.botPresets[1].name = 'renamed'
        flushSync()

        expect(tracker.botPreset).toBe(true)
        expect(markChanged).toHaveBeenCalledWith(true)
    })

    // THE IMPORTANT ONE. This models saveCurrentPreset() in
    // src/ts/storage/database.svelte.ts, which does an
    // element write followed by a self-assignment of the same array
    // reference:
    //
    //   db.botPresets[db.botPresetsId] = savedPreset   // element write
    //   db.botPresets = pres                           // same reference; notifies nothing
    //
    // Real call sites of that exact shape: downloadPreset()'s opening
    // `saveCurrentPreset()` call (database.svelte.ts), and
    // changeToPreset() whenever the target id equals the current id (see the
    // dedicated same-id test below for that path in full, including the
    // no-op `botPresetsId` assignment).
    test('saveCurrentPreset-style element write + self-reassignment dirties botPreset', () => {
        installDb()
        const tracker = makeTracker()
        const markChanged = vi.fn()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.botPreset = false
        markChanged.mockClear()

        const pres = DBState.db.botPresets
        const newPresetObject = { ...pres[DBState.db.botPresetsId], mainPrompt: 'edited prompt', temperature: 2 }
        pres[DBState.db.botPresetsId] = { ...newPresetObject }
        DBState.db.botPresets = pres
        flushSync()

        expect(tracker.botPreset).toBe(true)
        expect(markChanged).toHaveBeenCalledWith(true)
    })

    // Models re-selecting the ALREADY-active preset: changeToPreset(id) with
    // id === db.botPresetsId, reached from a preset hotkey
    // (initHotkey()'s keydown handler in src/ts/hotkey.ts, the ctrl+1..ctrl+9
    // switch cases calling changeToPreset(N), e.g. ctrl+1 while already on
    // preset 0) or from clicking the already-selected row in
    // src/lib/Setting/botpreset.svelte's preset-row onclick handler
    // (`changeToPreset(i)`). changeToPreset() always runs
    // saveCurrentPreset() first (the element write + self-assign above), then
    // does `db.botPresetsId = id`. Svelte skips no-op assignments via
    // Object.is equality, so that last assignment notifies nothing when id is
    // unchanged -- it is not what dirties botPreset here; the deep snapshot
    // of the mutated array is.
    test('re-selecting the already-active preset (element write + self-assign + no-op id) still dirties botPreset', () => {
        installDb()
        const tracker = makeTracker()
        const markChanged = vi.fn()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.botPreset = false
        markChanged.mockClear()

        const currentId = DBState.db.botPresetsId
        const pres = DBState.db.botPresets
        pres[currentId] = { ...pres[currentId], mainPrompt: 'edited before reselecting same preset' }
        DBState.db.botPresets = pres
        DBState.db.botPresetsId = currentId // no-op: same value, Svelte does not notify
        flushSync()

        expect(tracker.botPreset).toBe(true)
        expect(markChanged).toHaveBeenCalledWith(true)
    })

    test('setting a preset image in place dirties botPreset', () => {
        installDb()
        const tracker = makeTracker()
        const markChanged = vi.fn()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.botPreset = false

        DBState.db.botPresets[0].image = 'data:image/jpeg;base64,/9j/4AAQ...'
        flushSync()

        expect(tracker.botPreset).toBe(true)
    })

    // Guards that the effect snapshots deeply, not just one level down (i.e.
    // not e.g. only `$state.snapshot(DBState.db.botPresets[i])` for each
    // preset without recursing further).
    test('editing a nested promptTemplate entry dirties botPreset', () => {
        installDb()
        const tracker = makeTracker()
        const markChanged = vi.fn()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.botPreset = false

        ;(DBState.db.botPresets[0].promptTemplate[2] as { text: string }).text = 'changed'
        flushSync()

        expect(tracker.botPreset).toBe(true)
    })

    // Coverage only — not a guard for the deep-read invariant above.
    // movePreset() (movePreset() in src/lib/Setting/botpreset.svelte) builds
    // a brand-new plain array and assigns it wholesale, which changes
    // db.botPresets' identity. Even a shallow `.length`/id read observes a
    // new array reference, so this passes regardless of whether the effect
    // deep-reads -- it does not exercise the in-place-mutation invariant
    // tested above.
    test('reordering via whole-array reassignment dirties botPreset via the new array reference', () => {
        installDb()
        const tracker = makeTracker()
        const markChanged = vi.fn()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.botPreset = false

        const original = DBState.db.botPresets
        const reordered = [original[1], original[0]]
        DBState.db.botPresets = reordered
        flushSync()

        expect(tracker.botPreset).toBe(true)
    })

    // Invariant: on the very first flush, every effect's markChanged call
    // must report `false` (not dirty), since there is nothing to save yet.
    //
    // With installDb()'s default fixture (`characters: []`, selectedCharID
    // defaults to -1), 8 effects call markChanged on the first flush --
    // confirmed by reading the whole of `registerDbChangeEffects`:
    //   1. the preset effect
    //   2. modules outer (zero elements here, so no child)
    //   3. loadouts
    //   4. plugins
    //   5. pluginCustomStorage
    //   6. 6a (generic top-level loop)
    //   7. 6b-front (runs even with no character selected -- `if (char)`
    //                 only guards its body, not its `markChanged` call)
    //   8. 6b-char outer (same -- runs unconditionally)
    // The identity tracker is a NINTH effect but calls `markChanged` ZERO
    // times on an unseeded first run with zero characters: its loop body
    // never executes (`len` is 0), so neither the "missing from seed"
    // branch nor `markChanged` is reached -- it is not one of the 8.
    //
    // With a selected character populated (not exercised by this test, see
    // the equivalence/rebuild-count suites below), the count grows: one MORE
    // markChanged call per string key except `chats` and `chatPage` on the
    // character (a field child), one for the chats-shape effect, one per
    // chat (a per-chat child), and one per message in each chat whose
    // `message` is an array (a per-message child).
    test('first run reports markChanged(false) for every effect', () => {
        installDb()
        const tracker = makeTracker()
        const markChanged = vi.fn()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        expect(markChanged).toHaveBeenCalledTimes(8)
        for (const call of markChanged.mock.calls) {
            expect(call[0]).toBe(false)
        }
    })

    // 6b-front (the generic per-key loop plus character/chat tracking) is
    // not exercised by the tests above: installDb() sets `characters: []`
    // and selectedCharID defaults to -1, so
    // `DBState?.db?.characters?.[selIdState]` is never truthy there. Cover
    // the populated-character path directly.
    test('6b-front populates tracker.character and tracker.chat for the active character', () => {
        installDb()
        DBState.db.characters = [
            {
                chaId: 'char-0',
                chatPage: 0,
                chats: [{ id: 'chat-0', message: [], note: '', name: '', localLore: [] }],
            },
        ] as unknown as Database['characters']
        selectedCharID.set(0)

        const tracker = makeTracker()
        const markChanged = vi.fn()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        expect(tracker.character[0]).toBe('char-0')
        expect(tracker.chat[0]).toEqual(['char-0', 'chat-0'])
    })
})

// Equivalence suite for the modules partition (an outer shape-effect plus
// one child effect per element): pins that it tracks every mutation class a
// single deep-read effect over the whole `modules` array would, so nothing
// is under-tracked. The proof test below additionally pins that a leaf
// write to module k does not deep-read every other module; see its own
// comment for how that is verified.

//#region modules fixtures (Stage B)

// RisuModule's shape lives in src/ts/process/modules.ts, with nested
// loreBook/customscript/triggerscript types in database.svelte.ts and
// process/triggers.ts. Every field is given a real, present value, mirroring
// src/ts/process/tests/moduleUpdateDeps.svelte.test.ts's makeModule(), so
// that "field absent" is never an accidental variable in these tests.
type LoreBookEntry = NonNullable<RisuModule['lorebook']>[number]
type CustomScriptEntry = NonNullable<RisuModule['regex']>[number]
type TriggerEntry = NonNullable<RisuModule['trigger']>[number]
type AssetEntry = NonNullable<RisuModule['assets']>[number]

function makeModule(seed: string): RisuModule {
    const lorebookEntry: LoreBookEntry = {
        key: `key-${seed}`,
        secondkey: `secondkey-${seed}`,
        insertorder: 100,
        comment: `lorebook-comment-${seed}`,
        content: `lorebook-content-${seed}`,
        mode: 'normal',
        alwaysActive: false,
        selective: true,
    }
    const regexEntry: CustomScriptEntry = {
        comment: `regex-comment-${seed}`,
        in: '/foo/',
        out: 'bar',
        type: 'editinput',
    }
    const triggerEntry: TriggerEntry = {
        comment: `trigger-comment-${seed}`,
        type: 'manual',
        conditions: [],
        effect: [],
    }
    const assetEntry: AssetEntry = [`asset-name-${seed}`, `asset-path-${seed}`, `asset-ext-${seed}`]

    return {
        name: `Module ${seed}`,
        description: `Description for module ${seed}`,
        lorebook: [lorebookEntry],
        regex: [regexEntry],
        trigger: [triggerEntry],
        id: `module-id-${seed}`,
        assets: [assetEntry],
    }
}

function moduleWithAssetList(seed: string): RisuModule {
    const mod = makeModule(seed)
    mod.assets = toAssetList(mod.assets!)
    return mod
}

// installDb() (above) sets `modules: []`, which the count-based first-run
// test above requires (see the CRITICAL CONSTRAINT note below). Populate
// modules separately, after installDb(), rather than changing its default.
function installDbWithModules(modules: RisuModule[]) {
    installDb()
    DBState.db.modules = modules
}

function freshTrackerAndMarker() {
    const tracker = makeTracker()
    const markChanged = vi.fn()
    return { tracker, markChanged }
}

//#endregion

describe('registerDbChangeEffects — modules partition equivalence suite', () => {

    // CRITICAL CONSTRAINT: none of the tests below assert a markChanged call
    // COUNT, because with N modules populated, the first flush calls
    // markChanged 6+N times: the outer modules effect plus its N children
    // take the place of a single deep-read modules effect, so the 6
    // top-level effects become (6-1)+1+N = 6+N. (Separately,
    // a modules *shape-change* flush -- push/splice/whole-array replacement
    // -- calls markChanged N+1 times just for the modules effects: the outer
    // plus every recreated child.) Only tracker.modules and, where first-run
    // semantics matter, the markDirty ARGUMENT of every call are asserted.

    test('leaf write on modules[k].name marks dirty', () => {
        installDbWithModules([makeModule('a'), makeModule('b')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.modules = false

        DBState.db.modules[1].name = 'renamed'
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    test('nested leaf write on modules[k].lorebook[i].content marks dirty', () => {
        installDbWithModules([makeModule('a'), makeModule('b')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.modules = false

        DBState.db.modules[0].lorebook[0].content = 'changed content'
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    test('nested leaf write on modules[k].regex[i].out marks dirty', () => {
        installDbWithModules([makeModule('a'), makeModule('b')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.modules = false

        DBState.db.modules[0].regex[0].out = 'changed-out'
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    test('nested leaf write on modules[k].trigger[i].comment marks dirty', () => {
        installDbWithModules([makeModule('a'), makeModule('b')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.modules = false

        DBState.db.modules[0].trigger[0].comment = 'changed-trigger-comment'
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    // Holds for a plain list: a module added to the live database at runtime, or
    // any module while an enabled V2.1 plugin keeps the lists plain. An installed
    // `AssetList` is not tracked this way (see the two tests below).
    test('nested leaf write on a plain modules[k].assets[i][0] marks dirty', () => {
        installDbWithModules([makeModule('a'), makeModule('b')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.modules = false

        DBState.db.modules[0].assets[0][0] = 'changed-asset-name'
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    test('guard: replacing an installed AssetList marks the modules block dirty', () => {
        installDbWithModules([moduleWithAssetList('a'), moduleWithAssetList('b')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.modules = false

        DBState.db.modules[0].assets = toAssetList([['changed-asset-name', 'asset-path-a', 'asset-ext-a']])
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    // Documents why every editor change replaces the list: a leaf write on an
    // installed `AssetList` reaches no effect, so nothing is scheduled to save.
    test('guard: a leaf write on an installed AssetList is not tracked', () => {
        installDbWithModules([moduleWithAssetList('a'), moduleWithAssetList('b')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.modules = false

        DBState.db.modules[0].assets[0][0] = 'changed-asset-name'
        flushSync()

        expect(tracker.modules).toBe(false)
    })

    test('element replacement modules[k] = {...} marks dirty', () => {
        installDbWithModules([makeModule('a'), makeModule('b')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.modules = false

        DBState.db.modules[1] = { ...DBState.db.modules[1], name: 'replaced' }
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    test('push marks dirty', () => {
        installDbWithModules([makeModule('a')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.modules = false

        DBState.db.modules.push(makeModule('b'))
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    test('splice marks dirty', () => {
        installDbWithModules([makeModule('a'), makeModule('b'), makeModule('c')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.modules = false

        DBState.db.modules.splice(1, 1)
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    test('unshift marks dirty', () => {
        installDbWithModules([makeModule('a')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.modules = false

        DBState.db.modules.unshift(makeModule('z'))
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    test('in-place reorder (index swap) marks dirty', () => {
        installDbWithModules([makeModule('a'), makeModule('b')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.modules = false

        const modules = DBState.db.modules
        const first = modules[0]
        const second = modules[1]
        modules[0] = second
        modules[1] = first
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    // The real call-site pair in the remove-module button's onclick handler
    // in src/lib/Setting/Pages/Module/ModuleSettings.svelte:
    //   DBState.db.modules.splice(index, 1)
    //   DBState.db.modules = DBState.db.modules
    // Assert that this pair marks dirty. Do NOT invert this into
    // "self-assign alone does not mark" -- a negative assertion there would
    // enshrine under-marking as a spec.
    test('ModuleSettings.svelte splice + self-assign pair marks dirty', () => {
        installDbWithModules([makeModule('a'), makeModule('b'), makeModule('c')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.modules = false

        DBState.db.modules.splice(1, 1)
        DBState.db.modules = DBState.db.modules
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    test('whole-array reassignment marks dirty', () => {
        installDbWithModules([makeModule('a')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.modules = false

        DBState.db.modules = [makeModule('x'), makeModule('y')]
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    // The first-run guard is NOT "tracker.modules stays false on the first
    // run" -- it does not: `opts.tracker.modules = true` is set
    // unconditionally on every run, including the first, independent of any
    // ranOnce flag. The actual guard is that every markChanged() call's
    // argument is false on this first flush; markChanged(false) never means
    // "mark clean", so tracker.modules legitimately starting `true` after
    // mount is not a contradiction. The existing 'first run reports
    // markChanged(false) for every effect' test above covers the same
    // argument contract with installDb()'s empty modules array (and asserts
    // a call COUNT, which only survives because there are zero modules --
    // see the CRITICAL CONSTRAINT note); this is the same contract with
    // modules actually populated, asserted without a call count.
    test('first run sets tracker.modules unconditionally, but every markChanged call still receives false', () => {
        installDbWithModules([makeModule('a'), makeModule('b'), makeModule('c')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        expect(tracker.modules).toBe(true)
        expect(markChanged.mock.calls.every((call) => call[0] === false)).toBe(true)
    })

    test('mutating a module that is NOT the most recently touched one still marks dirty', () => {
        installDbWithModules([makeModule('a'), makeModule('b'), makeModule('c')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        // Touch module 2 first (making it the "most recently touched"
        // module), then clear and mutate module 0 instead.
        DBState.db.modules[2].name = 'touched-last'
        flushSync()
        tracker.modules = false

        DBState.db.modules[0].name = 'touched-earlier-module'
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    test('empty modules array does not throw, and a subsequent push marks dirty', () => {
        installDbWithModules([])
        const { tracker, markChanged } = freshTrackerAndMarker()

        expect(() => {
            cleanup = $effect.root(() => {
                registerDbChangeEffects({ tracker, markChanged })
            })
            flushSync()
        }).not.toThrow()

        // tracker.modules is set unconditionally on every run, including
        // the first, so it is already true here; reset
        // it before the push so the assertion below is meaningful.
        tracker.modules = false

        DBState.db.modules.push(makeModule('a'))
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    // "Hole/undefined entry": an explicit `undefined` element (a present
    // own property whose value is undefined), not a true sparse-array hole
    // -- but a genuine hole (e.g. `[a, , c]` assigned into a $state array)
    // behaves identically here: svelte 5.55.1,
    // node_modules/svelte/src/internal/client/proxy.js:178's `!exists` path
    // still creates an UNINITIALIZED source that gets subscribed. This
    // exercises the same defensive case: registration must not throw, and a
    // leaf write on a REAL neighbouring entry must still mark dirty.
    test('modules array containing an undefined entry does not throw, and a leaf write on a present entry still marks dirty', () => {
        installDbWithModules([makeModule('a'), undefined as unknown as RisuModule, makeModule('c')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        expect(() => {
            cleanup = $effect.root(() => {
                registerDbChangeEffects({ tracker, markChanged })
            })
            flushSync()
        }).not.toThrow()
        tracker.modules = false

        DBState.db.modules[2].name = 'renamed-c'
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    test('db.modules.length = 0 truncation marks dirty', () => {
        installDbWithModules([makeModule('a'), makeModule('b')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        tracker.modules = false

        DBState.db.modules.length = 0
        flushSync()

        expect(tracker.modules).toBe(true)
    })

    // LOAD-BEARING. Under the modules partition, a shape change tears down
    // and recreates every child effect. A leaf mutation to a PRE-EXISTING
    // module (present before the shape change) must still mark dirty
    // afterwards -- this is the exact mechanic the whole design depends on,
    // and no existing test or benchmark in this repo exercises a $effect
    // created inside a re-running $effect. A single effect that deep-read
    // the whole array regardless of prior shape changes would pass this test
    // trivially, so it only has teeth against the partitioned design.
    test('post-shape-change leaf mutation on a pre-existing module still marks dirty', () => {
        installDbWithModules([makeModule('a'), makeModule('b')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        // Shape change: push a third module.
        DBState.db.modules.push(makeModule('c'))
        flushSync()
        expect(tracker.modules).toBe(true)
        tracker.modules = false

        // Leaf mutation on a PRE-EXISTING module (index 0, present before
        // the push) must still mark dirty after teardown/recreation of the
        // per-element child effects.
        DBState.db.modules[0].name = 'renamed-after-shape-change'
        flushSync()

        expect(tracker.modules).toBe(true)
    })
})

describe('registerDbChangeEffects — modules partition narrow-read proof', () => {

    // Proves a leaf write to module k does not deep-read module j: the
    // modules partition (an outer shape-effect plus one child effect per
    // element) means a leaf write to module k only re-runs module k's own
    // child effect.
    //
    // Observability: DbChangeEffectOptions exposes only `tracker` and
    // `markChanged` -- counting child-effect runs is not observable through
    // it, and adding a production hook for this would itself be scaffolding.
    // Instead this defines an ACCESSOR property (a getter, not a data
    // property) on a fixture module. Verified against Svelte source:
    // svelte 5.55.1, node_modules/svelte/src/internal/client/proxy.js:178
    // skips creating a reactive source for a property when it exists but
    // its descriptor has no `writable` (true for a getter-only accessor),
    // so proxy.js:198's `return Reflect.get(target, prop, receiver)` falls
    // through to invoking the getter directly and untracked, on every
    // single deep read that reaches it.
    // node_modules/svelte/src/internal/shared/clone.js:83-105 -- the plain-
    // object branch of `$state.snapshot()`'s recursive clone -- walks
    // `Object.keys(value)` and reads `value[key]` for each, so it reaches
    // and fires the getter.
    test('a leaf write in module k does not deep-read module j', () => {
        let jHits = 0
        const modJ = makeModule('j')
        Object.defineProperty(modJ, 'probe', {
            get() {
                jHits++
                return 'x'
            },
            enumerable: true,
        })
        const modK = makeModule('k')

        installDbWithModules([modK, modJ])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        // The first run legitimately deep-reads everything (there is
        // nothing to narrow against yet, and the first-run guard requires it
        // not mark dirty either way); only hits AFTER this point are
        // evidence of unnecessary re-reading of module j.
        jHits = 0

        DBState.db.modules[0].name = 'k-renamed'
        flushSync()

        expect(jHits).toBe(0)
    })
})

// Tests below cover the identity tracker -- a SEPARATE $effect inside
// registerDbChangeEffects that only reacts to a character being REPLACED
// (element or whole-array), never to an in-place field edit, and marks the
// replaced element's chaId into opts.tracker via the shared appendIfAbsent
// rule. These tests drive the REAL registerDbChangeEffects() (unmodified
// from the suites above) with a populated `characters` array and, where
// relevant, the `seed` option.

describe('registerDbChangeEffects — identity tracker', () => {

    function makeChar(chaId: string, name: string): Record<string, unknown> {
        return { chaId, name, type: 'character', chatPage: 0, chats: [] }
    }

    function installDbWithCharacters(characters: Record<string, unknown>[]) {
        installDb()
        DBState.db.characters = characters as unknown as Database['characters']
    }

    test('seeded first run marks nothing, even though the seed is otherwise empty of tracking state', () => {
        installDbWithCharacters([makeChar('char-A', 'A'), makeChar('char-B', 'B')])
        // Capture the exact live proxies BEFORE registering the effect, so the
        // seed matches identity with what the effect will read on its first run.
        const seed = [DBState.db.characters[0], DBState.db.characters[1]]
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged, seed })
        })
        flushSync()

        expect(tracker.character).toEqual([])
    })

    test('an element replaced after seeding but before the first run IS marked (boot-window race)', () => {
        installDbWithCharacters([makeChar('char-A', 'A'), makeChar('char-B', 'B')])
        // Seed captures the ORIGINAL proxies (as if RisuSaveEncoder.init had
        // already encoded them)...
        const seed = [DBState.db.characters[0], DBState.db.characters[1]]
        // ...but before the identity effect's first run, char-A's element is
        // replaced (e.g. a plugin or backup load raced the encoder.init window).
        DBState.db.characters[0] = makeChar('char-A', 'A-replaced-during-init') as unknown as Database['characters'][number]

        const { tracker, markChanged } = freshTrackerAndMarker()
        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged, seed })
        })
        flushSync()

        expect(tracker.character).toEqual(['char-A'])
    })

    test('without a seed, the first run only fills the seen set and marks nothing (keeps the first-run markChanged count test valid)', () => {
        installDbWithCharacters([makeChar('char-A', 'A'), makeChar('char-B', 'B')])
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        expect(tracker.character).toEqual([])
    })

    test('splice (element removal) marks nothing: surviving elements keep their identity', () => {
        installDbWithCharacters([makeChar('char-A', 'A'), makeChar('char-B', 'B'), makeChar('char-C', 'C')])
        const { tracker, markChanged } = freshTrackerAndMarker()
        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        DBState.db.characters.splice(1, 1) // removes char-B; char-A and char-C keep their proxies
        flushSync()

        expect(tracker.character).toEqual([])
    })

    test('reorder (swap) marks nothing: only existing proxies move', () => {
        installDbWithCharacters([makeChar('char-A', 'A'), makeChar('char-B', 'B')])
        const { tracker, markChanged } = freshTrackerAndMarker()
        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        const chars = DBState.db.characters
        const first = chars[0]
        const second = chars[1]
        chars[0] = second
        chars[1] = first
        flushSync()

        expect(tracker.character).toEqual([])
    })

    test('element replacement marks exactly that chaId', () => {
        installDbWithCharacters([makeChar('char-A', 'A'), makeChar('char-B', 'B')])
        const { tracker, markChanged } = freshTrackerAndMarker()
        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        DBState.db.characters[1] = makeChar('char-B', 'B-replaced') as unknown as Database['characters'][number]
        flushSync()

        expect(tracker.character).toEqual(['char-B'])
    })

    test('whole-array replacement marks all new elements', () => {
        installDbWithCharacters([makeChar('char-A', 'A'), makeChar('char-B', 'B')])
        const { tracker, markChanged } = freshTrackerAndMarker()
        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        DBState.db.characters = [
            makeChar('char-X', 'X'),
            makeChar('char-Y', 'Y'),
            makeChar('char-Z', 'Z'),
        ] as unknown as Database['characters']
        flushSync()

        expect(tracker.character).toEqual(expect.arrayContaining(['char-X', 'char-Y', 'char-Z']))
        expect(tracker.character).toHaveLength(3)
    })

    test('in-place field write marks nothing: the identity effect never reads element properties', () => {
        installDbWithCharacters([makeChar('char-A', 'A'), makeChar('char-B', 'B')])
        const { tracker, markChanged } = freshTrackerAndMarker()
        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        ;(DBState.db.characters[0] as unknown as { name: string }).name = 'renamed-in-place'
        flushSync()

        expect(tracker.character).toEqual([])
    })

    test('falsy chaId on a replaced element is skipped (not appended), without throwing', () => {
        installDbWithCharacters([makeChar('char-A', 'A')])
        const { tracker, markChanged } = freshTrackerAndMarker()
        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        DBState.db.characters[0] = { chaId: '', name: 'no-id', type: 'character', chatPage: 0, chats: [] } as unknown as Database['characters'][number]

        expect(() => flushSync()).not.toThrow()
        expect(tracker.character).toEqual([])
    })

    // Svelte-facts premise (verified against 5.55.1): reading
    // chars[i] returns the SAME child proxy on every read (stable per
    // underlying object), and a self-assignment of the same array reference
    // notifies nothing -- so it must not mark anything either.
    test('same-proxy premise: re-reading the same array/elements and self-assigning the array marks nothing', () => {
        installDbWithCharacters([makeChar('char-A', 'A'), makeChar('char-B', 'B')])
        const firstRead = DBState.db.characters[0]
        const secondRead = DBState.db.characters[0]
        expect(firstRead).toBe(secondRead) // same proxy identity on repeated reads

        const { tracker, markChanged } = freshTrackerAndMarker()
        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        DBState.db.characters = DBState.db.characters // self-assignment, same reference
        flushSync()

        expect(tracker.character).toEqual([])
    })

    test('does not go through the module-global installed characterSaveMarks tracker: marks land only in opts.tracker', async () => {
        const { installCharacterSaveMarks, resetCharacterSaveMarksForTest } = await import('../characterSaveMarks')
        const globalTracker = makeTracker()
        const globalSchedule = vi.fn()
        installCharacterSaveMarks({ tracker: globalTracker, schedule: globalSchedule })

        installDbWithCharacters([makeChar('char-A', 'A')])
        const { tracker, markChanged } = freshTrackerAndMarker()
        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        DBState.db.characters[0] = makeChar('char-A', 'A-replaced') as unknown as Database['characters'][number]
        flushSync()

        expect(tracker.character).toEqual(['char-A'])
        // The module-global tracker (a different, "installed" one) must be
        // completely untouched by this effect.
        expect(globalTracker.character).toEqual([])
        expect(globalSchedule).not.toHaveBeenCalled()

        resetCharacterSaveMarksForTest()
    })

    // `opts.seed` is a strong Iterable (in production, a Set of every
    // boot-time character) used only to seed the identity tracker's WeakSet
    // below. The effect closures above all capture `opts` itself (they read
    // opts.tracker and call opts.markChanged), so as long as `opts.seed`
    // stays populated on that same object, every character it references
    // stays strongly reachable for as long as the effects live -- i.e.
    // forever, in production. registerDbChangeEffects must release it
    // (`opts.seed = undefined`) once the WeakSet has been built from it, or
    // that leak follows.
    //
    // A real reachability proof (WeakRef + global.gc()) is not included here:
    // it requires vitest to run with `--expose-gc`, which this project's
    // normal `pnpm test` / `vitest run` invocation does not enable (verified
    // against Agents/Tools/save-gen/*-bench.svelte.harness.ts, whose own
    // comments call out that same NODE_OPTIONS=--expose-gc requirement for
    // their retained-heap measurements). Asserting `opts.seed === undefined`
    // directly is the reachability proof available in the normal suite.
    test('registering releases the seed: opts.seed is undefined afterward, while the seeded behaviour still holds', () => {
        installDbWithCharacters([makeChar('char-A', 'A'), makeChar('char-B', 'B')])
        const seed = [DBState.db.characters[0], DBState.db.characters[1]]
        const opts: DbChangeEffectOptions = { tracker: makeTracker(), markChanged: vi.fn(), seed }

        cleanup = $effect.root(() => {
            registerDbChangeEffects(opts)
        })
        flushSync()

        // Seeded behaviour still holds: a seeded element is not marked on the
        // first run (same guarantee as the "seeded first run marks nothing"
        // test above), proving the WeakSet built from the seed is intact even
        // though `opts.seed` itself has been released.
        expect(opts.tracker.character).toEqual([])
        expect(opts.seed).toBeUndefined()
    })
})

// Equivalence suite for the selected-character partition (6a generic
// top-level loop, 6b-front, 6b-char, chats-shape, per-chat, per-message --
// the whole of `registerDbChangeEffects`'s handling of the selected
// character). It is the safety evidence that the partition's union of
// dependencies equals reading the selected character as a whole, never a
// subset of it.
//
// Every mutation-class test below arms a SENTINEL front value
// (`tracker.character = ['__sentinel__']`, never `[]`) before mutating, then
// asserts the SELECTED character's chaId is back at index 0. The sentinel
// matters because two different writers touch `tracker.character`: every 6b
// piece UNSHIFTS the selected chaId to the FRONT via the shared
// `frontUnshiftSelected` helper, while the separate identity tracker effect
// APPENDS via `appendIfAbsent` -- at the END, only if absent. An empty
// starting array can't tell them apart (both would leave the id at index
// 0); the sentinel can, because only a front-unshift displaces it from
// index 0.
//
// Fixture: three characters. The selected one (index 1, chaId 'char-1') has
// six chats -- four ordinary ones, a chat with MALFORMED data whose
// `message` is not an array (this is NOT a real cold-storage stub -- it
// exercises the per-chat child's non-array "otherwise" branch, which only
// guards against corrupt data, the same way throwError()'s
// `!Array.isArray(chatRoom.message)` guard in process/index.svelte.ts
// does), and a REAL cold-storage stub (an archived chat, as upstream builds
// and older data hold it) whose `message` is a one-element ARRAY whose
// `data` starts with `coldStorageHeader` -- plus a `globalLore`
// (per-character lorebook, the `globalLore` field of the `character`
// interface in database.svelte.ts) with entries, an
// `emotionImages` list, and `chatPage: 2`, so the active chat is never
// index 0 and "non-active chat" and "active chat" are always distinguishable
// in these tests.
describe('registerDbChangeEffects — selected-character partition equivalence suite', () => {

    const SENTINEL = '__sentinel__'

    function makeMessage(seed: string): Record<string, unknown> {
        return { role: 'char', data: `data-${seed}`, time: Date.now() }
    }

    function makeLorebookEntry(seed: string): Record<string, unknown> {
        return {
            key: `key-${seed}`, secondkey: '', insertorder: 100, comment: '',
            content: `content-${seed}`, mode: 'normal', alwaysActive: false, selective: true,
        }
    }

    function makeChat(id: string, messageCount: number): Record<string, unknown> {
        const message: Record<string, unknown>[] = []
        for (let i = 0; i < messageCount; i++) {
            message.push(makeMessage(`${id}-${i}`))
        }
        return { id, message, note: '', name: '', localLore: [] }
    }

    // Malformed chat data whose `message` is not an array -- the per-chat
    // child's non-array "otherwise" branch, i.e. the malformed non-array
    // branch. NOT a real cold-storage stub: a real archived chat (the
    // placeholder chat of an archived character, or a chat replaced by a
    // cold-storage pointer, as upstream builds and older data hold them)
    // holds `message` as a one-element ARRAY. This shape only models corrupt
    // data, which throwError()'s `!Array.isArray(chatRoom.message)` guard
    // in process/index.svelte.ts also guards against.
    function makeMalformedMessageChat(id: string): Record<string, unknown> {
        return { id, note: '', name: '', localLore: [], message: makeMessage(`${id}-cold-pointer`) }
    }

    // Real cold-storage stub shape (an archived chat, as upstream builds and
    // older data hold it): `message` is a one-element ARRAY whose `data`
    // starts with `coldStorageHeader`.
    function makeRealColdStubChat(id: string): Record<string, unknown> {
        return {
            id, note: '', name: '', localLore: [],
            message: [{ time: Date.now(), data: coldStorageHeader + id, role: 'char' }],
        }
    }

    function makeSelectedCharacter(chaId: string): Record<string, unknown> {
        return {
            chaId,
            name: 'Selected',
            type: 'character',
            desc: 'original description',
            notes: 'original notes',
            chatPage: 2, // active chat is index 2 -- never index 0
            chats: [
                makeChat('chat-0', 2),
                makeChat('chat-1', 2),
                makeChat('chat-2', 3), // ACTIVE (chatPage = 2)
                makeChat('chat-3', 2),
                makeMalformedMessageChat('chat-malformed'),
                makeRealColdStubChat('chat-real-cold'),
            ],
            globalLore: [makeLorebookEntry('a'), makeLorebookEntry('b')],
            emotionImages: [['happy', 'assets/happy.png'], ['sad', 'assets/sad.png']],
        }
    }

    function makeOtherCharacter(chaId: string): Record<string, unknown> {
        return {
            chaId,
            name: `Other ${chaId}`,
            type: 'character',
            desc: 'other description',
            notes: 'other notes',
            chatPage: 0,
            chats: [makeChat(`${chaId}-chat-0`, 2)],
            globalLore: [],
            emotionImages: [],
        }
    }

    function installSelectedCharacterFixture() {
        installDb()
        DBState.db.characterOrder = ['char-0', 'char-1', 'char-2'] as unknown as Database['characterOrder']
        DBState.db.characters = [
            makeOtherCharacter('char-0'),
            makeSelectedCharacter('char-1'),
            makeOtherCharacter('char-2'),
        ] as unknown as Database['characters']
        selectedCharID.set(1)
    }

    function selectedChar(): Record<string, any> {
        return DBState.db.characters[1] as unknown as Record<string, any>
    }

    function otherChar(index: 0 | 2): Record<string, any> {
        return DBState.db.characters[index] as unknown as Record<string, any>
    }

    // Steps 1-2 shared by every mutation-class test below: mount, flush the
    // initial run, arm the sentinel front value, and reset the spy so only
    // the mutation under test is observed.
    function setupArmed() {
        installSelectedCharacterFixture()
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        tracker.character = [SENTINEL]
        tracker.chat = []
        markChanged.mockClear()

        return { tracker, markChanged }
    }

    function expectFronted(tracker: toSaveType, markChanged: ReturnType<typeof vi.fn>, chaId = 'char-1') {
        expect(tracker.character[0]).toBe(chaId)
        expect(markChanged).toHaveBeenCalledWith(true)
    }

    test('a field write (character.desc) fronts the selected chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().desc = 'edited description'
        flushSync()

        expectFronted(tracker, markChanged)
    })

    test("a nested write (a globalLore entry's content) fronts the selected chaId and marks dirty", () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().globalLore[0].content = 'changed lore content'
        flushSync()

        expectFronted(tracker, markChanged)
    })

    test('a nested write (an emotionImages list entry) fronts the selected chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().emotionImages[0][1] = 'assets/happy-2.png'
        flushSync()

        expectFronted(tracker, markChanged)
    })

    test('a key added to the selected character fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().customMarker = 'added-value'
        flushSync()

        expectFronted(tracker, markChanged)
    })

    test('a key removed (delete) from the selected character fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        delete selectedChar().notes
        flushSync()

        expectFronted(tracker, markChanged)
    })

    test('a chat pushed fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chats.push(makeChat('chat-new', 1))
        flushSync()

        expectFronted(tracker, markChanged)
    })

    // Removes chat-3 (index 3), AFTER chatPage (2), so the active chat's
    // index never shifts underneath the mutation.
    test('a chat spliced fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chats.splice(3, 1)
        flushSync()

        expectFronted(tracker, markChanged)
    })

    test('one chat replaced by a new object fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chats[1] = makeChat('chat-1-replaced', 1)
        flushSync()

        expectFronted(tracker, markChanged)
    })

    test('the chats array replaced fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chats = [
            makeChat('new-0', 1), makeChat('new-1', 1), makeChat('new-2', 1),
            makeChat('new-3', 1), makeMalformedMessageChat('new-malformed'),
            makeRealColdStubChat('new-real-cold'),
        ]
        flushSync()

        expectFronted(tracker, markChanged)
    })

    test('a message appended to the active chat fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chats[2].message.push(makeMessage('active-appended'))
        flushSync()

        expectFronted(tracker, markChanged)
    })

    test("the last message's data appended (a streamed token) fronts the chaId and marks dirty", () => {
        const { tracker, markChanged } = setupArmed()

        const messages = selectedChar().chats[2].message
        messages[messages.length - 1].data += '-token'
        flushSync()

        expectFronted(tracker, markChanged)
    })

    test('a message edited in a NON-active chat fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chats[0].message[0].data = 'edited-non-active'
        flushSync()

        expectFronted(tracker, markChanged)
    })

    test('a message deleted fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chats[2].message.splice(0, 1)
        flushSync()

        expectFronted(tracker, markChanged)
    })

    test("a chat's message array replaced fronts the chaId and marks dirty", () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chats[3].message = [makeMessage('replaced-array')]
        flushSync()

        expectFronted(tracker, markChanged)
    })

    test('malformed chat whose message is not an array (the non-array branch): a field on the chat itself fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chats[4].note = 'edited malformed chat note'
        flushSync()

        expectFronted(tracker, markChanged)
    })

    test('malformed chat whose message is not an array (the non-array branch): a field on its message object fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chats[4].message.data = 'edited malformed message pointer'
        flushSync()

        expectFronted(tracker, markChanged)
    })

    // The REAL cold-storage stub (unlike chats[4] above): `message` is a
    // one-element ARRAY whose `data` starts with `coldStorageHeader` (an
    // archived chat, as upstream builds and older data hold it). This goes
    // through the per-chat child's ARRAY branch, not the malformed non-array
    // branch. No production path edits `message[0].data` in place on a stub
    // like this -- the real writer that reads a `coldStorageHeader`-prefixed
    // stub (preLoadChat() in coldstorage.svelte.ts) replaces `chat.message`
    // wholesale rather than editing it in place. (retryLegacyColdChatLoad() is a
    // different case: it matches a chat whose `message[0]` holds the pre-7b "could not be
    // loaded" error text, not a `coldStorageHeader`-prefixed pointer, so it
    // does not apply to this stub shape.) This test instead pins that
    // an in-place edit of a stub-shaped array message -- the kind a generic
    // writer such as a plugin could still make -- is caught by the
    // per-message child, and must still front the selected chaId and mark
    // dirty.
    test('the real cold-storage stub chat: editing its message[0].data fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        ;(selectedChar().chats[5].message[0] as { data: string }).data = coldStorageHeader + 'new-cold-id'
        flushSync()

        expectFronted(tracker, markChanged)
    })

    // A key added to a non-active chat object.
    test('a key added to a chat object fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        ;(selectedChar().chats[1] as Record<string, unknown>).customChatMarker = 'added-value'
        flushSync()

        expectFronted(tracker, markChanged)
    })

    // A key deleted from a non-active chat object.
    test('a key deleted from a chat object fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        delete (selectedChar().chats[1] as Record<string, unknown>).note
        flushSync()

        expectFronted(tracker, markChanged)
    })

    // A chat's `message` switching from an array to a non-array (the
    // per-chat child's "otherwise" branch) and back to an array.
    test("a chat's message switching from an array to a non-array and back fronts the chaId and marks dirty each time", () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chats[1].message = makeMessage('now-a-single-object')
        flushSync()
        expectFronted(tracker, markChanged)

        tracker.character = [SENTINEL]
        markChanged.mockClear()

        selectedChar().chats[1].message = [makeMessage('back-to-an-array')]
        flushSync()
        expectFronted(tracker, markChanged)
    })

    // message[j] replaced by a brand-new object (not an in-place field
    // edit on the existing message).
    test('message[j] replaced by a new object fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chats[2].message[0] = makeMessage('replaced-message-object')
        flushSync()

        expectFronted(tracker, markChanged)
    })

    // `message.length = n` truncation.
    test('message.length = n truncation fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chats[2].message.length = 1
        flushSync()

        expectFronted(tracker, markChanged)
    })

    // `chats.length = n` truncation. Truncates down to length 4, which
    // keeps the active chat (chatPage = 2, index 2) intact.
    test('chats.length = n truncation fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chats.length = 4
        flushSync()

        expectFronted(tracker, markChanged)
    })

    // A sparse/undefined chat element being filled in. A per-chat child's
    // `if (chat)` guard tolerates the undefined element; filling it back in
    // with a real chat must still front the chaId and mark dirty.
    test('a sparse/undefined chat element being filled in fronts the chaId and marks dirty', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chats[1] = undefined
        flushSync()
        tracker.character = [SENTINEL]
        markChanged.mockClear()

        selectedChar().chats[1] = makeChat('chat-1-filled-in', 1)
        flushSync()

        expectFronted(tracker, markChanged)
    })

    // 6b-front re-runs on a chatPage change because it reads
    // `chats[chatPage].id` to compute `tracker.chat`. Assert both
    // halves: the selected chaId is fronted, and tracker.chat reflects the
    // NEW active chat.
    test('chatPage changed fronts the chaId and updates tracker.chat to the new active chat', () => {
        const { tracker, markChanged } = setupArmed()

        selectedChar().chatPage = 0
        flushSync()

        expectFronted(tracker, markChanged)
        expect(tracker.chat[0]).toEqual(['char-1', 'chat-0'])
    })

    test('the selection changed via selectedCharID.set fronts the NEW selected chaId', () => {
        const { tracker, markChanged } = setupArmed()

        selectedCharID.set(2)
        flushSync()

        expectFronted(tracker, markChanged, 'char-2')
    })

    // The identity tracker (a separate effect) also fires here, which is
    // fine and expected -- it is the front position, not the
    // mere presence of 'char-1' somewhere in tracker.character, that proves
    // the 6b pieces themselves (not only the identity tracker) reacted.
    test('the selected character replaced by a new object at the same index fronts its chaId', () => {
        const { tracker, markChanged } = setupArmed()

        DBState.db.characters[1] = makeSelectedCharacter('char-1') as unknown as Database['characters'][number]
        flushSync()

        expectFronted(tracker, markChanged)
    })

    // 6b-char's outer effect never reads `chaId` at all
    // (tracked or untracked) -- its own dependency list is exactly the
    // character's key SET, via `Reflect.ownKeys`. Field/chat/message
    // children under it front the selected id by calling
    // `frontUnshiftSelected(char)`, which does its own untracked read of
    // `char.chaId` AT CALL TIME -- it does not capture a value through
    // closure. Renaming chaId IN PLACE (`char.chaId = '...'`) changes only a
    // VALUE, not the character's key set, so the outer effect (and its
    // chats-shape/chat/message children) does NOT re-run; only 6b-front
    // (which reads chaId directly and tracked) and the `chaId` field child
    // (which snapshots it) re-run and front the new id.
    //
    // Once the save loop trims `tracker.character` down to just that fronted
    // id (`prepareSaveIteration` in src/ts/globalApi.svelte.ts, which runs
    // this trim immediately, BEFORE encoding -- not `risuSave.ts`'s `set()`,
    // which does no such trim), the next field/message child to front the
    // selected character reads `chaId` fresh via `frontUnshiftSelected`'s
    // untracked read, so it fronts the CURRENT (new) id -- there is no stale
    // captured value that could displace it.
    test('a chaId renamed in place is fronted by field/message children after a save-loop trim', () => {
        installSelectedCharacterFixture()
        const { tracker, markChanged } = freshTrackerAndMarker()

        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()

        // Rename the selected character's chaId IN PLACE.
        selectedChar().chaId = 'new id'
        flushSync()

        // Simulate the save loop's trim of tracker.character down to the
        // fronted id (prepareSaveIteration's trim, which runs before
        // encoding).
        tracker.character = [tracker.character[0]]

        // In-place streamed-token append on an EXISTING message of the
        // active chat -- not a push, so it exercises a per-message child
        // that was created at initial mount, before the rename, and never
        // torn down by it (renaming chaId changes only a value, not the
        // character's key set, so this child's closure over `char` survives
        // untouched).
        const activeMessages = selectedChar().chats[2].message
        activeMessages[activeMessages.length - 1].data += 'x'
        flushSync()
        expect(tracker.character[0]).toBe('new id')

        selectedChar().desc = 'edited after rename'
        flushSync()
        expect(tracker.character[0]).toBe('new id')

        selectedChar().chats[2].message.push(makeMessage('after-rename'))
        flushSync()
        expect(tracker.character[0]).toBe('new id')
    })

    // NEGATIVE CONTROL. Every 6b piece reads ONLY
    // `DBState.db.characters[selIdState]` (the selected index) for the
    // character/chat half of its body -- none subscribes to any other
    // character's sources. So a write to a NON-selected character re-runs NO
    // effect in this module at all: markChanged is not called, and the
    // sentinel is left completely undisturbed at the front. Coverage for a
    // non-selected character's writes lives on the SAVE side (marking, via
    // characterSaveMarks.ts), not here -- this file's partition only splits
    // the selected-character watch into smaller pieces; it does not watch
    // other characters at all.
    test('negative control: an in-place write to a NON-selected character does not front its chaId', () => {
        const { tracker, markChanged } = setupArmed()

        otherChar(0).desc = 'edited on a non-selected character'
        flushSync()

        expect(tracker.character).toEqual([SENTINEL])
        expect(markChanged).not.toHaveBeenCalled()

        // Same for a message edit on that same non-selected character.
        otherChar(0).chats[0].message[0].data = 'edited message on non-selected'
        flushSync()

        expect(tracker.character).toEqual([SENTINEL])
        expect(markChanged).not.toHaveBeenCalled()
    })

    // A generic top-level key read by 6a (the generic top-level loop), NOT
    // the character-specific half. This class only needs markChanged(true);
    // it need not move the front -- 6a never touches tracker.character at
    // all.
    test('a generic top-level key (characterOrder) marks dirty', () => {
        const { markChanged } = setupArmed()

        DBState.db.characterOrder = ['char-1', 'char-0', 'char-2'] as unknown as Database['characterOrder']
        flushSync()

        expect(markChanged).toHaveBeenCalledWith(true)
    })
})

// Rebuild-count requirement ("a chatPage change creates no message children;
// replacing chat i re-runs only chat i's child"). The equivalence suite
// above proves CORRECTNESS (nothing is under-tracked); this suite proves
// COST (the partition does not over-rebuild). It drives the test-only
// `onPartitionRun` hook (defined on `DbChangeEffectOptions`), which fires
// at the top of every 6b piece's body -- 'front', 'char',
// 'field', 'chats', 'chat' (with its index) and 'message' (with its index)
// -- and is never called by production code.
//
// Fixture: the same general shape as the equivalence suite above (3
// characters, the selected one at index 1 with 5 chats -- four ordinary plus
// one chat with MALFORMED (non-array) message data, not a real cold-storage
// stub, see the fixture comment below -- of several messages each,
// `chatPage: 2` so the active chat is never
// index 0), reproduced locally rather than shared, since the equivalence
// suite's helpers are scoped to its own `describe` block.
describe('registerDbChangeEffects — selected-character partition rebuild counts', () => {

    function makeMessage(seed: string): Record<string, unknown> {
        return { role: 'char', data: `data-${seed}`, time: Date.now() }
    }

    function makeChat(id: string, messageCount: number): Record<string, unknown> {
        const message: Record<string, unknown>[] = []
        for (let i = 0; i < messageCount; i++) {
            message.push(makeMessage(`${id}-${i}`))
        }
        return { id, message, note: '', name: '', localLore: [] }
    }

    // Malformed chat data whose `message` is not an array -- the per-chat
    // child's non-array "otherwise" branch, i.e. the malformed non-array
    // branch. NOT a real cold-storage stub: a real archived chat (the
    // placeholder chat of an archived character, or a chat replaced by a
    // cold-storage pointer, as upstream builds and older data hold them)
    // holds `message` as a one-element ARRAY.
    function makeMalformedMessageChat(id: string): Record<string, unknown> {
        return { id, note: '', name: '', localLore: [], message: makeMessage(`${id}-cold-pointer`) }
    }

    function makeSelectedCharacter(chaId: string): Record<string, unknown> {
        return {
            chaId,
            name: 'Selected',
            type: 'character',
            desc: 'original description',
            notes: 'original notes',
            chatPage: 2, // active chat is index 2 -- never index 0
            chats: [
                makeChat('chat-0', 2),
                makeChat('chat-1', 2),
                makeChat('chat-2', 3), // ACTIVE (chatPage = 2)
                makeChat('chat-3', 2),
                makeMalformedMessageChat('chat-malformed'),
            ],
            globalLore: [],
            emotionImages: [],
        }
    }

    function makeOtherCharacter(chaId: string): Record<string, unknown> {
        return {
            chaId,
            name: `Other ${chaId}`,
            type: 'character',
            desc: 'other description',
            notes: 'other notes',
            chatPage: 0,
            chats: [makeChat(`${chaId}-chat-0`, 2)],
            globalLore: [],
            emotionImages: [],
        }
    }

    function installFixture() {
        installDb()
        DBState.db.characters = [
            makeOtherCharacter('char-0'),
            makeSelectedCharacter('char-1'),
            makeOtherCharacter('char-2'),
        ] as unknown as Database['characters']
        selectedCharID.set(1)
    }

    function selectedChar(): Record<string, any> {
        return DBState.db.characters[1] as unknown as Record<string, any>
    }

    type PartitionRun = { kind: 'front' | 'char' | 'field' | 'chats' | 'chat' | 'message'; index?: number }

    function countKind(log: PartitionRun[], kind: PartitionRun['kind']): number {
        return log.filter((e) => e.kind === kind).length
    }

    // Mount, flush the initial run (which legitimately runs every piece
    // once), then reset the log so only the mutation under test is
    // observed.
    function setupWithLog() {
        installFixture()
        const tracker = makeTracker()
        const markChanged = vi.fn()
        const log: PartitionRun[] = []

        cleanup = $effect.root(() => {
            registerDbChangeEffects({
                tracker,
                markChanged,
                onPartitionRun: (kind, index) => log.push({ kind, index }),
            })
        })
        flushSync()
        log.length = 0

        return { tracker, markChanged, log }
    }

    // Regression guard for the for...in descriptor-trap entanglement that
    // `Reflect.ownKeys` -- used by 6b-char outer, deliberately INSTEAD OF an
    // earlier `for...in char` (see that effect's own design comment) --
    // exists to avoid: a chatPage change must not rebuild any message
    // children. 6b-front reads
    // `char.chatPage`/`char.chats` on every run, which (on a proxy)
    // creates/refreshes those properties' reactive sources; a `for...in`
    // (or `Object.keys`) walk of `char`'s keys would additionally call
    // `getOwnPropertyDescriptor` per key, which subscribes the running
    // effect to any key whose VALUE source already exists (proxy.js:
    // 201-206) -- entangling the outer effect with `chatPage`. `Reflect.
    // ownKeys` calls only the `ownKeys` trap (no per-key value
    // subscription), so a chatPage change must run ONLY 'front', never
    // touch the 6b-char subtree.
    test('a chatPage change runs front once and rebuilds no part of the 6b-char subtree', () => {
        const { tracker, log } = setupWithLog()

        selectedChar().chatPage = 0
        flushSync()

        expect(countKind(log, 'front')).toBe(1)
        expect(countKind(log, 'char')).toBe(0)
        expect(countKind(log, 'field')).toBe(0)
        expect(countKind(log, 'chats')).toBe(0)
        expect(countKind(log, 'chat')).toBe(0)
        expect(countKind(log, 'message')).toBe(0)
        expect(tracker.character[0]).toBe('char-1')
        expect(tracker.chat[0]).toEqual(['char-1', 'chat-0'])
    })

    // Follow-up sanity check: the previous test shows a chatPage switch
    // touches nothing in the 6b-char subtree at all under `Reflect.ownKeys`
    // (no entanglement to leave behind). Confirm that holds up for a
    // SUBSEQUENT field write too -- a `desc` write after a chatPage switch
    // stays narrowed to its own field child, exactly as it would with no
    // prior chatPage switch.
    test("a field write (desc) after a chatPage switch: exactly one field run and nothing else in 6b", () => {
        const { log } = setupWithLog()

        selectedChar().chatPage = 0
        flushSync()
        log.length = 0

        selectedChar().desc = 'edited description'
        flushSync()

        expect(countKind(log, 'field')).toBe(1)
        expect(countKind(log, 'front')).toBe(0)
        expect(countKind(log, 'char')).toBe(0)
        expect(countKind(log, 'chats')).toBe(0)
        expect(countKind(log, 'chat')).toBe(0)
        expect(countKind(log, 'message')).toBe(0)
    })

    // A different, genuine trigger for a 6b-char outer effect re-run: a
    // round trip through another character and back to the original
    // selection (selIdState changes twice, so the outer effect and its
    // children are torn down and recreated twice, unlike the chatPage case
    // above). Confirm a subsequent field write still narrows to one field
    // run afterward.
    test('a field write (desc) after a selection round trip: exactly one field run', () => {
        const { log } = setupWithLog()

        selectedCharID.set(0)
        flushSync()
        selectedCharID.set(1)
        flushSync()
        log.length = 0

        selectedChar().desc = 'edited description'
        flushSync()

        expect(countKind(log, 'field')).toBe(1)
    })

    // Per-message children deep-read via `$state.snapshot`, an explicit
    // property GET, not a key-set read -- and since a chatPage switch
    // touches nothing in the 6b-char subtree (see above), they are never
    // recreated by it at all. Confirm a streamed token after such a switch
    // still narrows to exactly one message run, same as with no prior
    // chatPage switch.
    test("a streamed token after a chatPage switch: exactly one 'message' run", () => {
        const { log } = setupWithLog()

        selectedChar().chatPage = 0
        flushSync()
        log.length = 0

        const activeMessages = selectedChar().chats[2].message
        activeMessages[activeMessages.length - 1].data += '-token'
        flushSync()

        expect(countKind(log, 'message')).toBe(1)
    })

    // The key-set dependency must be kept: this is NOT about narrowing the
    // for...in walk away entirely -- the outer effect must still notice a
    // key being added or removed from the selected character (a real shape
    // change), even after a prior chatPage switch has left every field
    // source already created.
    test('the key-set dependency is kept after a chatPage switch: adding then deleting a key on the selected character reruns char', () => {
        const { tracker, log } = setupWithLog()

        selectedChar().chatPage = 0
        flushSync()
        log.length = 0

        selectedChar().customMarker = 'added-value'
        flushSync()

        expect(countKind(log, 'char')).toBeGreaterThan(0)
        expect(tracker.character[0]).toBe('char-1')

        log.length = 0
        delete selectedChar().notes
        flushSync()

        expect(countKind(log, 'char')).toBeGreaterThan(0)
    })

    test('replacing chat i (a non-active chat) with a new object: exactly one chat run, with index i, and message runs only for its new messages', () => {
        const { tracker, log } = setupWithLog()

        // chat-1 (index 1) is not the active chat (chatPage = 2).
        selectedChar().chats[1] = makeChat('chat-1-replaced', 3)
        flushSync()

        const chatRuns = log.filter((e) => e.kind === 'chat')
        expect(chatRuns).toHaveLength(1)
        expect(chatRuns[0].index).toBe(1)

        const messageRuns = log.filter((e) => e.kind === 'message')
        expect(messageRuns).toHaveLength(3) // chat-1-replaced's new message count
        expect(countKind(log, 'chats')).toBe(0)
        expect(countKind(log, 'char')).toBe(0)
        expect(tracker.character[0]).toBe('char-1')
    })

    test('a streamed token (appending to the last message of the active chat in place): exactly one message run, no chat/chats/char run', () => {
        const { tracker, log } = setupWithLog()

        const activeMessages = selectedChar().chats[2].message
        activeMessages[activeMessages.length - 1].data += '-token'
        flushSync()

        expect(countKind(log, 'message')).toBe(1)
        expect(countKind(log, 'chat')).toBe(0)
        expect(countKind(log, 'chats')).toBe(0)
        expect(countKind(log, 'char')).toBe(0)
        expect(tracker.character[0]).toBe('char-1')
    })

    test('a message edited in a non-active chat: exactly one message run', () => {
        const { tracker, log } = setupWithLog()

        selectedChar().chats[0].message[0].data = 'edited-non-active'
        flushSync()

        expect(countKind(log, 'message')).toBe(1)
        expect(countKind(log, 'chat')).toBe(0)
        expect(countKind(log, 'chats')).toBe(0)
        expect(countKind(log, 'char')).toBe(0)
        expect(tracker.character[0]).toBe('char-1')
    })

    test('a field write (desc): exactly one field run, and nothing else in 6b', () => {
        const { tracker, log } = setupWithLog()

        selectedChar().desc = 'edited description'
        flushSync()

        expect(countKind(log, 'field')).toBe(1)
        expect(countKind(log, 'front')).toBe(0)
        expect(countKind(log, 'char')).toBe(0)
        expect(countKind(log, 'chats')).toBe(0)
        expect(countKind(log, 'chat')).toBe(0)
        expect(countKind(log, 'message')).toBe(0)
        expect(tracker.character[0]).toBe('char-1')
    })

    // ACCEPTED COST: the per-chat child reads `message.length`
    // as part of its own body, so a PUSH onto the active chat's message
    // array re-runs that one chat child once, and (being torn down and
    // recreated) it recreates EVERY message grandchild of that chat -- not
    // just the newly appended one. This is the "once per appended message,
    // not per token" cost this design accepts: a push (new message arriving)
    // pays for the whole chat's message children; a token append in place
    // (the 'a streamed token (appending to the last message of the active
    // chat in place)' test above, not the immediately preceding 'desc' test)
    // does not.
    test('a message pushed onto the active chat: the chat child re-runs once and recreates every message child of that chat (accepted cost)', () => {
        const { tracker, log } = setupWithLog()

        const activeChat = selectedChar().chats[2]
        const originalLength = activeChat.message.length // 3
        activeChat.message.push(makeMessage('active-appended'))
        flushSync()

        const chatRuns = log.filter((e) => e.kind === 'chat')
        expect(chatRuns).toHaveLength(1)
        expect(chatRuns[0].index).toBe(2)

        const messageRuns = log.filter((e) => e.kind === 'message')
        expect(messageRuns).toHaveLength(originalLength + 1) // every message child recreated, not just the new one
        expect(countKind(log, 'chats')).toBe(0)
        expect(countKind(log, 'char')).toBe(0)
        expect(tracker.character[0]).toBe('char-1')
    })

    test('the selection changing: char and front run once each', () => {
        const { tracker, log } = setupWithLog()

        selectedCharID.set(2)
        flushSync()

        expect(countKind(log, 'char')).toBe(1)
        expect(countKind(log, 'front')).toBe(1)
        expect(tracker.character[0]).toBe('char-2')
    })

    // Renaming chaId IN PLACE changes
    // only a VALUE, not the selected character's key set, so 6b-char outer
    // and its chats-shape/chat/message children must NOT rebuild or re-run.
    // Only 6b-front (which reads chaId directly and tracked) and the
    // `chaId` field child (whose own `$state.snapshot(char['chaId'])` read
    // makes it depend on that value) react.
    test('renaming the selected chaId in place: exactly one front run and one field run, nothing else in 6b', () => {
        const { tracker, log } = setupWithLog()

        selectedChar().chaId = 'char-1-renamed'
        flushSync()

        expect(countKind(log, 'front')).toBe(1)
        expect(countKind(log, 'field')).toBe(1)
        expect(countKind(log, 'char')).toBe(0)
        expect(countKind(log, 'chats')).toBe(0)
        expect(countKind(log, 'chat')).toBe(0)
        expect(countKind(log, 'message')).toBe(0)
        expect(tracker.character[0]).toBe('char-1-renamed')
    })
})
