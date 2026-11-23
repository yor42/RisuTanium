<script lang="ts">
    import { tick, untrack } from 'svelte'
    import { CircleAlertIcon, KeyRoundIcon, PlugZapIcon, PlusIcon, TrashIcon, VariableIcon } from '@lucide/svelte'
    import { language } from '../../../lang'
    import { fillLang } from '../../../lang/fill'
    import { providerLabel, type Connection } from '../../../ts/connections/connections'
    import type { KeyHint } from '../../../ts/connections/connectionHint'
    import type { ConnectionUser, ConnectionUsers } from '../../../ts/connections/connectionUsers'
    import { catalogEntry } from '../../../ts/connections/providerCatalog'
    import { connectionKey } from '../../../ts/connections/keyAccess'
    import { appTestFetcher, canTestConnection, testConnection, type TestFetcher, type TestOutcome } from '../../../ts/connections/connectionTest'
    import type { UnderModel } from '../../../ts/connections/customModelsUnder'
    import KeyListInput from '../../UI/GUI/KeyListInput.svelte'
    import TextInput from '../../UI/GUI/TextInput.svelte'
    import { hintChipText, keyStateText, usedByText } from './ConnectionCard.svelte'

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
        /** The custom models under this connection; null for a connection that cannot own any. */
        models?: UnderModel[] | null
        onaddmodel?: () => void
        oneditmodel?: (id: string, patch: { name?: string, internalId?: string }) => void
        onremovemodel?: (id: string) => void
        /** The request a test sends; the page uses the app's own request path. */
        fetcher?: TestFetcher
    }

    let { conn, hint, users, needsKey, pending, error, onrename, onreplace, onclear, onuse, ondelete, models = null, onaddmodel, oneditmodel, onremovemodel, fetcher = appTestFetcher }: Props = $props()

    const uid = $props.id()

    let draft = $state(untrack(() => conn.name))
    let nameNote = $state('')
    // A blank or never-readable key opens straight into Change key; a temporarily unavailable one
    // is not empty, so it waits for an explicit Change key and offers no Clear.
    let replacing = $state(untrack(() => needsKey || hint.kind === 'none' || hint.kind === 'reentry'))
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

    /** The last test of this open page; never stored, and cleared when the key or URL changes. */
    let outcome = $state<TestOutcome | null>(null)
    let testing = $state<AbortController | null>(null)
    const testable = $derived(canTestConnection(conn))

    // A test belongs to the URL and key it started with: a change of either, a cleared key or a
    // closed page drops a running request and its result.
    const keyState = $derived(JSON.stringify(hint))
    $effect(() => {
        void conn.url
        void keyState
        untrack(() => {
            cancelTest()
            outcome = null
        })
    })
    $effect(() => () => { testing?.abort() })

    async function runTest(): Promise<void> {
        if (testing) return
        const controller = new AbortController()
        testing = controller
        outcome = null
        let result: TestOutcome
        try {
            result = await testConnection(conn, await connectionKey(conn), fetcher, controller.signal)
        } catch {
            result = { kind: 'unreachable' }
        }
        if (testing === controller) {
            testing = null
            outcome = result.kind === 'cancelled' ? null : result
        }
    }

    function cancelTest(): void {
        testing?.abort()
        testing = null
    }

    function outcomeText(result: TestOutcome): string {
        switch (result.kind) {
            case 'ok': return result.models === null
                ? fillLang(language.connectionsTestOkPlain, { ms: result.ms })
                : fillLang(language.connectionsTestOk, { n: result.models, ms: result.ms })
            case 'badKey': return language.connectionsTestBadKey
            case 'rateLimited': return language.connectionsTestRate
            case 'unreachable': return language.connectionsTestUnreachable
            default: return language.connectionsTestUnsupported
        }
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
            outcome = null
        }
    }

    function openReplace(): void {
        replacing = true
        void tick().then(() => focusKey())
    }
</script>

