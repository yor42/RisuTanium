<script lang="ts">
  import { afterFlush } from "src/ts/afterFlush";
  import { get } from "svelte/store";
  import { backCloseHandler, registerBackHandler } from "src/ts/backHandlers";
  import {
    SearchIcon,
    StarIcon,
    SettingsIcon,
    MoreVerticalIcon,
    BarChartIcon,
    Trash2Icon,
    XIcon,
    SquarePenIcon,
    TagIcon,
    BookUpIcon,
    BookDownIcon,
  } from "@lucide/svelte";
  import { language } from "src/lang";
  import {
    hypaV3ModalOpen,
    settingsOpen,
    SettingsMenuIndex,
  } from "src/ts/stores.svelte";
  import type { SearchState, BulkEditState, CategoryManagerState, FilterState, UIState } from "./types";

  interface Props {
    searchState: SearchState;
    filterImportant: boolean;
    dropdownOpen: boolean;
    filterSelected: boolean;
    bulkEditState?: BulkEditState;
    categoryManagerState?: CategoryManagerState;
    filterState?: FilterState;
    uiState?: UIState;
    hypaV3Data: any;
    onResetData?: () => Promise<void>;
    onToggleBulkEditMode?: () => void;
    onOpenCategoryManager?: () => void;
    onExportToLorebook?: () => Promise<void>;
    onImportFromLorebook?: () => Promise<void>;
  }

  let {
    searchState = $bindable(),
    filterImportant = $bindable(),
    dropdownOpen = $bindable(),
    filterSelected = $bindable(),
    bulkEditState,
    categoryManagerState,
    filterState,
    uiState,
    hypaV3Data,
    onResetData,
    onToggleBulkEditMode,
    onOpenCategoryManager,
    onExportToLorebook,
    onImportFromLorebook,
  }: Props = $props();


  async function toggleSearch() {
    if (searchState === null) {
      searchState = {
        ref: null,
        query: "",
        results: [],
        currentResultIndex: -1,
        requestedSearchFromIndex: -1,
        isNavigating: false,
      };

      // Focus on search element after it's rendered
      await afterFlush();

      if (searchState.ref) {
        searchState.ref.focus();
      }
    } else {
      searchState = null;
    }
  }

  function toggleFilterImportant() {
    filterImportant = !filterImportant;
  }

  function openGlobalSettings() {
    $hypaV3ModalOpen = false;
    $settingsOpen = true;
    $SettingsMenuIndex = 2; // Other bot settings
  }

  function openDropdown(e: MouseEvent) {
    e.stopPropagation();
    dropdownOpen = true;
  }

  function toggleFilterSelected() {
    filterSelected = !filterSelected;
  }

  async function resetData() {
    if (onResetData) {
      await onResetData();
    }
  }

  function closeModal() {
    $hypaV3ModalOpen = false;
  }

  // Back does what the X does. The category and tag managers register their own handlers only
  // while they are open, so they are newer and answer first. The effect reads no reactive state.
  $effect(() => registerBackHandler(backCloseHandler({
    isOpen: () => get(hypaV3ModalOpen),
    snapshot: () => get(hypaV3ModalOpen),
    close: closeModal,
  })));

  function toggleBulkEditMode() {
    if (onToggleBulkEditMode) {
      onToggleBulkEditMode();
    }
  }

  function openCategoryManager() {
    if (onOpenCategoryManager) {
      onOpenCategoryManager();
    }
  }
</script>

