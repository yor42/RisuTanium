<script lang="ts">
    import '../../../styles/settings-roles.css'
    import { CircleAlertIcon, KeyRoundIcon } from '@lucide/svelte'
    import { language } from '../../../lang'
    import { fillLang } from '../../../lang/fill'
    import { slotConnection, type ServiceSlot } from '../../../ts/connections/connections'
    import { connectionKeyHint, type KeyHint } from '../../../ts/connections/connectionHint'
    import { DBState } from '../../../ts/stores.svelte'
    import { hintChipText, keyStateText } from './ConnectionCard.svelte'
    import ConnectionsLink from './ConnectionsLink.svelte'

    interface Props {
        /** Not named `slot`: on a direct child of a component, Svelte reads that attribute as a legacy slot assignment and drops the child. */
        service: ServiceSlot
    }

    let { service }: Props = $props()

    function maskedHint(hint: KeyHint): KeyHint {
        if (hint.kind !== 'ref' && hint.kind !== 'masked') return hint
        return hint.count === undefined ? { kind: 'masked', tail: '' } : { kind: 'masked', tail: '', count: hint.count }
    }

    const conn = $derived(slotConnection(DBState.db, service))
    const hint = $derived(conn === undefined ? undefined : connectionKeyHint(conn))
    // The row always masks: a reference name or a key tail never shows here, whatever the hint kind.
    const chip = $derived(hint === undefined ? '' : hintChipText(maskedHint(hint)))
    // An empty field is never the only signal: a key that is not readable now or can never be read here says so.
    const reason = $derived(hint === undefined ? '' : keyStateText(hint, false, language.connectionsKeyMissingReason))
</script>

<div class="flex flex-col gap-1 mb-2" data-part="settings-service-connection" data-slot={service}>
    {#if conn === undefined}
        <span class="text-sm text-(--settings-text-2)" data-part="settings-service-connection-none">{language.connectionsServiceNone}</span>
    {:else}
        <span class="flex flex-wrap items-center gap-2 text-sm text-(--settings-text-2)" data-part="settings-service-connection-uses">
            <span>{fillLang(language.connectionsServiceUses, { name: conn.name })}</span>
            {#if chip !== ''}
                <span class="inline-flex items-center gap-1 max-w-full px-3 py-1 rounded-full bg-(--settings-raised) text-(--settings-text) font-mono" data-part="settings-service-connection-chip">
                    <KeyRoundIcon class="shrink-0" size={14} aria-hidden="true" />
                    <span class="truncate">{chip}</span>
                </span>
            {/if}
        </span>
        {#if reason !== ''}
            <span class="flex items-center gap-1 text-sm text-(--settings-danger)" data-part="settings-service-connection-alert">
                <CircleAlertIcon class="shrink-0" size={14} aria-hidden="true" />
                <span>{reason}</span>
            </span>
        {/if}
    {/if}
    <ConnectionsLink />
</div>
