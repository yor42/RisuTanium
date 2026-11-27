import { untrack } from 'svelte';
import { DBState } from 'src/ts/stores.svelte';
import { getRisuHub, type RisuHubResult, type hubType } from 'src/ts/characterCards';
import { filterBlockedRealmCards, realmBlockListKey } from 'src/ts/realmBlocking';

// Five-state model replacing the old `{#await}` -- offline/pending/
// failed/empty/populated, the card list, the announcement string, and a
// load function the Retry control calls -- so failure reads as
// distinguishable from empty (`MC-056`), pending is visibly announced
// (`MC-057`), and offline gets its own inert control (`MC-060`).
// Whether the upstream-services agreement still needs confirming is not a
// member of this type: the owner passes it in as `accepted`.
export type HubPreviewStatus = 'offline' | 'pending' | 'failed' | 'empty' | 'populated';

export interface RealmPreview {
  readonly status: HubPreviewStatus;
  readonly cards: hubType[];
  readonly announcement: string;
  readonly hidden: boolean;
  load(): Promise<void>;
  /**
   * Returns the in-flight or recent default-page request so RealmMain can reuse
   * it instead of issuing a duplicate recommended/page-0 fetch. Returns null
   * when no load is cached, the cache is older than 5 minutes, or the blocked
   * creators list changed since the request started.
   */
  getInitialList(): Promise<RisuHubResult> | null;
}

const REALM_LIST_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Contains effects; call it while a component (or an effect root) is being
 * initialised. The effects and the `online` listener are torn down with that
 * owner. `accepted` is read inside both effects, so it must read reactive
 * state for them to follow acceptance.
 */
export function createRealmPreview(accepted: () => boolean, verifyAccepted: () => boolean): RealmPreview {
    let hubStatus: HubPreviewStatus = $state('pending');
    let hubCards: hubType[] = $state([]);
    let hubAnnouncement = $state('');
    const visibleCards = $derived(filterBlockedRealmCards(hubCards, DBState.db.blockedRealmCreators ?? []));

    // Monotonic generation counter: guards every state write below (offline,
    // pending, success and failure alike) so a superseded request's late
    // resolution can never stomp a newer request's result.
    let hubGeneration = 0;

    let initialEntry: { key: string; time: number; promise: Promise<RisuHubResult> } | null = null;
    // Untracked so loadHubPreview() called inside the acceptance/hideRealm $effect
    // does not subscribe that effect to wholesale DBState.db reassignments.
    const blockedCreatorsKey = () => untrack(() => realmBlockListKey(DBState.db.blockedRealmCreators ?? []));

    async function loadHubPreview() {
      if (!verifyAccepted()) return;

      // Captured, then written before the request-issuing await below:
      // nothing else can run between the increment and this write (both
      // happen synchronously), so it is always the newest generation at
      // the moment it is written. Two calls can be in flight at once (the
      // acceptance effect below, Retry, the online listener); this is what
      // keeps a slower, superseded response from stomping a newer result.
      const generation = ++hubGeneration;
      hubStatus = 'pending';

      const key = blockedCreatorsKey();
      // `getRisuHub` itself classifies "offline" (checked before any fetch
      // is issued) alongside every other failure reason.
      const promise = getRisuHub({
        search: '',
        page: 0,
        nsfw: false,
        sort: 'recommended'
      });
      const entry = { key, time: Date.now(), promise };
      initialEntry = entry;

      const result = await promise;
      if (generation !== hubGeneration || !verifyAccepted()) {
        return;
      }
      if (initialEntry === entry && (!result.ok || result.cards.length === 0 || result.blockedCreatorsKey !== entry.key)) {
        initialEntry = null;
      }

      if (result.ok !== true) {
        if (result.reason === 'consent') {
          // `getRisuHub` checks `isUpstreamAccepted()` before any await, in the same tick as
          // this call, and already published that fresh, negative read into `upstreamAccepted`
          // before returning this via `publishUpstreamAccepted()` (`src/ts/upstreamAgreement.ts`)
          // -- the placeholder is showing again because `upstreamAccepted` now agrees with
          // storage, not because of anything this branch still needs to do.
          return;
        }
        hubStatus = result.reason === 'offline' ? 'offline' : 'failed';
        return;
      }

      // Only ever assign non-empty announcements: this reproduces the old
      // module-global cache's "keep the previous value" behaviour now that
      // the value lives in per-consumer $state instead.
      if (result.additionalHTML) {
        hubAnnouncement = result.additionalHTML;
      }
      hubCards = result.cards;
      hubStatus = result.cards.length > 0 ? 'populated' : 'empty';
    }

    // `DBState.db` is reassigned wholesale on backup restore, plugin
    // setDatabase and many command.ts paths. An effect that reads
    // `DBState.db.hideRealm` directly would depend on the
    // container and refetch on every one of those reassignments even when
    // hideRealm itself didn't change. Deriving the boolean first means the
    // effect depends on the value: Svelte 5 doesn't propagate a $derived
    // recompute that lands on the same value, so a DBState.db swap that
    // leaves hideRealm alone does not trigger a refetch.
    const realmHidden = $derived(DBState.db.hideRealm);

    // The one place this view loads in response to acceptance (MC-086, MC-087 #3, MC-087 #3a).
    // Reruns whenever either dependency actually changes value -- including a revisit, such as
    // hiding then unhiding -- since the acceptance source (a Svelte store) and `realmHidden` (a
    // `$derived`) both skip notifying on a write that reconfirms their current value, so a rerun
    // here always corresponds to a genuine transition.
    $effect(() => {
      if (!accepted()) {
        hubGeneration++;
        initialEntry = null;
        hubCards = [];
        hubAnnouncement = '';
        hubStatus = 'pending';
      } else if (!realmHidden) {
        loadHubPreview();
      }
    });

    // Recover automatically: leave the offline state and reload as soon as
    // the browser reports connectivity again, instead of stranding the
    // user until they find the (inert, in that state) retry control. All
    // three checks stay required: `hubStatus === 'offline'` so a fetch that's
    // already pending, failed or resolved isn't redundantly restarted;
    // `realmHidden` so a whole-`DBState.db` swap (plugin setDatabase, backup
    // restore, the command.ts paths named in the comment above) that turns
    // hideRealm on while the owner stays mounted doesn't fetch the hub
    // for a user who opted out, since `hubStatus` is never reset by that
    // swap on its own; and `accepted()` so withdrawing consent while
    // offline doesn't let a later `online` event load the preview for a user
    // who has not agreed to upstream's terms.
    $effect(() => {
      function handleOnline() {
        if (hubStatus === 'offline' && !realmHidden && accepted()) {
          loadHubPreview();
        }
      }
      window.addEventListener('online', handleOnline);
      return () => window.removeEventListener('online', handleOnline);
    });

    function getInitialList(): Promise<RisuHubResult> | null {
      if (!accepted() || !initialEntry) {
        return null;
      }
      if (initialEntry.key !== blockedCreatorsKey() || Date.now() - initialEntry.time > REALM_LIST_MAX_AGE_MS) {
        initialEntry = null;
        return null;
      }
      return initialEntry.promise;
    }

    return {
      get status() { return hubStatus === 'populated' && visibleCards.length === 0 ? 'empty' : hubStatus; },
      get cards() { return visibleCards; },
      get announcement() { return hubAnnouncement; },
      get hidden() { return realmHidden; },
      load: loadHubPreview,
      getInitialList,
    };
}
