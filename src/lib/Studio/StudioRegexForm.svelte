<script lang="ts">
    import { onDestroy, onMount, untrack } from 'svelte'
    import { language } from '../../lang'
    import { objRefusalText } from '../../ts/studio/edit/objListCopy'
    import { classifyRegexRow } from '../../ts/studio/edit/regexEntry'
    import { FLAG_ACTIONS, keptTokens, lettersOn, actionsOn, orderOf, setOrder, toggleAction, toggleLetter, type FlagAction } from '../../ts/studio/edit/regexFlags'
    import { regexCustomFlag, regexFieldEdit, regexFlagEdit, regexStageEdit, regexTypingKey, type RegexOp } from '../../ts/studio/edit/regexListOps'
    import { refusalTextOf } from '../../ts/studio/edit/studioToasts'
    import { registerStudioField } from '../../ts/studio/fieldFlush'
    import type { OwnerHistoryService, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import type { OwnerKey } from '../../ts/studio/history/ownerPhase'
    import type { LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import { ReloadGUIPointer } from '../../ts/stores.svelte'
    import { createCompositionGate } from '../../ts/studio/toggleBuilderModel'
    import LongTextField from './LongTextField.svelte'

    // The item editor of one regex script, addressed by its index (a regex row has no identity). Every write is one
    // `service.objEdit` build over the live row; nothing is written by mounting, focusing or leaving a control that was not
    // changed. The form holds no copy of the row.
    interface Props {
        index: number
        readLive: () => unknown
        editable: boolean
        service: OwnerHistoryService | null
        owner: OwnerKey | null
    }

    let { index, readLive, editable, service, owner }: Props = $props()

    const uid = $props.id()
    // Joins this form instance's typing into steps: the index alone would let a later form revive an earlier step.
    const formToken = uid

    type Row = Record<string, unknown>
    const row = $derived.by((): Row | null => {
        const list = readLive()
        if (!Array.isArray(list)) return null
        const found: unknown = list[index]
        return classifyRegexRow(found).kind === 'ok' ? found as Row : null
    })

    function text(value: unknown): string {
        return typeof value === 'string' ? value : ''
    }
    const name = $derived(text(row?.comment))
    const findText = $derived(row === null || typeof row.in !== 'string' ? null : row.in)
    const replaceText = $derived(row === null || typeof row.out !== 'string' ? null : row.out)
    const stage = $derived(text(row?.type))
    const flag = $derived(text(row?.flag))
    const ableFlag = $derived(row?.ableFlag === true)

    const STAGES: readonly { value: string, label: () => string }[] = [
        { value: 'editinput', label: () => language.editInput },
        { value: 'editoutput', label: () => language.editOutput },
        { value: 'editprocess', label: () => language.editProcess },
        { value: 'editdisplay', label: () => language.editDisplay },
        { value: 'edittrans', label: () => language.editTranslationDisplay },
        { value: 'disabled', label: () => language.disabled },
    ]
    const stageKnown = $derived(STAGES.some((entry) => entry.value === stage))

    const LETTERS: readonly { letter: string, label: () => string }[] = [
        { letter: 'g', label: () => language.sidebarUi.flagGlobal },
        { letter: 'i', label: () => language.sidebarUi.flagCaseInsensitive },
        { letter: 'm', label: () => language.sidebarUi.flagMultiLine },
        { letter: 'u', label: () => language.sidebarUi.flagUnicode },
        { letter: 's', label: () => language.sidebarUi.flagDotAll },
    ]
    const ACTION_LABELS: Record<FlagAction, () => string> = {
        move_top: () => language.sidebarUi.flagMoveTop,
        move_bottom: () => language.sidebarUi.flagMoveBottom,
        repeat_back: () => language.sidebarUi.flagRepeatBack,
        cbs: () => language.sidebarUi.flagInCbsParsing,
        no_end_nl: () => language.sidebarUi.flagNoNewlineSubfix,
    }
    const lettersSet = $derived(new Set(lettersOn(flag)))
    const actionsSet = $derived(new Set(actionsOn(flag)))
    const order = $derived(orderOf(flag))
    const kept = $derived(keptTokens(flag))

    // ------------------------------------------------------------- writes
    let refusal = $state<string | null>(null)
    // Set by a landed step on name, stage or replace; the chat refreshes once when that step closes (classic parity).
    let bumpOwed = false

    function closeStep(): void {
        if (owner !== null) service?.closeOpenStep(owner)
        if (bumpOwed) {
            bumpOwed = false
            ReloadGUIPointer.update((n) => n + 1)
        }
    }

    function run(op: RegexOp, field: 'comment' | 'in' | 'out' | 'type' | 'flag' | 'ableFlag'): StudioResult | null {
        if (!service || owner === null || !editable) return null
        const result = service.objEdit(owner, op.build)
        refusal = result.ok === false ? (objRefusalText(result) ?? refusalTextOf(result, owner)) : null
        if (result.ok === true && result.unchanged !== true && (field === 'comment' || field === 'type' || field === 'out')) bumpOwed = true
        return result
    }

    // ------------------------------------------------------------- name
    let nameInput = $state<HTMLInputElement | undefined>()
    // The name this form last saw stored: a build refuses when the live name differs, so a row that moved under the
    // editor is never renamed by mistake. It follows the live name once the live name changes.
    let expectedName = untrack(() => name)
    $effect(() => {
        const live = name
        untrack(() => { expectedName = live })
    })

    function commitName(value: string): void {
        const result = run(regexFieldEdit(index, 'comment', value, regexTypingKey(formToken, index, 'comment'), expectedName), 'comment')
        if (result === null) return
        if (result.ok) {
            if (result.unchanged !== true) expectedName = value
        } else if (nameInput) {
            nameInput.value = name
        }
    }
    const nameGate = createCompositionGate(commitName)

    function onNameInput(event: Event & { currentTarget: HTMLInputElement }): void {
        nameGate.input(event.currentTarget.value, event instanceof InputEvent && event.isComposing)
    }
    function onNameBlur(): void {
        nameGate.flush()
        closeStep()
    }

    // ------------------------------------------------------------- stage
    function onStage(event: Event & { currentTarget: HTMLSelectElement }): void {
        const select = event.currentTarget
        const result = run(regexStageEdit(index, select.value), 'type')
        if (result === null || !result.ok) select.value = stage
        closeStep()
    }

    // ------------------------------------------------------------- find and replace
    function textPort(field: 'in' | 'out', read: () => string | null): LongTextWritePort {
        return {
            read,
            write: (value) => run(regexFieldEdit(index, field, value, regexTypingKey(formToken, index, field)), field),
            closeStep,
        }
    }
    const findPort = textPort('in', () => findText)
    const replacePort = textPort('out', () => replaceText)

    // ------------------------------------------------------------- flags
    function onAbleFlag(event: Event & { currentTarget: HTMLInputElement }): void {
        const input = event.currentTarget
        const result = run(regexCustomFlag(index, input.checked), 'ableFlag')
        if (result === null || !result.ok) input.checked = ableFlag
        closeStep()
    }

    function writeFlag(transform: (flag: string) => string, typing: string | null): StudioResult | null {
        return run(regexFlagEdit(index, transform, typing === null ? null : regexTypingKey(formToken, index, typing)), 'flag')
    }

    function onLetter(letter: string): void {
        writeFlag((current) => toggleLetter(current, letter, !lettersOn(current).includes(letter)), null)
        closeStep()
    }
    function onAction(action: FlagAction): void {
        writeFlag((current) => toggleAction(current, action, !actionsOn(current).includes(action)), null)
        closeStep()
    }

    // A typed integer joins one coalesced step; an emptied input removes the order meta when the user leaves it.
    function onOrderInput(event: Event & { currentTarget: HTMLInputElement }): void {
        const value = event.currentTarget.valueAsNumber
        if (!Number.isInteger(value)) return
        writeFlag((current) => setOrder(current, value), 'order')
    }
    function onOrderChange(event: Event & { currentTarget: HTMLInputElement }): void {
        const input = event.currentTarget
        if (input.value === '') writeFlag((current) => setOrder(current, null), null)
        closeStep()
        input.value = order === null ? '' : String(order)
    }

    // ------------------------------------------------------------- flush on leave
    // Held composed text is written before the view changes, and the open step is closed so the next edit starts a step.
    onMount(() => registerStudioField((reason) => {
        nameGate.flush()
        if (reason === 'leave') closeStep()
    }))
    onDestroy(() => {
        const closing = service
        const closingOwner = owner
        queueMicrotask(() => {
            try {
                nameGate.flush()
                if (closingOwner !== null) closing?.closeOpenStep(closingOwner)
                if (bumpOwed) {
                    bumpOwed = false
                    ReloadGUIPointer.update((n) => n + 1)
                }
            } catch (error) {
                console.error('Studio regex form flush failed', error)
            }
        })
    })

    const inputClass = 'min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor'
    const rowClass = 'flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-darkborderc p-2'
    const chipClass = 'min-h-11 rounded-md border border-darkborderc px-3 text-sm cursor-pointer disabled:cursor-default disabled:opacity-50'
    const noteClass = 'text-sm text-textcolor2'
</script>

{#if row !== null}
    <section data-part="studio-regex-form" class="mx-auto flex w-full max-w-3xl flex-col gap-3" aria-busy={editable ? undefined : 'true'}>
        <h3 data-part="studio-regex-form-title" class="break-words font-bold">{name === '' ? language.sidebarUi.unnamedScript : name}</h3>
        {#if refusal !== null}
            <p role="alert" data-part="studio-regex-refusal" class="text-sm text-draculared">{refusal}</p>
        {/if}
        <div class="flex flex-col gap-1">
            <label for="{uid}-name" class="font-bold">{language.name}</label>
            <input
                id="{uid}-name"
                type="text"
                data-part="studio-regex-name"
                data-testid="studio-regex-name"
                class={inputClass}
                readonly={!editable}
                value={name}
                bind:this={nameInput}
                oninput={onNameInput}
                oncompositionstart={() => nameGate.start()}
                oncompositionend={(event) => nameGate.end(event.currentTarget.value)}
                onblur={onNameBlur}
            />
        </div>
        <div class="flex flex-col gap-1">
            <label for="{uid}-stage" class="font-bold">{language.studioRegexStage}</label>
            <select
                id="{uid}-stage"
                data-part="studio-regex-stage"
                data-testid="studio-regex-stage"
                class={inputClass}
                disabled={!editable}
                value={stage}
                onchange={onStage}
            >
                {#if !stageKnown}
                    <option value={stage}>{language.studioRegexStageOther(stage)}</option>
                {/if}
                {#each STAGES as entry (entry.value)}
                    <option value={entry.value}>{entry.label()}</option>
                {/each}
            </select>
        </div>
        <div class="flex flex-col gap-1" data-testid="studio-regex-find">
            {#if findText !== null}
                <LongTextField
                    port={findPort}
                    part="studio-regex-find"
                    label={language.studioRegexFind}
                    kind="regexIn"
                    mode="plain"
                    {editable}
                    busy={!editable}
                    fieldClass="min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
                    onresult={() => {}}
                />
            {/if}
        </div>
        <div class="flex flex-col gap-1" data-testid="studio-regex-replace">
            {#if replaceText !== null}
                <LongTextField
                    port={replacePort}
                    part="studio-regex-replace"
                    label={language.studioRegexReplace}
                    kind="regexOut"
                    mode="html+cbs"
                    {editable}
                    busy={!editable}
                    fieldClass="min-h-32 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
                    onresult={() => {}}
                />
            {/if}
        </div>
        <label class="{rowClass} cursor-pointer">
            <span class="font-bold">{language.sidebarUi.customFlag}</span>
            <input type="checkbox" role="switch" data-part="studio-regex-able-flag" data-testid="studio-regex-able-flag" aria-label={language.sidebarUi.customFlag} disabled={!editable} checked={ableFlag} onchange={onAbleFlag} />
        </label>
        {#if ableFlag}
            <div class="flex flex-col gap-2" data-part="studio-regex-flags">
                <span class="font-bold">{language.sidebarUi.normalFlag}</span>
                <div class="flex flex-wrap gap-2">
                    {#each LETTERS as entry (entry.letter)}
                        <button type="button" data-part="studio-regex-chip" data-testid="studio-regex-chip-{entry.letter}" class="{chipClass} {lettersSet.has(entry.letter) ? 'bg-selected text-textcolor' : 'text-textcolor2'}" aria-pressed={lettersSet.has(entry.letter)} disabled={!editable} onclick={() => onLetter(entry.letter)}>{entry.label()}</button>
                    {/each}
                    {#each FLAG_ACTIONS as action (action)}
                        <button type="button" data-part="studio-regex-chip" data-testid="studio-regex-chip-{action}" class="{chipClass} {actionsSet.has(action) ? 'bg-selected text-textcolor' : 'text-textcolor2'}" aria-pressed={actionsSet.has(action)} disabled={!editable} onclick={() => onAction(action)}>{ACTION_LABELS[action]()}</button>
                    {/each}
                </div>
                <div class="flex flex-col gap-1">
                    <label for="{uid}-order" class="font-bold">{language.sidebarUi.orderFlag}</label>
                    <input id="{uid}-order" type="number" step="1" data-part="studio-regex-order" data-testid="studio-regex-order" class={inputClass} readonly={!editable} value={order === null ? '' : order} oninput={onOrderInput} onchange={onOrderChange} />
                </div>
                {#if kept.length > 0}
                    <p data-part="studio-regex-flags-kept" class={noteClass}>{language.studioRegexFlagsKept(kept.join(' '))}</p>
                {/if}
            </div>
        {/if}
    </section>
{/if}
