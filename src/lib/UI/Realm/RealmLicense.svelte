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
    <section class="flex min-w-0 flex-col gap-1">
        <h2 class="text-lg font-bold">{language.realmLicenseHeading}</h2>
        <button
            type="button"
            class="risu-focus-ring min-h-11 self-start rounded-md border border-darkborderc px-3 text-start text-textcolor2 wrap-anywhere hover:bg-selected/50"
            use:tooltip={fillLang(language.uiCommon.licenseTooltip, { name: CCLicenseData[license][1] })}
            onclick={((e) => {
                e.stopPropagation();
                openURL(`https://creativecommons.org/licenses/${CCLicenseData[license][0]}/4.0/`)
            })}
        >
            {fillLang(language.uiCommon.licensedWith, { license: CCLicenseData[license][2] })}
        </button>
    </section>
{/if}
