<script lang="ts">
    import { language } from "src/lang";
    import Button from "src/lib/UI/GUI/Button.svelte";
    import { refreshAllNow } from "src/ts/model/modelData/modelDataStore";
    import { getLiteLLMFetchedAt, getModelDataFetchedAt, modelDataStatus } from "src/ts/model/modelData/modelDataService.svelte";
    import { refreshProviderLists } from "src/ts/model/modellist";
    import { DBState } from "src/ts/stores.svelte";

    // The status line reads only reactive state (`modelDataStatus` and the
    // `$state.raw` snapshots behind the two fetched-at getters), so it follows a
    // refresh that finishes after mount. "Updated" names the newest source time;
    // a failed attempt names the oldest, the point up to which every source is
    // known to be current. A partial attempt names no time: the failed part may be
    // a provider list, so no source time says when everything was last current.
    const times = $derived([getModelDataFetchedAt(), getLiteLLMFetchedAt()].filter((t): t is number => t !== null))
    const newest = $derived(times.length === 0 ? null : new Date(Math.max(...times)).toLocaleString())
    const oldest = $derived(times.length === 0 ? null : new Date(Math.min(...times)).toLocaleString())

    const statusText = $derived.by(() => {
        const outcome = modelDataStatus.lastOutcome
        if (outcome === 'partial') {
            return language.modelDataStatusPartial
        }
        if (outcome === 'failed') {
            return oldest === null ? language.modelDataStatusFailedEmpty : language.modelDataStatusFailed(oldest)
        }
        return newest === null ? language.modelDataStatusNever : language.modelDataStatusUpdated(newest)
    })

    // The service never rejects; the catch keeps an unexpected rejection from escaping the handler.
    // The registry option is read through the callback so the pass sees its current value.
    function refresh() {
        if (modelDataStatus.refreshing) {
            return
        }
        void refreshAllNow(refreshProviderLists, () => !!DBState.db.dynamicModelRegistry).catch(() => { })
    }
</script>

<div class="flex flex-col items-start mt-4 mb-2" data-testid="model-data-refresh">
    <Button size="sm" disabled={modelDataStatus.refreshing} onclick={refresh}>
        {modelDataStatus.refreshing ? language.modelDataRefreshing : language.modelDataRefresh}
    </Button>
    <p class="text-textcolor2 text-sm mt-1" data-testid="model-data-status">{statusText}</p>
</div>
