<script lang="ts">
  import {
    LanguagesIcon,
    RefreshCw,
    CheckIcon,
    XIcon,
  } from "@lucide/svelte";
  import { language } from "src/lang";
  import type { BulkResummaryState } from "./types";
  import { handleDualAction } from "./utils";

  interface Props {
    bulkResummaryState: BulkResummaryState;
    onToggleTranslation: (regenerate: boolean) => void;
    onReroll: () => void;
    onApply: () => void;
    onCancel: () => void;
  }

  let {
    bulkResummaryState,
    onToggleTranslation,
    onReroll,
    onApply,
    onCancel,
  }: Props = $props();

  const uid = $props.id();
</script>

<!-- Bulk Resummarize Result Section -->
{#if bulkResummaryState}
  <div class="sticky bottom-0 p-4 bg-darkbg border-t border-darkborderc rounded-b-lg">
    <div class="flex flex-col gap-3">
      <div class="flex justify-between items-center">
        <h3 id="{uid}-result" class="text-sm font-medium text-textcolor">{language.hypaV3Modal.reSummarizeResult}</h3>
        <div class="flex items-center gap-2">
          <!-- Translate Button -->
          <button
            class="p-2 text-textcolor2 hover:text-textcolor transition-colors {bulkResummaryState.isProcessing || !bulkResummaryState.result
              ? 'opacity-50 cursor-not-allowed'
              : ''}"
            disabled={bulkResummaryState.isProcessing || !bulkResummaryState.result}
            title={language.hypaV3Modal.translate}
            aria-label={language.hypaV3Modal.translate}
            use:handleDualAction={{
              onMainAction: () => onToggleTranslation(false),
              onAlternativeAction: () => onToggleTranslation(true),
            }}
          >
            <LanguagesIcon class="w-4 h-4" aria-hidden="true" />
          </button>

          <!-- Reroll Button -->
          <button
            class="p-2 rounded transition-colors {bulkResummaryState.isProcessing
              ? 'text-textcolor2 opacity-50 cursor-not-allowed'
              : 'text-textcolor hover:text-textcolor2'}"
            onclick={onReroll}
            disabled={bulkResummaryState.isProcessing}
            title={language.hypaV3Modal.retry}
            aria-label={language.hypaV3Modal.retry}
          >
            <RefreshCw class="w-4 h-4" aria-hidden="true" />
          </button>

          <!-- Apply Button -->
          <button
            class="p-2 rounded transition-colors {bulkResummaryState.isProcessing || !bulkResummaryState.result
              ? 'text-textcolor2 opacity-50 cursor-not-allowed'
              : 'text-textcolor hover:text-textcolor2'}"
            onclick={onApply}
            disabled={bulkResummaryState.isProcessing || !bulkResummaryState.result}
            title={language.apply}
            aria-label={language.apply}
          >
            <CheckIcon class="w-4 h-4" aria-hidden="true" />
          </button>

          <!-- Cancel Button -->
          <button
            class="p-2 rounded-sm transition-colors text-textcolor2 hover:text-textcolor"
            onclick={onCancel}
            title={language.cancel}
            aria-label={language.cancel}
          >
            <XIcon class="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <!-- Result Content -->
      {#if bulkResummaryState.isProcessing}
        <div class="text-center py-4 text-textcolor2">
          <RefreshCw class="w-6 h-6 animate-spin inline mr-2" aria-hidden="true" />
          {language.hypaV3Modal.reSummarizing}
        </div>
      {:else if bulkResummaryState.result}
        <textarea
          class="p-3 w-full min-h-32 resize-vertical rounded-sm border border-darkborderc focus:outline-hidden risu-focus-ring transition-colors text-textcolor bg-bgcolor"
          aria-labelledby="{uid}-result"
          aria-describedby="{uid}-result"
          readonly
          value={bulkResummaryState.result}
        ></textarea>

        <!-- Translation Result -->
        {#if bulkResummaryState.translation}
          <div class="mt-3">
            <div id="{uid}-translation" class="mb-2 text-sm text-textcolor2">
              {language.hypaV3Modal.translationLabel}
            </div>
            <textarea
              class="p-3 w-full min-h-32 resize-vertical rounded-sm border border-darkborderc focus:outline-hidden transition-colors text-textcolor bg-bgcolor"
              aria-labelledby="{uid}-translation"
              aria-describedby="{uid}-translation"
              readonly
              value={bulkResummaryState.translation}
            ></textarea>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}