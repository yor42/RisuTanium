<script lang="ts">
    import Hub from "./Realm/RealmMain.svelte";
    import { OpenRealmStore } from "src/ts/stores.svelte";
    import { Wrench } from "@lucide/svelte";
    import { language } from "src/lang";
    import { createRealmPreview } from "./Realm/realmPreview.svelte";
    import { handleHubHtmlClick, sanitizeHubHtml } from "src/ts/hubHtml";
    import { upstreamAccepted } from "src/ts/upstreamAgreement";
    import RealmPanel from "./Realm/RealmPanel.svelte";
    import CommunityList from "./CommunityList.svelte";
    import { pageStorageModeStore } from "src/ts/storage/pageStorageMode";
    import { utilityOpen, utilityVisible } from "../Utility/utilityGate";
    import type { Snippet } from "svelte";
    import { get } from "svelte/store";
    import { backCloseHandler, registerBackHandler } from "src/ts/backHandlers";

    interface Props {
      // Rendered above the columns while the Realm full view is closed.
      header?: Snippet;
      // Rendered in the main column; the side block is the only column content without it.
      stage?: Snippet;
    }

    let { header, stage }: Props = $props();

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

    // The preview state lives in realmPreview.svelte.ts; it is created here so its effects belong to this
    // component and the Realm full view's open/close never refetches.
    const preview = createRealmPreview(() => $upstreamAccepted);

    // Every two-up class is gated on the Realm panel being shown: without it the side block is a single
    // full-width list, and `col-start-2` in a one-track grid would create an implicit second column. Container
    // variants resolve against home-body, the nearest container above the aside. `@max-[1000px]` is exclusive,
    // so the 768 and 1000 ranges are exactly complementary to `@min-[1000px]`.
    const twoUp = $derived(preview.hidden ? "" : "@min-[1000px]:grid-cols-[minmax(0,1fr)_var(--home-side-width)]");
    const sideColumn = $derived(preview.hidden ? "" : "@min-[1000px]:col-start-2");
    const sideTwoUp = $derived(
      preview.hidden ? "" : "@min-[768px]:@max-[1000px]:grid @min-[768px]:@max-[1000px]:grid-cols-2 @min-[768px]:@max-[1000px]:items-start",
    );
</script>
<!--
  Size containment: this scroller must get a definite height from its parent, or the landing collapses. It makes
  the embedded library's `100cqh` cap resolve against the scroller's own height.
-->
<div class="h-full w-full flex flex-col overflow-y-auto items-center [container-type:size]">
  {#if !$OpenRealmStore}
    <div data-part="home-body" class="@container w-full max-w-[var(--home-page-max)] px-[var(--home-main-pad-x)] pt-[var(--home-main-pad-top)] pb-[var(--home-main-pad-bottom)] text-textcolor">
      {#if header}
        <div data-part="home-head" class="flex flex-col items-start">{@render header()}</div>
      {/if}
      <div data-part="home-columns" class="mt-[var(--home-space-11)] grid grid-cols-1 items-start gap-[var(--home-space-15)] {twoUp}">
        {#if stage}
          <div data-part="home-stage" class="flex min-w-0 flex-col gap-[var(--home-space-15)]">{@render stage()}</div>
        {/if}
        <!--
          Order: the Utility row, the RisuRealm panel, the Community and source list (version at its
          foot), then the announcement. The announcement arriving after the fetch appends below
          everything and moves no other block.
        -->
        <aside data-part="home-side" aria-label={language.homeSideLabel} class="flex flex-col gap-[var(--home-space-11)] {sideColumn} {sideTwoUp}">
          {#if utilityVisible($pageStorageModeStore)}
            <!-- Reads the reactive page-mode store, so the row follows the mode after mount: the app mounts before boot decides it. -->
            <button
              type="button"
              class="risu-focus-ring col-span-full flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--home-radius-3)] px-2 py-2 text-left text-textcolor hover:bg-darkbutton"
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
            <RealmPanel {preview} />
          {/if}
          <CommunityList />
          {#if preview.announcement && !preview.hidden}
            <!--
              Gated on preview.hidden, not just a non-empty string: this banner is
              realm-server content too, so hideRealm hides the whole realm
              widget, announcement included, rather than leaving server-supplied
              HTML on screen after the user opts out.

              This wrapper and the heading below it are decoration around the
              sanitized sink, not a change to it: the content is HTML from
              upstream's realm server, rendered unlabelled it could be misread
              as a first-party message, so the heading names the source. The
              container carries no hover lift and is not itself clickable; only
              the links the sanitizer allows inside it are, through the existing
              delegated handler. It is the side block's last child, after the
              Community list, so its arrival moves nothing above it. col-span-full
              makes it a full-width last row while the aside is the two-column grid.
            -->
            <div data-part="home-realm-announcement" class="col-span-full rounded-2xl border border-borderc/10 bg-darkbg p-6">
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
      </div>
    </div>
  {:else}
    <div class="w-full flex p-4 flex-col text-textcolor max-w-4xl"><Hub initialList={preview.getInitialList()} /></div>
  {/if}
</div>
