<script lang="ts">
    import type { Snippet } from 'svelte'
    import { language } from '../../lang'
    import type { DimRule } from '../../ts/setting/displayShellSettingsData'
    import { changedFromDefault } from '../../ts/setting/settingDefaults'
    import { settingRegistry } from '../../ts/setting/settingRegistry'
    import type { SettingContext, SettingItem } from '../../ts/setting/types'
    import { checkCondition, getLabel } from '../../ts/setting/utils'
    import { settingsLabel } from '../../ts/settingsShell/settingsPages'
    import { settingsSearchState } from '../../ts/settingsShell/settingsSearchState.svelte'
    import type { Database } from '../../ts/storage/database.svelte'
    import { SettingsMenuIndex } from '../../ts/stores.svelte'

    // Rows a shell component renders itself still carry the marker of the one field they edit.
    const SHELL_ROW_FIELDS: Readonly<Record<string, keyof Database>> = {
        'display.theme': 'theme',
        'display.assetWidth': 'assetWidth',
    }

    interface Props {
        /** The id a search result and the page's reveal find the row by. */
        id: string
        ctx: SettingContext
        /** A setting rendered through the registry; without it the row renders `children`. */
        item?: SettingItem
        /** Decides whether the row shows; defaults to the item's own condition. */
        condition?: (ctx: SettingContext) => boolean
        /** The row stays operable while it has no effect, and says why. */
        dim?: DimRule
        /** Replaces the control, for a setting that does not apply on this layout. */
        note?: string
        ends?: { startKey: string, endKey: string }
        hintKey?: string
        children?: Snippet
    }
    let { id, ctx, item, condition, dim, note, ends, hintKey, children }: Props = $props()

    const shown = $derived(condition ? condition(ctx) : item ? checkCondition(item, ctx) : true)
    const dimmed = $derived(dim ? dim.when(ctx.db) : false)
    // The marker shows only for a row bound to one stored field that has a known default.
    const field = $derived(item?.bindKey ?? SHELL_ROW_FIELDS[id])
    const changed = $derived(field !== undefined && changedFromDefault(field, ctx.db[field]))
    const arrived = $derived(settingsSearchState.highlightedRow === id)
</script>

{#if shown}
    <div class="flex flex-col relative" class:rounded-md={arrived} class:ring-2={arrived} class:ring-selected={arrived} data-setting-row={id} data-dimmed={dimmed ? 'true' : undefined} data-arrived={arrived ? 'true' : undefined} data-changed={changed ? 'true' : undefined}>
        {#if changed}
            <span class="absolute -left-3 top-3 size-2 rounded-full bg-selected border border-borderc" role="img" aria-label={language.settingsShellChangedFromDefault} title={language.settingsShellChangedFromDefault} data-part="setting-row-dot"></span>
        {/if}
        {#if note !== undefined}
            {#if item}<span class="text-textcolor mt-4">{getLabel(item)}</span>{/if}
            <p class="text-sm text-textcolor2 mt-1" data-part="setting-row-note">{note}</p>
        {:else if item}
            {@const Control = settingRegistry[item.type]}
            <div class:opacity-60={dimmed}>
                <Control {item} {ctx} />
            </div>
        {:else}
            <div class:opacity-60={dimmed}>
                {@render children?.()}
            </div>
        {/if}
        {#if ends}
            <div class="flex justify-between text-xs text-textcolor2 -mt-3 mb-2" data-part="setting-row-ends" aria-hidden="true">
                <span>{settingsLabel(ends.startKey)}</span>
                <span>{settingsLabel(ends.endKey)}</span>
            </div>
        {/if}
        {#if hintKey}
            <p class="text-xs text-textcolor2 mb-2" data-part="setting-row-hint">{settingsLabel(hintKey)}</p>
        {/if}
        {#if dimmed && dim}
            <p class="text-sm text-textcolor2 mt-1" data-part="setting-row-reason">{settingsLabel(dim.reasonKeyOf?.() ?? dim.reasonKey)}</p>
            {#if dim.jump}
                {@const jump = dim.jump}
                <button type="button" class="self-start min-h-11 px-1 text-sm text-textcolor2 underline hover:text-textcolor" data-part="setting-row-jump" onclick={() => SettingsMenuIndex.set(jump.index)}>{settingsLabel(jump.labelKey)}</button>
            {/if}
        {/if}
    </div>
{/if}
