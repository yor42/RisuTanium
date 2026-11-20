<script lang="ts">
    import { BotIcon, PackageIcon, Sailboat } from "@lucide/svelte";
    import { language } from "src/lang";
    import { QuickSettings } from "src/ts/stores.svelte";
    import BotSettings from "../Setting/Pages/BotSettings.svelte";
    import OtherBotSettings from "../Setting/Pages/OtherBotSettings.svelte";
    import ModuleSettings from "../Setting/Pages/Module/ModuleSettings.svelte";
</script>

<div class="flex mb-2 gap-2">
    <button class={QuickSettings.index === 0 ? 'rounded-sm bg-selected text-textcolor ring-1 ring-borderc' : 'text-textcolor2'} aria-label={language.chatBot} aria-pressed={QuickSettings.index === 0} onclick={() => {QuickSettings.index = 0}}>
        <BotIcon aria-hidden="true" />
    </button>
    <button class={QuickSettings.index === 1 ? 'rounded-sm bg-selected text-textcolor ring-1 ring-borderc' : 'text-textcolor2'} aria-label={language.otherBots} aria-pressed={QuickSettings.index === 1} onclick={() => {QuickSettings.index = 1}}>
        <Sailboat aria-hidden="true" />
    </button>
    <button class={QuickSettings.index === 2 ? 'rounded-sm bg-selected text-textcolor ring-1 ring-borderc' : 'text-textcolor2'} aria-label={language.modules} aria-pressed={QuickSettings.index === 2} onclick={() => {QuickSettings.index = 2}}>
        <PackageIcon aria-hidden="true" />
    </button>
</div>

<div class="py-6 px-4 flex flex-col text-textcolor overflow-y-auto relative rs-setting-cont-5">
    {#if QuickSettings.index === 0}
        <BotSettings />
    {:else if QuickSettings.index === 1}
        <OtherBotSettings />
    {:else if QuickSettings.index === 2}
        <ModuleSettings />
    {/if}
</div>