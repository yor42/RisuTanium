/**
 * PREMISE MEASUREMENT (not a bug repro, not a fix) for a planned performance
 * change to the character-list page.
 *
 * HYPOTHESIS UNDER TEST (source-read by the Orchestrator, measured here, not
 * assumed): `src/lib/Others/GridCatalog.svelte` renders four layouts
 * (3 = simple, delegating to `src/lib/Others/CharacterSimpleList.svelte`;
 * 0 = grid; 1 = list; 2 = trash), each iterating an UNKEYED `{#each
 * formatChars(search, DBState.db) as char}` (or `sortChar(...)` for simple).
 * `formatChars` (`GridCatalog.svelte:23-53`) builds brand-new objects on
 * every call, and every item passes `additionalStyle={getCharImage(char.image,
 * 'css')}` straight into `BarIcon.svelte`, which `{#await}`s it
 * (`BarIcon.svelte:13-17`). `getCharImage` (`src/ts/characters.ts:54-86`)
 * always calls `getFileSrc(loc)` (`src/ts/globalApi.svelte.ts:170-291`) when
 * a location is present. On the plain-HTTP branch (no Tauri, no service
 * worker, no account), `getFileSrc` re-encodes the whole asset to a base64
 * `data:` URL on EVERY call, including cache hits (`globalApi.svelte.ts:285`
 * runs unconditionally after either branch of the `if(!existing)` check).
 * The hypothesis: every listed character is mounted on initial render, and
 * every re-render (a search keystroke, or ANY mutation of a field
 * `formatChars` reads -- name, image, trashTime, type, creatorNotes -- on
 * ANY character, whether or not that character is currently visible in the
 * active layout) re-invokes `getCharImage`/`getFileSrc` for EVERY listed
 * character, not just a changed one.
 *
 * UPDATE (post-AV-1, `Agents/Reports/12-charlist-avatar-plan.md` section 2):
 * the hypothesis above described the code as it stood BEFORE this plan
 * landed. `GridCatalog.svelte` and `CharacterSimpleList.svelte` no longer
 * pass `getCharImage(...)` straight to `BarIcon.svelte`: they draw each
 * item's avatar through `CharListAvatar.svelte`, which looks the image up
 * once per `src` and only while the row reports itself visible, and the
 * rows are keyed by character, so filtering/reordering no longer changes
 * which key maps to which image. The action-count
 * assertions below (`ACTIONS` / the per-N `expect` block) are pinned
 * against THIS fixed code, with the old, pre-fix numbers kept alongside
 * them as history; the paragraph above is left as originally written
 * because it is still the accurate rationale for why this harness measures
 * what it measures, not because it describes current behaviour.
 *
 * WHAT THIS HARNESS DOES: mounts the REAL `GridCatalog.svelte` (and
 * therefore the real `CharacterSimpleList.svelte` and `BarIcon.svelte`) with
 * Svelte's `mount()` into happy-dom, drives it exactly like a user would
 * (click the real layout buttons, type into the real search input, mutate
 * `DBState.db` directly the way the rest of the app does), and counts calls
 * to a spy standing in for `getFileSrc` -- the ONE thing mocked on the hot
 * path, per the task brief. `getCharImage` itself is REAL: this file does
 * NOT mock `src/ts/characters.ts`, so the exact call path the app takes
 * (template -> BarIcon prop -> getCharImage -> getFileSrc) is exercised
 * verbatim.
 *
 * WHY GETCHARIMAGE COULD BE KEPT REAL DESPITE THE HEAVY IMPORT GRAPH:
 * `characters.ts` transitively imports most of the app's processing engine
 * (`process/index.svelte.ts` -- memory systems, transformers, TTS,
 * multiuser sync; `parser/parser.svelte.ts` -- markdown/highlight/regex;
 * `characterCards.ts` -- card import/export; `process/coldstorage.svelte.ts`;
 * `translator/translator.ts`). A throwaway probe (deleted before this file
 * was finalized -- see git history/PR description, not present in this
 * repo) confirmed empirically that importing this ENTIRE graph in this
 * harness's happy-dom + vi.mock setup is NOT a hang: it completes in a
 * bounded, reproducible ~15-17s on this machine (Vite/esbuild
 * transforming ~100+ modules cold, once per process), then every
 * subsequent import/mount in the same process is fast (tens of ms). That
 * is a one-time transform cost, not a per-test cost, so the first test
 * below carries a generous timeout and the rest do not need it. Nothing
 * in that graph is mocked beyond what the two existing rune-module
 * harnesses in this directory already establish as necessary
 * (`localforage`, `src/ts/globalApi.svelte`, `src/ts/storage/database.svelte`,
 * `src/ts/platform`, `@tauri-apps/plugin-fs`, `src/ts/stores.svelte`) --
 * none of the heavier modules (`alert`, `sionyw`, `parser.svelte`,
 * `characterCards`, `process/index.svelte`) needed mocking here, unlike in
 * `cold-storage-orphan-repro.svelte.harness.ts`, because nothing in these
 * scenarios calls into their exported functions; only characters.ts's own
 * synchronous top-level module body runs, and the probe confirmed that
 * body -- and everything it drags in -- tolerates the same thin,
 * genuinely-reactive `stores.svelte` mock used elsewhere in this directory
 * without throwing.
 *
 * MOCKED, AND WHY:
 *   - `localforage` -- IndexedDB backend; not exercised by anything the
 *     mounted components call in these scenarios, stubbed to be inert.
 *   - `src/ts/globalApi.svelte` -- this is where `getFileSrc` lives; it is
 *     replaced with a COUNTING SPY that logs every call and its argument,
 *     returns a distinct string per `loc`, and resolves on the same
 *     microtask tick (no artificial delay) so re-renders settle fast. Every
 *     other named export characters.ts/util.ts/characterCards.ts/etc. pull
 *     from this module is stubbed with an inert no-op; the probe confirmed
 *     none of them are touched at module-evaluation time, and none of these
 *     scenarios call the character-mutation helpers (`changeChar`,
 *     `removeChar`, import/export) that would need them for real.
 *   - `src/ts/storage/database.svelte` -- `getDatabase()` throws if called;
 *     never called, `DBState.db` is set directly instead (same pattern as
 *     both existing `.svelte.harness.ts` files in this directory).
 *   - `src/ts/platform` -- forces the plain-HTTP branch (`isTauri: false`),
 *     which is the branch under measurement.
 *   - `@tauri-apps/plugin-fs` -- present in `node_modules` and importable
 *     for real, but stubbed anyway (matches the other harnesses; not
 *     exercised when `isTauri` is false).
 *   - `src/ts/stores.svelte` -- replaced with a thin, genuinely reactive
 *     (`$state`-backed) stand-in exposing every store this import graph
 *     reads (`DBState`, `selectedCharID`, `CharEmotion`,
 *     `OpenRealmStore`, `alertStore`, `selIdState`,
 *     `SettingsMenuIndex`, `ShowRealmFrameStore`, `settingsOpen`). Kept in
 *     THIS ONE FILE per Agents/Tools/README.md's "Harnesses that mock the
 *     app's rune modules: keep them in ONE file" -- splitting the factory
 *     across files reproduces the unhandled-exception trap documented
 *     there for `trash-restore-repro.svelte.harness.ts`.
 *
 * NOT mocked: `src/ts/characters.ts` (`getCharImage` is real), `src/lang`,
 * `src/ts/util.ts` (`findCharacterIndexbyId`, `parseMultilangString`),
 * `GridCatalog.svelte`, `CharacterSimpleList.svelte`, `BarIcon.svelte`,
 * `TextInput.svelte`, `Button.svelte`, the lucide icon components, and
 * everything characters.ts drags in transitively.
 *
 * DRIVING THE UI: layout buttons are located by matching a real button's
 * `textContent` against the real `language.grid` / `.list` / `.trash` /
 * `.simple` strings and `.click()`ed (real click, not internal state
 * poking). The search box is the first `<input type="text">` under the
 * mounted root; its value is set via the native `HTMLInputElement.value`
 * setter (bypassing Svelte's own binding) and a real `input` event is
 * dispatched, exactly as the task requires.
 *
 * SETTLING: after every action, this harness calls the SAME `flushSync`
 * this component tree runs on (imported directly from `svelte`, the one
 * instance vite-plugin-svelte wires the compiled components to -- avoiding
 * the "importing `svelte` from the page loads a second runtime" trap noted
 * in the README, which does not apply here since this file IS the runtime
 * the components compile against), then repeatedly awaits a pair of
 * microtask ticks and re-checks both the getFileSrc call count and the
 * number of DOM nodes carrying a resolved avatar background, stopping once
 * both stop changing (bounded at 50 iterations as a safety cap, never hit
 * in practice since the mock `getFileSrc` resolves in one tick and nothing
 * here chains promises).
 *
 * WHAT "INITIAL MOUNT OF THAT LAYOUT" MEANS FOR NON-DEFAULT LAYOUTS:
 * `GridCatalog`'s own `selected` state always defaults to 3 (simple), so a
 * fresh `mount()` always renders simple first. For layouts 0/1/2, this
 * harness mounts fresh, lets the DEFAULT simple layout settle (uncounted),
 * clears the spy, THEN clicks that layout's button and measures from there
 * -- i.e. "initial mount of layout N" measures the cost of that layout's
 * each-block rendering for the very first time, isolated from the default
 * layout's own mount cost. This is the only sense in which "initial mount"
 * is meaningful for a layout that is never the component's own default.
 *
 * Run:
 *   npx vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/charlist-avatar-count.svelte.harness.ts --reporter=verbose
 *
 * Read-only w.r.t. src/ -- this file drives the real modules, it does not
 * modify them.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi } from 'vitest'
import type { Database } from '../../../src/ts/storage/database.svelte'

//#region module mocks (kept in this one file -- see header)

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

/**
 * The counting spy IS the measurement instrument. `calls` records every
 * `loc` argument in call order; `mock` is the vi spy itself (for
 * `.mock.calls.length` / `.mockClear()`). Resolves on the microtask the
 * `async` function body itself yields -- no artificial delay -- so the
 * settle loop below converges in a couple of ticks regardless of N.
 */
