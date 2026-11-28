<script lang="ts">
    import '../../../styles/settings-roles.css'
    import type { ConnectionSlot } from '../../../ts/connections/connections'
    import { language } from '../../../lang'
    import SlotKeyField from './SlotKeyField.svelte'

    /* A data-driven settings row for one key slot: its visible label over the masked key field. */
    interface Props {
        /** Not named `slot`: Svelte reads that attribute on a component as a legacy slot assignment. */
        keySlot: ConnectionSlot
        /** The `language` key of the visible label. */
        labelKey: string
        classes?: string
    }

    let { keySlot, labelKey, classes = '' }: Props = $props()

    const uid = $props.id()
    const label = $derived(String((language as unknown as Record<string, unknown>)[labelKey] ?? ''))
</script>

<span class="text-(--settings-text) {classes}" id="{uid}-label">{label}</span>
<SlotKeyField {keySlot} labelId="{uid}-label" marginBottom />
