<script lang="ts">
  import { language } from "src/lang";
  import { fillLang } from "src/lang/fill";
  import type { ChroMemoryTrace } from "src/ts/process/memory/chroMemory/shadow";
  import { FIRST_MESSAGE_ID } from "src/ts/process/memory/chroMemory/records";
  import type { Message } from "src/ts/storage/database.svelte";

  interface Props {
    trace: Readonly<ChroMemoryTrace> | null;
    messages?: readonly Message[];
  }

  let { trace, messages }: Props = $props();

  const EXCERPT_CHARS = 120;

  function outcomeText(t: Readonly<ChroMemoryTrace>): string {
    switch (t.outcome) {
      case "injected": return language.chroMemoryOutcomeInjected;
      case "packed": return language.chroMemoryOutcomePacked;
      case "nothing-packed": return language.chroMemoryOutcomeNothing;
      case "empty-d0": return language.chroMemoryOutcomeEmpty;
      case "no-query": return language.chroMemoryOutcomeNoQuery;
      case "no-room": return language.chroMemoryOutcomeNoRoom;
      case "dropped-at-recheck": return language.chroMemoryOutcomeRecheck;
      case "error": return fillLang(language.chroMemoryOutcomeError, { error: t.error ?? "" });
    }
  }

  // Plain text only: it is rendered as a text node, never as markup.
  function excerptOf(source: { chatId: string; index: number }): string {
    if (source.chatId === FIRST_MESSAGE_ID) return "";
    const m = messages?.[source.index];
    if (!m || m.chatId !== source.chatId) return "";
    const flat = m.data.replace(/\s+/g, " ").trim();
    return flat.length > EXCERPT_CHARS ? flat.slice(0, EXCERPT_CHARS) + "…" : flat;
  }

  const fillPercent = $derived(trace && trace.budgetTokens > 0 ? Math.min(100, (trace.T / trace.budgetTokens) * 100) : 0);
</script>

{#if !trace}
  <p class="text-sm text-textcolor2">{language.chroMemoryNoSend}</p>
{:else}
  <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
    <div class="col-span-2 p-2 border rounded-md bg-bgcolor/50 border-darkborderc">
      <div class="text-xs text-textcolor2">{language.chroMemoryOutcome}</div>
      <div class="text-sm font-semibold wrap-break-word {trace.outcome === 'error' ? 'text-draculared' : 'text-textcolor'}">{outcomeText(trace)}</div>
    </div>
    <div class="p-2 border rounded-md bg-bgcolor/50 border-darkborderc">
      <div class="text-xs text-textcolor2">{language.chroMemoryItems}</div>
      <div class="text-lg font-semibold tabular-nums text-textcolor">{trace.items.length}</div>
    </div>
    <div class="p-2 border rounded-md bg-bgcolor/50 border-darkborderc">
      <div class="text-xs text-textcolor2">{language.chroMemoryTime}</div>
      <div class="text-lg font-semibold tabular-nums text-textcolor">{fillLang(language.chroMemoryMs, { ms: Math.round(trace.ms) })}</div>
    </div>
    <div class="col-span-2 p-2 border rounded-md sm:col-span-4 bg-bgcolor/50 border-darkborderc">
      <div class="text-xs text-textcolor2">{language.chroMemoryTokens}</div>
      <div class="text-lg font-semibold tabular-nums text-textcolor">{fillLang(language.chroMemoryTokensOf, { tokens: trace.T, budget: trace.budgetTokens })}</div>
      <div
        class="mt-1 overflow-hidden rounded-full h-1.5 bg-darkbutton"
        role="meter"
        aria-label={language.chroMemoryTokens}
        aria-valuemin={0}
        aria-valuemax={trace.budgetTokens}
        aria-valuenow={trace.T}
      >
        <div class="h-full bg-selected" style="width: {fillPercent}%"></div>
      </div>
    </div>
  </div>

  <div class="flex flex-col gap-1 text-sm text-textcolor2">
    {#if trace.d0.records > 0}
      <div>{fillLang(language.chroMemorySearched, { records: trace.d0.records, units: trace.d0.units })}</div>
    {/if}
    {#if trace.query && trace.query.terms.length > 0}
      <div><span>{language.chroMemoryTerms}:</span> <span class="text-textcolor">{trace.query.terms.join(", ")}</span></div>
    {/if}
    {#if trace.makeRoom && trace.makeRoom.evictedChats > 0}
      <div>{fillLang(language.chroMemoryMadeRoom, { chats: trace.makeRoom.evictedChats, tokens: trace.makeRoom.evictedTokens })}</div>
    {/if}
    {#if trace.makeRoom && trace.makeRoom.itemsDropped > 0}
      <div>{fillLang(language.chroMemoryItemsDropped, { count: trace.makeRoom.itemsDropped })}</div>
    {/if}
    {#if trace.countCapped}
      <div>{fillLang(language.chroMemoryCountCapped, { count: trace.countCap })}</div>
    {/if}
  </div>

  {#if trace.items.length > 0}
    <ul class="flex flex-col gap-2 text-sm">
      {#each trace.items as item, i (i)}
        {@const excerpt = excerptOf(item.source)}
        <li class="p-2 border rounded-md border-darkborderc">
          <div class="flex flex-wrap items-baseline justify-between gap-x-2">
            <span class="font-semibold text-textcolor">{item.source.chatId === FIRST_MESSAGE_ID ? language.chroMemoryItemFirst : `#${item.source.index}`}</span>
            <span class="tabular-nums text-textcolor2">{fillLang(language.chroMemoryItemMeta, { tokens: item.tokens, rank: item.rank.lexical })}</span>
          </div>
          {#if excerpt}
            <div class="mt-1 text-textcolor2 wrap-break-word">{excerpt}</div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
{/if}