// vi.mock factories are hoisted above ordinary top-level const/let
// declarations, so the spy must be created inside vi.hoisted() to be
// visible to the factory below at the time it runs.
const { getFileSrcCalls, getFileSrcSpy } = vi.hoisted(() => {
    const calls: string[] = []
    const spy = vi.fn(async (loc: string) => {
        calls.push(loc)
        return `data:mock-image;loc=${loc}`
    })
    return { getFileSrcCalls: calls, getFileSrcSpy: spy }
})

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                isAccount: false,
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => {}),
            },
            getFileSrc: getFileSrcSpy,
            checkCharOrder: vi.fn(),
            requiresFullEncoderReload: { state: false },
            AppendableBuffer: class {},
            VirtualWriter: class {},
            LocalWriter: class {},
            BlankWriter: class {},
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(),
            readImage: vi.fn(),
            globalFetch: vi.fn(),
            aiWatermarkingLawApplies: vi.fn(() => false),
            changeChatTo: vi.fn(),
            hubURL: '',
            usingSw: false,
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: vi.fn(() => {
                throw new Error('no live database in tests')
            }),
            presetTemplate: { name: 'test-preset' },
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

// Thin, genuinely-reactive ($state-backed) stand-in for the app's whole
// store module -- same pattern and same reason as
// trash-restore-repro.svelte.harness.ts / cold-storage-orphan-repro's mock.
// The factory constructs the `$state` object directly (no cross-file
// dynamic import); splitting that across files is the exact trap the
// README documents.
vi.mock(import('../../../src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 },
        SettingsMenuIndex: writable(0),
        ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false),
    } as unknown as typeof import('../../../src/ts/stores.svelte')
})

