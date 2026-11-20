<script lang="ts">
    import type { SettingItem, SettingContext } from 'src/ts/setting/types';
    import { UNINITIALIZED, getLabel, getSettingValue, setSettingValue } from 'src/ts/setting/utils';
    import { untrack } from 'svelte';
    import SliderInput from 'src/lib/UI/GUI/SliderInput.svelte';
    import Help from 'src/lib/Others/Help.svelte';

    interface Props {
        item: SettingItem;
        ctx: SettingContext;
    }

    let { item, ctx }: Props = $props();

    const uid = $props.id();

    let localValue: any = $state(untrack(() => getSettingValue(item, ctx)));

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

    let customText = $derived(
        typeof item.options?.customText === 'function'
            ? item.options.customText(localValue)
            : item.options?.customText
    );
</script>

<span class="text-textcolor {item.classes ?? ''}">
    <span id="{uid}-label">{getLabel(item)}</span>
    {#if item.helpKey}<Help key={item.helpKey as any}/>{/if}
</span>
<SliderInput
    labelId="{uid}-label"
    label={getLabel(item)}
    marginBottom={true}
    min={item.options?.min} 
    max={item.options?.max}
    step={item.options?.step}
    fixed={item.options?.fixed}
    multiple={item.options?.multiple}
    disableable={item.options?.disableable}
    {customText}
    bind:value={localValue}
/>
