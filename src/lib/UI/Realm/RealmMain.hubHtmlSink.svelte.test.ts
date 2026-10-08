// @vitest-environment jsdom

/**
 * Wiring test for the `{@html sanitizeHubHtml(hubAnnouncement)}` sink in
 * `RealmMain.svelte` (Stage 2 of the home-screen rework; see
 * `Agents/Live-State.md`). Compare `MainMenu.hubHtmlSink.svelte.test.ts`, the
 * sibling test for the other `additionalHTML` sink. `src/ts/hubHtml.test.ts`
 * already covers `sanitizeHubHtml` as a pure function; this file mounts the
 * REAL `RealmMain.svelte` against the REAL `src/ts/hubHtml.ts` (not mocked)
 * and drives it with a hostile `additionalHTML` payload, so a disconnected
 * sink fails here even though it would still pass every unit test on
 * `hubHtml.ts` alone.
 *
 * `hubAnnouncement` is component `$state`, assigned from `getHub()`'s
 * resolved `RisuHubResult` (`src/ts/characterCards.ts`) only after the fetch
 * settles, so this test's assertions must run after awaiting that
 * resolution: asserting immediately after mount would observe the sink
 * before `hubAnnouncement` is ever set and pass vacuously against an empty
 * string.
 *
 * `getRisuHub` is mocked (to resolve to the hostile payload) so the real
 * network fetch never fires. `./RealmHubIcon.svelte` and `./RealmPopUp.svelte`
 * are stubbed to trivial components, following the
 * `ChatBody.svelte`/`PartialEditController.svelte` precedent in
 * `Chat.messageEditor.svelte.test.ts`: neither is exercised by the sink
 * under test (the card list stays empty; `openedData` stays `null`, so the
 * popup never renders), and stubbing both keeps this file from also having
 * to mock `src/ts/util` and the rest of `RealmPopUp.svelte`'s own dependency
 * graph.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'

//#region module mocks

const hubState = vi.hoisted(() => ({
    result: { ok: true, cards: [] as unknown[], additionalHTML: '' } as unknown,
}))

vi.mock(import('src/ts/characterCards'), () => ({
    getRisuHub: vi.fn(async () => hubState.result),
    downloadRisuHub: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/alert'), () => ({
    alertInput: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/stores.svelte'), () => {
    // `RealmMain.svelte` imports the REAL `src/ts/hubHtml.ts` (see file
    // header), which imports the REAL `src/ts/globalApi.svelte` for
    // `openURL`. That module's own import graph reaches
    // `src/ts/parser/parser.svelte.ts`, which runs a top-level `$effect.root`
    // reading `selIdState.selId` and `DBState.db.characters` at module load.
    // `selectedCharID` is imported there too, though not read at load time.
    // These three are supplied here only so that module load does not
    // throw; none of them is otherwise exercised by this file's test.
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        MobileGUI: writable(false),
        RealmInitialOpenChar: writable(null),
        // `src/ts/upstreamAgreement.ts` reads and writes this store directly,
        // never through `src/ts/alert.ts` -- a mock lacking it leaves the
        // agreement helper writing to `undefined`.
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

// Stubbed out entirely -- not rendered (charas stays empty, openedData stays
// null) and not itself under test (see file header).
vi.mock('./RealmHubIcon.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('./RealmPopUp.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import RealmMain from './RealmMain.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountRealmMain() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(RealmMain, { target, props: {} })
    mountedInstances.push(instance)
    flushSync()
    return target
}

// This suite's own assertion is about the sanitizer wiring, not the
// agreement gate, so acceptance is seeded through the module.
beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
})

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    hubState.result = { ok: true, cards: [], additionalHTML: '' }
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
    vi.clearAllMocks()
})

describe('RealmMain.svelte: the additionalHTML sink is wired to sanitizeHubHtml', () => {
    test('a hostile additionalHTML payload is sanitized before it reaches the DOM, once getHub() resolves', async () => {
        hubState.result = {
            ok: true,
            cards: [],
            additionalHTML: '<img src=x onerror="alert(1)"><p>safe text</p>',
        }

        const target = mountRealmMain()
        // The banner must not appear before getHub()'s await settles --
        // otherwise this test would pass vacuously against an implementation
        // that leaves the sink frozen at mount.
        expect(target.innerHTML).not.toContain('safe text')

        // Let RealmMain's top-level `getHub()` call resolve.
        await Promise.resolve()
        await Promise.resolve()
        flushSync()

        expect(target.innerHTML).not.toContain('onerror')
        expect(target.innerHTML).not.toContain('<img')
        expect(target.innerHTML).toContain('<p>safe text</p>')
    })
})