<div class="flex flex-col gap-4 min-w-0 outline-none rounded-md" tabindex="-1" role="group" aria-label={conn.name} bind:this={root} data-part="settings-connection-detail">
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
            <span class="text-sm text-draculared" role="status" data-part="settings-connection-name-note">{nameNote}</span>
        {/if}
        <span class="text-sm text-textcolor2">{providerLabel(conn.provider)}</span>
    </div>

    <div class="flex flex-col gap-2" data-part="settings-connection-key">
        <span class="text-sm text-textcolor2">{language.connectionsKey}</span>
        {#if chip !== ''}
            <span class="inline-flex items-center gap-1 self-start max-w-full px-3 py-1 rounded-full bg-darkbutton text-textcolor text-sm font-mono" data-part="settings-connection-chip">
                {#if hint.kind === 'ref'}
                    <VariableIcon class="shrink-0" size={14} aria-hidden="true" />
                {:else}
                    <KeyRoundIcon class="shrink-0" size={14} aria-hidden="true" />
                {/if}
                <span class="truncate">{chip}</span>
            </span>
        {:else}
            <span class="flex items-center gap-1 text-sm text-draculared" data-part="settings-connection-alert">
                <CircleAlertIcon class="shrink-0" size={14} aria-hidden="true" />
                <span>{keyStateText(hint, needsKey, language.connectionsKeyMissing)}</span>
            </span>
        {/if}
        {#if replacing}
            <span class="text-sm text-textcolor2" id="{uid}-key">{language.connectionsChangeKey}</span>
            <div data-part="settings-connection-key-input" bind:this={keyField}>
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
                    data-part="settings-connection-key-save"
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
                    data-part="settings-connection-key-replace"
                    disabled={pending}
                    onclick={openReplace}
                >{language.connectionsChangeKey}</button>
                {#if hint.kind !== 'none' && hint.kind !== 'unavailable'}
                    <button
                        type="button"
                        class="min-h-11 px-4 rounded-md bg-darkbutton text-draculared hover:bg-selected disabled:opacity-50 risu-focus-ring"
                        data-part="settings-connection-key-clear"
                        disabled={pending}
                        onclick={(event) => onclear(event.currentTarget)}
                    >{language.connectionsClearKey}</button>
                {/if}
            </div>
        {/if}
        {#if error !== ''}
            <p class="text-sm text-draculared" role="alert" data-part="settings-connection-error">{error}</p>
        {/if}
        <span class="text-xs text-textcolor2">{language.connectionsKeyLocal}</span>
        <span class="text-xs text-textcolor2">{language.connectionsKeyNoUndo}</span>
    </div>

    <div class="flex flex-col gap-1" data-part="settings-connection-users">
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

    <div class="flex flex-col gap-2" data-part="settings-connection-test">
        <div class="flex flex-wrap items-center gap-2">
            {#if testing}
                <span class="text-sm text-textcolor2" role="status">{language.connectionsTesting}</span>
                <button
                    type="button"
                    class="min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected risu-focus-ring"
                    data-part="settings-connection-test-cancel"
                    onclick={cancelTest}
                >{language.cancel}</button>
            {:else}
                <button
                    type="button"
                    class="inline-flex items-center gap-2 min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected disabled:opacity-50 risu-focus-ring"
                    data-part="settings-connection-test-run"
                    disabled={pending || !testable}
                    onclick={() => { void runTest() }}
                >
                    <PlugZapIcon size={16} aria-hidden="true" />
                    <span>{language.connectionsTest}</span>
                </button>
            {/if}
        </div>
        {#if !testable}
            <span class="text-sm text-textcolor2">{language.connectionsTestUnsupported}</span>
        {:else if outcome}
            <span class="text-sm {outcome.kind === 'ok' ? 'text-textcolor' : 'text-draculared'}" role="status" data-part="settings-connection-test-result">{outcomeText(outcome)}</span>
        {:else if !testing}
            <span class="text-sm text-textcolor2">{language.connectionsTestNone}</span>
        {/if}
    </div>

    {#if models !== null}
        <div class="flex flex-col gap-2" data-part="settings-connection-models">
            <span class="text-sm text-textcolor2">{language.connectionsModels}</span>
            {#if models.length === 0}
                <span class="text-sm text-textcolor2">{language.connectionsModelsNone}</span>
            {/if}
            {#each models as model (model.id)}
                <div class="flex flex-col gap-1 p-2 rounded-md border border-darkborderc" data-part="settings-connection-model" data-model-id={model.id}>
                    <label class="text-sm text-textcolor2" for="{uid}-m-name-{model.id}">{language.connectionsModelName}</label>
                    <input
                        id="{uid}-m-name-{model.id}"
                        type="text"
                        autocomplete="off"
                        class="min-h-11 px-3 rounded-md border border-darkborderc bg-transparent text-textcolor risu-focus-ring"
                        value={model.name}
                        onchange={(event) => oneditmodel?.(model.id, { name: event.currentTarget.value })}
                    />
                    <label class="text-sm text-textcolor2" for="{uid}-m-id-{model.id}">{language.connectionsModelId}</label>
                    <input
                        id="{uid}-m-id-{model.id}"
                        type="text"
                        autocomplete="off"
                        class="min-h-11 px-3 rounded-md border border-darkborderc bg-transparent text-textcolor font-mono risu-focus-ring"
                        value={model.internalId}
                        onchange={(event) => oneditmodel?.(model.id, { internalId: event.currentTarget.value })}
                    />
                    <button
                        type="button"
                        class="inline-flex items-center gap-2 self-start min-h-11 px-4 rounded-md bg-darkbutton text-draculared hover:bg-selected risu-focus-ring"
                        data-part="settings-connection-model-remove"
                        onclick={() => onremovemodel?.(model.id)}
                    >
                        <TrashIcon size={16} aria-hidden="true" />
                        <span>{fillLang(language.connectionsModelRemove, { name: model.name === '' ? model.internalId : model.name })}</span>
                    </button>
                </div>
            {/each}
            <button
                type="button"
                class="inline-flex items-center gap-2 self-start min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected risu-focus-ring"
                data-part="settings-connection-model-add"
                onclick={() => onaddmodel?.()}
            >
                <PlusIcon size={16} aria-hidden="true" />
                <span>{language.connectionsModelAdd}</span>
            </button>
        </div>
    {/if}

    <div class="flex flex-wrap gap-2">
        {#if canUse}
            <button
                type="button"
                class="min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected risu-focus-ring"
                data-part="settings-connection-use"
                onclick={onuse}
            >{language.connectionsUseForCurrent}</button>
        {/if}
        <button
            type="button"
            class="min-h-11 px-4 rounded-md bg-draculared text-white disabled:opacity-50 risu-focus-ring"
            data-part="settings-connection-delete"
            disabled={pending}
            onclick={(event) => ondelete(event.currentTarget)}
        >{language.connectionsDelete}</button>
    </div>
</div>
