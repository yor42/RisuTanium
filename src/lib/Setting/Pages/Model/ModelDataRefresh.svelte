<script lang="ts">
    import { language } from "src/lang";
    import Button from "src/lib/UI/GUI/Button.svelte";
    import { refreshModelDataNow } from "src/ts/model/modelData/modelDataStore";
    import { getModelDataFetchedAt, modelDataStatus } from "src/ts/model/modelData/modelDataService.svelte";

    // The status line reads only reactive state (`modelDataStatus` and the
    // `$state.raw` snapshot behind `getModelDataFetchedAt`), so it follows a
    // refresh that finishes after mount.
    const fetchedAt = $derived(getModelDataFetchedAt())
    const time = $derived(fetchedAt === null ? '' : new Date(fetchedAt).toLocaleString())
    const failed = $derived(modelDataStatus.lastOutcome === 'failed')

    const statusText = $derived(
        failed
            ? (fetchedAt === null ? language.modelDataStatusFailedEmpty : language.modelDataStatusFailed(time))
            : (fetchedAt === null ? language.modelDataStatusNever : language.modelDataStatusUpdated(time))
    )

    // The service never rejects; the catch keeps an unexpected rejection from escaping the handler.
    function refresh() {
        if (modelDataStatus.refreshing) {
            return
        }
        void refreshModelDataNow().catch(() => { })
    }
</script>

<div class="flex flex-col items-start mt-4 mb-2" data-testid="model-data-refresh">
    <Button size="sm" disabled={modelDataStatus.refreshing} onclick={refresh}>
        {modelDataStatus.refreshing ? language.modelDataRefreshing : language.modelDataRefresh}
    </Button>
    <p class="text-textcolor2 text-sm mt-1" data-testid="model-data-status">{statusText}</p>
</div>
