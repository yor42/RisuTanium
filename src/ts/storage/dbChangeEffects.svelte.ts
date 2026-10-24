import { untrack } from "svelte"
import { DBState, selectedCharID } from "../stores.svelte"
import type { toSaveType } from "./risuSave"
import { appendIfAbsent } from "./characterSaveMarks"
import { MEASURE } from "../process/memory/measureFlag"
import { classifyChange, ensureInstalled, noteIdentity, notePartitionTag, noteSignal } from "./netSignalMeter"

export interface DbChangeEffectOptions {
    tracker: toSaveType
    /** Called by every effect. `markDirty` is false on an effect's first run. */
    markChanged: (markDirty: boolean) => void
    /**
     * Character proxies to seed the identity tracker's "already seen" set
     * with -- normally the set `RisuSaveEncoder.init` just encoded, so a
     * replacement that happened WHILE that init was still running isn't
     * treated as new the first time the identity tracker below runs. Without
     * a seed (tests, or any other caller), the first run only fills the set
     * and marks nothing.
     */
    seed?: Iterable<object>
    /**
     * TEST AND MEASURE INSTRUMENTATION ONLY -- only tests and MEASURE builds pass this. Called at
     * the top of every selected-character (6b) effect
     * body, so a test can count how many times each partition piece re-runs
     * without that count being observable through `tracker`/`markChanged`
     * (e.g. "a chatPage change creates no message children", "replacing chat
     * i re-runs only chat i's child"). `index` is the array index for the
     * 'chat' and 'message' kinds, and is omitted otherwise.
     */
    onPartitionRun?: (kind: 'front' | 'char' | 'field' | 'chats' | 'chat' | 'message', index?: number) => void
}

/** The identity tracker's "already seen" set of the latest registration; null before one exists. */
let markSeen: ((object: object) => void) | null = null

/**
 * Tells the identity tracker that `object`, a character just placed in `DBState.db.characters`, is not a new character:
 * a residency's load replaces a stub by the character read from the same entity, so the replacement must raise no mark
 * and no pass. Call it in the step that installs the object, with the object read back from the list (the reactive proxy
 * the tracker iterates) and no `await` between the assignment and the call; the tracker looks at the list in its next
 * run and finds the object already seen.
 */
export function markIdentitySeen(object: object): void {
    markSeen?.(object)
}

