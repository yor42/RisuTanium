<script lang="ts">
    import { tick, untrack } from 'svelte'
    import { CircleAlertIcon, KeyRoundIcon, VariableIcon } from '@lucide/svelte'
    import { language } from '../../../lang'
    import { fillLang } from '../../../lang/fill'
    import { providerLabel, type Connection } from '../../../ts/connections/connections'
    import type { KeyHint } from '../../../ts/connections/connectionHint'
    import type { ConnectionUser, ConnectionUsers } from '../../../ts/connections/connectionUsers'
    import { catalogEntry } from '../../../ts/connections/providerCatalog'
    import KeyListInput from '../../UI/GUI/KeyListInput.svelte'
    import TextInput from '../../UI/GUI/TextInput.svelte'
    import { hintChipText, usedByText } from './ConnectionCard.svelte'

    /** How many users the used-by list names before it folds the rest into "and n more". */
    const LISTED_USERS = 5

    interface Props {
        conn: Connection
        hint: KeyHint
        users: ConnectionUsers
        /** True for a connection an undo brought back without its key. */
        needsKey: boolean
        /** True while a key write of this connection is in flight. */
        pending: boolean
        /** A failed key change, shown inline. */
        error: string
        onrename: (name: string) => { ok: boolean, duplicate: boolean }
        /** Resolves true when the new key is stored. */
        onreplace: (plain: string) => Promise<boolean>
        onclear: (trigger: HTMLElement | null) => void
        onuse: () => void
        ondelete: (trigger: HTMLElement | null) => void
    }

    let { conn, hint, users, needsKey, pending, error, onrename, onreplace, onclear, onuse, ondelete }: Props = $props()

    const uid = $props.id()

    let draft = $state(untrack(() => conn.name))
    let nameNote = $state('')
    let replacing = $state(untrack(() => needsKey || hint.kind === 'none'))
    let newKey = $state('')
    let root = $state<HTMLElement>()
    let keyField = $state<HTMLElement>()

    const chip = $derived(hintChipText(hint))
    const usedLine = $derived(usedByText(conn, users))
    const multiline = $derived(catalogEntry(conn.provider)?.multilineKey ?? false)
    const userList = $derived<ConnectionUser[]>(users.kind === 'presets' ? users.presets : users.kind === 'models' ? users.models : [])
    const listed = $derived(userList.slice(0, LISTED_USERS))
    const hidden = $derived(userList.length - listed.length)
    const canUse = $derived(conn.provider === 'reverse_proxy' && users.kind === 'presets' && !users.working)

    $effect(() => {
        void tick().then(() => focusKey() ?? root?.focus())
    })

    function focusKey(): true | undefined {
        const field = keyField?.querySelector('input')
        if (!field) return undefined
        field.focus()
        return true
    }

    function commitName(): void {
        const result = onrename(draft)
        if (!result.ok) {
            nameNote = language.connectionsNameEmpty
            draft = conn.name
            return
        }
        draft = conn.name
        nameNote = result.duplicate ? language.connectionsNameDuplicate : ''
    }

    async function saveKey(): Promise<void> {
        if (pending || newKey.trim() === '') return
        if (await onreplace(newKey)) {
            newKey = ''
            replacing = false
        }
    }

    function openReplace(): void {
        replacing = true
        void tick().then(() => focusKey())
    }
</script>

