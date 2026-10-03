<script lang="ts">
    import { DBState } from 'src/ts/stores.svelte';
    import { updateTextThemeAndCSS } from 'src/ts/gui/colorscheme';
    import ColorInput from 'src/lib/UI/GUI/ColorInput.svelte';
    import { language } from 'src/lang';

    const colors = [
        ['FontColorStandard', 'normalText', false],
        ['FontColorItalic', 'italicText', false],
        ['FontColorBold', 'boldText', false],
        ['FontColorItalicBold', 'italicBoldText', false],
        ['FontColorQuote1', 'singleQuoteText', true],
        ['FontColorQuote2', 'doubleQuoteText', true],
    ] as const;
</script>

{#if DBState.db.textTheme === 'custom'}
    {#each colors as color}
        <div class="flex items-center mt-2">
            <ColorInput
                nullable={color[2]}
                bind:value={DBState.db.customTextTheme[color[0]]}
                oninput={updateTextThemeAndCSS}
            />
            <span class="ml-2">{language.settingsPage[color[1]]}</span>
        </div>
    {/each}
{/if}
