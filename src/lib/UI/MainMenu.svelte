<script lang="ts">
    import { DBState } from 'src/ts/stores.svelte';
    import Hub from "./Realm/RealmMain.svelte";
    import { OpenRealmStore, RealmInitialOpenChar } from "src/ts/stores.svelte";
    import { Compass, Wrench } from "@lucide/svelte";
    import { language } from "src/lang";
    import { createRealmPreview } from "./Realm/realmPreview.svelte";
    import { handleHubHtmlClick, sanitizeHubHtml } from "src/ts/hubHtml";
    import { askUpstreamAgreement, upstreamAccepted } from "src/ts/upstreamAgreement";
    import RealmPreviewRow from "./Realm/RealmPreviewRow.svelte";
    import CommunityList from "./CommunityList.svelte";
    import { pageStorageModeStore } from "src/ts/storage/pageStorageMode";
    import { utilityOpen, utilityVisible } from "../Utility/utilityGate";
    import type { Snippet } from "svelte";
    import { get } from "svelte/store";
    import { backCloseHandler, registerBackHandler } from "src/ts/backHandlers";

    interface Props {
      // Rendered above the side block while the Realm full view is closed.
      header?: Snippet;
    }

    let { header }: Props = $props();

    // Back closes the Realm full view, as its own Back arrow does. Registered once; the thunks read
    // the store at call time, so the effect reads no reactive state and never re-registers.
    $effect(() =>
      registerBackHandler(
        backCloseHandler({
          isOpen: () => get(OpenRealmStore),
          snapshot: () => get(OpenRealmStore),
          close: () => OpenRealmStore.set(false),
        }),
      ),
    );

    const relatedLinkIconClass =
      "h-40 w-40 md:h-44 md:w-44 origin-right -rotate-12 opacity-[0.12] transition-all duration-500 group-hover:scale-105 group-hover:opacity-[0.22]";

    // The preview state lives in realmPreview.svelte.ts; it is created here so its effects belong to this component.
    const preview = createRealmPreview(() => $upstreamAccepted);

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
      {#if header}
        {@render header()}
      {/if}
    {/if}
    <div class="w-full flex p-4 flex-col text-textcolor max-w-4xl">
      {#if !$OpenRealmStore}
        <!--
          One column, in this order: the Utility row, the RisuRealm card, the
          Community and source list (version at its foot), then the
          announcement. Nothing here is placed by a grid, so the announcement
          arriving after the fetch appends below everything and moves no
          other block.
        -->
        <aside data-part="home-side" aria-label={language.homeSideLabel} class="flex flex-col gap-6">
          {#if utilityVisible($pageStorageModeStore)}
            <!-- Reads the reactive page-mode store, so the row follows the mode after mount: the app mounts before boot decides it. -->
            <button
              type="button"
              class="risu-focus-ring flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--home-radius-3)] px-2 py-2 text-left text-textcolor hover:bg-darkbutton"
              data-testid="utility-card"
              onclick={() => {
                $utilityOpen = true
              }}
            >
              <span aria-hidden="true" data-part="home-row-icon" class="shrink-0 text-[color:var(--home-ink-2)]">
                <Wrench class="h-4 w-4" strokeWidth={1.5} />
              </span>
              <span data-part="home-utility-text" class="flex max-w-full flex-1 flex-col [overflow-wrap:break-word]">
                <span class="text-[length:var(--home-text-md)] font-bold">{language.homeLinkUtilityTitle}</span>
                <span class="text-[length:var(--home-text-sm)] text-[color:var(--home-ink-2)]">{language.homeLinkUtilityDescription}</span>
              </span>
            </button>
          {/if}
          {#if !preview.hidden}
            <!--
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
              icon make the whole card read as clickable. A click handler on
              a div is mouse-only, so the title below is its own focusable
              button carrying the browse label, keeping a keyboard path into
              the same action.
            -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!--
              The ceiling belongs on the scrollable list, not the card: capping
              the list at a fixed height keeps the card's own intrinsic height
              (padding + header + description + that constant list height)
              the same whether preview.status is pending or populated, which is
              what actually stops MC-053's layout shift on fetch resolution.
              The card itself carries no unqualified max-height. min-h-0 on
              the list is still required: without it the flex item refuses to
              shrink below its own content and overflow-y-auto never engages.

              lg:min-h-[380px] is not cosmetic. The list's cap grows to
              lg:max-h-[200px] below (see that comment), and the card's
              required height must stay under the floor at each breakpoint or
              the fetch-time shift comes back — a bigger cap needs a bigger
              floor to still fit inside.
            -->
            <div
              class="group relative flex min-h-[296px] lg:min-h-[380px] cursor-pointer flex-col overflow-hidden rounded-2xl border border-borderc/10 border-t-borderc bg-darkbg p-6 transition-all duration-300 hover:-translate-y-1 hover:border-borderc/30 hover:border-t-borderc hover:bg-selected/50 hover:shadow-xl hover:shadow-darkbg/50"
              onclick={handleCardClick}
            >
              <div class="relative z-10 mb-2 flex flex-col">
                <button
                  class="risu-focus-ring min-h-11 w-fit border-0 bg-transparent p-0 text-left text-2xl font-bold tracking-tight text-textcolor hover:underline"
                  aria-label={language.hubBrowseMore}
                  onclick={() => {
                    $OpenRealmStore = true
                  }}
                >{language.hub}</button>
                <span class="mt-1 block text-base leading-relaxed text-textcolor2">{language.hubDescription}</span>
              </div>
              {#if preview.status === 'populated'}
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
                  height constant across preview.status states — the panel is
                  purely a background, not a layout change.
                  data-realm-preview-list stays on the outer panel so
                  handleCardClick's delegated closest() check bails on
                  clicks anywhere in the panel's padding too, not just on
                  the rows themselves.

                  max-h-[150px] lg:max-h-[200px]: a single cap across every
                  width does not work. The cap and the card's lg:min-h-[380px]
                  above move together — the cap must stay small enough that
                  the card's required height (padding + header + description
                  + this cap) never exceeds the card's floor at that
                  breakpoint, or the card grows past its floor and
                  MC-053's fetch-time shift comes straight back. 150 clears
                  the smaller-breakpoint floor of 296; 200 needs the taller
                  380 floor at lg to still clear.
                  Raising either number without raising its partner
                  reintroduces the shift — verify both again with real
                  measurements before changing either.
                -->
                <div class="relative z-10 rounded-lg bg-darkbg/30 p-2" data-realm-preview-list>
                  <div class="flex min-h-0 max-h-[150px] lg:max-h-[200px] flex-col gap-1 overflow-y-auto">
                    <!-- Clamped to 10, not the full page of results: every
                         row is its own button in the tab order, and a page
                         of hub results is dozens of cards. The clamp bounds
                         keyboard cost while this scrollable frame still
                         gives browsing value. -->
                    {#each preview.cards.slice(0, 10) as chara}
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
                <div role="status" aria-live="polite" class="relative z-10 flex grow flex-col items-center justify-center gap-2 text-center text-textcolor2">
                  {#if !$upstreamAccepted}
                    <div data-testid="upstream-consent-placeholder" class="flex flex-col items-center gap-2">
                      <span>{language.upstreamConsentPlaceholder}</span>
                      <button
                        data-testid="upstream-consent-accept"
                        class="risu-focus-ring min-h-11 rounded-md bg-selected px-4 text-textcolor hover:bg-selected/50"
                        onclick={(event) => {
                          event.stopPropagation();
                          // Only asks; the acceptance effect above is the sole thing that loads
                          // in response to whatever answer this resolves to (MC-086, MC-087 #3,
                          // MC-087 #3a).
                          askUpstreamAgreement();
                        }}
                      >{language.upstreamConsentShow}</button>
                    </div>
                  {:else if preview.status === 'pending'}
                    <div class="h-8 w-8 rounded-full border-2 border-textcolor border-t-transparent animate-spin"></div>
                    <span>{language.loading}...</span>
                  {:else if preview.status === 'offline'}
                    <span>{language.hubOffline}</span>
                    <button
                      aria-disabled="true"
                      class="risu-focus-ring min-h-11 cursor-not-allowed rounded-md border border-darkborderc bg-darkbutton px-3 text-textcolor opacity-50"
                      onclick={(event) => { event.stopPropagation(); }}
                    >{language.hubRetry}</button>
                  {:else if preview.status === 'failed'}
                    <span>{language.hubLoadFailed}</span>
                    <button class="risu-focus-ring min-h-11 rounded-md border border-darkborderc bg-darkbutton px-3 text-textcolor hover:bg-selected/50" onclick={(event) => { event.stopPropagation(); preview.load(); }}>{language.hubRetry}</button>
                  {:else if preview.status === 'empty'}
                    <span>{language.hubEmpty}</span>
                  {/if}
                </div>
              {/if}
              <div aria-hidden="true" class="pointer-events-none absolute -bottom-10 -right-10 text-textcolor">
                <Compass class={relatedLinkIconClass} strokeWidth={1} />
              </div>
            </div>
          {/if}
          <CommunityList />
          {#if preview.announcement && !preview.hidden}
            <!--
              Gated on preview.hidden, not just a non-empty string: this banner is
              realm-server content too, so hideRealm hides the whole realm
              widget, announcement included, rather than leaving server-supplied
              HTML on screen after the user opts out.

              This wrapper and the heading below it are new decoration around
              the sanitized sink, not a change to it: the content is HTML from
              upstream's realm server, rendered unlabelled it could be misread
              as a first-party message, so the heading names the source. The
              container carries no hover lift and is not itself clickable — only
              the links the sanitizer allows inside it are, through the existing
              delegated handler. It is the side block's last child, after the
              Community list, so its arrival moves nothing above it.
            -->
            <div class="rounded-2xl border border-borderc/10 bg-darkbg p-6">
              <h2 class="mb-2 text-base font-bold tracking-tight text-textcolor">{language.hubAnnouncementTitle}</h2>
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <!-- A keyboard Enter on a focused anchor dispatches a bubbling click, so this delegated handler already covers keyboard activation; see hubHtml.ts. -->
              <div onclick={handleHubHtmlClick}>
                {@html sanitizeHubHtml(preview.announcement)}
              </div>
            </div>
          {/if}
        </aside>
      {:else}
        <Hub />
      {/if}
  </div>
</div>
