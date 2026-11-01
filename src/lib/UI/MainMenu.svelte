<script lang="ts">
    import { DBState } from 'src/ts/stores.svelte';
    import Hub from "./Realm/RealmMain.svelte";
    import { OpenRealmStore, RealmInitialOpenChar } from "src/ts/stores.svelte";
    import { ArrowLeft, ArrowRight, Compass, GlobeIcon, MailIcon, Send, Wrench } from "@lucide/svelte";
    import { getVersionString, openURL } from "src/ts/globalApi.svelte";
    import { language } from "src/lang";
    import { getRisuHub, type hubType } from "src/ts/characterCards";
    import { handleHubHtmlClick, sanitizeHubHtml } from "src/ts/hubHtml";
    import { askUpstreamAgreement, upstreamAccepted } from "src/ts/upstreamAgreement";
    import RealmPreviewRow from "./Realm/RealmPreviewRow.svelte";
    import SourceDisclosure, { type Destination } from "./SourceDisclosure.svelte";
    import Title from "./Title.svelte";
    import { pageStorageModeStore } from "src/ts/storage/pageStorageMode";
    import { utilityOpen, utilityVisible } from "../Utility/utilityGate";

    // Discriminated on `kind` rather than a bare optional `href`, so a
    // disclosure entry can never also carry a direct-navigate href and vice
    // versa -- `MC-065` records that this looked like a one-line change and
    // was not one, precisely because the GitHub card's root element has to
    // change shape (see the shared class constants and the {#each} below).
    //
    // `upstream` on the `link` variant and `destinations`/`icon` on the
    // `disclosure` variant are additions, not a reshape of the union
    // itself: `upstream` drives the same grey marker treatment
    // `SourceDisclosure` already renders per-destination, generalised here
    // to the Discord and Website cards per `MC-054` ("the upstream label
    // generalises... to every home-screen link owned by upstream").
    // `destinations`/`icon` let the Email card reuse `SourceDisclosure` for
    // its two addresses instead of duplicating the disclosure machinery.
    type RelatedLink =
      | {
          kind: 'link';
          title: string;
          description: string;
          href: string;
          logoIcon: "globe" | "mail" | "paper-airplane";
          upstream?: boolean;
        }
      | {
          kind: 'disclosure';
          title: string;
          description: string;
          destinations?: Destination[];
          icon?: typeof MailIcon;
        };

    const relatedLinkIconClass =
      "h-40 w-40 md:h-44 md:w-44 origin-right -rotate-12 opacity-[0.12] transition-all duration-500 group-hover:scale-105 group-hover:opacity-[0.22]";

    // Expressed once and composed by both branches of the {#each} below
    // (the plain link <button>, and the disclosure's outer <div> plus its
    // inner trigger <button>) rather than copy-pasted, so the two card
    // shapes cannot drift the first time either is restyled.
    //
    // relatedCardClass carries the card's visual chrome -- border, rounded
    // corners, background, overflow clipping (which the decorative icon's
    // bleed-past-the-edge relies on) and the hover lift/border/background/
    // shadow motion every card in this grid shares.
    //
    // relatedCardTriggerClass carries the sizing: `min-h-[140px]` and
    // `flex flex-col justify-center` are what give a link card its
    // collapsed footprint, and `group`+`relative` are what the decorative
    // icon's `group-hover` and `absolute` positioning need from their
    // nearest ancestor. For the plain link card, chrome and trigger sizing
    // sit on the same root <button>. For the disclosure, only the trigger
    // sizing sits on the inner <button>; the chrome sits on the outer
    // <div> so the revealed list stays inside the same bordered card
    // rather than looking like an unstyled panel bolted beneath it.
    const relatedCardClass =
      "rounded-2xl border border-borderc/10 bg-darkbg overflow-hidden p-6 transition-all duration-300 hover:-translate-y-1 hover:border-borderc/30 hover:bg-selected/50 hover:shadow-xl hover:shadow-darkbg/50";
    const relatedCardTriggerClass =
      "group relative flex min-h-[140px] w-full flex-col justify-center text-left";

    // Fork entries first, matching the GitHub disclosure's own ordering:
    // this build's own address is the more likely destination for someone
    // looking at this build.
    const emailDestinations: Destination[] = [
      { label: language.homeSourceEmailForkLabel, href: "mailto:yoonch1022@naver.com", upstream: false },
      { label: language.homeSourceEmailUpstreamLabel, href: "mailto:support@risuai.net", upstream: true }
    ];

    const relatedLinks: RelatedLink[] = [
      {
        kind: 'link',
        title: language.homeLinkDiscordTitle,
        description: language.homeLinkDiscordDescription,
        href: "https://discord.gg/Exy3NrqkGm",
        logoIcon: "paper-airplane",
        // Upstream's own Discord, with no fork equivalent (`MC-054`).
        upstream: true
      },
      {
        kind: 'link',
        title: language.homeLinkWebsiteTitle,
        description: language.homeLinkWebsiteDescription,
        href: "https://risuai.net",
        logoIcon: "globe",
        // Upstream's own website, with no fork equivalent (`MC-054`).
        upstream: true
      },
      {
        // The Source & Issues disclosure (`MC-065`): four fixed GitHub
        // destinations rendered by SourceDisclosure.svelte, not a
        // direct-navigate href.
        kind: 'disclosure',
        title: language.homeLinkGithubTitle,
        description: language.homeLinkGithubDescription
      },
      {
        // The Email card is a disclosure too, for the same reason the
        // GitHub card is: there are two addresses (fork and upstream), not
        // one, and a plain link can only ever carry one href.
        kind: 'disclosure',
        title: language.homeLinkEmailTitle,
        description: language.homeLinkEmailDescription,
        destinations: emailDestinations,
        icon: MailIcon
      }
    ];

    // Five-state model replacing the old `{#await}` -- offline/pending/
    // failed/empty/populated, the card list, the announcement string, and a
    // load function the Retry control below calls -- so failure reads as
    // distinguishable from empty (`MC-056`), pending is visibly announced
    // (`MC-057`), and offline gets its own inert control (`MC-060`).
    // Whether the upstream-services agreement still needs confirming is read
    // directly from `$upstreamAccepted` in the template below, not tracked
    // as a member of this type.
    type HubPreviewStatus = 'offline' | 'pending' | 'failed' | 'empty' | 'populated';

    let hubStatus: HubPreviewStatus = $state('pending');
    let hubCards: hubType[] = $state([]);
    let hubAnnouncement = $state('');

    // Monotonic generation counter: guards every state write below (offline,
    // pending, success and failure alike) so a superseded request's late
    // resolution can never stomp a newer request's result.
    let hubGeneration = 0;

    async function loadHubPreview() {
      // Captured, then written before the request-issuing await below:
      // nothing else can run between the increment and this write (both
      // happen synchronously), so it is always the newest generation at
      // the moment it is written. Two calls can be in flight at once (the
      // acceptance effect below, Retry, the online listener); this is what
      // keeps a slower, superseded response from stomping a newer result.
      const generation = ++hubGeneration;
      hubStatus = 'pending';

      // `getRisuHub` itself classifies "offline" (checked before any fetch
      // is issued) alongside every other failure reason.
      const result = await getRisuHub({
        search: '',
        page: 0,
        nsfw: false,
        sort: 'recommended'
      });

      if (generation !== hubGeneration) {
        return;
      }

      if (result.ok !== true) {
        if (result.reason === 'consent') {
          // `getRisuHub` checks `isUpstreamAccepted()` before any await, in the same tick as
          // this call, and already published that fresh, negative read into `upstreamAccepted`
          // before returning this via `publishUpstreamAccepted()` (`src/ts/upstreamAgreement.ts`)
          // -- the placeholder is showing again because `$upstreamAccepted` now agrees with
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
    // hiding then unhiding -- since `upstreamAccepted` (a Svelte store) and `realmHidden` (a
    // `$derived`) both skip notifying on a write that reconfirms their current value, so a rerun
    // here always corresponds to a genuine transition.
    $effect(() => {
      if (!realmHidden && $upstreamAccepted) {
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
    // hideRealm on while this component stays mounted doesn't fetch the hub
    // for a user who opted out, since `hubStatus` is never reset by that
    // swap on its own; and `$upstreamAccepted` so withdrawing consent while
    // offline doesn't let a later `online` event load the preview for a user
    // who has not agreed to upstream's terms.
    $effect(() => {
      function handleOnline() {
        if (hubStatus === 'offline' && !realmHidden && $upstreamAccepted) {
          loadHubPreview();
        }
      }
      window.addEventListener('online', handleOnline);
      return () => window.removeEventListener('online', handleOnline);
    });

    // Delegated click target for the card's browse action: a click
    // anywhere on the card that did not originate inside the scrollable
    // entries list opens RisuRealm, using
    // the same delegated `closest` check hubHtml.ts's handleHubHtmlClick
    // uses, against a stable hook on the list container, so it keeps
    // working if the rows are restructured. The Retry controls in the
    // non-populated states below stop their own click's propagation so
    // this handler doesn't also fire on top of them — retrying is not
    // "browse", and the offline control must stay fully inert.
    function handleCardClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-realm-preview-list]')) {
        return;
      }
      $OpenRealmStore = true;
    }
</script>
<div class="h-full w-full flex flex-col overflow-y-auto items-center">
    {#if !$OpenRealmStore}
      <Title />
      <h3 class="text-textcolor2 mt-1">{language.homeVersion} {getVersionString()}</h3>
    {/if}
    <div class="w-full flex p-4 flex-col text-textcolor max-w-4xl">
      {#if !$OpenRealmStore}
        <div class="grid w-full grid-cols-1 gap-4 p-2 md:grid-cols-2 lg:grid-cols-3">
          {#each relatedLinks as relatedLink}
            {#if relatedLink.kind === 'disclosure'}
              <!--
                The disclosure entry's root is a <div>, not a <button>: its
                revealed region is a list of <a href> links, and links
                cannot live inside a <button> -- nested interactive content
                is invalid, and the parser would implicitly close an open
                <button> at the next <button> start tag, silently
                fragmenting the DOM. The realm card below already documents
                this exact constraint for the same reason.
              -->
              <SourceDisclosure
                title={relatedLink.title}
                description={relatedLink.description}
                cardClass={relatedCardClass}
                triggerClass={relatedCardTriggerClass}
                iconClass={relatedLinkIconClass}
                destinations={relatedLink.destinations}
                icon={relatedLink.icon}
              />
            {:else}
              <button
                class={`${relatedCardClass} ${relatedCardTriggerClass}`}
                onclick={() => {
                  openURL(relatedLink.href)
                }}
              >
                <div class="relative z-10 w-[68%] sm:w-[70%]">
                    <div class="flex items-center gap-2">
                        <h2 class="text-2xl font-bold tracking-tight text-textcolor break-keep">{relatedLink.title}</h2>
                        {#if relatedLink.upstream}
                            <!--
                              Decorative pill, aria-hidden: this button
                              carries no aria-label (that would replace,
                              not add to, its accessible name -- dropping
                              the description below from what a screen
                              reader announces). The sr-only span after
                              the description instead joins the marker to
                              the name that title and description already
                              build, so the announced order is title,
                              description, marker.
                            -->
                            <span aria-hidden="true" class="rounded-full bg-textcolor2/20 px-2 py-0.5 text-xs text-textcolor/70">
                                {language.homeSourceUpstreamLabel}
                            </span>
                        {/if}
                    </div>
                    <span class="mt-2 block text-base leading-relaxed text-textcolor2">
                      {relatedLink.description}
                    </span>
                    {#if relatedLink.upstream}
                        <span class="sr-only">({language.homeSourceUpstreamLabel})</span>
                    {/if}
                </div>

                <div aria-hidden="true" class="pointer-events-none absolute -right-12 top-1/2 -translate-y-1/2 text-textcolor">
                    {#if relatedLink.logoIcon === "globe"}
                      <GlobeIcon class={relatedLinkIconClass} strokeWidth={1} />
                    {:else if relatedLink.logoIcon === "mail"}
                      <MailIcon class={relatedLinkIconClass} strokeWidth={1} />
                    {:else if relatedLink.logoIcon === "paper-airplane"}
                      <Send class={relatedLinkIconClass} strokeWidth={1} />
                    {/if}
                </div>
              </button>
            {/if}
          {/each}
          {#if utilityVisible($pageStorageModeStore)}
            <!-- Reads the reactive page-mode store, so the card follows the mode after mount: the app mounts before boot decides it. -->
            <button
              class={`${relatedCardClass} ${relatedCardTriggerClass}`}
              data-testid="utility-card"
              onclick={() => {
                $utilityOpen = true
              }}
            >
              <div class="relative z-10 w-[68%] sm:w-[70%]">
                <h2 class="text-2xl font-bold tracking-tight text-textcolor break-keep">{language.homeLinkUtilityTitle}</h2>
                <span class="mt-2 block text-base leading-relaxed text-textcolor2">{language.homeLinkUtilityDescription}</span>
              </div>
              <div aria-hidden="true" class="pointer-events-none absolute -right-12 top-1/2 -translate-y-1/2 text-textcolor">
                <Wrench class={relatedLinkIconClass} strokeWidth={1} />
              </div>
            </button>
          {/if}
          {#if !realmHidden}
            <!--
              Last grid child in DOM order (the fifth, or the sixth while the Utility card shows): on mobile every link card
              stacks above it, so the realm preview never pushes Related
              Links below the fold; on desktop it sits beside and below the
              link cards.

              lg:col-span-1 is load-bearing, not redundant: both the md: and
              lg: breakpoints are live at >=1024px, and md:col-span-2 emits
              the `grid-column` shorthand (sets both start and end) while
              lg:col-start-3 is a longhand that only overrides the start.
              Without an lg: span reset, the end stays `span 2` and the card
              spills into a fabricated fourth column track. Verified by
              compiling this exact class list through the repo's own
              tailwindcss build rather than assumed.

              This div is deliberately not a <button>: realmDirectOpen is a
              persisted setting whose help text promises that clicking a
              character in the preview opens that character, and this file
              is the only reader of it. A single wrapping <button> would
              silently disable that setting (interactive children inside a
              button are invalid) while the setting kept appearing in
              Advanced Settings, so the preview rows and the offline/failed
              Retry controls below stay their own buttons.

              The card itself is still the browse target: a click anywhere
              on it that isn't the scrollable entries list, or one of the
              Retry controls (which
              stop their own click's propagation to keep their own
              meaning), opens RisuRealm — see handleCardClick above — and
              the hover lift, brighter-on-hover background and decorative
              icon mirror the other Related Links cards' treatment so the
              whole card reads as clickable. A click handler on a div is
              mouse-only, so the title below is its own focusable button
              carrying the browse label, keeping a keyboard path into the
              same action.
            -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!--
              The ceiling belongs on the scrollable list, not the card: capping
              the list at a fixed height keeps the card's own intrinsic height
              (padding + header + description + that constant list height)
              the same whether hubStatus is pending or populated, which is
              what actually stops MC-053's layout shift on fetch resolution.
              The card itself carries no unqualified max-height, so it stays
              an ordinary grid item and stretches to fill its grid area
              instead of falling short of it. min-h-0 on the list is still
              required: without it the flex item refuses to shrink below its
              own content and overflow-y-auto never engages.

              lg:min-h-[380px] is not cosmetic. The list's cap grows to
              lg:max-h-[200px] below (see that comment), and the card's
              required height must stay under whatever height is actually
              available at each breakpoint or the fetch-time shift comes
              back — a bigger cap needs a bigger floor to still fit inside.
              At lg the grid area is driven by the neighbouring link cards'
              wrapped descriptions and comfortably clears 380px in current
              measurements; below lg the card is a full-width single-row
              item sitting at the plain 296px floor, so it keeps the smaller
              cap instead of forcing a tall solid block onto tablet widths.
            -->
            <div
              class="group relative flex min-h-[296px] lg:min-h-[380px] cursor-pointer flex-col overflow-hidden rounded-2xl border border-borderc/10 bg-primary-500 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary-300 hover:bg-primary-400 hover:shadow-xl hover:shadow-darkbg/50 md:col-span-2 lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:row-span-2"
              onclick={handleCardClick}
            >
              <div class="relative z-10 mb-2 flex flex-col">
                <button
                  class="w-fit border-0 bg-transparent p-0 text-left text-2xl font-bold tracking-tight text-textcolor hover:underline"
                  aria-label={language.hubBrowseMore}
                  onclick={() => {
                    $OpenRealmStore = true
                  }}
                >{language.hub}</button>
                <span class="mt-1 block text-base leading-relaxed text-textcolor/80">{language.hubDescription}</span>
              </div>
              {#if hubStatus === 'populated'}
                <!--
                  The dark backing panel is a separate wrapper around the
                  scroller, not merged onto it, because the panel's own
                  padding would otherwise eat into the fixed max-h budget
                  below and shrink the visible rows. The panel is sized to
                  its content (no grow), so it hugs the scrollable area
                  itself rather than stretching to fill the rest of the card
                  — the leftover space below it, where the decorative
                  compass icon bleeds, is left as plain card background.
                  Keeping the cap, min-h-0 and overflow-y-auto together on
                  the inner scroller is what holds the card's intrinsic
                  height constant across hubStatus states — the panel is
                  purely a background, not a layout change.
                  data-realm-preview-list stays on the outer panel so
                  handleCardClick's delegated closest() check bails on
                  clicks anywhere in the panel's padding too, not just on
                  the rows themselves.

                  max-h-[150px] lg:max-h-[200px]: a single cap across every
                  width does not work. The cap and the card's lg:min-h-[380px]
                  above move together — the cap must stay small enough that
                  the card's required height (padding + header + description
                  + this cap) never exceeds the height actually available at
                  that breakpoint, or the card grows past its floor and
                  MC-053's fetch-time shift comes straight back. 150 clears
                  the smaller-breakpoint floor of 296; 200 needs the taller
                  380 floor at lg to still clear the available grid area.
                  Raising either number without raising its partner
                  reintroduces the shift — verify both again with real
                  measurements before changing either.
                -->
                <div class="relative z-10 rounded-lg bg-black/30 p-2" data-realm-preview-list>
                  <div class="flex min-h-0 max-h-[150px] lg:max-h-[200px] flex-col gap-1 overflow-y-auto">
                    <!-- Clamped to 10, not the full page of results: every
                         row is its own button in the tab order, and a page
                         of hub results is dozens of cards. The clamp bounds
                         keyboard cost while this scrollable frame still
                         gives browsing value. -->
                    {#each hubCards.slice(0, 10) as chara}
                        <RealmPreviewRow onClick={() => {
                          $OpenRealmStore = true
                          if(DBState.db.realmDirectOpen){
                              $RealmInitialOpenChar = chara
                          }
                        }} chara={chara} />
                    {/each}
                  </div>
                </div>
              {:else}
                <!-- All non-populated messages (the consent placeholder,
                     pending/failed/empty/offline) share one announced
                     region, so a screen reader hears the transition between
                     them, including into and out of offline. -->
                <div role="status" aria-live="polite" class="relative z-10 flex grow flex-col items-center justify-center gap-2 text-center text-textcolor/80">
                  {#if !$upstreamAccepted}
                    <div data-testid="upstream-consent-placeholder" class="flex flex-col items-center gap-2">
                      <span>{language.upstreamConsentPlaceholder}</span>
                      <button
                        data-testid="upstream-consent-accept"
                        class="transition-all duration-300 hover:-translate-y-1"
                        onclick={(event) => {
                          event.stopPropagation();
                          // Only asks; the acceptance effect above is the sole thing that loads
                          // in response to whatever answer this resolves to (MC-086, MC-087 #3,
                          // MC-087 #3a).
                          askUpstreamAgreement();
                        }}
                      >{language.upstreamConsentShow}</button>
                    </div>
                  {:else if hubStatus === 'pending'}
                    <div class="h-8 w-8 rounded-full border-2 border-textcolor border-t-transparent animate-spin"></div>
                    <span>{language.loading}...</span>
                  {:else if hubStatus === 'offline'}
                    <span>{language.hubOffline}</span>
                    <button
                      aria-disabled="true"
                      class="cursor-not-allowed opacity-50"
                      onclick={(event) => { event.stopPropagation(); }}
                    >{language.hubRetry}</button>
                  {:else if hubStatus === 'failed'}
                    <span>{language.hubLoadFailed}</span>
                    <button class="transition-all duration-300 hover:-translate-y-1" onclick={(event) => { event.stopPropagation(); loadHubPreview(); }}>{language.hubRetry}</button>
                  {:else if hubStatus === 'empty'}
                    <span>{language.hubEmpty}</span>
                  {/if}
                </div>
              {/if}
              <div aria-hidden="true" class="pointer-events-none absolute -bottom-10 -right-10 text-textcolor">
                <Compass class={relatedLinkIconClass} strokeWidth={1} />
              </div>
            </div>
          {/if}
      </div>
      {#if hubAnnouncement && !realmHidden}
        <!--
          Gated on realmHidden, not just a non-empty string: this banner is
          realm-server content too, so hideRealm hides the whole realm
          widget, announcement included, rather than leaving server-supplied
          HTML on screen after the user opts out.

          This wrapper and the heading below it are new decoration around
          the sanitized sink, not a change to it: the content is HTML from
          upstream's realm server, rendered unlabelled it could be misread
          as a first-party message, so the heading names the source. The
          container borrows the link cards' shape (rounded-2xl, border,
          bg-darkbg, padding) so it reads as a deliberate element, but
          carries no hover lift and is not itself clickable — only the
          links the sanitizer allows inside it are, through the existing
          delegated handler.
        -->
        <div class="mt-4 rounded-2xl border border-borderc/10 bg-darkbg p-6">
          <h2 class="mb-2 text-base font-bold tracking-tight text-textcolor">{language.hubAnnouncementTitle}</h2>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- A keyboard Enter on a focused anchor dispatches a bubbling click, so this delegated handler already covers keyboard activation; see hubHtml.ts. -->
          <div onclick={handleHubHtmlClick}>
            {@html sanitizeHubHtml(hubAnnouncement)}
          </div>
        </div>
      {/if}

      {:else}
        <div class="flex items-center mt-4">
          <button class="mr-2 text-textcolor2 hover:text-green-500" onclick={() => ($OpenRealmStore = false)}>
            <ArrowLeft/>
          </button>
        </div>
        <Hub />
      {/if}
  </div>
</div>
