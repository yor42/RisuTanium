<script lang="ts">
    import { untrack } from 'svelte'
    import { language } from '../../../lang'
    import { assetWidthFor, assetWidthModeOf, type AssetWidthMode } from '../../../ts/settingsShell/displayPresentation'
    import type { SettingContext } from '../../../ts/setting/types'
    import SliderInput from '../../UI/GUI/SliderInput.svelte'

    interface Props {
        ctx: SettingContext
    }
    let { ctx }: Props = $props()

    const mode = $derived(assetWidthModeOf(ctx.db.assetWidth))
    // The last usable custom width of this visit, so switching away and back restores it.
    let lastCustom = $state<number | undefined>(untrack(() => (assetWidthModeOf(ctx.db.assetWidth) === 'custom' ? ctx.db.assetWidth : undefined)))
    const group = $props.id()

    const choices: readonly { mode: AssetWidthMode, label: () => string }[] = [
        { mode: 'unlimited', label: () => language.settingsShellAssetUnlimited },
        { mode: 'hidden', label: () => language.settingsShellAssetHidden },
        { mode: 'custom', label: () => language.settingsShellAssetCustom },
    ]

    function choose(next: AssetWidthMode): void {
        if (mode === 'custom') lastCustom = ctx.db.assetWidth
        ctx.db.assetWidth = assetWidthFor(next, lastCustom)
    }
</script>

<fieldset class="mt-4 min-w-0 border-0 p-0" data-part="asset-width">
    <legend class="text-textcolor">{language.assetWidth}</legend>
    <div class="mt-2 mb-2 flex w-full overflow-hidden rounded-md border border-darkborderc">
        {#each choices as choice (choice.mode)}
            <label class="relative flex min-h-11 grow items-center justify-center px-3 text-sm cursor-pointer transition-colors {mode === choice.mode ? 'bg-darkbutton text-textcolor' : 'text-textcolor2 hover:text-textcolor'}">
                <input
                    class="sr-only peer"
                    type="radio"
                    name={group}
                    value={choice.mode}
                    checked={mode === choice.mode}
                    onchange={() => choose(choice.mode)}
                />
                <span class="rounded-sm peer-focus-visible:ring-2 peer-focus-visible:ring-textcolor2">{choice.label()}</span>
            </label>
        {/each}
    </div>
    {#if mode === 'custom'}
        <span class="text-textcolor" data-part="asset-width-custom">{language.settingsShellAssetMaxWidth}</span>
        <SliderInput
            marginBottom={true}
            min={1}
            max={40}
            step={1}
            customText={language.settingsShellAssetRem(ctx.db.assetWidth)}
            bind:value={() => ctx.db.assetWidth, (width) => { lastCustom = width; ctx.db.assetWidth = width }}
        />
    {/if}
</fieldset>
