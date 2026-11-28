<script lang="ts">
    import { tick } from 'svelte'
    import { CircleAlertIcon, KeyRoundIcon, VariableIcon } from '@lucide/svelte'
    import { language } from '../../../lang'
    import { fillLang } from '../../../lang/fill'
    import { slotConnection, type ConnectionSlot } from '../../../ts/connections/connections'
    import { connectionKeyHint, type KeyHint } from '../../../ts/connections/connectionHint'
    import { setSlotKey } from '../../../ts/connections/slotEditor'
    import { DBState } from '../../../ts/stores.svelte'
    import KeyListInput from '../../UI/GUI/KeyListInput.svelte'
    import PatternWarning from '../../Nexus/pattern/PatternWarning.svelte'
    import type { PatternAnswer, PatternWarningDef } from '../../Nexus/pattern/patternWarning'
    import { hintChipText, keyStateText } from './ConnectionCard.svelte'

    /*
     * The key of one settings slot, shown as a masked chip (last four characters at most) with Replace
     * key and Remove key. The saved key is never put in a field: a typed value exists only while the
     * Replace key field is open, and a cancel or save drops it.
     */
    interface Props {
        /** Not named `slot`: Svelte reads that attribute on a component as a legacy slot assignment. */
        keySlot: ConnectionSlot
        /** Id of the visible label that names the Replace key field. */
        labelId: string
    }

    let { keySlot, labelId }: Props = $props()

    const conn = $derived(slotConnection(DBState.db, keySlot))
    const hint = $derived<KeyHint>(conn === undefined ? { kind: 'none' } : connectionKeyHint(conn))
    const chip = $derived(hintChipText(hint))

    // A blank or never-readable key opens straight into the field; a temporarily unavailable one
    // is not empty, so it waits for an explicit Replace key and offers no Remove.
    let opened = $state(false)
    let newKey = $state('')
    let busy = $state(false)
    let error = $state('')
    let confirming = $state<HTMLElement | null | false>(false)
    let root = $state<HTMLElement>()
    const replacing = $derived(opened || hint.kind === 'none' || hint.kind === 'reentry')

    async function write(plain: string): Promise<boolean> {
        if (busy) return false
        busy = true
        error = ''
        try {
            await setSlotKey(DBState.db, keySlot, plain)
            return true
        } catch {
            error = language.connectionsKeyWriteFailed
            return false
        } finally {
            busy = false
        }
    }

    async function save(): Promise<void> {
        if (newKey.trim() === '') return
        if (await write(newKey)) {
            newKey = ''
            opened = false
        }
    }

    function openReplace(): void {
        opened = true
        void tick().then(() => root?.querySelector('input')?.focus())
    }

    function cancel(): void {
        opened = false
        newKey = ''
    }

    const removeDef = $derived<PatternWarningDef>({
        severity: 'danger',
        headline: fillLang(language.connectionsClearKeyQ, { name: conn?.name ?? '' }),
        consequences: [language.connectionsKeyNoUndo],
        actions: { cancel: language.cancel, primary: language.connectionsClearKey },
    })

    function answerRemove(answer: PatternAnswer): void {
        confirming = false
        if (answer === 'confirm') void write('')
    }
</script>

<div class="flex flex-col gap-2" data-part="settings-slot-key" data-slot={keySlot} bind:this={root}>
    {#if chip !== ''}
        <span class="inline-flex items-center gap-1 self-start max-w-full px-3 py-1 rounded-full bg-darkbutton text-textcolor text-sm font-mono" data-part="settings-slot-key-chip">
            {#if hint.kind === 'ref'}
                <VariableIcon class="shrink-0" size={14} aria-hidden="true" />
            {:else}
                <KeyRoundIcon class="shrink-0" size={14} aria-hidden="true" />
            {/if}
            <span class="truncate">{chip}</span>
        </span>
    {:else}
        <span class="flex items-center gap-1 text-sm text-draculared" data-part="settings-slot-key-alert">
            <CircleAlertIcon class="shrink-0" size={14} aria-hidden="true" />
            <span>{keyStateText(hint, false, language.connectionsKeyMissing)}</span>
        </span>
    {/if}
    {#if replacing}
        <KeyListInput {labelId} size="sm" hideText bind:value={newKey} />
        <div class="flex flex-wrap gap-2">
            <button
                type="button"
                class="min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected disabled:opacity-50 risu-focus-ring"
                data-part="settings-slot-key-save"
                disabled={busy || newKey.trim() === ''}
                onclick={() => { void save() }}
            >{language.uiCommon.save}</button>
            {#if hint.kind !== 'none' && hint.kind !== 'reentry'}
                <button
                    type="button"
                    class="min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected risu-focus-ring"
                    onclick={cancel}
                >{language.cancel}</button>
            {/if}
        </div>
    {:else}
        <div class="flex flex-wrap gap-2">
            <button
                type="button"
                class="min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected disabled:opacity-50 risu-focus-ring"
                data-part="settings-slot-key-replace"
                disabled={busy}
                onclick={openReplace}
            >{language.connectionsChangeKey}</button>
            {#if hint.kind !== 'none' && hint.kind !== 'unavailable'}
                <button
                    type="button"
                    class="min-h-11 px-4 rounded-md bg-darkbutton text-draculared hover:bg-selected disabled:opacity-50 risu-focus-ring"
                    data-part="settings-slot-key-remove"
                    disabled={busy}
                    onclick={(event) => { confirming = event.currentTarget }}
                >{language.connectionsClearKey}</button>
            {/if}
        </div>
    {/if}
    {#if error !== ''}
        <p class="text-sm text-draculared" role="alert" data-part="settings-slot-key-error">{error}</p>
    {/if}
</div>

{#if confirming !== false}
    <PatternWarning def={removeDef} trigger={confirming} background={root ? [root] : []} onanswer={answerRemove} />
{/if}
