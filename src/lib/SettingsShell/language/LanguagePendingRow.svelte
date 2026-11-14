<script lang="ts">
    import { languagePending } from '../../../ts/setting/languageShellSettingsData'
    import type { SettingContext } from '../../../ts/setting/types'
    import { settingsLabel } from '../../../ts/settingsShell/settingsPages'
    import { DBState } from '../../../ts/stores.svelte'

    interface Props {
        ctx: SettingContext
    }
    let { ctx: _ctx }: Props = $props()

    // The language the page opened with. The row sits in a group that never collapses and has no condition, so
    // it mounts once per visit; a remount means Settings were closed and opened again, when the change has taken effect.
    const atMount = DBState.db.language
    const pending = $derived(languagePending(atMount, DBState.db.language))
</script>

<div role="status" class="mt-1" data-part="language-pending">
    {#if pending}
        <p class="text-sm text-textcolor2">{settingsLabel('settingsShellLangPending')}</p>
    {/if}
</div>
