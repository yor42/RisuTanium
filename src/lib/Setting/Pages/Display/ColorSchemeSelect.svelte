<script lang="ts">
    import { language } from 'src/lang';
    import { DBState } from 'src/ts/stores.svelte';
    import {
        changeColorScheme,
        colorSchemeList,
        colorSchemePresets,
        defaultColorScheme,
        PACK_SCHEME_NAME,
        type ColorScheme,
    } from 'src/ts/gui/colorscheme';
    import { activePackDefaultScheme, adoptActivePackScheme } from 'src/ts/themePack/activePack.svelte';

    // The theme-pack tile is its own scheme entry: the Custom slot is never touched by it (MC-2948).
    const packTileVisible = $derived(DBState.db.colorSchemeName === PACK_SCHEME_NAME || activePackDefaultScheme() !== null);
    const packSelected = $derived(DBState.db.colorSchemeName === PACK_SCHEME_NAME);

    const formatSchemeName = (name: string) => {
        if (name === 'custom') {
            return language.optCustom;
        }

        const names: Readonly<Record<string, string | undefined>> = language.settingsShellSchemeNames;
        const named = names[name];
        if (named) {
            return named;
        }

        return name
            .split('-')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    };

    const paletteStyle = (scheme: ColorScheme) => {
        const { bgcolor, darkbg, borderc, selected } = scheme;

        return `background: conic-gradient(from 45deg, ${bgcolor} 0deg 90deg, ${darkbg} 90deg 180deg, ${borderc} 180deg 270deg, ${selected} 270deg 360deg);`;
    };
</script>

<span class="text-textcolor mt-4">{language.colorScheme}</span>

<div class="mt-2 grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
    {#each colorSchemeList as scheme}
        <button
            type="button"
            class="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border p-3 text-center transition-colors hover:bg-darkbutton focus:outline-hidden risu-focus-ring"
            class:border-borderc={DBState.db.colorSchemeName === scheme}
            class:border-darkborderc={DBState.db.colorSchemeName !== scheme}
            class:bg-darkbutton={DBState.db.colorSchemeName === scheme}
            aria-pressed={DBState.db.colorSchemeName === scheme}
            title={formatSchemeName(scheme)}
            onclick={() => changeColorScheme(scheme)}
        >
            <span
                class="palette-wheel relative h-14 w-14 overflow-hidden rounded-full shadow-sm"
                aria-hidden="true"
            >
                <span class="palette-wheel-fill" style={paletteStyle(colorSchemePresets[scheme])}></span>
            </span>
            <span class="w-full truncate text-sm text-textcolor">{formatSchemeName(scheme)}</span>
        </button>
    {/each}

    {#if packTileVisible}
        <button
            type="button"
            class="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border p-3 text-center transition-colors hover:bg-darkbutton focus:outline-hidden risu-focus-ring"
            class:border-borderc={packSelected}
            class:border-darkborderc={!packSelected}
            class:bg-darkbutton={packSelected}
            aria-pressed={packSelected}
            title={formatSchemeName(PACK_SCHEME_NAME)}
            onclick={adoptActivePackScheme}
        >
            <span
                class="palette-wheel relative h-14 w-14 overflow-hidden rounded-full shadow-sm"
                aria-hidden="true"
            >
                <span class="palette-wheel-fill" style={paletteStyle(activePackDefaultScheme() ?? DBState.db.colorScheme ?? defaultColorScheme)}></span>
            </span>
            <span class="w-full truncate text-sm text-textcolor">{formatSchemeName(PACK_SCHEME_NAME)}</span>
        </button>
    {/if}

    <button
        type="button"
        class="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border p-3 text-center transition-colors hover:bg-darkbutton focus:outline-hidden risu-focus-ring"
        class:border-borderc={DBState.db.colorSchemeName === 'custom'}
        class:border-darkborderc={DBState.db.colorSchemeName !== 'custom'}
        class:bg-darkbutton={DBState.db.colorSchemeName === 'custom'}
        aria-pressed={DBState.db.colorSchemeName === 'custom'}
        title={language.optCustom}
        onclick={() => changeColorScheme('custom')}
    >
        <span
            class="palette-wheel relative h-14 w-14 overflow-hidden rounded-full shadow-sm"
            aria-hidden="true"
        >
            <span class="palette-wheel-fill" style={paletteStyle(DBState.db.customColorScheme ?? defaultColorScheme)}></span>
        </span>
        <span class="w-full truncate text-sm text-textcolor">{language.optCustom}</span>
    </button>
</div>

<style>
    .palette-wheel {
        box-shadow:
            inset 0 0 0 1px rgb(255 255 255 / 0.2),
            0 1px 2px rgb(0 0 0 / 0.15);
        box-shadow:
            inset 0 0 0 1px color-mix(in srgb, var(--risu-theme-textcolor) 20%, transparent),
            0 1px 2px rgb(0 0 0 / 0.15);
    }

    .palette-wheel-fill {
        position: absolute;
        inset: -1px;
        border-radius: inherit;
    }
</style>