//#endregion

//#region AV-2 IntersectionObserver fake (see comment below)

/**
 * AV-2 (`Agents/Reports/14-av2-lazy-avatar-plan.md`, section 3.1) now gates
 * each avatar's resolution on `nearViewport`'s use of `IntersectionObserver`,
 * and happy-dom's own `IntersectionObserver` never invokes its callback at
 * all (`observe()` is a no-op there), so without a fake every avatar here
 * would stay permanently unresolved and every measurement below would read 0
 * lookups no matter what actually changed. Per the plan's v8 ("AV-1's tests
 * must still pass with the fake reporting all visible"), this fake reports
 * every observed target immediately, permanently visible -- the same
 * "everything resolves" behaviour this harness measured before AV-2 existed
 * -- so it keeps measuring AV-1's per-change re-lookup behaviour, not AV-2's
 * visibility gating.
 *
 * SYNCHRONOUS, ON PURPOSE: `nearViewport.svelte.ts` (`use:nearViewport`'s
 * setup) reads nothing about *when* its `IntersectionObserver` callback
 * fires -- it only registers a per-target callback and calls `observe()`;
 * there is no code path anywhere in it, or in this file's `settle()` helper,
 * that depends on the callback arriving asynchronously. An EARLIER version
 * of this fake deferred its callback via `queueMicrotask`, matching the real
 * spec's always-async delivery -- but that extra hop raced `settle()`'s own
 * "stop once two consecutive checks agree" convergence loop: `settle()`
 * could observe two stable-looking ticks and return BEFORE the deferred
 * microtask had even run, letting that call land after the NEXT action's
 * own `getFileSrcSpy.mockClear()`, misattributing it (confirmed empirically
 * against this same fake in the sibling test file: the suite was measurably
 * flaky with the deferred version, and merely adding unrelated
 * `console.log` calls -- extra synchronous work shifting microtask timing
 * -- was enough to flip failures to passes on an unchanged assertion).
 * Firing synchronously inside `observe()` removes that hop entirely:
 * `onChange(true)` runs in the same tick as the mount/update that called
 * `observe()`, exactly like AV-1's pre-AV-2 behaviour (avatars started
 * resolving synchronously at render time, no observer indirection at all),
 * which is precisely the behaviour this harness measures. Installed before
 * any component ever mounts (module-level, not inside a hook), per
 * `nearViewport.svelte.ts`'s own test-seam doc comment.
 */
class AllVisibleIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null
    readonly rootMargin: string = ''
    readonly thresholds: ReadonlyArray<number> = []
    #callback: IntersectionObserverCallback

    constructor(callback: IntersectionObserverCallback) {
        this.#callback = callback
    }

    observe(target: Element): void {
        this.#callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this)
    }

    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
        return []
    }
}

vi.stubGlobal('IntersectionObserver', AllVisibleIntersectionObserver)

//#endregion

import { DBState } from '../../../src/ts/stores.svelte'
import { language } from '../../../src/lang'
import GridCatalog from '../../../src/lib/Others/GridCatalog.svelte'

//#region fixture helpers

type CharacterFixture = Database['characters'][number]

/**
 * `~` is a marker not otherwise present in any generated name. Every 10th
 * non-trashed character (i % 10 === 0) carries it, and the FIRST trashed
 * character carries it too, giving a precise, reproducible "~10% of the
 * currently-shown list" narrowing target for the search scenarios (exact
 * fraction reported per N in the results table, not assumed to be exactly
 * 10%). All non-trashed AND trashed names contain the literal "Character",
 * so a single 'C' keystroke matches every character in every layout,
 * including trash.
 */
function buildDb(nonTrashed: number, trashed: number): Database {
    const characters: CharacterFixture[] = []
    for (let i = 0; i < nonTrashed; i++) {
        const marked = i % 10 === 0
        characters.push({
            chaId: `char-${i}`,
            name: `Character ${i}${marked ? '~' : ''}`,
            type: 'character',
            image: `assets/${i}.png`,
            creatorNotes: '',
            chatPage: 0,
            lastInteraction: i,
            chats: [{ id: `char-${i}-chat-0`, message: [], note: '', name: '', localLore: [] }],
            trashTime: undefined,
        } as unknown as CharacterFixture)
    }
    for (let j = 0; j < trashed; j++) {
        const marked = j === 0
        characters.push({
            chaId: `trashed-${j}`,
            name: `Character Trash ${j}${marked ? '~' : ''}`,
            type: 'character',
            image: `assets/trashed-${j}.png`,
            creatorNotes: '',
            chatPage: 0,
            lastInteraction: 0,
            chats: [{ id: `trashed-${j}-chat-0`, message: [], note: '', name: '', localLore: [] }],
            trashTime: 1_700_000_000_000 + j,
        } as unknown as CharacterFixture)
    }
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
        hideAllImages: false,
    } as unknown as Database
}

