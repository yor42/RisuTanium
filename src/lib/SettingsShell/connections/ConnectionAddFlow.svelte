<script lang="ts">
    import { onDestroy, tick } from 'svelte'
    import { language } from '../../../lang'
    import { addConnection } from '../../../ts/connections/connectionEditor'
    import { addPrefillName, addableProviders, type ProviderEntry, type ProviderGroup } from '../../../ts/connections/providerCatalog'
    import { DBState } from '../../../ts/stores.svelte'
    import KeyListInput from '../../UI/GUI/KeyListInput.svelte'
    import TextInput from '../../UI/GUI/TextInput.svelte'
    import { providerIconOf } from './ConnectionCard.svelte'

    interface Props {
        /** Called after the connection and its key are stored. */
        onclose: () => void
    }

    let { onclose }: Props = $props()

    const uid = $props.id()
    const GROUP_ORDER: ProviderGroup[] = ['cloud', 'router', 'local', 'compatible']

    let provider = $state<ProviderEntry | null>(null)
    let name = $state('')
    let nameTouched = $state(false)
    let url = $state('')
    let key = $state('')
    let pending = $state(false)
    let error = $state('')
    let nameField = $state<HTMLInputElement>()
    // Back can close this flow while the key write is in flight; the finished add must not then close
    // whatever the page shows by that time.
    let alive = true
    onDestroy(() => { alive = false })

    const offered = $derived(addableProviders(DBState.db))
    const onlyProxy = $derived(offered.every((entry) => entry.provider === 'reverse_proxy'))
    const groups = $derived(GROUP_ORDER
        .map((group) => ({ group, entries: offered.filter((entry) => entry.group === group) }))
        .filter((item) => item.entries.length > 0))
    // A proxy is named after its host, so the prefill follows the URL until the user types a name.
    const prefill = $derived(provider ? addPrefillName(DBState.db, provider.provider, url) : '')
    const shownName = $derived(nameTouched ? name : prefill)
    const canSave = $derived(provider !== null && !pending && shownName.trim() !== ''
        && (key.trim() !== '' || (provider.takesUrl && url.trim() !== '')))

    function groupLabel(group: ProviderGroup): string {
        switch (group) {
            case 'cloud': return language.connectionsGroupCloud
            case 'router': return language.connectionsGroupRouter
            case 'local': return language.connectionsGroupLocal
            case 'compatible': return language.connectionsGroupCompatible
        }
    }

    async function choose(entry: ProviderEntry): Promise<void> {
        provider = entry
        await tick()
        nameField?.focus()
    }

    async function save(): Promise<void> {
        if (!provider || pending || !canSave) return
        pending = true
        error = ''
        try {
            const result = await addConnection(DBState.db, { provider: provider.provider, name: shownName, key, url: provider.takesUrl ? url : undefined })
            if (result.ok === false) {
                if (result.reason === 'name') error = language.connectionsNameEmpty
                else if (result.reason === 'taken') error = language.connectionsAllAdded
                else if (result.reason !== 'blank') error = language.connectionsKeyWriteFailed
                return
            }
            key = ''
            if (alive) onclose()
        } finally {
            pending = false
        }
    }
</script>

<div class="flex flex-col gap-3 min-w-0" data-part="connection-add">
    {#if provider === null}
        <h2 class="font-semibold text-textcolor">{language.connectionsPickProvider}</h2>
        {#if onlyProxy}
            <p class="text-sm text-textcolor2" data-part="connection-all-added">{language.connectionsAllAdded}</p>
        {/if}
        {#each groups as item (item.group)}
            <section class="flex flex-col gap-2" aria-label={groupLabel(item.group)}>
                <h3 class="text-sm text-textcolor2">{groupLabel(item.group)}</h3>
                <ul class="grid gap-2 list-none p-0 m-0">
                    {#each item.entries as entry (entry.provider)}
                        {@const Icon = providerIconOf({ id: '', name: '', provider: entry.provider, key: '' })}
                        <li>
                            <button
                                type="button"
                                class="flex w-full items-center gap-3 min-h-11 px-3 rounded-md border border-darkborderc bg-darkbg text-left text-textcolor risu-focus-ring active:bg-selected"
                                data-connection-provider={entry.provider}
                                onclick={() => { void choose(entry) }}
                            >
                                <Icon class="shrink-0 text-textcolor2" size={20} aria-hidden="true" />
                                <span class="truncate">{entry.label}</span>
                            </button>
                        </li>
                    {/each}
                </ul>
            </section>
        {/each}
    {:else}
        <div class="flex flex-col gap-1">
            <span class="text-sm text-textcolor2">{language.connectionsProvider}</span>
            <span class="font-semibold text-textcolor" data-part="connection-add-provider">{provider.label}</span>
        </div>
        {#if provider.provider === 'vertex'}
            <p class="text-sm text-textcolor2">{language.connectionsVertexNote}</p>
        {/if}
        <div class="flex flex-col gap-1">
            <label class="text-sm text-textcolor2" for="{uid}-name">{language.connectionsName}</label>
            <input
                id="{uid}-name"
                type="text"
                autocomplete="off"
                class="min-h-11 px-3 rounded-md border border-darkborderc bg-transparent text-textcolor risu-focus-ring"
                value={shownName}
                bind:this={nameField}
                oninput={(event) => { nameTouched = true; name = event.currentTarget.value }}
            />
        </div>
        {#if provider.takesUrl}
            <div class="flex flex-col gap-1">
                <label class="text-sm text-textcolor2" for="{uid}-url">{language.connectionsUrl}</label>
                <input
                    id="{uid}-url"
                    type="url"
                    autocomplete="off"
                    spellcheck="false"
                    class="min-h-11 px-3 rounded-md border border-darkborderc bg-transparent text-textcolor risu-focus-ring"
                    bind:value={url}
                />
            </div>
        {/if}
        <div class="flex flex-col gap-1">
            <span class="text-sm text-textcolor2" id="{uid}-key">{language.connectionsKey}</span>
            <div data-part="connection-key-input">
                {#if provider.multilineKey}
                    <TextInput labelId="{uid}-key" size="sm" hideText bind:value={key} />
                {:else}
                    <KeyListInput labelId="{uid}-key" size="sm" hideText bind:value={key} />
                {/if}
            </div>
            <span class="text-xs text-textcolor2">{language.connectionsKeyLocal}</span>
        </div>
        {#if error !== ''}
            <p class="flex items-center gap-1 text-sm text-draculared" role="alert" data-part="connection-error">{error}</p>
        {/if}
        <div class="flex flex-wrap gap-2">
            <button
                type="button"
                class="min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected disabled:opacity-50 risu-focus-ring"
                data-part="connection-save"
                disabled={!canSave}
                onclick={() => { void save() }}
            >{language.uiCommon.save}</button>
        </div>
    {/if}
</div>
