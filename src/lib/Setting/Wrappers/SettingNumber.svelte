<script lang="ts">
    import type { SettingItem, SettingContext } from 'src/ts/setting/types';
    import { UNINITIALIZED, getLabel, getSettingValue, setSettingValue } from 'src/ts/setting/utils';
    import { untrack } from 'svelte';
    import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte';
    import Help from 'src/lib/Others/Help.svelte';
    import { exceedsActualMax, formatTokenCount } from 'src/ts/model/modelData/openrouterData';

    interface Props {
        item: SettingItem;
        ctx: SettingContext;
    }

    let { item, ctx }: Props = $props();

    let localValue: any = $state(untrack(() => getSettingValue(item, ctx)));

    // Only a finite positive figure counts as a known maximum; anything else renders as if the option were absent.
    const actual = $derived.by(() => {
        const figure = item.options?.actualMax?.(ctx);
        return typeof figure === 'number' && Number.isFinite(figure) && figure > 0 ? figure : undefined;
    });

    // Sync: DB → local (one-way read)
    $effect(() => {
        localValue = getSettingValue(item, ctx);
    });

    // Write-back: local → DB (guarded)
    $effect(() => {
        const val = localValue;
        if (val === UNINITIALIZED) return;
        untrack(() => {
            if (val !== getSettingValue(item, ctx)) {
                setSettingValue(item, val, ctx);
            }
        });
    });
</script>

<span class="text-textcolor {item.classes ?? ''}">
    {getLabel(item)}
    {#if item.helpKey}<Help key={item.helpKey as any}/>{/if}
    {#if actual !== undefined && typeof localValue === 'number'}
        <span data-testid="setting-actual-max" class="text-textcolor2 text-xs ml-2">{formatTokenCount(localValue)} / {formatTokenCount(actual)}</span>
    {/if}
</span>
<NumberInput
    marginBottom={true}
    size="sm"
    min={item.options?.min}
    max={item.options?.max}
    bind:value={localValue}
/>
{#if actual !== undefined && item.options?.actualMaxWarning && exceedsActualMax(localValue, actual)}
    <p data-testid="setting-actual-max-warning" class="text-draculared text-sm mb-2">{item.options.actualMaxWarning(formatTokenCount(actual))}</p>
{/if}