/**
 * Index of a character that is VISIBLE in the active layout but otherwise
 * uninvolved in the action (the "unrelated character" the task brief
 * describes) -- a middle non-trashed character for grid/list/simple, a
 * middle trashed one for trash.
 *
 * An EARLIER version of this harness deliberately targeted an INVISIBLE
 * character instead (a trashed one, while viewing grid/list/simple), to
 * test the hypothesis's literal "ANY character" wording. That measured a
 * hard 0 for every layout and looked like a premise-contradicting result,
 * but tracing `formatChars` (`GridCatalog.svelte:33-51`) shows why: its
 * loop does `if(c.trashTime && !trash){ continue }` (and the mirror check
 * for the trash view) BEFORE reading `.name`/`.image`/`.type`/
 * `.creatorNotes` for that character -- an excluded character's name/image
 * is one of exactly the fields the hypothesis itself scopes to "fields
 * formatChars reads", and for an excluded character formatChars reads
 * ONLY `.trashTime`, never those others. So that 0 is fully consistent
 * with the hypothesis (not a contradiction of it), not evidence the
 * mutation was ignored for some other reason -- it was never a dependency
 * in the first place. Recorded as a finding, not built into the measured
 * scenario, to avoid presenting a confound as if it were a clean test.
 */
function unrelatedIndexFor(layout: 0 | 1 | 2 | 3, nonTrashed: number): number {
    return layout === 2 ? nonTrashed : Math.floor(nonTrashed / 2) // trash: first trashed char; else: a middle non-trashed char
}

function layoutLabel(layout: 0 | 1 | 2 | 3): string {
    return layout === 0 ? language.grid : layout === 1 ? language.list : layout === 2 ? language.trash : language.simple
}

function countAvatarEls(root: HTMLElement): number {
    return root.querySelectorAll('[style*="background: url("]').length
}

function countAllEls(root: HTMLElement): number {
    return root.querySelectorAll('*').length
}

function clickLayoutButton(root: HTMLElement, layout: 0 | 1 | 2 | 3): void {
    const label = layoutLabel(layout).trim()
    const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    if (!btn) {
        throw new Error(`layout button not found for label "${label}"`)
    }
    btn.click()
}

function setSearchValue(root: HTMLElement, value: string): void {
    const input = root.querySelector('input[type="text"]') as HTMLInputElement | null
    if (!input) {
        throw new Error('search input not found')
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Repeatedly flushes the REAL Svelte runtime this component tree is
 * compiled against, then awaits a pair of microtask ticks, until neither
 * the getFileSrc call count nor the number of resolved-avatar DOM nodes
 * changes between two consecutive iterations. Bounded at 50 iterations as
 * a safety cap; never observed to need more than a handful in practice
 * since the mocked getFileSrc resolves in one microtask.
 */
async function settle(root: HTMLElement): Promise<void> {
    let lastCalls = -1
    let lastAvatars = -1
    for (let i = 0; i < 50; i++) {
        flushSync()
        await Promise.resolve()
        await Promise.resolve()
        const calls = getFileSrcSpy.mock.calls.length
        const avatars = countAvatarEls(root)
        if (calls === lastCalls && avatars === lastAvatars) {
            break
        }
        lastCalls = calls
        lastAvatars = avatars
    }
    flushSync()
}

/**
 * Split into "build the DB" and "mount" on purpose: `mount()` runs the
 * component's first render SYNCHRONOUSLY, which synchronously invokes
 * `getCharImage`/`getFileSrc` for every listed character (calling an async
 * function runs its body up to the first `await` synchronously). A caller
 * that wants to count "calls caused by this mount" must clear the spy
 * AFTER setting up `DBState.db` but BEFORE calling `mount()` -- clearing
 * afterward (as an earlier version of this harness did) silently wipes out
 * the exact calls being measured and undercounts by the full initial-mount
 * total, while resolved avatars still show up later because the spy's
 * returned promises are unaffected by `mockClear()`. That bug was caught
 * by cross-checking `avatarEls` against `calls` in a first raw run of this
 * harness (avatarEls == N while calls == 0 is impossible if calls truly
 * caused those avatars), not assumed.
 */
function prepareDb(nonTrashed: number, trashed: number): void {
    DBState.db = buildDb(nonTrashed, trashed)
}

function mountGridCatalog(): { target: HTMLElement; app: Record<string, unknown> } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: {} }) as unknown as Record<string, unknown>
    return { target, app }
}

async function teardown(target: HTMLElement, app: Record<string, unknown>): Promise<void> {
    await unmount(app as never)
    target.remove()
}

//#endregion

//#region measurement types

interface InitialMountRow {
    n: number
    layout: string
    calls: number
    avatarEls: number
    domEls: number
    ms: number
}

interface ActionRow {
    n: number
    layout: string
    action: string
    calls: number
    ms: number
}

