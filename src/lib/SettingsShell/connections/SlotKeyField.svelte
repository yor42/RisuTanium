<script lang="ts">
    import '../../../styles/settings-roles.css'
    import { slotConnection, type ConnectionSlot } from '../../../ts/connections/connections'
    import { connectionKeyHint, type KeyHint } from '../../../ts/connections/connectionHint'
    import { setSlotKey } from '../../../ts/connections/slotEditor'
    import { DBState } from '../../../ts/stores.svelte'
    import MaskedKeyField from './MaskedKeyField.svelte'

    /* The key of one settings slot: the masked field over the connection the slot resolves to. */
    interface Props {
        /** Not named `slot`: Svelte reads that attribute on a component as a legacy slot assignment. */
        keySlot: ConnectionSlot
        /** Id of the visible label that names the Replace key field. */
        labelId: string
        placeholder?: string
        marginBottom?: boolean
        /** Runs after a key was saved or removed, for a field whose cached token depends on it. */
        onwrite?: () => void
    }

    let { keySlot, labelId, placeholder, marginBottom = false, onwrite }: Props = $props()

    const conn = $derived(slotConnection(DBState.db, keySlot))
    const hint = $derived<KeyHint>(conn === undefined ? { kind: 'none' } : connectionKeyHint(conn))
</script>

<MaskedKeyField
    {hint}
    {labelId}
    {placeholder}
    {marginBottom}
    {onwrite}
    fieldName={keySlot}
    ownerName={conn?.name ?? ''}
    write={(plain) => setSlotKey(DBState.db, keySlot, plain)}
/>
