<script lang="ts">
    import { language } from "src/lang";
    import { LOCK_GROUPS } from "src/ts/storage/presetLocks";
    import PresetLockSwitch from "./PresetLockSwitch.svelte";
</script>

<div data-part="settings-preset-locks-panel" class="mb-4 flex flex-col gap-1 rounded-md border border-darkborderc p-3">
    <span class="font-bold text-textcolor">{language.presetLockTitle}</span>
    <p class="text-sm text-textcolor2">{language.presetLockHelp}</p>
    {#each LOCK_GROUPS as group (group.id)}
        <PresetLockSwitch id={group.id} />
    {/each}
</div>
