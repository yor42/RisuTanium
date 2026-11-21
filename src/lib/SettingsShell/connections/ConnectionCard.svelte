<script module lang="ts">
    import { CloudIcon, HouseIcon, RouteIcon, ServerIcon } from '@lucide/svelte'
    import { language } from '../../../lang'
    import { fillLang } from '../../../lang/fill'
    import { providerLabel, type Connection } from '../../../ts/connections/connections'
    import type { ConnectionUsers } from '../../../ts/connections/connectionUsers'
    import type { KeyHint } from '../../../ts/connections/connectionHint'
    import { catalogEntry, type ProviderIcon } from '../../../ts/connections/providerCatalog'

    const PROVIDER_ICONS: Record<ProviderIcon, typeof CloudIcon> = {
        cloud: CloudIcon,
        route: RouteIcon,
        house: HouseIcon,
        server: ServerIcon,
    }

    /** The icon of a connection's provider; a custom connection has no catalog entry and reads as a server. */
    export function providerIconOf(conn: Connection): typeof CloudIcon {
        return PROVIDER_ICONS[catalogEntry(conn.provider)?.icon ?? 'server']
    }

    /** What the key chip shows: only a tail, a whole `${NAME}` reference or a bare mask; empty for no key. */
    export function hintChipText(hint: KeyHint): string {
        if (hint.kind === 'none') return ''
        const base = hint.kind === 'ref' ? hint.text : `••••${hint.tail === '' ? '' : ' ' + hint.tail}`
        const count = hint.count ?? 1
        return count > 1 ? `${base} · ${fillLang(language.connectionsKeyCount, { n: count })}` : base
    }

    /** The used-by line; empty when nothing countable is known (a provider in use). */
    export function usedByText(conn: Connection, users: ConnectionUsers): string {
        if (users.kind === 'presets') {
            const parts: string[] = []
            if (users.working) parts.push(language.connectionsUsedByCurrent)
            if (users.presets.length > 0) parts.push(fillLang(language.connectionsUsedByPresets, { n: users.presets.length }))
            return parts.length > 0 ? parts.join(' · ') : language.connectionsNotUsed
        }
        if (users.kind === 'models') {
            return users.models.length > 0 ? fillLang(language.connectionsUsedByModels, { n: users.models.length }) : language.connectionsNotUsed
        }
        if (users.kind === 'shadowed') {
            return fillLang(language.connectionsShadowed, { provider: providerLabel(conn.provider) })
        }
        return ''
    }
</script>

<script lang="ts">
    import { CircleAlertIcon, KeyRoundIcon, VariableIcon } from '@lucide/svelte'

    interface Props {
        conn: Connection
        hint: KeyHint
        users: ConnectionUsers
        /** True for a connection an undo brought back without its key. */
        needsKey: boolean
        onopen: () => void
    }

    let { conn, hint, users, needsKey, onopen }: Props = $props()

    const Icon = $derived(providerIconOf(conn))
    const usedLine = $derived(usedByText(conn, users))
    const chip = $derived(hintChipText(hint))
    const reason = $derived(needsKey ? language.connectionsKeyAgain : hint.kind === 'none' ? language.connectionsKeyMissingReason : '')
</script>

<li class="rounded-md border border-darkborderc bg-darkbg min-w-0" data-part="connection-card">
    <button
        type="button"
        class="flex w-full items-start gap-3 min-h-11 p-3 rounded-md text-left text-textcolor risu-focus-ring active:bg-selected"
        data-connection-open={conn.id}
        onclick={onopen}
    >
        <Icon class="shrink-0 mt-0.5 text-textcolor2" size={20} aria-hidden="true" />
        <span class="flex flex-col gap-1 min-w-0 grow">
            <span class="font-semibold truncate" data-part="connection-name">{conn.name}</span>
            <span class="text-sm text-textcolor2 truncate">{providerLabel(conn.provider)}</span>
            {#if usedLine !== ''}
                <span class="text-xs text-textcolor2" data-part="connection-used">{usedLine}</span>
            {/if}
            {#if chip !== ''}
                <span class="inline-flex items-center gap-1 self-start max-w-full px-3 py-1 rounded-full bg-darkbutton text-textcolor text-sm font-mono" data-part="connection-chip">
                    {#if hint.kind === 'ref'}
                        <VariableIcon class="shrink-0" size={14} aria-hidden="true" />
                    {:else}
                        <KeyRoundIcon class="shrink-0" size={14} aria-hidden="true" />
                    {/if}
                    <span class="truncate">{chip}</span>
                </span>
            {/if}
            {#if reason !== ''}
                <span class="flex items-center gap-1 text-sm text-draculared" data-part="connection-alert">
                    <CircleAlertIcon class="shrink-0" size={14} aria-hidden="true" />
                    <span>{reason}</span>
                </span>
            {/if}
        </span>
    </button>
</li>