<div class="flex flex-col gap-4 min-w-0 outline-none rounded-md" tabindex="-1" role="group" aria-label={conn.name} bind:this={root} data-part="connection-detail">
    <div class="flex flex-col gap-1">
        <label class="text-sm text-textcolor2" for="{uid}-name">{language.connectionsName}</label>
        <input
            id="{uid}-name"
            type="text"
            autocomplete="off"
            class="min-h-11 px-3 rounded-md border border-darkborderc bg-transparent text-textcolor risu-focus-ring"
            bind:value={draft}
            onchange={commitName}
        />
        {#if nameNote !== ''}
            <span class="text-sm text-draculared" role="status" data-part="connection-name-note">{nameNote}</span>
        {/if}
        <span class="text-sm text-textcolor2">{providerLabel(conn.provider)}</span>
    </div>

    <div class="flex flex-col gap-2" data-part="connection-key">
        <span class="text-sm text-textcolor2">{language.connectionsKey}</span>
        {#if chip !== ''}
            <span class="inline-flex items-center gap-1 self-start max-w-full px-3 py-1 rounded-full bg-darkbutton text-textcolor text-sm font-mono" data-part="connection-chip">
                {#if hint.kind === 'ref'}
                    <VariableIcon class="shrink-0" size={14} aria-hidden="true" />
                {:else}
                    <KeyRoundIcon class="shrink-0" size={14} aria-hidden="true" />
                {/if}
                <span class="truncate">{chip}</span>
            </span>
        {:else}
            <span class="flex items-center gap-1 text-sm text-draculared" data-part="connection-alert">
                <CircleAlertIcon class="shrink-0" size={14} aria-hidden="true" />
                <span>{needsKey ? language.connectionsKeyAgain : language.connectionsKeyMissing}</span>
            </span>
        {/if}
        {#if replacing}
            <span class="text-sm text-textcolor2" id="{uid}-key">{language.connectionsChangeKey}</span>
            <div data-part="connection-key-input" bind:this={keyField}>
                {#if multiline}
                    <TextInput labelId="{uid}-key" size="sm" hideText bind:value={newKey} />
                {:else}
                    <KeyListInput labelId="{uid}-key" size="sm" hideText bind:value={newKey} />
                {/if}
            </div>

            <div class="flex flex-wrap gap-2">
                <button
                    type="button"
                    class="min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected disabled:opacity-50 risu-focus-ring"
                    data-part="connection-key-save"
                    disabled={pending || newKey.trim() === ''}
                    onclick={() => { void saveKey() }}
                >{language.uiCommon.save}</button>
                {#if hint.kind !== 'none' || needsKey}
                    <button
                        type="button"
                        class="min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected risu-focus-ring"
                        onclick={() => { replacing = false; newKey = '' }}
                    >{language.cancel}</button>
                {/if}
            </div>
        {:else}
            <div class="flex flex-wrap gap-2">
                <button
                    type="button"
                    class="min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected disabled:opacity-50 risu-focus-ring"
                    data-part="connection-key-replace"
                    disabled={pending}
                    onclick={openReplace}
                >{language.connectionsChangeKey}</button>
                {#if hint.kind !== 'none'}
                    <button
                        type="button"
                        class="min-h-11 px-4 rounded-md bg-darkbutton text-draculared hover:bg-selected disabled:opacity-50 risu-focus-ring"
                        data-part="connection-key-clear"
                        disabled={pending}
                        onclick={(event) => onclear(event.currentTarget)}
                    >{language.connectionsClearKey}</button>
                {/if}
            </div>
        {/if}
        {#if error !== ''}
            <p class="text-sm text-draculared" role="alert" data-part="connection-error">{error}</p>
        {/if}
        <span class="text-xs text-textcolor2">{language.connectionsKeyLocal}</span>
        <span class="text-xs text-textcolor2">{language.connectionsKeyNoUndo}</span>
    </div>

    <div class="flex flex-col gap-1" data-part="connection-users">
        <span class="text-sm text-textcolor2">{language.connectionsUsedHere}</span>
        {#if usedLine !== ''}
            <span class="text-sm text-textcolor">{usedLine}</span>
        {/if}
        {#each listed as user, index (user.id === '' ? `n${index}` : user.id)}
            <span class="text-sm text-textcolor2 truncate">{user.name}</span>
        {/each}
        {#if hidden > 0}
            <span class="text-sm text-textcolor2">{fillLang(language.connectionsAndMore, { n: hidden })}</span>
        {/if}
    </div>

    <div class="flex flex-wrap gap-2">
        {#if canUse}
            <button
                type="button"
                class="min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected risu-focus-ring"
                data-part="connection-use"
                onclick={onuse}
            >{language.connectionsUseForCurrent}</button>
        {/if}
        <button
            type="button"
            class="min-h-11 px-4 rounded-md bg-draculared text-white disabled:opacity-50 risu-focus-ring"
            data-part="connection-delete"
            disabled={pending}
            onclick={(event) => ondelete(event.currentTarget)}
        >{language.connectionsDelete}</button>
    </div>
</div>