const initialMountRows: InitialMountRow[] = []
const actionRows: ActionRow[] = []

const LAYOUTS: { id: 0 | 1 | 2 | 3; label: string }[] = [
    { id: 3, label: 'simple' },
    { id: 0, label: 'grid' },
    { id: 1, label: 'list' },
    { id: 2, label: 'trash' },
]

const TRASHED_COUNT = 5

type Action = 'search-all' | 'search-narrow' | 'mutate-name' | 'mutate-image' | 'mutate-unrelated'

const ACTIONS: Action[] = ['search-all', 'search-narrow', 'mutate-name', 'mutate-image', 'mutate-unrelated']

/**
 * ONE fresh mount per layout, reused for the initial-mount measurement AND
 * all five action measurements in sequence (rather than a fresh mount per
 * action). This is a deliberate departure from the "isolate everything"
 * instinct: mounting a reactive N=1000 character tree 6x per layout (72
 * mounts total across all three N tiers) reliably drove this harness's
 * Node process out of heap (`Ineffective mark-compacts near heap limit`)
 * on this machine before this change -- happy-dom + Svelte 5's per-property
 * reactive proxies are not cheap per character, and repeated large mounts
 * within one process outpaced GC. Reusing one mount per layout cuts total
 * mounts to 12 (4 layouts x 3 N tiers) and completes without OOM. Isolation
 * between actions is preserved by explicitly resetting the search box to
 * '' (settled, uncounted) before every action, so each measured action
 * always starts from the same "full list visible" baseline regardless of
 * what the previous action did.
 */
async function measureLayout(n: number, layout: 0 | 1 | 2 | 3, layoutLabelStr: string): Promise<void> {
    prepareDb(n, TRASHED_COUNT)
    getFileSrcSpy.mockClear() // BEFORE mount() -- see mountGridCatalog's doc comment
    const t0 = performance.now()
    const { target, app } = mountGridCatalog()
    await settle(target)
    let initCalls: number
    let initMs: number
    if (layout === 3) {
        // simple is GridCatalog's own default -- this settle above IS the
        // initial mount.
        initCalls = getFileSrcSpy.mock.calls.length
        initMs = performance.now() - t0
    } else {
        // isolate this layout's own first-render cost from the default
        // (simple) layout's mount cost that necessarily precedes it.
        getFileSrcSpy.mockClear()
        const t1 = performance.now()
        clickLayoutButton(target, layout)
        await settle(target)
        initMs = performance.now() - t1
        initCalls = getFileSrcSpy.mock.calls.length
    }
    initialMountRows.push({
        n,
        layout: layoutLabelStr,
        calls: initCalls,
        avatarEls: countAvatarEls(target),
        domEls: countAllEls(target),
        ms: initMs,
    })

    const idx = unrelatedIndexFor(layout, n)

    async function resetSearchToFullList(): Promise<void> {
        setSearchValue(target, '')
        await settle(target)
    }

    for (const action of ACTIONS) {
        await resetSearchToFullList() // full, unfiltered list visible, uncounted
        getFileSrcSpy.mockClear()
        const ta0 = performance.now()
        switch (action) {
            case 'search-all':
                setSearchValue(target, 'C')
                break
            case 'search-narrow':
                setSearchValue(target, '~')
                break
            case 'mutate-name':
                DBState.db.characters[idx].name = `${DBState.db.characters[idx].name} EDITED`
                break
            case 'mutate-image':
                DBState.db.characters[idx].image = 'assets/mutated.png'
                break
            case 'mutate-unrelated':
                ;(DBState.db.characters[idx].chats[0].message as unknown[]).push({
                    time: Date.now(),
                    data: 'unrelated mutation',
                    role: 'user',
                })
                break
        }
        await settle(target)
        const ms = performance.now() - ta0
        const calls = getFileSrcSpy.mock.calls.length
        actionRows.push({ n, layout: layoutLabelStr, action, calls, ms })
    }

    await teardown(target, app)
}

//#endregion

