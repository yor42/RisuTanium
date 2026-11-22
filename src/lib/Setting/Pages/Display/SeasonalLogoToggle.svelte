<script lang="ts">
    import { language } from 'src/lang';
    import Check from 'src/lib/UI/GUI/CheckInput.svelte';
    import { seasonalLogoEnabled, setSeasonalLogoEnabled } from 'src/ts/seasonal/seasonalPrefs.svelte';

    // This device's choice (localStorage, never the saved database): the box follows the stored value.
    let shown = $state(false);
    $effect.pre(() => {
        shown = seasonalLogoEnabled();
    });
</script>

<div class="flex items-center mt-2">
    <Check
        bind:check={shown}
        name={language.seasonalLogoSetting}
        onChange={setSeasonalLogoEnabled}
    />
</div>
<p class="text-sm text-textcolor2 mt-1" data-part="settings-seasonal-logo-help">{language.seasonalLogoHelp}</p>
