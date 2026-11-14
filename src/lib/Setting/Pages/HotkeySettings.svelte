<script lang="ts">
    import { language } from "src/lang";
    import { DBState } from "src/ts/stores.svelte";
    import { alertConfirm } from "src/ts/alert";
    import { afterFlush } from "src/ts/afterFlush";
    import { backCloseHandler, registerBackHandler } from "src/ts/backHandlers";
    import { inputOf } from "src/ts/gui/rootAttributes";
    import { postToast, postUndoToast } from "src/ts/toast/toastHost.svelte";
    import {
        chordCaps, chordInputOf, chordText, chordsEqual, hotkeyIsApple, readChord, reservedNote,
        type Chord, type Refusal,
    } from "src/ts/hotkeyChord";
    import {
        FIXED_ROWS, HOTKEY_GROUPS, applyPlan, duplicateGroups, findConflict, hotkeyUndoAction, isChanged,
        keyboardSignal, listedRows, pageReadOnly, planReset, planResetAll, planSet, planSwap, planUnbind,
        rowChord, type Conflict, type PlanStep,
    } from "src/ts/setting/hotkeyPage";

    let { apple = hotkeyIsApple() }: { apple?: boolean } = $props();

    interface Pending {
        action: string
        chord: Chord
        conflict: Conflict
    }

    let root: HTMLElement | undefined = $state();
    let recording: string | null = $state(null);
    let held = $state({ ctrl: false, alt: false, shift: false });
    let refusal: Refusal | null = $state(null);
    let pending: Pending | null = $state(null);
    let menuOpen: string | null = $state(null);
    let status = $state("");
    let keyboardSeen = $state(false);
    let width = $state(window.innerWidth);
    let finePointer = $state(inputOf(window) === "hover");
    // A Space press that committed or refused a chord must not also press the chord button on keyup.
    let swallowSpaceUp = false;

    const rows = $derived(DBState.db.hotkeys ?? []);
    const listed = $derived(listedRows(rows, { scrollToActiveChar: DBState.db.enableScrollToActiveChar !== false }));
    const duplicates = $derived(duplicateGroups(listed));
    const changedCount = $derived(listed.filter(isChanged).length);
    const readOnly = $derived(pageReadOnly({ width, finePointer, keyboardSeen }));
    const groups = $derived(HOTKEY_GROUPS
        .map((group) => ({ id: group.id, rows: listed.filter((row) => group.actions.includes(row.action)) }))
        .filter((group) => group.rows.length > 0));

    const groupTitles = {
        msg: () => language.settingsShellHkGroupMessages,
        nav: () => language.settingsShellHkGroupNavigation,
        tools: () => language.settingsShellHkGroupTools,
    };

    function labelOf(action: string): string {
        return (language.settingsShellHkActions as Record<string, string>)[action] ?? action;
    }

    function capsOf(chord: Chord): string[] {
        return chordCaps(chord, apple);
    }

    function textOf(chord: Chord): string {
        return chord.key ? chordText(capsOf(chord)) : language.settingsShellHkUnbound;
    }

    function refusalText(reason: Refusal): string {
        switch (reason) {
            case "bare": return language.settingsShellHkBare;
            case "navKey": return language.settingsShellHkNavKey;
            case "shiftOnly": return language.settingsShellHkShiftOnly;
            case "macCtrl": return language.settingsShellHkMacCtrl;
            case "super": return language.settingsShellHkSuper;
            case "altGr": return language.settingsShellHkAltGr;
            case "browser": return language.settingsShellHkBrowser;
            case "edit": return language.settingsShellHkEdit;
        }
    }

    function heldText(): string {
        const parts: string[] = [];
        if (held.ctrl) parts.push(apple ? "⌘" : "Ctrl");
        if (held.alt) parts.push(apple ? "⌥" : "Alt");
        if (held.shift) parts.push(apple ? "⇧" : "Shift");
        return parts.length > 0 ? parts.join("+") + "+…" : "";
    }

    const recordingLine = $derived(
        refusal ? refusalText(refusal) : (heldText() || language.settingsShellHkRecPrompt)
    );

    function conflictText(draft: Pending): string {
        if (draft.conflict.kind === "fixed") {
            return language.settingsShellHkFixed(textOf(draft.conflict.chord));
        }
        return language.settingsShellHkConflict(labelOf(draft.conflict.action));
    }

    function swapOutcomeText(draft: Pending): string {
        if (draft.conflict.kind !== "action") {
            return "";
        }
        return language.settingsShellHkSwapOutcome(labelOf(draft.conflict.action), textOf(draft.conflict.otherOld));
    }

    function stopRecording() {
        recording = null;
        refusal = null;
        held = { ctrl: false, alt: false, shift: false };
    }

    async function focusChord(action: string) {
        await afterFlush();
        root?.querySelector<HTMLElement>(`[data-hotkey-action="${action}"]`)?.focus();
    }

    function startRecording(action: string) {
        pending = null;
        menuOpen = null;
        stopRecording();
        recording = action;
        status = language.settingsShellHkRecPrompt;
    }

    function undoTexts() {
        return {
            undone: language.settingsShellHkUndone,
            refused: language.settingsShellHkUndoRefused,
            failed: language.settingsShellHkUndoFailed,
        };
    }

    function commit(plan: PlanStep[], text: string, focusAction: string) {
        if (plan.length === 0 || !applyPlan(rows, plan)) {
            return;
        }
        postUndoToast({
            text,
            actionLabel: language.uiCommon.undo,
            action: hotkeyUndoAction(() => DBState.db.hotkeys ?? [], plan, undoTexts()),
        });
        status = text;
        pending = null;
        menuOpen = null;
        stopRecording();
        focusChord(focusAction);
    }

    // A chord equal to the row's own one ends recording with no write. A used chord opens the conflict block.
    function attempt(action: string, chord: Chord) {
        const row = rows.find((candidate) => candidate.action === action);
        if (!row) {
            return;
        }
        if (chordsEqual(chord, rowChord(row))) {
            stopRecording();
            focusChord(action);
            return;
        }
        const conflict = findConflict(listed, action, chord);
        if (!conflict) {
            commit(planSet(row, chord), language.settingsShellHkSet, action);
            return;
        }
        stopRecording();
        menuOpen = null;
        pending = { action, chord, conflict };
        status = conflictText(pending);
    }

    function swapPending() {
        const draft = pending;
        if (!draft || draft.conflict.kind !== "action") {
            return;
        }
        const row = rows.find((candidate) => candidate.action === draft.action);
        const other = rows.find((candidate) => candidate.action === (draft.conflict as { action: string }).action);
        if (row && other) {
            commit(planSwap(row, other, draft.chord), language.settingsShellHkSwapped, draft.action);
        }
    }

    function cancelPending() {
        const action = pending?.action;
        pending = null;
        if (action) {
            focusChord(action);
        }
    }

    function onChordKeydown(e: KeyboardEvent, action: string) {
        if (recording !== action) {
            return;
        }
        const read = readChord(chordInputOf(e), { apple, action });
        if (read.kind === "leave") {
            stopRecording();
            return;
        }
        // The key belongs to recording: neither the global shortcuts nor Settings' Escape may see it.
        e.preventDefault();
        e.stopPropagation();
        if (e.key === " ") {
            swallowSpaceUp = true;
        }
        switch (read.kind) {
            case "cancel":
                stopRecording();
                status = "";
                focusChord(action);
                break;
            case "modifiers":
                refusal = null;
                held = { ctrl: read.ctrl, alt: read.alt, shift: read.shift };
                break;
            case "refused":
                held = { ctrl: false, alt: false, shift: false };
                refusal = read.reason;
                status = refusalText(read.reason);
                break;
            case "chord":
                attempt(action, read.chord);
                break;
        }
    }

    function onChordKeyup(e: KeyboardEvent) {
        if (e.key === " " && swallowSpaceUp) {
            swallowSpaceUp = false;
            e.preventDefault();
        }
    }

    function onChordClick(action: string) {
        if (recording === action) {
            stopRecording();
            return;
        }
        startRecording(action);
    }

    function unbind(action: string) {
        const row = rows.find((candidate) => candidate.action === action);
        if (row) {
            commit(planUnbind(row), language.settingsShellHkCleared, action);
        }
    }

    function resetOne(action: string) {
        const row = rows.find((candidate) => candidate.action === action);
        const base = row ? planReset(row)[0] : undefined;
        if (row && base) {
            attempt(action, base.after);
        }
    }

    async function resetAll() {
        const plan = planResetAll(listed);
        if (plan.length === 0) {
            postToast({ kind: "info", text: language.settingsShellHkResetNone });
            status = language.settingsShellHkResetNone;
            return;
        }
        const ok = await alertConfirm(language.settingsShellHkResetAllQ(plan.length) + "\n" + language.settingsShellHkResetAllBody);
        if (!ok) {
            return;
        }
        const fresh = planResetAll(listed);
        if (fresh.length > 0) {
            commit(fresh, language.settingsShellHkResetAllDone(fresh.length), "");
        }
    }

    function cancelInnermost() {
        if (menuOpen !== null) {
            menuOpen = null;
        } else if (pending !== null) {
            cancelPending();
        } else if (recording !== null) {
            const action = recording;
            stopRecording();
            focusChord(action);
        }
    }

    // Back cancels the innermost open thing: the menu, then the conflict, then recording. The effect reads no
    // reactive state; the callbacks read it when Back is pressed.
    $effect(() => registerBackHandler(backCloseHandler({
        isOpen: () => menuOpen !== null || pending !== null || recording !== null,
        snapshot: () => `${menuOpen}|${pending?.action}|${recording}`,
        close: cancelInnermost,
    })));

    // A read-only page has no draft: entering it drops recording, the conflict and the menu.
    $effect(() => {
        if (readOnly) {
            recording = null;
            pending = null;
            menuOpen = null;
        }
    });

    function onWindowKeydown(e: KeyboardEvent) {
        if (!keyboardSeen && keyboardSignal(e)) {
            keyboardSeen = true;
        }
    }

    function onWindowResize() {
        width = window.innerWidth;
        finePointer = inputOf(window) === "hover";
    }

    function onWindowBlur() {
        if (recording !== null) {
            stopRecording();
        }
    }
