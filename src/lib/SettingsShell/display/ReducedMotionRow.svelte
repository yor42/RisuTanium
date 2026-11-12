<script lang="ts">
    import { language } from '../../../lang'
    import { motionPrefs, setReducedMotion, type ReducedMotionMode } from '../../../ts/chatShell/motionPrefs.svelte'
    import type { SettingContext } from '../../../ts/setting/types'

    interface Props {
        ctx: SettingContext
    }
    let { ctx: _ctx }: Props = $props()
    const group = $props.id()

    const choices: readonly { mode: ReducedMotionMode, label: () => string }[] = [
        { mode: 'system', label: () => language.settingsShellReducedMotionSystem },
        { mode: 'on', label: () => language.settingsShellReducedMotionOn },
        { mode: 'off', label: () => language.settingsShellReducedMotionOff },
    ]
</script>

<!-- A device choice (MC-1529), like low power. -->
<fieldset class="mt-4 min-w-0 border-0 p-0" data-part="reduced-motion" aria-describedby="{group}-desc">
    <legend class="text-textcolor">{language.settingsShellReducedMotion}</legend>
    <div class="mt-2 flex w-full overflow-hidden rounded-md border border-darkborderc">
        {#each choices as choice (choice.mode)}
            <label class="relative flex min-h-11 grow items-center justify-center px-3 text-sm cursor-pointer transition-colors {motionPrefs.reducedMotion === choice.mode ? 'bg-darkbutton text-textcolor' : 'text-textcolor2 hover:text-textcolor'}">
                <input
                    class="sr-only peer"
                    type="radio"
                    name={group}
                    value={choice.mode}
                    checked={motionPrefs.reducedMotion === choice.mode}
                    onchange={() => setReducedMotion(choice.mode)}
                />
                <span class="rounded-sm peer-focus-visible:ring-2 peer-focus-visible:ring-textcolor2">{choice.label()}</span>
            </label>
        {/each}
    </div>
    <p id="{group}-desc" class="mt-1 text-sm text-textcolor2">{language.settingsShellReducedMotionDesc}</p>
</fieldset>
