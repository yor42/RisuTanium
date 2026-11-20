<script lang="ts">
  import { StarIcon } from "@lucide/svelte";
  import { DBState, selectedCharID } from "src/ts/stores.svelte";
  import type { BulkEditState, Category } from "./types";
  import { language } from "src/lang";
  import { isImeComposing } from "src/ts/ime/compositionGuard";

  interface Props {
    bulkEditState: BulkEditState;
    categories: Category[];
    showImportantOnly: boolean;
    selectedCategoryFilter: string;
    onResummarize: () => void;
    onClearSelection: () => void;
    onUpdateSelectedCategory: (categoryId: string) => void;
    onUpdateBulkSelectInput: (input: string) => void;
    onApplyCategory: () => void;
    onToggleImportant: () => void;
    onParseAndSelectSummaries: () => void;
  }

  let {
    bulkEditState,
    categories,
    showImportantOnly,
    selectedCategoryFilter,
    onResummarize,
    onClearSelection,
    onUpdateSelectedCategory,
    onUpdateBulkSelectInput,
    onApplyCategory,
    onToggleImportant,
    onParseAndSelectSummaries,
  }: Props = $props();

  const uid = $props.id();

  const hypaV3Data = $derived(
    DBState.db.characters[$selectedCharID].chats[
      DBState.db.characters[$selectedCharID].chatPage
    ].hypaV3Data
  );

  function applyCategoryToSelected() {
    onApplyCategory();
  }

  function bulkToggleImportant() {
    onToggleImportant();
  }

  function parseAndSelectSummaries() {
    onParseAndSelectSummaries();
  }

  function clearSelection() {
    onClearSelection();
  }

  function handleCategoryChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    onUpdateSelectedCategory(target.value);
  }

  function handleBulkSelectInputChange(event: Event) {
    const target = event.target as HTMLInputElement;
    onUpdateBulkSelectInput(target.value);
  }

  function handleBulkSelectKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (isImeComposing(e)) return;
      parseAndSelectSummaries();
    }
  }
</script>

<!-- Bulk Edit Action Bar -->
{#if bulkEditState.isEnabled}
  <div class="sticky bottom-0 p-3 bg-bgcolor border-t border-darkborderc rounded-b-lg">
    <div class="flex items-center justify-between">
      <!-- Left Side: Resummarize Button -->
      <div class="flex items-center gap-2">
        <!-- Resummarize Button -->
        <button
          class="px-4 py-2 rounded text-sm font-medium transition-colors {bulkEditState.selectedSummaries.size > 1
            ? 'bg-selected text-textcolor ring-1 ring-borderc hover:ring-2 hover:ring-textcolor2'
            : 'bg-selected text-textcolor2 cursor-not-allowed'}"
          onclick={onResummarize}
          disabled={bulkEditState.selectedSummaries.size < 2}
        >
          {language.hypaV3Modal.reSummarize}
        </button>
      </div>

      <!-- Right Side: Category, Important, Bulk Select, Clear -->
      <div class="flex items-center gap-2">
        <!-- Category Selection -->
        <span id="{uid}-category" class="sr-only">{language.hypaV3Modal.categoryFilter}</span>
        <select
          aria-labelledby="{uid}-category"
          aria-describedby="{uid}-category"
          class="risu-select px-3 py-2 rounded-sm border border-darkborderc bg-darkbg text-textcolor text-sm focus:outline-hidden risu-focus-ring"
          value={bulkEditState.selectedCategory}
          onchange={handleCategoryChange}
        >
          {#each categories as category}
            <option value={category.id}>{category.name}</option>
          {/each}
        </select>

        <!-- Apply Category Button -->
        <button
          class="px-4 py-2 rounded text-sm font-medium transition-colors {bulkEditState.selectedSummaries.size > 0
            ? 'bg-selected text-textcolor ring-1 ring-borderc hover:ring-2 hover:ring-textcolor2'
            : 'bg-selected text-textcolor2 cursor-not-allowed'}"
          onclick={applyCategoryToSelected}
          disabled={bulkEditState.selectedSummaries.size === 0}
        >
          {language.apply}
        </button>

        <!-- Bulk Toggle Important Button -->
        <button
          class="px-3 py-2 rounded-sm border border-darkborderc text-textcolor hover:bg-selected text-sm transition-colors flex items-center gap-2 {bulkEditState.selectedSummaries.size === 0 ? 'opacity-50 cursor-not-allowed' : ''}"
          aria-label={language.hypaV3BulkImportant}
          onclick={bulkToggleImportant}
          disabled={bulkEditState.selectedSummaries.size === 0}
        >
          <StarIcon class="w-4 h-4" aria-hidden="true" />
        </button>

        <!-- Bulk Select by Numbers -->
        <div class="flex gap-2">
          <span id="{uid}-bulk-select" class="sr-only">{language.select}</span>
          <input
            type="text"
            value={bulkEditState.bulkSelectInput}
            oninput={handleBulkSelectInputChange}
            placeholder="1,3,5-8"
            class="w-32 px-3 py-2 text-sm bg-bgcolor border border-darkborderc rounded-sm text-textcolor placeholder:text-textcolor2 focus:border-borderc outline-hidden risu-focus-ring"
            aria-labelledby="{uid}-bulk-select"
            aria-describedby="{uid}-bulk-select"
            onkeydown={handleBulkSelectKeydown}
          />
          <button
            class="px-3 py-2 rounded-sm border border-darkborderc text-textcolor hover:bg-selected text-sm transition-colors"
            onclick={parseAndSelectSummaries}
          >
            {language.select}
          </button>
        </div>

        <!-- Clear Selection Button -->
        <button
          class="px-3 py-2 rounded-sm border border-draculared text-draculared hover:bg-draculared hover:text-bgcolor text-sm transition-colors"
          onclick={clearSelection}
        >
          {language.cancel}
        </button>
      </div>
    </div>
  </div>
{/if}