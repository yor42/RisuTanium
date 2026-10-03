<script lang="ts">
    import { CCLicenseData } from "src/ts/licenses";
    import { tooltip } from "src/ts/gui/tooltip";
    import { openURL } from "src/ts/globalApi.svelte";
    import { language } from "src/lang";
    import { fillLang } from "src/lang/fill";

    interface Props {
        license?: string;
    }

    let { license = "" }: Props = $props();
</script>

{#if Object.keys(CCLicenseData).includes(license)}
    <div class="w-full flex flex-row">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div role="button" tabindex="0" class="flex flex-wrap flex-row gap-1 mt-2 items-center cursor-pointer" use:tooltip={fillLang(language.uiCommon.licenseTooltip, { name: CCLicenseData[license][1] })} onclick={((e) => {
            e.stopPropagation();
            openURL(`https://creativecommons.org/licenses/${CCLicenseData[license][0]}/4.0/`)
        })}>
            <img alt={language.uiCommon.creativeCommons} class="cc" src="https://i.creativecommons.org/l/{CCLicenseData[license][0]}/4.0/88x31.png" />
            <span class="text-textcolor2">
                {fillLang(language.uiCommon.licensedWith, { license: CCLicenseData[license][2] })}
            </span>
    
        </div>
    </div>
{/if}


<style>
    .cc{
        width: 88px;
        height: 31px;
        border-width: 0;
    }
</style>