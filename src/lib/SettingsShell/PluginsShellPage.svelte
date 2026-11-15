<script lang="ts">
    import { onMount } from 'svelte'
    import { CodeXmlIcon, PlusIcon, RefreshCwIcon } from '@lucide/svelte'
    import { language } from '../../lang'
    import { fillLang } from '../../lang/fill'
    import { alertError, alertSelect } from '../../ts/alert'
    import { hotReloadPluginFiles } from '../../ts/plugins/apiV3/developMode'
    import { importPlugin } from '../../ts/plugins/plugins.svelte'
    import {
        pluginUpdateVersion,
        readUpdateRecord,
        runPluginUpdateCheck,
        shouldAutoCheck,
        summarizeUpdateRecord,
        type UpdateRecord,
        type UpdateRecordStorage,
    } from '../../ts/plugins/pluginUpdateCheck'
    import { downloadPluginStarter } from '../../ts/setting/pluginStarterDownload'
    import { DBState } from '../../ts/stores.svelte'
    import PluginRow from './plugins/PluginRow.svelte'

    /**
     * The Plugins page: one list of installed plugins. The page never filters, rewrites or reorders the list;
     * only a row's own actions write it. The last update check is kept on this device only, and a check runs by
     * itself at most once a day, when the page opens, never on render.
     */

    // Reached lazily so a storage that refuses access reads as "no record" inside the seam's guards.
    const storage: UpdateRecordStorage = {
        getItem: (key) => localStorage.getItem(key),
        setItem: (key, value) => localStorage.setItem(key, value),
    }

    let record = $state<UpdateRecord | null>(readUpdateRecord(storage))
    let checking = $state(false)

    const plugins = $derived(DBState.db.plugins ?? [])
    const checkable = $derived(plugins.some((plugin) => !!plugin.updateURL))
    const summary = $derived(summarizeUpdateRecord(record, plugins))

    async function checkNow(): Promise<void> {
        if (checking) return
        checking = true
        try {
            record = await runPluginUpdateCheck(DBState.db.plugins ?? [], {
                fetcher: (url, init) => fetch(url, init),
                now: () => Date.now(),
                storage,
            })
        } finally {
            checking = false
        }
    }

    onMount(() => {
        if (checkable && shouldAutoCheck(record, Date.now())) {
            void checkNow()
        }
    })

    async function codeMenu(): Promise<void> {
        const choice = parseInt(await alertSelect([
            language.alerts.importPluginHotReload,
            language.alerts.downloadPluginTemplate,
            language.cancel,
        ]))
        if (choice === 0) {
            await hotReloadPluginFiles()
        } else if (choice === 1) {
            await downloadPluginStarter({
                fetcher: (url) => fetch(url),
                download: async (fileName, data) => {
                    const { downloadFile } = await import('../../ts/globalApi.svelte')
                    return downloadFile(fileName, data)
                },
                fail: () => alertError(language.pluginsPage.starterFailed),
            })
        }
    }

    const buttonClass = 'flex items-center gap-2 px-3 min-h-11 rounded-md bg-darkbutton text-textcolor hover:text-textcolor'
</script>

<div class="flex flex-col gap-3" data-part="plugins-page">
    <p class="text-draculared text-sm" data-part="plugins-warning">{language.pluginsPage.warning}</p>

    <div class="flex flex-wrap gap-2">
        <button type="button" class={buttonClass} data-part="plugins-add" onclick={() => { void importPlugin() }}>
            <PlusIcon aria-hidden="true" />
            <span>{language.pluginsPage.add}</span>
        </button>
        <button type="button" class={buttonClass} data-part="plugins-dev" onclick={codeMenu}>
            <CodeXmlIcon aria-hidden="true" />
            <span>{language.pluginsPage.devTools}</span>
        </button>
        {#if checkable}
            <button type="button" class={buttonClass} disabled={checking} data-part="plugins-check" onclick={checkNow}>
                <RefreshCwIcon aria-hidden="true" />
                <span>{language.pluginsPage.checkNow}</span>
            </button>
        {/if}
    </div>

    <div class="flex flex-col gap-1 text-sm" role="status" aria-live="polite" data-part="plugins-results">
        {#if checking}
            <span class="text-textcolor2">{language.pluginsPage.checking}</span>
        {:else}
            {#if summary.failed.length > 0}
                <span class="text-draculared" data-part="plugins-result-failed">{fillLang(language.pluginsPage.resultFailed, { count: summary.failed.length, names: summary.failed.join(', ') })}</span>
            {/if}
            {#if summary.updates > 0}
                <span class="text-textcolor" data-part="plugins-result-updates">{fillLang(language.pluginsPage.resultUpdates, { count: summary.updates })}</span>
            {/if}
            {#if summary.allCurrent}
                <span class="text-textcolor2" data-part="plugins-result-current">{language.pluginsPage.resultAllCurrent}</span>
            {/if}
        {/if}
    </div>

    {#if plugins.length === 0}
        <span class="text-textcolor2">{language.noPlugins}</span>
    {/if}
    <div class="flex flex-col gap-2">
        {#each plugins as plugin (plugin)}
            <PluginRow {plugin} updateVersion={pluginUpdateVersion(record, plugin)} />
        {/each}
    </div>
</div>
