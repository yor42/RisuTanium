<script lang="ts">
    import { DBState } from 'src/ts/stores.svelte';
    import {
        changeColorSchemeType,
        exportColorScheme,
        importColorScheme,
        updateCustomColorScheme,
    } from 'src/ts/gui/colorscheme';
    import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte';
    import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte';
    import { DownloadIcon, HardDriveUploadIcon } from '@lucide/svelte';
    import { language } from 'src/lang';
    import { fillLang } from 'src/lang/fill';

    const colors = [
        ['bgcolor', () => language.settingsPage.background],
        ['darkbg', () => language.settingsPage.darkBackground],
        ['borderc', () => fillLang(language.settingsPage.colorNumber, { n: 1 })],
        ['selected', () => fillLang(language.settingsPage.colorNumber, { n: 2 })],
        ['draculared', () => fillLang(language.settingsPage.colorNumber, { n: 3 })],
        ['darkBorderc', () => fillLang(language.settingsPage.colorNumber, { n: 4 })],
        ['darkbutton', () => fillLang(language.settingsPage.colorNumber, { n: 5 })],
        ['textcolor', () => language.textColor],
        ['textcolor2', () => fillLang(language.settingsPage.textColorNumber, { n: 2 })],
    ] as const;
</script>

{#if DBState.db.colorSchemeName === 'custom'}
    <div class="border border-darkborderc p-2 m-2 rounded-md">
        <SelectInput
            className="mt-2"
            value={DBState.db.customColorScheme.type}
            onchange={(e) => {
                changeColorSchemeType((e.target as HTMLInputElement).value as 'light' | 'dark');
            }}
        >
            <OptionInput value="light">{language.settingsPage.light}</OptionInput>
            <OptionInput value="dark">{language.settingsPage.dark}</OptionInput>
        </SelectInput>

        {#each colors as color}
            <div class="flex items-center mt-2">
                <input
                    type="color"
                    class="native-color-input"
                    aria-label={color[1]()}
                    bind:value={DBState.db.customColorScheme[color[0]]}
                    oninput={updateCustomColorScheme}
                />
                <span class="ml-2">{color[1]()}</span>
            </div>
        {/each}

        <div class="grow flex justify-end">
            <button
                class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer"
                onclick={() => exportColorScheme()}
            >
                <DownloadIcon size={18} />
            </button>
            <button
                class="text-textcolor2 hover:text-green-500 cursor-pointer"
                onclick={() => importColorScheme()}
            >
                <HardDriveUploadIcon size={18} />
            </button>
        </div>
    </div>
{/if}

<style>
    .native-color-input {
        width: 1.8rem;
        height: 1.8rem;
        padding: 0;
        border: 0;
        border-radius: 9999px;
        background: transparent;
        cursor: pointer;
        appearance: none;
        -webkit-appearance: none;
    }

    .native-color-input::-webkit-color-swatch-wrapper {
        padding: 0;
    }

    .native-color-input::-webkit-color-swatch {
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: 9999px;
    }

    .native-color-input::-moz-color-swatch {
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: 9999px;
    }
</style>