export function registerDbChangeEffects(opts: DbChangeEffectOptions): void {

    let selIdState = $state(0)

    selectedCharID.subscribe((v) => {
        selIdState = v
    })

    if (MEASURE) {
        // The net-signal meter's wrappers. The selected id is read untracked, once per call and only on the `part`
        // branch, so no effect gains a dependency; a partition effect tags itself before its own `markChanged`.
        const innerMarkChanged = opts.markChanged
        const innerPartitionRun = opts.onPartitionRun
        const selectedChaId = (): string | null => {
            const chaId = (DBState?.db?.characters?.[selIdState] as { chaId?: unknown } | undefined)?.chaId
            return typeof chaId === 'string' && chaId !== '' ? chaId : null
        }
        const readSelected = (): string | null => untrack(selectedChaId)
        ensureInstalled(readSelected)
        opts.onPartitionRun = (kind, index) => {
            notePartitionTag()
            innerPartitionRun?.(kind, index)
        }
        opts.markChanged = (markDirty) => {
            try {
                if (classifyChange(markDirty)) {
                    const chaId = readSelected()
                    if (chaId !== null) {
                        noteSignal('part', chaId)
                    }
                }
            } catch {
                // A measurement failure never reaches the save.
            }
            innerMarkChanged(markDirty)
        }
    }

    let ranOnce = false
    // Deep-read, like the sibling effects below. A shallow id/length read misses
    // every in-place preset mutation -- rename, preset image, and most importantly
    // saveCurrentPreset()'s `botPresets[id] = savedPreset` element write, whose
    // following `db.botPresets = pres` self-assignment notifies nothing. Since this
    // flag gates whether the preset block is re-encoded at all, a missed mutation is
    // never written to disk rather than merely written late.
    $effect(() => {
        $state.snapshot(DBState.db.botPresets)
        DBState.db.botPresetsId
        opts.tracker.botPreset = true
        opts.markChanged(ranOnce)
        ranOnce = true
    })
    let modulesRanOnce = false
    // Partitioned, not narrowed: an outer effect over array shape plus one child
    // effect per element, together registering the exact same dependency closure as
    // a single `$state.snapshot(DBState.db.modules)` (container, length, and every
    // index -- $state.snapshot's array branch never touches the array `version`
    // source). Reading less than this loses writes -- see the preset effect's
    // comment above for a real data-loss bug caused by exactly that. The point of splitting
    // it is that a leaf edit to module k now only re-reads module k's child effect,
    // not every other module's.
    //
    // Two independent guards, neither redundant:
    //   1. `opts.tracker.modules = true` is set unconditionally by the outer AND by
    //      every child, regardless of any `ranOnce` flag -- `risuSave.ts`'s `set()`,
    //      the `if (toSave.modules)` gate, keys off `tracker.modules`, not off
    //      `dirtySinceLastSave`. Do not delete the child's assignment as "redundant"
    //      with the outer's.
    //   2. `markChanged(false)` never marks clean: `saveTimeoutExecute` in
    //      `globalApi.svelte.ts` only ever sets `dirtySinceLastSave = true`
    //      and re-arms the debounce timer.
    // Shape changes (push/splice/whole-array replacement) tear down and recreate
    // every child, so a recreated child's first run always passes `false` -- shape
    // changes are covered only by the outer's own `markChanged(modulesRanOnce)`,
    // which passes `true` on every run after its first.
    $effect(() => {
        const mods = DBState.db.modules
        const len = mods?.length ?? 0          // shape: push/splice/whole-array replacement
        for (let i = 0; i < len; i++) {
            const m = mods[i]                  // element identity: modules[i] = {...}
            if (!m) continue
            let childRanOnce = false
            $effect(() => {
                $state.snapshot(m)             // deep-read THIS element only
                opts.tracker.modules = true
                opts.markChanged(childRanOnce)
                childRanOnce = true
            })
        }
        opts.tracker.modules = true
        opts.markChanged(modulesRanOnce)
        modulesRanOnce = true
    })
    let ranOnce3 = false
    $effect(() => {
        $state.snapshot(DBState.db.loadouts)
        opts.tracker.loadouts = true
        opts.markChanged(ranOnce3)
        ranOnce3 = true
    })
    let ranOnce4 = false
    $effect(() => {
        $state.snapshot(DBState.db.plugins)
        opts.tracker.plugins = true
        opts.markChanged(ranOnce4)
        ranOnce4 = true
    })
    let ranOnce5 = false
    $effect(() => {
        $state.snapshot(DBState.db.pluginCustomStorage)
        opts.tracker.pluginCustomStorage = true
        opts.markChanged(ranOnce5)
        ranOnce5 = true
    })
    // 6a -- the generic top-level loop. Deep-reads every top-level
    // DB key except the six handled by their own effects above/below.
    let ranOnce6a = false
    $effect(() => {
        for (const key in DBState.db) {
            if (
                key !== 'characters' && key !== 'botPresets' && key !== 'modules' &&
                key !== 'loadouts' && key !== 'plugins' && key !== 'pluginCustomStorage'
            ) {
                $state.snapshot(DBState.db[key])
            }
        }
        opts.markChanged(ranOnce6a)
        ranOnce6a = true
    })

    // 6b -- the selected character, partitioned. Not narrowed: the union of
    // every piece below's dependencies equals reading `characters[selIdState]`
    // as a whole -- reading less than this loses writes (see the preset
    // effect's comment above for a real data-loss bug caused by exactly that
    // class of mistake).
    //
    // Closure-equivalence argument (verified against Svelte 5.55.1):
    // `$state.snapshot()`'s plain-object branch clones via
    // `Object.keys(value)` then reads `value[key]` for each key
    // (svelte/src/internal/shared/clone.js:92-102). `Object.keys` goes
    // through the proxy's `ownKeys` trap, which reads the proxy's `version`
    // source before returning the key list (proxy.js:333-334: `ownKeys(target)
    // { get(version); ... }`). So the ORIGINAL single
    // `$state.snapshot(chats)` call already depended on the `version` source
    // of every chat object and every message object it reached, in addition
    // to every key and every value -- not merely "whatever the array/object
    // branches happen to walk". The array branch instead reads `.length` and
    // every index (clone.js:73-78), never the array's own `version`.
    //
    // The partition below reads exactly that same set, split across smaller
    // effects: `Object.keys(chat)` (+ a snapshot of every value except
    // `message`) reproduces a chat's version/keys/values dependency;
    // `chats.length` + `chats[i]` on the shape effect and its per-index
    // children reproduce the chats array's length/index dependency;
    // `message.length` + `message[j]` (array case) or
    // `$state.snapshot(message)` (malformed non-array case) reproduce the
    // message-level dependency the same way. Partition, never narrow.
    //
    // Duplicate ids: none of the pieces below de-duplicate their
    // front-unshift against ids the identity tracker (or
    // a `markCharacterForSave` mark) appends at the END of
    // `opts.tracker.character`. This is safe -- `savedId` in `risuSave.ts`'s
    // `set()` records which ids were saved this pass, and a character's block
    // is deleted only if its id was NOT saved this pass, so a duplicate or
    // stale id of an existing character is harmless; it is merely re-encoded,
    // not deleted.
    //
    // Every effect below (front, char outer, field children, chats-shape,
    // per-chat, per-message) independently does the SAME front-unshift of
    // the selected chaId, then calls `markChanged(ownRanOnce)` -- exactly
    // the modules-partition effect's convention above: children created
    // fresh always pass `false` on their first run, so a SHAPE change (a
    // chat pushed/spliced/replaced, a message array replaced, the character
    // itself replaced) is covered by the parent's own `markChanged(true)`,
    // never by a recreated child's first run.
    //
    // Decision on `chats[chatPage].id`: reading
    // `characters[selIdState]?.chats[...chatPage].id` WITHOUT `?.` on the
    // `chats` element itself means -- if `chats[chatPage]` is undefined (an
    // out-of-range or empty `chats`), `.id` throws. That is preserved below,
    // even though the read is split into local variables: still no `?.` on
    // that element, so it throws in the same cases. Adding `?.` would
    // silently change behaviour from "throws today" to "never throws" for a
    // case this file does not otherwise handle.
    //
    // chaId re-read at fronting time, not captured: only 6b-front lists
    // `chaId` itself as a tracked read (it needs the CURRENT
    // value to decide whether to front it and to build the `tracker.chat`
    // pair). Every other 6b piece (char outer, field/chats-shape/per-chat/
    // per-message children) must NOT add `chaId` to its own dependency list,
    // since their spec above does not list it -- EXCEPT the `chaId` field
    // child, which tracks it anyway through its own generic
    // `$state.snapshot(char[key])` read when `key === 'chaId'` (expected;
    // that snapshot dependency is what makes the field child re-run at all
    // when `chaId` is renamed in place). `frontUnshiftSelected` takes the
    // live `char` object, not a `chaId` string, and does its own
    // `untrack(() => char?.chaId)` read at the moment it is called. This
    // matters because 6b-char and its descendants do NOT re-run on an
    // in-place `chaId` rename (renaming an existing key's value never bumps
    // the key-set `version` that `Reflect.ownKeys(char)` depends on, so the
    // outer effect's closure is not torn down) -- if a child instead
    // captured `chaId` once when the outer effect last ran and reused that
    // captured value on every fronting call, a rename would leave every
    // field/chats-shape/per-chat/per-message fronting call pointing at the
    // OLD id, even though the field child that snapshots `chaId` itself
    // re-runs and fronts the NEW id. Since `char` is the
    // same object reference for the outer effect's whole lifetime, reading
    // `char.chaId` fresh at each call, still through `untrack` so it adds no
    // dependency, always fronts the CURRENT id instead.
    function frontUnshiftSelected(char: { chaId?: string } | undefined): void {
        const chaId = untrack(() => char?.chaId)
        if (opts.tracker.character[0] !== chaId) {
            opts.tracker.character.unshift(chaId)
        }
    }

    // 6b-front: the only piece that reads `chatPage` as a tracked dependency,
    // and the only piece that writes `tracker.chat`. It also reads `chaId`
    // and `chats[chatPage].id`, but those two are not unique to this effect:
    // the `chaId` field child (in 6b-char below) tracks `chaId` through its
    // own generic `$state.snapshot(char[key])` read, and the per-chat child
    // for index `chatPage` reads that chat's `id` as part of its own
    // `Object.keys(chat)` snapshot. Kept separate so a `chatPage` change
    // (switching the active chat) never rebuilds any message child.
    let frontRanOnce = false
    $effect(() => {
        opts.onPartitionRun?.('front')
        const char = DBState?.db?.characters?.[selIdState]
        if (char) {
            const chaId = char.chaId
            frontUnshiftSelected(char)
            const chats = char.chats
            const chatPage = char.chatPage
            if (
                opts.tracker.chat[0]?.[0] !== chaId ||
                opts.tracker.chat[0]?.[1] !== chats[chatPage].id
            ) {
                opts.tracker.chat.unshift([chaId, chats[chatPage].id])
            }
        }
        opts.markChanged(frontRanOnce)
        frontRanOnce = true
    })

    // 6b-char: the outer effect over the selected character's shape (its key
    // set, via `Reflect.ownKeys`, NOT `for...in`/`Object.keys` -- see below).
    // Creates one child per non-`chats`/non-`chatPage` key, plus one
    // chats-shape child. `chatPage` is excluded from the generic per-field
    // loop for the same reason `chats` is: 6b-front already reads it (the
    // comment above 6b-front calls it "the only piece that reads ...
    // chatPage ... as a tracked dependency") and unconditionally calls
    // `markChanged` on every run, so a dedicated `chatPage` field child would
    // only duplicate that dependency, not add coverage -- and it would
    // defeat the point of splitting front out in the first place, since a
    // chatPage write would then also rerun a 6b-char child on every switch.
    // `chaId` is never read directly by this effect -- it passes `char` itself
    // to `frontUnshiftSelected` (see the comment block above), which does its
    // own untracked read at fronting time -- so this effect's own dependency
    // list stays exactly `selIdState`, `characters[selIdState]`, and the
    // character's key set.
    //
    // Why `Reflect.ownKeys`, not `for...in` (verified against Svelte 5.55.1):
    // both `for...in` and `Object.keys` list an object's keys by calling
    // [[OwnPropertyKeys]] (the proxy's `ownKeys` trap) and then, for EACH key
    // returned, calling [[GetOwnProperty]] (the proxy's
    // `getOwnPropertyDescriptor` trap) to check enumerability. That second
    // trap (proxy.js:201-206) does `if (s) descriptor.value = get(s)` --
    // `get(s)` subscribes the running effect to that key's VALUE source, not
    // just its existence. So `for...in char` doesn't just depend on char's
    // key set; it depends on the VALUE of every key char already has a
    // source for. On first mount 6b-front has already created `chats` and
    // `chatPage` sources, so a `chatPage` change alone reruns this whole
    // outer effect and rebuilds every field/chat/message child; after any
    // rerun, every field has a source, so every keystroke does the same.
    // `Reflect.ownKeys(char)` calls only the `ownKeys` trap (proxy.js:333-347:
    // `get(version); ... return own_keys`), never `getOwnPropertyDescriptor`,
    // so it depends on `version` (i.e. the key set) and nothing else -- no
    // per-key value subscription. Symbols are filtered out (character
    // objects carry only plain string data keys; Svelte's `STATE_SYMBOL` is
    // served by the proxy's `get` trap, not stored as an own key on the
    // target, so it never appears in `Reflect.ownKeys` here either way), and
    // there is no inherited-enumerable-key difference to worry about since
    // these are plain JSON-like objects with no prototype chain of their
    // own enumerable keys -- so this reads the identical key set `for...in`
    // did, just without the extra per-value reads.
    let charRanOnce = false
    $effect(() => {
        opts.onPartitionRun?.('char')
        const char = DBState?.db?.characters?.[selIdState]
        if (char) {
            for (const key of Reflect.ownKeys(char)) {
                if (typeof key === 'string' && key !== 'chats' && key !== 'chatPage') {
                    let fieldRanOnce = false
                    $effect(() => {
                        opts.onPartitionRun?.('field')
                        $state.snapshot(char[key])
                        frontUnshiftSelected(char)
                        opts.markChanged(fieldRanOnce)
                        fieldRanOnce = true
                    })
                }
            }
            // Chats-shape child: reads `chats` and its `length` only, and
            // creates one child per index `i`. Each index child ("per-chat
            // child") reads `chats[i]` itself, so replacing one chat re-runs
            // only that one child, not every chat.
            let chatsShapeRanOnce = false
            $effect(() => {
                opts.onPartitionRun?.('chats')
                const chats = char.chats
                const len = chats?.length ?? 0
                for (let i = 0; i < len; i++) {
                    let chatRanOnce = false
                    $effect(() => {
                        opts.onPartitionRun?.('chat', i)
                        const chat = chats[i]
                        if (chat) {
                            // Object.keys so the read matches the
                            // closure-equivalence argument above exactly (verified
                            // against Svelte 5.55.1): it goes through the proxy's
                            // `ownKeys` trap (key set / `version` dependency) AND,
                            // per key, the `getOwnPropertyDescriptor` trap
                            // (proxy.js:201-206), which additionally subscribes to
                            // that key's VALUE source -- unlike the 6b-char
                            // outer effect above, that extra per-key value
                            // subscription is harmless here: this child
                            // already deep-reads every key's value itself
                            // (via `$state.snapshot(chat[key])` below, plus
                            // `chat.message` separately), so it costs
                            // nothing to also depend on those same values
                            // through the descriptor trap.
                            for (const key of Object.keys(chat)) {
                                if (key !== 'message') {
                                    $state.snapshot(chat[key])
                                }
                            }
                            const message = chat.message
                            if (Array.isArray(message)) {
                                const mlen = message.length
                                for (let j = 0; j < mlen; j++) {
                                    let msgRanOnce = false
                                    $effect(() => {
                                        opts.onPartitionRun?.('message', j)
                                        $state.snapshot(message[j])
                                        frontUnshiftSelected(char)
                                        opts.markChanged(msgRanOnce)
                                        msgRanOnce = true
                                    })
                                }
                            } else {
                                // An archived chat holds a one-element message
                                // ARRAY, not a bare object (upstream builds and
                                // older data make both the character-level and the
                                // chat-level archive placeholders that way), so
                                // they go through the array branch above. This
                                // non-array branch only
                                // handles malformed data where `message` is not an
                                // array at all -- the same case guarded against by
                                // `throwError`'s (inside `sendChatBody` in
                                // `index.svelte.ts`) `!Array.isArray(ctx.chat.message)`
                                // guard on the resolved chat -- and is kept here only for that malformed case,
                                // snapshotting `message` as-is without checking its shape.
                                $state.snapshot(message)
                            }
                        }
                        frontUnshiftSelected(char)
                        opts.markChanged(chatRanOnce)
                        chatRanOnce = true
                    })
                }
                frontUnshiftSelected(char)
                opts.markChanged(chatsShapeRanOnce)
                chatsShapeRanOnce = true
            })
            frontUnshiftSelected(char)
        }
        opts.markChanged(charRanOnce)
        charRanOnce = true
    })

    // Identity tracker: a SEPARATE effect that only watches for a character
    // being REPLACED (element or whole-array), not for in-place field edits
    // -- it reads DBState.db.characters, its length and each chars[i], and no
    // property of any element (chaId is read through `untrack` below
    // specifically so it never becomes a dependency; letting it would make
    // this effect re-run on a chaId edit, which never happens in practice,
    // but reading it untracked keeps the closure exactly "identity only").
    // Covers: V3 setCharacterToIndex, V3 setDatabase(Lite) with characters,
    // backup loads, and any future element/whole-db replacement -- writers
    // the selected-character effect above does not otherwise see, because
    // they never touch it. V2 in-place edits are NOT seen by this identity
    // tracker (they replace no element, so nothing here fires) -- those are
    // covered instead by the explicit marks the V2 plugin setters make
    // directly.
    //
    // Deliberately does NOT go through the module-global installed tracker
    // (characterSaveMarks.ts) -- it writes straight into opts.tracker with the
    // same `appendIfAbsent` rule `markCharacterForSave` uses, so tests stay
    // isolated from production installation state.
    let identityRanOnce = false
    const identitySeen = new WeakSet<object>(opts.seed ?? [])
    const identityHasSeed = !!opts.seed
    markSeen = (object) => { identitySeen.add(object) }
    // The effect closures below all capture `opts` itself (they read
    // opts.tracker and call opts.markChanged), so as long as `opts.seed`
    // stayed populated on that same object, every character it references
    // would stay strongly reachable for as long as the effects live -- i.e.
    // forever, in production. `identitySeen` already copied everything it
    // needs out of `opts.seed` above, so release it here.
    opts.seed = undefined
    $effect(() => {
        const chars = DBState.db.characters
        const len = chars?.length ?? 0
        for (let i = 0; i < len; i++) {
            const c = chars[i]
            if (!c) continue
            if (!identitySeen.has(c)) {
                // First run: only elements missing from the seed are "new" (a
                // replacement that raced encoder.init). Without a seed, the
                // first run only fills the set and marks nothing.
                if (identityRanOnce || identityHasSeed) {
                    const chaId = untrack(() => (c as { chaId?: string }).chaId)
                    if (chaId) {
                        appendIfAbsent(opts.tracker, chaId)
                        if (MEASURE) {
                            noteIdentity(chaId)
                        }
                        opts.markChanged(true)
                    }
                }
                identitySeen.add(c)
            }
        }
        identityRanOnce = true
    })
}
