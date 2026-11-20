<script lang="ts">
  import { untrack, onDestroy } from "svelte";
  import { afterFlush } from "src/ts/afterFlush";
  import { v4 } from "uuid";
  import { HYPA_DRAFT_KIND, registerDraft, unregisterDraft } from "src/ts/localDrafts";
  import {
    LanguagesIcon,
    StarIcon,
    RefreshCw,
    Trash2Icon,
    ScissorsLineDashed,
    XIcon,
    CheckIcon,
    TagIcon,
    ChevronUpIcon,
    ChevronDownIcon,
  } from "@lucide/svelte";
  import { language } from "src/lang";
  import { fillLang } from "src/lang/fill";
  import {
    type SerializableHypaV3Data,
    type SerializableSummary,
    summarize,
    getCurrentHypaV3Preset,
  } from "src/ts/process/memory/hypav3";
  import { type OpenAIChat } from "src/ts/process/index.svelte";
  import { type Message } from "src/ts/storage/database.svelte";
  import { translateHTML } from "src/ts/translator/translator";
  import { alertConfirm } from "src/ts/alert";
  import { ensureCurrentModulesOrAlert } from "src/ts/process/moduleEnsure";
  import { hasModuleStubs } from "src/ts/process/moduleRefList";
  import { DBState, selectedCharID } from "src/ts/stores.svelte";
  import type {
    SummaryItemState,
    ExpandedMessageState,
    SearchState,
    Category,
    BulkEditState,
    UIState,
  } from "./types";
  import {
    alertConfirmTwice,
    handleDualAction,
    getFirstMessage,
    processRegexScript,
    getCategoryName,
  } from "./utils";

  interface Props {
    summaryIndex: number;
    hypaV3Data: SerializableHypaV3Data;
    summaryItemStateMap: WeakMap<SerializableSummary, SummaryItemState>;
    expandedMessageState: ExpandedMessageState;
    searchState: SearchState;
    filterSelected: boolean;
    categories: Category[];
    bulkEditState?: BulkEditState;
    uiState?: UIState;
    onToggleSummarySelection?: (index: number) => void;
    onOpenTagManager?: (index: number) => void;
    onToggleCollapse?: (index: number) => void;
    onSummariesRemoved?: () => void;
  }

  let {
    summaryIndex,
    hypaV3Data,
    summaryItemStateMap,
    expandedMessageState = $bindable(),
    searchState = $bindable(),
    filterSelected,
    categories,
    bulkEditState,
    uiState,
    onToggleSummarySelection,
    onOpenTagManager,
    onToggleCollapse,
    onSummariesRemoved,
  }: Props = $props();

  const uid = $props.id();
  const summary = $derived(hypaV3Data.summaries[summaryIndex]);
  const numberLabel = $derived(
    language.hypaV3Modal.summaryNumberLabel.replace("{0}", (summaryIndex + 1).toString())
  );
  const summaryItemState = $state<SummaryItemState>({
    originalRef: null,
    translationRef: null,
    rerolledTranslationRef: null,
    chatMemoRefs: null,
  });

  let isTranslating = $state(false);
  let translation = $state<string | null>(null);
  let isRerolling = $state(false);
  let rerolled = $state<string | null>(null);
  let rerollFailed = $state(false);
  const canApplyRerolled = $derived(!!rerolled && !isRerolling && !rerollFailed);
  let isTranslatingRerolled = $state(false);
  let rerolledTranslation = $state<string | null>(null);

  // Driven from `$effect` tracking `rerolled` itself (not the accept/discard
  // handlers), so every exit path is covered.
  const rerolledDraftKey = v4();
  $effect(() => {
    if (rerolled !== null) {
      registerDraft(rerolledDraftKey, HYPA_DRAFT_KIND);
      return () => unregisterDraft(rerolledDraftKey);
    }
  });
  onDestroy(() => {
    // Backstop alongside the `$effect` cleanup above -- `unregisterDraft` is a
    // safe no-op if the key was already removed.
    unregisterDraft(rerolledDraftKey);
  });

  $effect.pre(() => {
    summaryItemStateMap.set(summary, summaryItemState);
  });

  $effect.pre(() => {
    summary?.chatMemos?.length;

    untrack(() => {
      summaryItemState.chatMemoRefs = new Array(summary.chatMemos.length).fill(
        null
      );

      expandedMessageState = null;
      searchState = null;
    });
  });

  async function toggleTranslate(regenerate: boolean): Promise<void> {
    if (isTranslating) return;

    if (translation) {
      translation = null;
      return;
    }

    isTranslating = true;
    translation = language.loadingEllipsis;

    // Focus on translation element after it's rendered
    await afterFlush();

    if (summaryItemState.translationRef) {
      summaryItemState.translationRef.focus();
      summaryItemState.translationRef.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }

    // Translate
    const result = await translate(summary.text, regenerate);

    translation = result;
    isTranslating = false;
  }

  async function translate(text: string, regenerate: boolean): Promise<string> {
    try {
      return await translateHTML(text, false, "", -1, regenerate);
    } catch (error) {
      return fillLang(language.hypaV3Modal.translationFailed, { error: `${error}` });
    }
  }

  function toggleImportant(): void {
    summary.isImportant = !summary.isImportant;
  }

  function isOrphan(): boolean {
    const char = DBState.db.characters[$selectedCharID];
    const chat = char.chats[DBState.db.characters[$selectedCharID].chatPage];

    for (const chatMemo of summary.chatMemos) {
      if (chatMemo == null) {
        // Check first message exists
        if (!getFirstMessage()) return true;
      } else {
        if (chat.message.findIndex((m) => m.chatId === chatMemo) === -1)
          return true;
      }
    }

    return false;
  }

  async function toggleReroll(): Promise<void> {
    if (isRerolling) return;
    if (isOrphan()) return;
    // A summary with no connected messages (an imported lorebook entry) has nothing to summarize again.
    if (summary.chatMemos.length === 0) return;

    const rerolledBeforeClick = rerolled;
    const rerollFailedBeforeClick = rerollFailed;

    isRerolling = true;
    rerollFailed = false;
    rerolled = language.loadingEllipsis;

    try {
      // The wait precedes every step that reads module data (regex scripts, lorebooks), not just summarize.
      // A failed wait has already alerted. The restore applies only while the placeholder is still showing, so a
      // Cancel or an edit made during the wait is kept; isRerolling is cleared by the finally below.
      if (hasModuleStubs() && !(await ensureCurrentModulesOrAlert())) {
        if (rerolled === language.loadingEllipsis) {
          rerolled = rerolledBeforeClick;
          rerollFailed = rerollFailedBeforeClick;
        }
        return;
      }

      const toSummarize: OpenAIChat[] = await Promise.all(
        summary.chatMemos.map(async (chatMemo) => {
          const message = await getMessageFromChatMemo(chatMemo);

          return {
            role: (message.role === "char"
              ? "assistant"
              : message.role) as OpenAIChat["role"],
            content: message.data,
          };
        })
      );

      const summarizeResult = await summarize(toSummarize);

      rerolled = summarizeResult;
    } catch (error) {
      rerollFailed = true;
      rerolled = language.hypaV3Modal.rerollFailed;
    } finally {
      isRerolling = false;
    }
  }

  async function getMessageFromChatMemo(
    chatMemo: string | null
  ): Promise<Message | null> {
    const char = DBState.db.characters[$selectedCharID];
    const chat = char.chats[DBState.db.characters[$selectedCharID].chatPage];
    const shouldProcess = getCurrentHypaV3Preset().settings.processRegexScript;

    let msg = null;
    let msgIndex = -1;

    if (chatMemo == null) {
      const firstMessage = getFirstMessage();

      if (!firstMessage) return null;
      msg = { role: "char", data: firstMessage };
    } else {
      msgIndex = chat.message.findIndex((m) => m.chatId === chatMemo);
      if (msgIndex === -1) return null;
      msg = chat.message[msgIndex];
    }

    return shouldProcess ? await processRegexScript(msg, msgIndex) : msg;
  }

  async function deleteThis(): Promise<void> {
    const target = summary;

    if (await alertConfirm(language.hypaV3Modal.deleteThisConfirmMessage)) {
      if (hypaV3Data.summaries.indexOf(target) === -1) return;

      hypaV3Data.summaries = hypaV3Data.summaries.filter((s) => s !== target);
      onSummariesRemoved?.();
    }
  }

  async function deleteAfter(): Promise<void> {
    const target = summary;

    if (
      await alertConfirmTwice(
        language.hypaV3Modal.deleteAfterConfirmMessage,
        language.hypaV3Modal.deleteAfterConfirmSecondMessage
      )
    ) {
      const targetIndex = hypaV3Data.summaries.indexOf(target);

      if (targetIndex === -1) return;

      hypaV3Data.summaries.splice(targetIndex + 1);
      onSummariesRemoved?.();
    }
  }

  async function toggleTranslateRerolled(regenerate: boolean): Promise<void> {
    if (isTranslatingRerolled) return;

    if (rerolledTranslation) {
      rerolledTranslation = null;
      return;
    }

    if (!rerolled) return;

    isTranslatingRerolled = true;
    rerolledTranslation = language.loadingEllipsis;

    // Focus on rerolled translation element after it's rendered
    await afterFlush();

    if (summaryItemState.rerolledTranslationRef) {
      summaryItemState.rerolledTranslationRef.focus();
      summaryItemState.rerolledTranslationRef.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }

    // Translate
    const result = await translate(rerolled, regenerate);

    rerolledTranslation = result;
    isTranslatingRerolled = false;
  }

  function cancelRerolled(): void {
    rerolled = null;
    rerolledTranslation = null;
  }

  function applyRerolled(): void {
    if (!canApplyRerolled || rerolled === null) return;

    summary.text = rerolled;
    translation = null;
    rerolled = null;
    rerolledTranslation = null;
  }

  async function toggleTranslateExpandedMessage(
    regenerate: boolean
  ): Promise<void> {
    if (!expandedMessageState || expandedMessageState.isTranslating) return;

    if (expandedMessageState.translation) {
      expandedMessageState.translation = null;
      return;
    }

    const message = await getMessageFromChatMemo(
      expandedMessageState.selectedChatMemo
    );

    if (!message) return;

    expandedMessageState.isTranslating = true;
    expandedMessageState.translation = language.loadingEllipsis;

    // Focus on translation element after it's rendered
    await afterFlush();

    if (expandedMessageState.translationRef) {
      expandedMessageState.translationRef.focus();
      expandedMessageState.translationRef.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }

    // Translate
    const result = await translate(message.data, regenerate);

    expandedMessageState.translation = result;
    expandedMessageState.isTranslating = false;
  }

  function isMessageExpanded(chatMemo: string | null): boolean {
    if (!expandedMessageState) return false;

    return (
      expandedMessageState.summaryIndex === summaryIndex &&
      expandedMessageState.selectedChatMemo === chatMemo
    );
  }

  function toggleExpandMessage(chatMemo: string | null): void {
    expandedMessageState = isMessageExpanded(chatMemo)
      ? null
      : {
          summaryIndex,
          selectedChatMemo: chatMemo,
          isTranslating: false,
          translation: null,
          translationRef: null,
        };
  }

  function toggleSummaryCollapse(): void {
    if (onToggleCollapse) {
      onToggleCollapse(summaryIndex);
    }
  }

  function isCollapsed(): boolean {
    return uiState?.collapsedSummaries?.has(summaryIndex) ?? false;
  }

  function isSelected(): boolean {
    return bulkEditState?.selectedSummaries?.has(summaryIndex) ?? false;
  }