describe('charlist-avatar-count: premise measurement against GridCatalog.svelte (post-AV-1 fix; see header UPDATE note)', () => {
    // Generous timeout: this first test pays the one-time ~15-17s Vite
    // transform cost for characters.ts's whole transitive import graph
    // (confirmed bounded and reproducible by a throwaway probe -- see
    // header). Every mount/action after this one in the same process is
    // fast because the modules are already transformed.
    test(
        'N=31: initial mount + actions across all four layouts',
        async () => {
            const n = 31
            for (const { id, label } of LAYOUTS) {
                await measureLayout(n, id, label)
            }
        },
        120_000,
    )

    test(
        'N=500: initial mount + actions across all four layouts',
        async () => {
            const n = 500
            for (const { id, label } of LAYOUTS) {
                await measureLayout(n, id, label)
            }
        },
        180_000,
    )

    test(
        'N=1000: initial mount + actions across all four layouts, then print full report',
        async () => {
            const n = 1000
            for (const { id, label } of LAYOUTS) {
                await measureLayout(n, id, label)
            }

            console.log('\n=== charlist-avatar-count: INITIAL MOUNT ===')
            console.table(
                initialMountRows.map((r) => ({
                    N: r.n,
                    layout: r.layout,
                    getFileSrcCalls: r.calls,
                    avatarEls: r.avatarEls,
                    totalDomEls: r.domEls,
                    ms: r.ms.toFixed(2),
                })),
            )

            console.log('\n=== charlist-avatar-count: ACTIONS ===')
            console.table(
                actionRows.map((r) => ({
                    N: r.n,
                    layout: r.layout,
                    action: r.action,
                    getFileSrcCalls: r.calls,
                    ms: r.ms.toFixed(2),
                })),
            )

            // --- Observations pinned against THIS run of the POST-AV-1
            // FIXED code (see the header's "UPDATE (post-AV-1)" note).
            // Initial mount is UNCHANGED by AV-1 (it never had a stale-avatar
            // problem to begin with -- every listed character legitimately
            // needs its avatar resolved once on first render): every
            // layout's initial mount still resolves an avatar for every
            // character it lists (grid/list/simple: all non-trashed; trash:
            // all trashed).
            for (const layout of ['simple', 'grid', 'list']) {
                const row = initialMountRows.find((r) => r.n === n && r.layout === layout)!
                expect(row.calls).toBe(n) // observed: one getFileSrc call per non-trashed character
                expect(row.avatarEls).toBe(n) // observed: one resolved avatar element per character
            }
            const trashRow = initialMountRows.find((r) => r.n === n && r.layout === 'trash')!
            expect(trashRow.calls).toBe(TRASHED_COUNT) // observed: one call per trashed character

            // AV-1's target: none of the five actions below should
            // re-resolve any avatar except `mutate-image`, which should
            // resolve EXACTLY the one character whose image path changed
            // (`calls === 1`), regardless of N or layout. Measured directly
            // (not assumed) at N=31, N=500 and N=1000, for all four layouts;
            // all twelve (N x layout) combinations were confirmed to match
            // this fixed pattern before pinning it here.
            const EXPECTED_POST_FIX = {
                'search-all': 0,
                'search-narrow': 0,
                'mutate-name': 0,
                'mutate-image': 1,
                'mutate-unrelated': 0,
            } as const

            // A search keystroke that still matches everyone.
            // PRE-FIX HISTORY (unkeyed `{#each formatChars(search, db) as
            // char}` with `additionalStyle={getCharImage(char.image, 'css')}`
            // inline): simple=0, grid=n, list=n, trash=TRASHED_COUNT -- grid/
            // list rebuilt every item as a fresh object on every keystroke
            // (formatChars sat inside the `{#each}` source expression), so
            // every listed avatar re-resolved even though the visible set
            // was unchanged; simple's per-item `{#if}`-gated filtering never
            // had this problem. AV-1's two-level `{@const imgPath = char.
            // image}` / `{@const avatarStyle = getCharImage(imgPath, 'css')}`
            // derived boundary (plan section 2.2(i)) now gates grid/list the
            // same way simple was already gated: the resolved path string is
            // unchanged, so the derived does not re-invoke `getCharImage`.
            for (const layout of ['simple', 'grid', 'list', 'trash']) {
                const row = actionRows.find((r) => r.n === n && r.layout === layout && r.action === 'search-all')!
                expect(row.calls).toBe(EXPECTED_POST_FIX['search-all'])
            }

            // A search keystroke that narrows to ~10%.
            // PRE-FIX HISTORY: simple=0, grid=matchedNarrow, list=matchedNarrow
            // (once per now-visible character, not N and not 0 -- the cost
            // tracked the current render's visible-list size). AV-1's
            // equality boundary now gates every surviving item the same way
            // as the unfiltered case above; the same characters carrying the
            // '~' marker are still keyed by `char.index` (plan section
            // 2.2(ii)), so narrowing no longer touches their resolved paths.
            for (const layout of ['simple', 'grid', 'list', 'trash']) {
                const row = actionRows.find((r) => r.n === n && r.layout === layout && r.action === 'search-narrow')!
                expect(row.calls).toBe(EXPECTED_POST_FIX['search-narrow'])
            }

            // Mutating one VISIBLE, otherwise-uninvolved character's name.
            // PRE-FIX HISTORY: every layout resolved `n` (or TRASHED_COUNT
            // for trash) again on a rename, even though only one
            // character's name changed and no character's image changed.
            // AV-1's equality boundary reads only the image path, so a name
            // change no longer invalidates any avatar's derived.
            for (const layout of ['simple', 'grid', 'list', 'trash']) {
                const row = actionRows.find((r) => r.n === n && r.layout === layout && r.action === 'mutate-name')!
                expect(row.calls).toBe(EXPECTED_POST_FIX['mutate-name'])
            }

            // Mutating one VISIBLE, otherwise-uninvolved character's image.
            // PRE-FIX HISTORY: every layout resolved `n` (or TRASHED_COUNT
            // for trash) again, i.e. the one real change caused every OTHER
            // listed character to re-resolve too. AV-1 is exactly this
            // regression's fix: the equality boundary re-invokes
            // `getCharImage` only for the item whose own resolved path
            // changed, so this is now the one action expected to produce a
            // nonzero, and exactly `1`, call count.
            for (const layout of ['simple', 'grid', 'list', 'trash']) {
                const row = actionRows.find((r) => r.n === n && r.layout === layout && r.action === 'mutate-image')!
                expect(row.calls).toBe(EXPECTED_POST_FIX['mutate-image'])
            }

            // Mutating a field formatChars/sortChar does not read (pushing a
            // chat message). PRE-FIX HISTORY: already 0 in every layout
            // before AV-1 (formatChars/sortChar reads `c.chats.length`, not
            // chat contents, and pushing a message does not change that
            // length, so this action was never a dependency of the
            // pre-existing per-item render in the first place). Unaffected
            // by AV-1; still 0, kept here as the negative control.
            for (const layout of ['simple', 'grid', 'list', 'trash']) {
                const row = actionRows.find((r) => r.n === n && r.layout === layout && r.action === 'mutate-unrelated')!
                expect(row.calls).toBe(EXPECTED_POST_FIX['mutate-unrelated'])
            }
        },
        300_000,
    )

    // --- Standalone timing: the per-call cost of the exact base64 expression
    // at globalApi.svelte.ts:285, with no components involved. ---
    test('base64 encode cost: globalApi.svelte.ts:285 expression, median of 20, at four payload sizes', () => {
        const sizes = [
            { label: '100 KB', bytes: 100 * 1024 },
            { label: '500 KB', bytes: 500 * 1024 },
            { label: '1 MB', bytes: 1024 * 1024 },
            { label: '3 MB', bytes: 3 * 1024 * 1024 },
        ]
        const rows: { size: string; medianMs: string; resultLength: number }[] = []
        for (const { label, bytes } of sizes) {
            const arr = new Uint8Array(bytes)
            for (let i = 0; i < arr.length; i++) {
                arr[i] = (i * 2654435761) & 0xff // deterministic pseudo-random fill, no RNG dependency
            }
            const timings: number[] = []
            let resultLength = 0
            for (let i = 0; i < 20; i++) {
                const t0 = performance.now()
                // exact expression from globalApi.svelte.ts:285
                const encoded = Buffer.from(arr).toString('base64')
                timings.push(performance.now() - t0)
                resultLength = encoded.length
            }
            timings.sort((a, b) => a - b)
            const median = timings[Math.floor(timings.length / 2)]
            rows.push({ size: label, medianMs: median.toFixed(3), resultLength })
        }
        console.log('\n=== base64 encode cost (globalApi.svelte.ts:285 expression) ===')
        console.table(rows)
        // Observation only -- record that encoding completes and scales with
        // size; not a pass/fail claim about any budget.
        expect(rows.length).toBe(4)
    })
})