</script>

<svelte:window onkeydowncapture={onWindowKeydown} onresize={onWindowResize} onblur={onWindowBlur} />

<div class="flex flex-col gap-4 w-full" bind:this={root} data-part="settings-hotkey-page">
    <div role="status" class="sr-only" data-hotkey-status>{status}</div>

    {#if readOnly}
        <p class="text-textcolor2 text-sm" data-part="settings-hotkey-banner">{language.settingsShellHkPhone}</p>
    {:else}
        <div class="flex items-center gap-2 justify-end">
            <button
                class="text-sm text-textcolor2 hover:text-textcolor border border-darkborderc rounded-md px-2 py-1"
                data-hotkey-reset-all
                onclick={resetAll}
            >{language.settingsShellHkResetAll}</button>
        </div>
    {/if}

    {#if duplicates.count > 0}
        <p class="text-draculared text-sm" data-part="settings-hotkey-banner" data-hotkey-dup-banner>{language.settingsShellHkDupBanner(duplicates.count)}</p>
    {/if}

    {#each groups as group (group.id)}
        <section class="flex flex-col gap-1">
            <h3 class="text-textcolor font-semibold">{groupTitles[group.id]()}</h3>
            <ul class="flex flex-col">
                {#each group.rows as row (row.action)}
                    {@const chord = rowChord(row)}
                    {@const caps = capsOf(chord)}
                    {@const note = reservedNote(chord)}
                    {@const partners = duplicates.partners.get(row.action) ?? []}
                    <li class="flex flex-col py-1 border-b border-darkborderc" data-part="settings-hotkey-row" data-hotkey-row={row.action}>
                        <div class="flex items-center gap-2">
                            <span class="flex-1 text-textcolor flex items-center gap-2">
                                {labelOf(row.action)}
                                {#if isChanged(row)}
                                    <span class="size-2 rounded-full bg-selected border border-borderc" role="img" aria-label={language.settingsShellChangedFromDefault} title={language.settingsShellChangedFromDefault}></span>
                                {/if}
                            </span>
                            {#if readOnly}
                                <span class="flex gap-1 text-textcolor2" data-hotkey-caps>
                                    {#each caps as cap}<kbd class="rounded border border-darkborderc bg-darkbg px-1.5 text-sm">{cap}</kbd>{:else}<span class="text-sm">{language.settingsShellHkUnbound}</span>{/each}
                                </span>
                            {:else}
                                <button
                                    class="flex gap-1 items-center rounded-md px-1 py-0.5 border {recording === row.action ? 'border-selected' : 'border-transparent'}"
                                    data-part="settings-hotkey-chord"
                                    data-hotkey-action={row.action}
                                    aria-pressed={recording === row.action}
                                    aria-label={caps.length > 0
                                        ? language.settingsShellHkAria(labelOf(row.action), caps.join(" "))
                                        : language.settingsShellHkAriaNone(labelOf(row.action))}
                                    onclick={() => onChordClick(row.action)}
                                    onkeydown={(e) => onChordKeydown(e, row.action)}
                                    onkeyup={onChordKeyup}
                                    onblur={() => { if (recording === row.action) stopRecording(); }}
                                >
                                    {#each caps as cap}<kbd class="rounded border border-darkborderc bg-darkbg px-1.5 text-sm text-textcolor">{cap}</kbd>{:else}<span class="text-sm text-textcolor2">{language.settingsShellHkUnbound}</span>{/each}
                                </button>
                                <button
                                    class="text-textcolor2 hover:text-textcolor px-1"
                                    data-hotkey-menu={row.action}
                                    aria-expanded={menuOpen === row.action}
                                    aria-label={language.settingsShellHkMoreFor(labelOf(row.action))}
                                    onclick={() => { menuOpen = menuOpen === row.action ? null : row.action; }}
                                >⋯</button>
                            {/if}
                        </div>
                        {#if note}
                            <p class="text-xs text-textcolor2">{note === "browser" ? language.settingsShellHkNoteBrowser : language.settingsShellHkNoteEdit}</p>
                        {/if}
                        {#each partners as partner (partner)}
                            <p class="text-xs text-draculared" data-hotkey-also>{language.settingsShellHkAlso(labelOf(partner))}</p>
                        {/each}
                        {#if !readOnly}
                            {#if recording === row.action}
                                <p class="text-sm text-textcolor2" data-part="settings-hotkey-recording">{recordingLine}</p>
                            {/if}
                            {#if menuOpen === row.action}
                                <div class="flex gap-2 text-sm" data-hotkey-menu-list>
                                    <button class="text-textcolor hover:text-selected" data-hotkey-menu-rec onclick={() => { startRecording(row.action); focusChord(row.action); }}>{language.settingsShellHkMenuRec}</button>
                                    {#if isChanged(row)}
                                        <button class="text-textcolor hover:text-selected" data-hotkey-menu-reset onclick={() => { menuOpen = null; resetOne(row.action); }}>{language.settingsShellHkMenuReset}</button>
                                    {/if}
                                    {#if row.key}
                                        <button class="text-textcolor hover:text-selected" data-hotkey-menu-clear onclick={() => unbind(row.action)}>{language.settingsShellHkMenuClear}</button>
                                    {/if}
                                </div>
                            {/if}
                            {#if pending && pending.action === row.action}
                                <div class="flex flex-col gap-1 text-sm border border-draculared rounded-md p-2 mt-1" data-part="settings-hotkey-conflict">
                                    <span class="text-textcolor">{textOf(pending.chord)} · {conflictText(pending)}</span>
                                    {#if pending.conflict.kind === "action"}
                                        <span class="text-textcolor2">{swapOutcomeText(pending)}</span>
                                    {/if}
                                    <div class="flex gap-2">
                                        {#if pending.conflict.kind === "action"}
                                            <button class="text-textcolor hover:text-selected" data-part="settings-hotkey-conflict-action" data-hotkey-swap onclick={swapPending}>{language.settingsShellHkSwap}</button>
                                        {/if}
                                        <button class="text-textcolor hover:text-selected" data-part="settings-hotkey-conflict-action" data-hotkey-cancel onclick={cancelPending}>{language.cancel}</button>
                                    </div>
                                </div>
                            {/if}
                        {/if}
                    </li>
                {/each}
            </ul>
        </section>
    {/each}

    <section class="flex flex-col gap-1">
        <h3 class="text-textcolor font-semibold">{language.settingsShellHkGroupFixed}</h3>
        <ul class="flex flex-col">
            {#each FIXED_ROWS as fixed (fixed.action)}
                <li class="flex items-center gap-2 py-1 border-b border-darkborderc" data-part="settings-hotkey-row" data-hotkey-fixed={fixed.action}>
                    <span class="flex-1 text-textcolor">{labelOf(fixed.action)}</span>
                    <span class="flex gap-1 text-textcolor2">
                        {#each capsOf(fixed.chord) as cap}<kbd class="rounded border border-darkborderc bg-darkbg px-1.5 text-sm">{cap}</kbd>{/each}
                    </span>
                </li>
            {/each}
        </ul>
    </section>
</div>