<div class="flex items-center justify-between mb-2 sm:mb-4">
  <!-- Modal Title -->
  <h1 class="text-lg font-semibold sm:text-2xl text-textcolor">
    {language.hypaV3Modal.titleLabel}
  </h1>

  <!-- Buttons Container -->
  <div class="flex items-center gap-2">
    <!-- Open Search Button -->
    <button
      class="p-2 transition-colors text-textcolor2 hover:text-textcolor"
      tabindex="-1"
      aria-label={language.search}
      onclick={async () => await toggleSearch()}
    >
      <SearchIcon class="w-6 h-6" aria-hidden="true" />
    </button>

    <!-- Filter Important Summary Button -->
    <button
      class="p-2 transition-colors {filterState?.showImportantOnly
        ? 'rounded-sm bg-selected text-textcolor ring-1 ring-borderc'
        : 'text-textcolor2 hover:text-textcolor'}"
      tabindex="-1"
      aria-label={language.hypaV3ImportantOnly}
      aria-pressed={!!filterState?.showImportantOnly}
      onclick={toggleFilterImportant}
    >
      <StarIcon class="w-6 h-6" aria-hidden="true" />
    </button>

    <!-- Bulk Edit Mode Button -->
    {#if bulkEditState}
      <button
        class="p-2 transition-colors {bulkEditState.isEnabled
          ? 'rounded-sm bg-selected text-textcolor ring-1 ring-borderc'
          : 'text-textcolor2 hover:text-textcolor'}"
        tabindex="-1"
        aria-label={language.hypaV3BulkEdit}
        aria-pressed={bulkEditState.isEnabled}
        onclick={toggleBulkEditMode}
      >
        <SquarePenIcon class="w-6 h-6" aria-hidden="true" />
      </button>
    {/if}

    <!-- Category Manager Button -->
    {#if categoryManagerState}
      <button
        class="p-2 text-textcolor2 hover:text-textcolor transition-colors"
        tabindex="-1"
        aria-label={language.hypaV3Modal.categoryManager}
        onclick={openCategoryManager}
      >
        <TagIcon class="w-6 h-6" aria-hidden="true" />
      </button>
    {/if}

    <!-- Open Global Settings Button -->
    <button
      class="p-2 transition-colors text-textcolor2 hover:text-textcolor"
      tabindex="-1"
      aria-label={language.settings}
      onclick={openGlobalSettings}
    >
      <SettingsIcon class="w-6 h-6" aria-hidden="true" />
    </button>

    <!-- Open Dropdown Button -->
    <div class="relative">
      <button
        class="p-2 transition-colors text-textcolor2 hover:text-textcolor"
        tabindex="-1"
        aria-label={language.chatShellMoreActions}
        onclick={openDropdown}
      >
        <MoreVerticalIcon class="w-6 h-6" aria-hidden="true" />
      </button>

      {#if dropdownOpen}
        <div
          class="absolute right-0 z-10 p-2 mt-1 border rounded-md shadow-lg border-darkborderc bg-bgcolor"
        >
          <!-- Buttons Container -->
          <div class="flex items-center gap-2">
            <!-- Filter Selected Summary Button -->
            <button
              class="p-2 transition-colors {filterSelected
                ? 'rounded-sm bg-selected text-textcolor ring-1 ring-borderc'
                : 'text-textcolor2 hover:text-textcolor'}"
              tabindex="-1"
              aria-label={language.hypaV3ShowMetrics}
              aria-pressed={filterSelected}
              onclick={toggleFilterSelected}
            >
              <BarChartIcon class="w-6 h-6" aria-hidden="true" />
            </button>

            <!-- Export Summaries To Chat Lorebook Button -->
            {#if onExportToLorebook}
              <button
                class="p-2 transition-colors text-textcolor2 hover:text-textcolor"
                tabindex="-1"
                title={language.hypaV3Modal.exportToLorebookLabel}
                aria-label={language.hypaV3Modal.exportToLorebookLabel}
                onclick={async () => await onExportToLorebook()}
              >
                <BookUpIcon class="w-6 h-6" aria-hidden="true" />
              </button>
            {/if}

            <!-- Import Chat Lorebook Entries As Summaries Button -->
            {#if onImportFromLorebook}
              <button
                class="p-2 transition-colors text-textcolor2 hover:text-textcolor"
                tabindex="-1"
                title={language.hypaV3Modal.importFromLorebookLabel}
                aria-label={language.hypaV3Modal.importFromLorebookLabel}
                onclick={async () => await onImportFromLorebook()}
              >
                <BookDownIcon class="w-6 h-6" aria-hidden="true" />
              </button>
            {/if}

            <!-- Reset Data Button -->
            <button
              class="p-2 transition-colors text-textcolor2 hover:text-draculared"
              tabindex="-1"
              aria-label={language.reset}
              onclick={async () => await resetData()}
            >
              <Trash2Icon class="w-6 h-6" aria-hidden="true" />
            </button>
          </div>
        </div>
      {/if}
    </div>

    <!-- Close Modal Button -->
    <button
      class="p-2 transition-colors text-textcolor2 hover:text-textcolor"
      tabindex="-1"
      aria-label={language.uiCommon.close}
      onclick={closeModal}
    >
      <XIcon class="w-6 h-6" aria-hidden="true" />
    </button>
  </div>
</div>
