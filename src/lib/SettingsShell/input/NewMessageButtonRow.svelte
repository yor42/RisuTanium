<script lang="ts">
    import { accessibilitySettingsItems } from '../../../ts/setting/accessibilitySettingsData'
    import type { SettingContext, SettingItem } from '../../../ts/setting/types'
    import { getSettingValue, setSettingValue } from '../../../ts/setting/utils'
    import { settingsLabel } from '../../../ts/settingsShell/settingsPages'

    interface Props {
        ctx: SettingContext
    }
    let { ctx }: Props = $props()

    // The legacy item holds the six stored values and their labels; this row only shows them as a radio group.
    const item = accessibilitySettingsItems.find((candidate): candidate is SettingItem => candidate.id === 'acc.newMessageButtonStyle')
    const options = item?.options?.selectOptions ?? []
    const uid = $props.id()
    // Where the button sits inside the decorative outline, by stored value.
    const MARKER_CLASS: Readonly<Record<string, string>> = {
        'bottom-center': 'size-2 rounded-full bottom-1 left-1/2',
        'bottom-right': 'size-2 rounded-full bottom-1 right-1',
        'bottom-left': 'size-2 rounded-full bottom-1 left-1',
        'floating-circle': 'size-3 rounded-full bottom-1 right-1',
        'right-center': 'size-2 rounded-full right-1 top-1/2',
        'top-bar': 'h-1 rounded-full inset-x-1 top-1',
    }
    // An unset style is the bottom-center button, as the chat screen reads it.
    const current = $derived(item ? (getSettingValue(item, ctx) || 'bottom-center') : 'bottom-center')

    function choose(value: string): void {
        if (item) setSettingValue(item, value, ctx)
    }
</script>

<fieldset class="mt-4 flex flex-col gap-1 min-w-0" data-part="new-message-button-row">
    <legend class="text-textcolor">{settingsLabel('settingsShellInputNewMsgButton')}</legend>
    <p class="text-xs text-textcolor2 mb-1">{settingsLabel('settingsShellInputNewMsgButtonHint')}</p>
    <div class="flex flex-wrap gap-x-4 gap-y-1">
        {#each options as option (option.value)}
            <label class="flex min-h-11 items-center gap-2 text-textcolor2 has-[:checked]:text-textcolor">
                <input
                    type="radio"
                    name="{uid}-new-message-button"
                    value={option.value}
                    checked={current === option.value}
                    onchange={() => choose(option.value)}
                />
                <span>{option.labelKey ? settingsLabel(option.labelKey) : option.label}</span>
            </label>
        {/each}
    </div>
    <div class="relative h-12 w-24 rounded-md border border-darkborderc" aria-hidden="true" data-part="new-message-button-outline">
        <span class="absolute bg-selected {MARKER_CLASS[current] ?? MARKER_CLASS['bottom-center']}"></span>
    </div>
</fieldset>