</script>

<div
  class="flex flex-col p-2 border rounded-lg sm:p-4 border-darkborderc bg-bgcolor/50 {isSelected() ? 'ring-2 ring-borderc' : ''}"
>
  <!-- Original Summary Header -->
  <div class="flex items-center justify-between">
    <!-- Summary Number / Metrics Container -->
    <div class="flex items-center gap-2">
      <!-- Bulk Edit Checkbox -->
      {#if bulkEditState?.isEnabled}
        <input
          type="checkbox"
          class="w-4 h-4 accent-borderc bg-darkbg border-darkborderc rounded-sm risu-focus-ring"
          aria-label={numberLabel}
          checked={isSelected()}
          onchange={() => onToggleSummarySelection?.(summaryIndex)}
        />
      {/if}

      <span id="{uid}-number" class="text-sm text-textcolor2">{numberLabel}</span>

      <!-- Category Tag -->
      <span class="px-2 py-1 text-xs rounded-full bg-darkbutton text-textcolor">
        <TagIcon class="w-3 h-3 inline mr-1" aria-hidden="true" />
        {getCategoryName(summary.categoryId, categories)}
      </span>

      <!-- Individual Tags -->
      {#if summary.tags && summary.tags.length > 0}
        {#each summary.tags as tag}
          <button
            class="px-2 py-1 text-xs rounded-full bg-selected text-textcolor ring-1 ring-borderc hover:ring-2 hover:ring-textcolor2 transition-colors"
            onclick={() => onOpenTagManager?.(summaryIndex)}
          >
            #{tag}
          </button>
        {/each}
      {/if}

      <!-- Add Tag Button -->
      <button
        class="px-2 py-1 text-xs rounded-full bg-selected hover:bg-borderc text-textcolor transition-colors"
        onclick={() => onOpenTagManager?.(summaryIndex)}
        title={language.hypaV3Modal.tagManager}
      >
        + {language.hypaV3Modal.tag}
      </button>

      {#if filterSelected && hypaV3Data.metrics}
        <div class="flex flex-wrap gap-1">
          {#if hypaV3Data.metrics.lastImportantSummaries.includes(summaryIndex)}
            <span
              class="px-1.5 py-0.5 rounded-full text-xs whitespace-nowrap text-purple-200 bg-purple-900/70"
            >
              {language.hypaV3Modal.importantBadge}
            </span>
          {/if}
          {#if hypaV3Data.metrics.lastRecentSummaries.includes(summaryIndex)}
            <span
              class="px-1.5 py-0.5 rounded-full text-xs whitespace-nowrap text-blue-200 bg-blue-900/70"
            >
              {language.recent}
            </span>
          {/if}
          {#if hypaV3Data.metrics.lastSimilarSummaries.includes(summaryIndex)}
            <span
              class="px-1.5 py-0.5 rounded-full text-xs whitespace-nowrap text-green-200 bg-green-900/70"
            >
              {language.hypaV3Modal.similarBadge}
            </span>
          {/if}
          {#if hypaV3Data.metrics.lastRandomSummaries.includes(summaryIndex)}
            <span
              class="px-1.5 py-0.5 rounded-full text-xs whitespace-nowrap text-yellow-200 bg-yellow-900/70"
            >
              {language.random}
            </span>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Buttons Container -->
    <div class="flex items-center gap-2">
      <!-- Translate Button -->
      <button
        class="p-2 transition-colors text-textcolor2 hover:text-textcolor"
        tabindex="-1"
        aria-label={language.translate}
        use:handleDualAction={{
          onMainAction: () => toggleTranslate(false),
          onAlternativeAction: () => toggleTranslate(true),
        }}
      >
        <LanguagesIcon class="w-4 h-4" aria-hidden="true" />
      </button>

      <!-- Important Button -->
      <button
        class="p-2 transition-colors {summary.isImportant
          ? 'rounded-sm bg-selected text-textcolor ring-1 ring-borderc'
          : 'text-textcolor2 hover:text-textcolor'}"
        tabindex="-1"
        aria-label={language.hypaV3Modal.importantBadge}
        aria-pressed={!!summary.isImportant}
        onclick={toggleImportant}
      >
        <StarIcon class="w-4 h-4" aria-hidden="true" />
      </button>

      <!-- Reroll Button -->
      <button
        class="p-2 transition-colors text-textcolor2 hover:text-textcolor"
        tabindex="-1"
        aria-label={language.reroll}
        disabled={isOrphan()}
        onclick={async () => await toggleReroll()}
      >
        <RefreshCw class="w-4 h-4" aria-hidden="true" />
      </button>

      <!-- Delete This Button -->
      <button
        class="p-2 transition-colors text-textcolor2 hover:text-draculared"
        tabindex="-1"
        aria-label={language.uiCommon.delete}
        onclick={async () => await deleteThis()}
      >
        <Trash2Icon class="w-4 h-4" aria-hidden="true" />
      </button>

      <!-- Delete After Button -->
      <button
        class="p-2 transition-colors text-textcolor2 hover:text-draculared"
        tabindex="-1"
        aria-label={language.hypaV3DeleteAfter}
        onclick={async () => await deleteAfter()}
      >
        <ScissorsLineDashed class="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  </div>

  <!-- Original Summary -->
  <div class="mt-2 sm:mt-4">
    <textarea
      class="w-full p-2 transition-colors border rounded-sm sm:p-4 min-h-40 sm:min-h-56 resize-vertical border-darkborderc focus:outline-hidden risu-focus-ring text-textcolor bg-darkbg"
      aria-labelledby="{uid}-number"
      aria-describedby="{uid}-number"
      bind:this={summaryItemState.originalRef}
      bind:value={summary.text}
      onfocus={() => {
        if (searchState && !searchState.isNavigating) {
          searchState.requestedSearchFromIndex = summaryIndex;
        }
      }}
    >
    </textarea>
  </div>

  <!-- Original Summary Translation -->
  {#if translation}
    <div class="mt-2 sm:mt-4">
      <div id="{uid}-translation" class="mb-2 text-sm sm:mb-4 text-textcolor2">
        {language.hypaV3Modal.translationLabel}
      </div>

      <textarea
        class="w-full p-2 transition-colors border rounded-sm sm:p-4 min-h-40 sm:min-h-56 resize-vertical border-darkborderc focus:outline-hidden text-textcolor bg-darkbg"
        aria-labelledby="{uid}-translation"
        aria-describedby="{uid}-translation"
        readonly
        tabindex="-1"
        bind:this={summaryItemState.translationRef}
        value={translation}
      ></textarea>
    </div>
  {/if}

  {#if rerolled}
    <!-- Rerolled Summary Header -->
    <div class="mt-2 sm:mt-4">
      <div class="flex items-center justify-between">
        <span id="{uid}-rerolled" class="text-sm text-textcolor2"
          >{language.hypaV3Modal.rerolledSummaryLabel}</span
        >
        <div class="flex items-center gap-2">
          <!-- Translate Rerolled Button -->
          <button
            class="p-2 transition-colors text-textcolor2 hover:text-textcolor"
            tabindex="-1"
            aria-label={language.translate}
            use:handleDualAction={{
              onMainAction: () => toggleTranslateRerolled(false),
              onAlternativeAction: () => toggleTranslateRerolled(true),
            }}
          >
            <LanguagesIcon class="w-4 h-4" aria-hidden="true" />
          </button>

          <!-- Cancel Button -->
          <button
            class="p-2 transition-colors text-textcolor2 hover:text-textcolor"
            tabindex="-1"
            aria-label={language.cancel}
            onclick={cancelRerolled}
          >
            <XIcon class="w-4 h-4" aria-hidden="true" />
          </button>

          <!-- Apply Button -->
          <button
            class="p-2 transition-colors text-textcolor2 hover:text-draculared disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-textcolor2"
            tabindex="-1"
            aria-label={language.apply}
            disabled={!canApplyRerolled}
            onclick={applyRerolled}
          >
            <CheckIcon class="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <!-- Rerolled Summary -->
    <div class="mt-2 sm:mt-4">
      <textarea
        class="w-full p-2 transition-colors border rounded-sm sm:p-4 min-h-40 sm:min-h-56 resize-vertical border-darkborderc focus:outline-hidden risu-focus-ring text-textcolor bg-darkbg"
        aria-labelledby="{uid}-rerolled"
        aria-describedby="{uid}-rerolled"
        tabindex="-1"
        bind:value={rerolled}
        oninput={() => {
          if (!isRerolling) rerollFailed = false;
        }}
      >
      </textarea>
    </div>

    <!-- Rerolled Summary Translation -->
    {#if rerolledTranslation}
      <div class="mt-2 sm:mt-4">
        <div id="{uid}-rerolled-translation" class="mb-2 text-sm sm:mb-4 text-textcolor2">
          {language.hypaV3Modal.rerolledTranslationLabel}
        </div>

        <textarea
          class="w-full p-2 transition-colors border rounded-sm sm:p-4 min-h-40 sm:min-h-56 resize-vertical border-darkborderc focus:outline-hidden text-textcolor bg-darkbg"
          aria-labelledby="{uid}-rerolled-translation"
          aria-describedby="{uid}-rerolled-translation"
          readonly
          tabindex="-1"
          bind:this={summaryItemState.rerolledTranslationRef}
          value={rerolledTranslation}
        ></textarea>
      </div>
    {/if}
  {/if}

  <!-- Connected Messages Header -->
  <div class="mt-2 sm:mt-4">
    <div class="flex items-center justify-between">
      <button
        class="flex items-center gap-2 text-sm text-textcolor2 hover:text-textcolor transition-colors"
        tabindex="-1"
        onclick={toggleSummaryCollapse}
      >
        {#if isCollapsed()}
          <ChevronDownIcon class="w-4 h-4" aria-hidden="true" />
        {:else}
          <ChevronUpIcon class="w-4 h-4" aria-hidden="true" />
        {/if}
        <span>{language.hypaV3Modal.connectedMessageCountLabel.replace(
          "{0}",
          summary.chatMemos.length.toString()
        )}</span>
      </button>

      <div class="flex items-center gap-2">
        <!-- Translate Message Button -->
        <button
          class="p-2 transition-colors text-textcolor2 hover:text-textcolor"
          tabindex="-1"
          aria-label={language.translate}
          use:handleDualAction={{
            onMainAction: () => toggleTranslateExpandedMessage(false),
            onAlternativeAction: () => toggleTranslateExpandedMessage(true),
          }}
        >
          <LanguagesIcon class="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>

  {#if !isCollapsed()}
    <!-- Connected Message IDs -->
    <div class="flex flex-wrap gap-2 mt-2 sm:mt-4">
      {#key summary.chatMemos.length}
        {#each summary.chatMemos as chatMemo, memoIndex (chatMemo)}
          <button
            class="px-3 py-2 rounded-full text-xs text-textcolor hover:bg-selected transition-colors bg-darkbg {isMessageExpanded(
              chatMemo
            )
              ? 'ring-2 ring-borderc'
              : ''}"
            tabindex="-1"
            bind:this={summaryItemState.chatMemoRefs[memoIndex]}
            onclick={() => toggleExpandMessage(chatMemo)}
          >
            {chatMemo == null
              ? language.hypaV3Modal.connectedFirstMessageLabel
              : chatMemo}
          </button>
        {/each}
      {/key}
    </div>

    {#if expandedMessageState?.summaryIndex === summaryIndex}
      <!-- Expanded Message -->
      <div class="mt-2 sm:mt-4">
        {#await getMessageFromChatMemo(expandedMessageState.selectedChatMemo) then expandedMessage}
          {#if expandedMessage}
            <!-- Role -->
            <div id="{uid}-message-role" class="mb-2 text-sm sm:mb-4 text-textcolor2">
              {language.hypaV3Modal.connectedMessageRoleLabel.replace(
                "{0}",
                expandedMessage.role
              )}
            </div>

            <!-- Content -->
            <textarea
              class="w-full p-2 transition-colors border rounded-sm sm:p-4 min-h-40 sm:min-h-56 resize-vertical border-darkborderc focus:outline-hidden text-textcolor bg-darkbg"
              aria-labelledby="{uid}-message-role"
              aria-describedby="{uid}-message-role"
              readonly
              tabindex="-1"
              value={expandedMessage.data}
            ></textarea>
          {:else}
            <span class="text-sm text-draculared"
              >{language.hypaV3Modal.connectedMessageNotFoundLabel}</span
            >
          {/if}
        {:catch error}
          <span class="text-sm text-draculared"
            >{language.hypaV3Modal.connectedMessageLoadingError.replace(
              "{0}",
              error.message
            )}</span
          >
        {/await}
      </div>

      <!-- Expanded Message Translation -->
      {#if expandedMessageState.translation}
        <div class="mt-2 sm:mt-4">
          <div id="{uid}-message-translation" class="mb-2 text-sm sm:mb-4 text-textcolor2">
            {language.hypaV3Modal.connectedMessageTranslationLabel}
          </div>

          <textarea
            class="w-full p-2 transition-colors border rounded-sm sm:p-4 min-h-40 sm:min-h-56 resize-vertical border-darkborderc focus:outline-hidden text-textcolor bg-darkbg"
            aria-labelledby="{uid}-message-translation"
            aria-describedby="{uid}-message-translation"
            readonly
            tabindex="-1"
            bind:this={expandedMessageState.translationRef}
            value={expandedMessageState.translation}
          ></textarea>
        </div>
      {/if}
    {/if}
  {/if}

</div>
