<script lang="ts">
    import { language } from 'src/lang'
    import {
        getUtilityWorkspace,
        isUtilityWorkspaceLocked,
        setUtilityWorkspace,
    } from 'src/ts/process/utility/utilityConversation.svelte'
    import { listWorkspaces } from 'src/ts/process/utility/workspace/workspaceModel.svelte'
    import SelectInput from '../UI/GUI/SelectInput.svelte'

    // The choice is read and written only through the conversation's accessor pair, so this component never knows where
    // the conversation keeps it. Once the conversation has turns or a run is live the accessor refuses a change; the
    // picker then shows the fixed choice instead of an input that cannot take effect.
    const workspaces = $derived(listWorkspaces())
    const bound = $derived(getUtilityWorkspace())
    const locked = $derived(isUtilityWorkspaceLocked())
    const boundName = $derived(workspaces.find((workspace) => workspace.id === bound)?.name)
    const gone = $derived(bound !== null && boundName === undefined)

    function pick(value: string | number) {
        setUtilityWorkspace(value === '' ? null : String(value))
    }
</script>

<div class="flex flex-wrap items-center gap-2" data-testid="workspace-picker">
    <span id="utility-workspace-label" class="text-textcolor2">{language.utility.workspaces.pickerLabel}</span>
    {#if locked}
        <span class="min-h-11 min-w-0 max-w-full content-center break-words rounded-md border border-darkborderc px-4 text-textcolor" data-testid="workspace-picker-fixed">
            {bound === null ? language.utility.workspaces.pickerNone : (boundName ?? language.utility.workspaces.pickerGone)}
        </span>
        <span class="text-sm text-textcolor2" data-testid="workspace-picker-locked">{language.utility.workspaces.pickerLocked}</span>
    {:else}
        <!-- The select is rebuilt when the bound workspace disappears, so its shown option follows the choice. -->
        {#key gone}
            <SelectInput labelId="utility-workspace-label" bind:value={() => bound ?? '', pick} className="min-h-11 min-w-48">
                <option value="">{language.utility.workspaces.pickerNone}</option>
                {#each workspaces as workspace (workspace.id)}
                    <option value={workspace.id}>{workspace.name}</option>
                {/each}
                {#if gone && bound !== null}
                    <option value={bound}>{language.utility.workspaces.pickerGone}</option>
                {/if}
            </SelectInput>
        {/key}
    {/if}
</div>
