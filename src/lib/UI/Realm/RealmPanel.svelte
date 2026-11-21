<script lang="ts">
    import { DBState, OpenRealmStore, RealmInitialOpenChar } from "src/ts/stores.svelte";
    import { language } from "src/lang";
    import { askUpstreamAgreement, upstreamAccepted } from "src/ts/upstreamAgreement";
    import { UPSTREAM_TAG_CLASS } from "../SourceDisclosure.svelte";
    import RealmPreviewRow from "./RealmPreviewRow.svelte";
    import type { RealmPreview } from "./realmPreview.svelte";

    interface Props {
      // Owned by MainMenu, so opening and closing the Realm full view never refetches.
      preview: RealmPreview;
    }

    let { preview }: Props = $props();

    // A click anywhere on the panel that did not originate inside the preview list opens RisuRealm,
    // using the same delegated `closest` check hubHtml.ts's handleHubHtmlClick uses, against a stable
    // hook on the list container, so it keeps working if the rows are restructured. The Retry and
    // consent controls stop their own click's propagation, so retrying is not "browse" and the
    // offline control stays fully inert.
    function handleCardClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-realm-preview-list]')) {
        return;
      }
      $OpenRealmStore = true;
    }
</script>

<!--
  Deliberately not a <button>: realmDirectOpen is a persisted setting whose help text promises that
  clicking a character in the preview opens that character, and this component is the only reader of
  it. A wrapping <button> would silently disable that setting (interactive children inside a button
  are invalid), so the preview rows and the Retry controls stay their own buttons. The title is its
  own focusable button carrying the browse label, which keeps a keyboard path into the same action.
-->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  data-part="home-realm"
  aria-label={language.hub}
  onclick={handleCardClick}
  class="relative flex min-h-[var(--home-realm-min-height)] cursor-pointer flex-col gap-[var(--home-space-6)] rounded-b-[var(--home-radius-5)] border-t-2 border-t-borderc bg-darkbg p-[var(--home-card-pad-lg)] transition-colors hover:bg-selected/30"
>
  <h3 tabindex="-1" data-jump-target="realm" class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[length:var(--home-text-lg)] font-bold">
    <button
      class="risu-focus-ring min-h-11 w-fit max-w-full border-0 bg-transparent p-0 text-left text-textcolor [overflow-wrap:break-word] hover:underline"
      aria-label={language.hubBrowseMore}
      onclick={() => {
        $OpenRealmStore = true
      }}
    >{language.hub}</button>
    <!-- Outside the button: its aria-label replaces its content in the accessible name, so a marker inside would never be read. -->
    <span aria-hidden="true" data-part="home-upstream-tag" class="{UPSTREAM_TAG_CLASS} shrink-0">{language.homeSourceUpstreamLabel}</span>
    <span class="sr-only">({language.homeSourceUpstreamLabel})</span>
  </h3>
  <p class="text-[length:var(--home-text-sm)] text-[color:var(--home-ink-2)]">{language.hubDescription}</p>
  <!--
    The body has the same fixed height in every state, so the panel's height never depends on the
    fetch state or on how the header wraps (MC-053): the list's cap plus its panel padding is the
    constant, and the status region fills it instead of growing the panel.
  -->
  <div data-part="home-realm-body" class="flex h-[calc(var(--home-realm-list-max)+2*var(--home-space-3))] min-h-0 flex-col">
    {#if preview.status === 'populated'}
      <!--
        The backing panel is a separate wrapper around the scroller so its padding does not eat into
        the cap. data-realm-preview-list stays on the outer panel so handleCardClick bails on clicks
        anywhere in the padding too. The cap and the panel's min-height move together per band
        (registry pair); raising one without the other reintroduces the fetch-time shift.
      -->
      <div class="rounded-[var(--home-radius-4)] bg-bgcolor/55 p-[var(--home-space-3)]" data-realm-preview-list>
        <div class="flex min-h-0 max-h-[var(--home-realm-list-max)] flex-col gap-1 overflow-y-auto">
          <!-- Clamped to 10: every row is its own button in the tab order, and a hub page is dozens of cards. -->
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
      <!-- Every non-populated message shares one announced region, so a screen reader hears the transition between them, including into and out of offline. -->
      <div role="status" aria-live="polite" class="flex h-full flex-col items-center justify-center gap-2 overflow-y-auto text-center text-[color:var(--home-ink-2)]">
        {#if !$upstreamAccepted}
          <div data-testid="upstream-consent-placeholder" class="flex flex-col items-center gap-2">
            <span>{language.upstreamConsentPlaceholder}</span>
            <button
              data-testid="upstream-consent-accept"
              class="risu-focus-ring min-h-11 rounded-md bg-selected px-4 text-textcolor hover:bg-selected/50"
              onclick={(event) => {
                event.stopPropagation();
                // Only asks; the acceptance effect in realmPreview is the sole thing that loads in
                // response to whatever answer this resolves to (MC-086, MC-087).
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
  </div>
</section>
