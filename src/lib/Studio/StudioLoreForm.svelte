<script lang="ts">
    import { onDestroy, onMount, untrack } from 'svelte'
    import { language } from '../../lang'
    import {
        clampProbability,
        loreDecoratorNotes,
        loreDecoratorPickSource,
        loreDecoratorProblems,
        probabilityClearKeeps,
        probabilityEditable,
        readProbabilityLine,
    } from '../../ts/studio/longText/loreDecorators'
    import {
        containerOf,
        displayNameOf,
        duplicateIds,
        idOf,
        isLinkRow,
        isLoreRow,
        moveTargets,
        trackedOf,
        type LoreHost,
        type LoreTracked,
    } from '../../ts/studio/edit/loreListModel'
    import {
        loreAlwaysActive,
        loreCaseSensitive,
        loreFieldEdit,
        loreLegacyProbability,
        loreMove,
        loreMoveLegacyIntoLine,
        loreNewId,
        loreProbabilitySet,
        loreTypingKey,
        loreUnlink,
        type LoreOp,
        type LoreSetField,
    } from '../../ts/studio/edit/loreListOps'
    import { loreDecoratorCopy } from '../../ts/studio/edit/objListCopy'
    import type { LoreControl, LoreRunEffect } from './StudioLoreList.svelte'
    import { flushStudioFields, registerStudioField } from '../../ts/studio/fieldFlush'
    import type { ObjFieldValue } from '../../ts/studio/history/objectListOps'
    import type { OwnerHistoryService, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import type { OwnerKey } from '../../ts/studio/history/ownerPhase'
    import { beginOwnerVisit } from '../../ts/studio/history/studioHistoryService.svelte'
    import { selectStudioNode } from '../../ts/studio/studioScreen.svelte'
    import { createCompositionGate } from '../../ts/studio/toggleBuilderModel'
    import type { LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import { DBState } from '../../ts/stores.svelte'
    import Help from '../Others/Help.svelte'
    import LongTextField from './LongTextField.svelte'
    import { combinedKeyOf } from './StudioCombined.svelte'

    // The form of one lorebook entry, or of a chat's linked entry. Every write goes through the pane's `runForm` with this
    // form's token, so a write held past the form's life (a composition flushed on unmount) is refused once another view
    // is open. The form reads the live row at every use and holds no copy of it.
    interface Props {
        // The token of the open view this form belongs to. It is constant for the instance: the pane keys the form by it.
        token: number
        host: LoreHost
        // The entry's index on the live rows right now.
        index: number
        readLive: () => readonly unknown[]
        // The character's own lorebook (what a chat's link points at) and the context chat's lorebook (the local links).
        readParent: () => readonly unknown[]
        readChatLore: () => readonly unknown[]
        editable: boolean
        service: OwnerHistoryService | null
        owner: OwnerKey | null
        // The context chat's owner, only on a character host with a unique context chat.
        chatOwner: OwnerKey | null
        runForm: (token: number, make: (t: LoreTracked, hint: number) => LoreOp, effect?: LoreRunEffect, control?: LoreControl) => StudioResult
        activateInChat: (token: number) => StudioResult
        deleteOpen: (token: number) => void
        noted: (result: StudioResult) => boolean
        // True when the entry was just added: the Name input takes focus.
        focusName?: boolean
    }

    let { token: openToken, host, index, readLive, readParent, readChatLore, editable, service, owner, chatOwner, runForm, activateInChat, deleteOpen, noted, focusName = false }: Props = $props()
    // A prop reads the parent's current value, so a write held past this form's life (the destroy-time flush) would carry the
    // token of whatever view is open by then. The form's own token is captured once.
    const token = untrack(() => openToken)

    const uid = $props.id()
    const rows = $derived(readLive())
    const entry = $derived.by(() => {
        const found: unknown = rows[index]
        return isLoreRow(found) ? found : null
    })
    const link = $derived(isLinkRow(entry))
    const id = $derived(idOf(entry))
    // A unique id names the entry across moves; otherwise the form's own token does.
    const identity = $derived.by(() => {
        const tracked = trackedOf(rows, index)
        return tracked !== null && tracked.id !== null ? `id:${tracked.id}` : `row:${token}`
    })

    function text(value: unknown): string {
        return typeof value === 'string' ? value : ''
    }
    const name = $derived(text(entry?.comment))
    const content = $derived(entry !== null && typeof entry.content === 'string' ? entry.content : null)
    const alwaysActive = $derived(entry?.alwaysActive === true)
    const selective = $derived(entry?.selective === true)
    const useRegex = $derived(entry?.useRegex === true)
    const caseSensitive = $derived.by(() => {
        const container: unknown = entry?.extentions
        return isLoreRow(container) && container.risu_case_sensitive === true
    })
    const insertOrder = $derived(typeof entry?.insertorder === 'number' ? entry.insertorder : 100)
    const legacy = $derived(typeof entry?.activationPercent === 'number' ? entry.activationPercent : null)
    const probability = $derived(content === null ? null : readProbabilityLine(content))
    const container = $derived(containerOf(rows, index))
    const targets = $derived(moveTargets(rows, index))

    function writeField(field: LoreSetField, after: ObjFieldValue, typing: string | null): StudioResult {
        return runForm(token, (t, hint) => loreFieldEdit(t, hint, field, after, typing === null ? null : loreTypingKey(identity, typing)))
    }

    // ------------------------------------------------------------- the three single-line inputs
    // Each writes through a composition gate: nothing is written while an IME composes, the composed value is written once,
    // and a refused write puts the live value back into the input.
    let nameInput = $state<HTMLInputElement | undefined>()
    let keysInput = $state<HTMLInputElement | undefined>()
    let secondInput = $state<HTMLInputElement | undefined>()

    function commitText(field: 'comment' | 'key' | 'secondkey', input: HTMLInputElement | undefined, value: string): void {
        const result = writeField(field, { had: true, value }, field)
        if (!result.ok && input) input.value = text(entry?.[field])
    }
    const nameGate = createCompositionGate((value) => commitText('comment', nameInput, value))
    const keysGate = createCompositionGate((value) => commitText('key', keysInput, value))
    const secondGate = createCompositionGate((value) => commitText('secondkey', secondInput, value))

    function onTextInput(gate: ReturnType<typeof createCompositionGate>, event: Event & { currentTarget: HTMLInputElement }): void {
        gate.input(event.currentTarget.value, event instanceof InputEvent && event.isComposing)
    }
    function onTextBlur(gate: ReturnType<typeof createCompositionGate>): void {
        gate.flush()
        if (owner !== null) service?.closeOpenStep(owner)
    }

    // The registered flush writes held text while the form lives. A teardown can run before the flush that removes the
    // form, so the late write runs in a microtask: the pane refuses it unless this form's token is still the open one.
    onMount(() => {
        if (focusName) nameInput?.focus()
        return registerStudioField(() => {
            nameGate.flush()
            keysGate.flush()
            secondGate.flush()
        })
    })
    onDestroy(() => {
        const closing = service
        const closingOwner = owner
        queueMicrotask(() => {
            try {
                nameGate.flush()
                keysGate.flush()
                secondGate.flush()
                if (closingOwner !== null) closing?.closeOpenStep(closingOwner)
            } catch (error) {
                console.error('Studio lore form flush failed', error)
            }
        })
    })

    // ------------------------------------------------------------- content
    const copy = loreDecoratorCopy()
    const picks = loreDecoratorPickSource(copy)
    const contentPort: LongTextWritePort = {
        read: () => content,
        write: (value) => writeField('content', { had: true, value }, 'content'),
        closeStep: () => { if (owner !== null) service?.closeOpenStep(owner) },
    }

    // ------------------------------------------------------------- switches and numbers
    function closeStep(): void {
        if (owner !== null) service?.closeOpenStep(owner)
    }

    function onAlwaysActive(event: Event & { currentTarget: HTMLInputElement }): void {
        const input = event.currentTarget
        const result = runForm(token, (t, hint) => loreAlwaysActive(t, hint, input.checked))
        if (!result.ok) input.checked = alwaysActive
    }

    function onFlag(field: 'selective' | 'useRegex', event: Event & { currentTarget: HTMLInputElement }): void {
        const input = event.currentTarget
        const result = writeField(field, { had: true, value: input.checked }, null)
        if (!result.ok) input.checked = field === 'selective' ? selective : useRegex
        else closeStep()
    }

    function onCaseSensitive(event: Event & { currentTarget: HTMLInputElement }): void {
        const input = event.currentTarget
        const result = runForm(token, (t, hint) => loreCaseSensitive(t, hint, input.checked))
        if (!result.ok) input.checked = caseSensitive
        else closeStep()
    }

    // A typed number is clamped to 0..1000 and joins one coalesced step; leaving the field shows the stored value.
    function onOrderInput(event: Event & { currentTarget: HTMLInputElement }): void {
        const value = event.currentTarget.valueAsNumber
        if (!Number.isFinite(value)) return
        writeField('insertorder', { had: true, value: Math.min(1000, Math.max(0, value)) }, 'insertorder')
    }
    function onOrderChange(event: Event & { currentTarget: HTMLInputElement }): void {
        closeStep()
        event.currentTarget.value = String(insertOrder)
    }

    // ------------------------------------------------------------- probability
    const probabilityShown = $derived(probability?.kind === 'one' ? String(probability.value) : '')
    const probabilityOpen = $derived(editable && probability !== null && probabilityEditable(probability))
    const keptNotice = $derived(probability?.kind === 'one' && content !== null && probabilityClearKeeps(content))

    function onProbabilityInput(event: Event & { currentTarget: HTMLInputElement }): void {
        const value = clampProbability(event.currentTarget.valueAsNumber)
        if (value === null) return
        // Held text goes first, so the line is written over what the user typed before it.
        flushStudioFields('hide')
        runForm(token, (t, hint) => loreProbabilitySet(t, hint, value, loreTypingKey(identity, 'probability')))
    }
    function onProbabilityChange(event: Event & { currentTarget: HTMLInputElement }): void {
        const input = event.currentTarget
        if (input.value === '') runForm(token, (t, hint) => loreProbabilitySet(t, hint, null, null))
        closeStep()
        input.value = probabilityShown
    }

    function onLegacyInput(event: Event & { currentTarget: HTMLInputElement }): void {
        const value = event.currentTarget.valueAsNumber
        if (!Number.isFinite(value)) return
        runForm(token, (t, hint) => loreLegacyProbability(t, hint, value, loreTypingKey(identity, 'activationPercent')))
    }
    function onLegacyChange(event: Event & { currentTarget: HTMLInputElement }): void {
        closeStep()
        event.currentTarget.value = legacy === null ? '' : String(legacy)
    }

    // ------------------------------------------------------------- folder, id, local activation
    function folderNameOf(key: string): string {
        const folder = rows.find((candidate) => isLoreRow(candidate) && candidate.mode === 'folder' && candidate.key === key)
        return displayNameOf(folder) ?? language.sidebarUi.unnamedFolder
    }
    function onFolder(event: Event & { currentTarget: HTMLSelectElement }): void {
        const select = event.currentTarget
        const to = select.value === '' ? null : select.value
        const result = runForm(token, (t, hint) => loreMove(t, hint, { to }))
        if (!result.ok || result.unchanged === true) select.value = container ?? ''
    }

    const duplicateId = $derived(id !== null && !link && duplicateIds(rows).has(id))
    let copied = $state(false)
    async function copyId(): Promise<void> {
        if (id === null) return
        try {
            await navigator.clipboard.writeText(id)
            copied = true
        } catch {
            copied = false
        }
    }
    function giveNewId(): void {
        runForm(token, (t, hint) => loreNewId(t, hint))
    }

    const showLocal = $derived(host === 'character' && chatOwner !== null && !alwaysActive && !link && DBState.db.localActivationInGlobalLorebook === true)
    // The context chat's history owner is started while the switch shows, so it can be written when pressed.
    $effect(() => {
        if (!service || !showLocal || chatOwner === null) return
        const started = chatOwner
        untrack(() => beginOwnerVisit(started))
    })
    const chatReady = $derived(service !== null && chatOwner !== null && service.view(chatOwner).editable)
    const localOn = $derived(id !== null && readChatLore().some((candidate) => isLinkRow(candidate) && idOf(candidate) === id))

    function onLocal(event: Event & { currentTarget: HTMLInputElement }): void {
        const input = event.currentTarget
        let ok = false
        if (input.checked) {
            ok = activateInChat(token).ok
        } else if (service && chatOwner !== null && id !== null) {
            ok = noted(service.objEdit(chatOwner, loreUnlink(id, displayNameOf(entry)).build))
            closeStep()
        }
        // The switch reads live state again: a refused or unchanged step leaves it where the lorebooks say.
        if (!ok) input.checked = localOn
    }

    const parentName = $derived.by(() => {
        if (!link || id === null) return null
        const parent = readParent().find((candidate) => !isLinkRow(candidate) && idOf(candidate) === id)
        return parent === undefined ? null : (displayNameOf(parent) ?? language.sidebarUi.unnamedLore)
    })

    const optionCount = $derived(
        (selective ? 1 : 0) + (useRegex ? 1 : 0) + (caseSensitive ? 1 : 0) + (text(entry?.secondkey) !== '' ? 1 : 0) +
        (insertOrder !== 100 ? 1 : 0) + (probability !== null && probability.kind !== 'none' ? 1 : 0) + (legacy !== null ? 1 : 0) +
        (container !== null ? 1 : 0) + (localOn ? 1 : 0),
    )
    let detailsOpened = $state(false)
    const detailsOpen = $derived(detailsOpened || optionCount > 0)

    const inputClass = 'min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor'
    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
    const rowClass = 'flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-darkborderc p-2'
    const noteClass = 'text-sm text-textcolor2'
</script>

{#if entry !== null}
    <section data-part="studio-lore-form" class="mx-auto flex w-full max-w-3xl flex-col gap-3" aria-busy={editable ? undefined : 'true'}>
        {#if link}
            <h3 data-part="studio-lore-form-title" class="break-words font-bold">{displayNameOf(entry) ?? language.sidebarUi.unnamedLore}</h3>
            <p data-part="studio-lore-linked" class="break-words">{parentName === null ? language.studioLoreLinkedMissing : language.studioLoreLinked(parentName)}</p>
            <p data-part="studio-lore-linked-note" class={noteClass}>{language.childLoreDesc}</p>
            <button type="button" data-part="studio-lore-form-delete" class="{buttonClass} self-start text-draculared" disabled={!editable} onclick={() => deleteOpen(token)}>{language.studioLoreDelete}</button>
        {:else}
            <h3 data-part="studio-lore-form-title" class="break-words font-bold">{name === '' ? language.sidebarUi.unnamedLore : name}</h3>
            <div class="flex flex-col gap-1">
                <label for="{uid}-name" class="font-bold">{language.name} <Help key="loreName" /></label>
                <input
                    id="{uid}-name"
                    type="text"
                    data-part="studio-lore-name"
                    class={inputClass}
                    readonly={!editable}
                    value={name}
                    bind:this={nameInput}
                    oninput={(event) => onTextInput(nameGate, event)}
                    oncompositionstart={() => nameGate.start()}
                    oncompositionend={(event) => nameGate.end(event.currentTarget.value)}
                    onblur={() => onTextBlur(nameGate)}
                />
            </div>
            <div class="flex flex-col gap-1">
                <label for="{uid}-keys" class="font-bold">{language.activationKeys} <Help key="loreActivationKey" /></label>
                <input
                    id="{uid}-keys"
                    type="text"
                    data-part="studio-lore-keys"
                    class={inputClass}
                    readonly={!editable}
                    disabled={alwaysActive}
                    aria-describedby="{uid}-keys-note"
                    value={text(entry.key)}
                    bind:this={keysInput}
                    oninput={(event) => onTextInput(keysGate, event)}
                    oncompositionstart={() => keysGate.start()}
                    oncompositionend={(event) => keysGate.end(event.currentTarget.value)}
                    onblur={() => onTextBlur(keysGate)}
                />
                <p id="{uid}-keys-note" class={noteClass}>{alwaysActive ? language.studioLoreKeysUnused : language.activationKeysInfo}</p>
            </div>
            <div class="flex flex-col gap-1">
                {#if content === null}
                    <p data-part="studio-lore-content-foreign" class={noteClass}>{language.prompt}</p>
                {:else}
                    <LongTextField
                        port={contentPort}
                        part="studio-lore-content"
                        label={language.prompt}
                        kind="lore"
                        mode="cbs"
                        {editable}
                        busy={!editable}
                        fieldClass="min-h-32 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
                        extraMarks={loreDecoratorNotes}
                        extraProblems={(value) => loreDecoratorProblems(value, copy)}
                        extraPicks={picks}
                        onresult={() => {}}
                    />
                {/if}
            </div>
            <label class="{rowClass} cursor-pointer">
                <span class="font-bold">{language.alwaysActive}</span>
                <input type="checkbox" role="switch" data-part="studio-lore-always-active" aria-label={language.alwaysActive} disabled={!editable} checked={alwaysActive} onchange={onAlwaysActive} />
            </label>
            <details data-part="studio-lore-more" class="flex flex-col gap-3 rounded-md border border-darkborderc p-3" open={detailsOpen} ontoggle={(event) => { detailsOpened = event.currentTarget.open }}>
                <summary class="min-h-11 cursor-pointer font-bold">{language.studioLoreMoreOptions(optionCount)}</summary>
                <div class="flex flex-col gap-3">
                    {#if selective || text(entry.secondkey) !== ''}
                        <div class="flex flex-col gap-1">
                            <label for="{uid}-second" class="font-bold">{language.SecondaryKeys}</label>
                            <input
                                id="{uid}-second"
                                type="text"
                                data-part="studio-lore-secondary"
                                class={inputClass}
                                readonly={!editable}
                                disabled={!selective}
                                value={text(entry.secondkey)}
                                bind:this={secondInput}
                                oninput={(event) => onTextInput(secondGate, event)}
                                oncompositionstart={() => secondGate.start()}
                                oncompositionend={(event) => secondGate.end(event.currentTarget.value)}
                                onblur={() => onTextBlur(secondGate)}
                            />
                            {#if !selective}<p class={noteClass}>{language.studioLoreSecondaryUnused}</p>{/if}
                        </div>
                    {/if}
                    <label class="{rowClass} cursor-pointer">
                        <span class="font-bold">{language.selective} <Help key="loreSelective" /></span>
                        <input type="checkbox" role="switch" data-part="studio-lore-selective" aria-label={language.selective} disabled={!editable || useRegex} checked={selective} onchange={(event) => onFlag('selective', event)} />
                    </label>
                    {#if useRegex}<p class={noteClass}>{language.studioLoreSelectiveRegex}</p>{/if}
                    <label class="{rowClass} cursor-pointer">
                        <span class="font-bold">{language.useRegexLorebook} <Help key="useRegexLorebook" /></span>
                        <input type="checkbox" role="switch" data-part="studio-lore-regex" aria-label={language.useRegexLorebook} disabled={!editable || alwaysActive} checked={useRegex} onchange={(event) => onFlag('useRegex', event)} />
                    </label>
                    <label class="{rowClass} cursor-pointer">
                        <span class="font-bold">{language.caseSensitive} <Help key="caseSensitiveLorebook" /></span>
                        <input type="checkbox" role="switch" data-part="studio-lore-case-sensitive" aria-label={language.caseSensitive} disabled={!editable || alwaysActive} checked={caseSensitive} onchange={onCaseSensitive} />
                    </label>
                    {#if alwaysActive}<p class={noteClass}>{language.studioLoreOptionUnused}</p>{/if}
                    <div class="flex flex-col gap-1">
                        <label for="{uid}-order" class="font-bold">{language.insertOrder} <Help key="loreorder" /></label>
                        <input id="{uid}-order" type="number" min="0" max="1000" data-part="studio-lore-order" class={inputClass} readonly={!editable} value={insertOrder} oninput={onOrderInput} onchange={onOrderChange} />
                    </div>
                    <div class="flex flex-col gap-1">
                        <label for="{uid}-probability" class="font-bold">{language.activationProbability}</label>
                        <input
                            id="{uid}-probability"
                            type="number"
                            min="0"
                            max="100"
                            data-part="studio-lore-probability"
                            class={inputClass}
                            readonly={!editable}
                            disabled={!probabilityOpen}
                            placeholder={language.studioLoreProbabilityNone}
                            aria-describedby="{uid}-probability-hint"
                            value={probabilityShown}
                            oninput={onProbabilityInput}
                            onchange={onProbabilityChange}
                        />
                        <p id="{uid}-probability-hint" class={noteClass}>{language.studioLoreProbabilityHint}</p>
                        {#if probability?.kind === 'unreadable'}
                            <p data-part="studio-lore-probability-note" class={noteClass}>{language.studioLoreProbabilityUnreadable}</p>
                        {:else if probability?.kind === 'many'}
                            <p data-part="studio-lore-probability-note" class={noteClass}>{language.studioLoreProbabilityMany}</p>
                        {/if}
                        {#if keptNotice}
                            <p role="status" data-part="studio-lore-probability-kept" class={noteClass}>{language.studioLoreProbabilityKept}</p>
                        {/if}
                    </div>
                    {#if legacy !== null}
                        <div class="flex flex-col gap-1">
                            <label for="{uid}-legacy" class="font-bold">{language.studioLoreLegacyProbabilityLabel}</label>
                            <input id="{uid}-legacy" type="number" min="0" max="100" data-part="studio-lore-legacy" class={inputClass} readonly={!editable} value={legacy} oninput={onLegacyInput} onchange={onLegacyChange} />
                            <p class={noteClass}>{language.studioLoreLegacyProbability}</p>
                            {#if probability?.kind === 'one'}
                                <p data-part="studio-lore-legacy-note" class={noteClass}>{language.studioLoreLegacyDiffers(probability.value)}</p>
                            {:else if probability?.kind === 'none'}
                                <p data-part="studio-lore-legacy-note" class={noteClass}>{language.studioLoreLegacyNoLine}</p>
                            {/if}
                            {#if probability?.kind === 'none' && legacy !== 0 && editable}
                                <button type="button" data-part="studio-lore-legacy-move" class="{buttonClass} self-start" onclick={() => runForm(token, (t, hint) => loreMoveLegacyIntoLine(t, hint))}>{language.studioLoreLegacyMove}</button>
                            {/if}
                        </div>
                    {/if}
                    {#if showLocal}
                        <label class="{rowClass} cursor-pointer">
                            <span class="font-bold">{language.alwaysActiveInChat}</span>
                            <input type="checkbox" role="switch" data-part="studio-lore-local-active" aria-label={language.alwaysActiveInChat} disabled={!editable || !chatReady} checked={localOn} onchange={onLocal} />
                        </label>
                    {/if}
                    <div class="flex flex-col gap-1">
                        <label for="{uid}-folder" class="font-bold">{language.studioLoreFolder}</label>
                        <select id="{uid}-folder" data-part="studio-lore-folder-select" class={inputClass} disabled={!editable} value={container ?? ''} onchange={onFolder}>
                            {#each targets as target (target ?? '\u0000top')}
                                <option value={target ?? ''}>{target === null ? language.studioLoreTopLevel : folderNameOf(target)}</option>
                            {/each}
                            {#if container !== null && !targets.includes(container)}
                                <option value={container}>{language.studioLoreFolderMissing}</option>
                            {/if}
                        </select>
                    </div>
                    {#if id !== null}
                        <div class="flex flex-col gap-1">
                            <label for="{uid}-id" class="font-bold">{language.studioLoreEntryId}</label>
                            <div class="flex items-center gap-2">
                                <input id="{uid}-id" type="text" data-part="studio-lore-id" class={inputClass} readonly value={id} />
                                <button type="button" data-part="studio-lore-copy-id" class={buttonClass} onclick={() => { void copyId() }}>{copied ? language.copied : language.studioLoreCopyId}</button>
                            </div>
                            {#if duplicateId}
                                <p role="status" data-part="studio-lore-duplicate-id" class="text-sm text-draculared">{language.studioLoreDuplicateId}</p>
                                <button type="button" data-part="studio-lore-new-id" class="{buttonClass} self-start" disabled={!editable} onclick={giveNewId}>{language.studioLoreNewId}</button>
                                <p class={noteClass}>{language.studioLoreNewIdNote}</p>
                            {/if}
                        </div>
                    {/if}
                </div>
            </details>
            <div class="flex flex-wrap gap-2">
                <button type="button" data-part="studio-lore-test" class={buttonClass} onclick={() => selectStudioNode(combinedKeyOf('lore'), 'lore', null)}>{language.studioLoreTestTitle}</button>
                <button type="button" data-part="studio-lore-form-delete" class="{buttonClass} text-draculared" disabled={!editable} onclick={() => deleteOpen(token)}>{language.studioLoreDelete}</button>
            </div>
        {/if}
    </section>
{/if}
