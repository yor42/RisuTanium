<script lang="ts">
    import { onMount, tick, untrack } from "svelte";
    import { language } from "src/lang";
    import { alertConfirm } from "src/ts/alert";
    import { LLMProvider } from "src/ts/model/types";
    import { DBState } from "src/ts/stores.svelte";
    import Button from "src/lib/UI/GUI/Button.svelte";
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import { retentionCutoff, retentionMonthsOf, USAGE_RETENTION_CHOICES, withoutClearedUsage, type UsageClearScope } from "src/ts/usage/usageLedger";
    import { applyUsageRetention } from "src/ts/usage/usageRetention";
    import type { CostResult, PriceOverride, UsageRetentionMonths } from "src/ts/usage/usageTypes";
    import { buildUsageView, formatUsd, purposeLabelKey, type ModelRow, type UsageViewContext } from "src/ts/usage/usageView";

    // A price is a non-negative plain decimal; the length cap keeps the exact cost arithmetic well inside its limits.
    const PRICE_RULE = /^\d{1,12}(\.\d{1,12})?$/;

    const PRICE_FIELDS = [
        { kind: "input", label: () => language.usageStats.priceInput },
        { kind: "output", label: () => language.usageStats.priceOutput },
        { kind: "cacheRead", label: () => language.usageStats.priceCacheRead },
        { kind: "cacheWrite", label: () => language.usageStats.priceCacheWrite },
    ] as const;

    // The model list is loaded when the page opens, not imported with it: Settings imports this page, and the list
    // pulls in most of the app. Prices are resolved from it, so the tables wait for it rather than show a wrong price first.
    const noCatalog: UsageViewContext["modelInfo"] = (id) => ({ id, internalID: id, provider: LLMProvider.AsIs });
    let modelInfo = $state<UsageViewContext["modelInfo"] | null>(null);
    onMount(() => {
        // A model list that cannot load leaves catalog lookups empty: the recorded counts still show, unpriced unless overridden.
        void import("src/ts/model/modellist").then((list) => {
            modelInfo = list.getModelInfo;
        }).catch(() => {
            modelInfo = noCatalog;
        });
    });

    // The catalog snapshots are rune cells, so a data load or refresh while the page is open recomputes the prices.
    const view = $derived(buildUsageView(DBState.db.statics, {
        overrides: DBState.db.usagePriceOverrides,
        customModels: DBState.db.customModels,
        modelInfo: modelInfo ?? noCatalog,
    }));
    const ready = $derived(modelInfo !== null);

    let picked = $state("");
    // The chosen month while it still exists, else the newest.
    const month = $derived(view.months.some((row) => row.month === picked) ? picked : (view.months[0]?.month ?? ""));
    const models = $derived(month === "" ? [] : view.modelsOf(month));
    const purposes = $derived(month === "" ? [] : view.purposesOf(month));
    const monthTotal = $derived(month === "" ? null : view.totalOf(month));
    const empty = $derived(view.months.length === 0 && !view.overflow.present);

    let editing = $state<string | null>(null);
    let invalid = $state(false);
    let fields = $state({ input: "", output: "", cacheRead: "", cacheWrite: "" });

    function number(value: number): string {
        return value.toLocaleString();
    }

    function openEditor(row: ModelRow): void {
        if (editing === row.modelKey) {
            editing = null;
            return;
        }
        fields = {
            input: row.override?.input ?? "",
            output: row.override?.output ?? "",
            cacheRead: row.override?.cacheRead ?? "",
            cacheWrite: row.override?.cacheWrite ?? "",
        };
        invalid = false;
        editing = row.modelKey;
        void tick().then(() => document.getElementById("usage-price-input")?.focus());
    }

    // The editor row is removed on save or clear, which would drop focus to the page; it returns to the row's button.
    function focusSetPrice(modelKey: string): void {
        void tick().then(() => {
            const row = [...document.querySelectorAll<HTMLElement>("tr[data-model]")].find((candidate) => candidate.dataset.model === modelKey);
            row?.querySelector("button")?.focus();
        });
    }

    function savePrice(modelKey: string): void {
        const entry: PriceOverride = {};
        let any = false;
        for (const { kind } of PRICE_FIELDS) {
            const text = fields[kind].trim();
            if (text === "") {
                continue;
            }
            if (!PRICE_RULE.test(text)) {
                invalid = true;
                return;
            }
            entry[kind] = text;
            any = true;
        }
        if (!any) {
            invalid = true;
            return;
        }
        DBState.db.usagePriceOverrides = Object.fromEntries([...Object.entries(DBState.db.usagePriceOverrides ?? {}), [modelKey, entry]]);
        invalid = false;
        editing = null;
        focusSetPrice(modelKey);
    }

    function clearPrice(modelKey: string): void {
        const rest = Object.entries(DBState.db.usagePriceOverrides ?? {}).filter(([key]) => key !== modelKey);
        if (rest.length === 0) {
            delete DBState.db.usagePriceOverrides;
        } else {
            DBState.db.usagePriceOverrides = Object.fromEntries(rest);
        }
        invalid = false;
        editing = null;
        focusSetPrice(modelKey);
    }

    // Retention. The select is bound to a local pick so a declined confirm can put the stored choice back on screen.
    const storedPick = $derived(String(retentionMonthsOf(DBState.db.usageRetentionMonths) ?? "off"));
    let retentionPick = $state(untrack(() => storedPick));
    // A change from outside (a peer fast-forward, an import) is shown; the pick in progress is not overwritten otherwise.
    $effect.pre(() => {
        const stored = storedPick;
        untrack(() => { retentionPick = stored; });
    });

    async function onRetentionChange(): Promise<void> {
        const next = retentionPick;
        const previous = storedPick;
        if (next === previous) {
            return;
        }
        if (next === "off") {
            delete DBState.db.usageRetentionMonths;
            return;
        }
        const months = Number(next) as UsageRetentionMonths;
        const now = new Date();
        // The dry run: how many months this period would delete now. Overflow is never a month, so it never asks.
        const { months: count } = withoutClearedUsage(DBState.db.statics, { kind: "before", month: retentionCutoff(now, months) });
        if (count > 0 && !(await alertConfirm(language.usageStats.retentionConfirm(months, count)))) {
            retentionPick = previous;
            return;
        }
        DBState.db.usageRetentionMonths = months;
        applyUsageRetention(DBState.db, now, { force: true });
    }

    // Clear. The oldest month is not offered: nothing lies before it.
    let clearPick = $state("all");
    let cleared = $state(false);
    const clearableMonths = $derived(view.months.slice(0, -1));
    const clearChoice = $derived(clearableMonths.some((row) => "before:" + row.month === clearPick) ? clearPick : "all");

    async function onClear(): Promise<void> {
        const choice = clearChoice;
        const scope: UsageClearScope = choice === "all" ? { kind: "all" } : { kind: "before", month: choice.slice("before:".length) };
        const message = scope.kind === "all" ? language.usageStats.clearConfirmAll : language.usageStats.clearConfirmBefore(scope.month);
        if (!(await alertConfirm(message))) {
            return;
        }
        const { statics, removed } = withoutClearedUsage(DBState.db.statics, scope);
        if (removed > 0) {
            DBState.db.statics = statics;
        }
        clearPick = "all";
        cleared = true;
        // A clear-all removes the clear controls, which would drop focus to the page; it moves to the notice.
        void tick().then(() => document.querySelector<HTMLElement>('[data-part="usage-cleared"]')?.focus());
    }
</script>

{#snippet costCell(cost: CostResult)}
    {#if cost.status === "unpriced"}
        <span class="text-textcolor2">{language.usageStats.unpriced}</span>
    {:else}
        {formatUsd(cost.usd ?? "0")}
        {#if cost.status === "partial"}
            <span class="text-textcolor2">({language.usageStats.partlyUnpriced})</span>
        {/if}
    {/if}
{/snippet}

{#snippet estimatedTag(estimated: boolean)}
    {#if estimated}
        <span class="text-textcolor2 text-xs ml-1">({language.usageStats.estimated})</span>
    {/if}
{/snippet}

<h2 class="mb-2 text-2xl font-bold mt-2">{language.usageStats.title}</h2>

{#if !ready}
    <!-- Prices are not resolved yet; nothing is shown rather than a price from the wrong source. -->
{:else if empty}
    <p class="text-textcolor2 mb-4" data-part="usage-empty">{language.usageStats.empty}</p>
{:else}
    <div class="overflow-x-auto mb-6">
        <table class="w-full text-sm text-left" data-part="usage-months">
            <caption class="sr-only">{language.usageStats.title}</caption>
            <thead>
                <tr class="border-b border-darkborderc text-textcolor2">
                    <th scope="col" class="py-1 pr-2 font-medium">{language.usageStats.month}</th>
                    <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.requests}</th>
                    <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.inputTokens}</th>
                    <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.outputTokens}</th>
                    <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.cacheReads}</th>
                    <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.cacheWrites}</th>
                    <th scope="col" class="py-1 pl-2 font-medium text-right">{language.usageStats.cost}</th>
                </tr>
            </thead>
            <tbody>
                {#each view.months as row (row.month)}
                    <tr class="border-b border-darkborderc/50">
                        <th scope="row" class="py-1 pr-2 font-normal">{row.month}{@render estimatedTag(row.estimated)}</th>
                        <td class="py-1 px-2 text-right tabular-nums">{number(row.requests)}</td>
                        <td class="py-1 px-2 text-right tabular-nums">{number(row.input)}</td>
                        <td class="py-1 px-2 text-right tabular-nums">{number(row.output)}</td>
                        <td class="py-1 px-2 text-right tabular-nums">{number(row.cacheRead)}</td>
                        <td class="py-1 px-2 text-right tabular-nums">{number(row.cacheWrite)}</td>
                        <td class="py-1 pl-2 text-right tabular-nums">{@render costCell(row.cost)}</td>
                    </tr>
                {/each}
                {#if view.overflow.present}
                    <tr class="border-b border-darkborderc/50" data-part="usage-overflow">
                        <th scope="row" class="py-1 pr-2 font-normal">{language.usageStats.overflow}{@render estimatedTag(view.overflow.estimated)}</th>
                        <td class="py-1 px-2 text-right tabular-nums">{number(view.overflow.requests)}</td>
                        <td class="py-1 px-2 text-right tabular-nums">{number(view.overflow.input)}</td>
                        <td class="py-1 px-2 text-right tabular-nums">{number(view.overflow.output)}</td>
                        <td class="py-1 px-2 text-right tabular-nums">{number(view.overflow.cacheRead)}</td>
                        <td class="py-1 px-2 text-right tabular-nums">{number(view.overflow.cacheWrite)}</td>
                        <td class="py-1 pl-2 text-right text-textcolor2">-</td>
                    </tr>
                {/if}
            </tbody>
        </table>
    </div>

    {#if month !== ""}
        <label class="flex flex-col gap-1 mb-4 max-w-xs">
            <span class="text-textcolor2">{language.usageStats.monthPick}</span>
            <SelectInput value={month} onchange={(event) => { picked = event.currentTarget.value }}>
                {#each view.months as row (row.month)}
                    <option value={row.month}>{row.month}</option>
                {/each}
            </SelectInput>
        </label>

        <div class="overflow-x-auto mb-6">
            <table class="w-full text-sm text-left" data-part="usage-models">
                <caption class="text-left text-lg font-semibold mb-1">{language.usageStats.byModel}</caption>
                <thead>
                    <tr class="border-b border-darkborderc text-textcolor2">
                        <th scope="col" class="py-1 pr-2 font-medium">{language.usageStats.model}</th>
                        <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.requests}</th>
                        <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.inputTokens}</th>
                        <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.outputTokens}</th>
                        <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.cacheReads}</th>
                        <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.cacheWrites}</th>
                        <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.cost}</th>
                        <th scope="col" class="py-1 pl-2 font-medium"><span class="sr-only">{language.usageStats.setPrice}</span></th>
                    </tr>
                </thead>
                <tbody>
                    {#each models as row (row.modelKey)}
                        <tr class="border-b border-darkborderc/50" data-model={row.modelKey}>
                            <th scope="row" class="py-1 pr-2 font-normal break-all">
                                {row.label}{@render estimatedTag(row.estimated)}
                                {#if row.priceSource === "override"}
                                    <span class="text-textcolor2 text-xs ml-1">({language.usageStats.yourPrice})</span>
                                {/if}
                            </th>
                            <td class="py-1 px-2 text-right tabular-nums">{number(row.requests)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(row.input)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(row.output)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(row.cacheRead)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(row.cacheWrite)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{@render costCell(row.cost)}</td>
                            <td class="py-1 pl-2 text-right">
                                <Button size="sm" styled="outlined" ariaPressed={editing === row.modelKey} onclick={() => openEditor(row)}>
                                    {language.usageStats.setPrice}<span class="sr-only"> {row.label}</span>
                                </Button>
                            </td>
                        </tr>
                        {#if editing === row.modelKey}
                            <tr class="border-b border-darkborderc/50" data-part="usage-price-editor">
                                <td colspan="8" class="py-2">
                                    <div class="flex flex-col gap-2 max-w-md">
                                        {#each PRICE_FIELDS as field (field.kind)}
                                            <div class="flex flex-col gap-1">
                                                <label id={"usage-price-" + field.kind + "-label"} for={"usage-price-" + field.kind} class="text-textcolor2">{field.label()}</label>
                                                <TextInput id={"usage-price-" + field.kind} labelId={"usage-price-" + field.kind + "-label"} size="sm" bind:value={fields[field.kind]} />
                                            </div>
                                        {/each}
                                        {#if invalid}
                                            <p class="text-draculared" role="alert" data-part="usage-price-invalid">{language.usageStats.priceInvalid}</p>
                                        {/if}
                                        <div class="flex gap-2 flex-wrap">
                                            <Button size="sm" onclick={() => savePrice(row.modelKey)}>{language.usageStats.priceSave}</Button>
                                            {#if row.priceSource === "override"}
                                                <Button size="sm" styled="outlined" onclick={() => clearPrice(row.modelKey)}>{language.usageStats.priceClear}</Button>
                                            {/if}
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        {/if}
                    {/each}
                </tbody>
                {#if monthTotal !== null}
                    <tfoot>
                        <tr>
                            <th scope="row" class="py-1 pr-2 text-left">{language.usageStats.total}</th>
                            <td class="py-1 px-2 text-right tabular-nums">{number(monthTotal.requests)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(monthTotal.input)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(monthTotal.output)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(monthTotal.cacheRead)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(monthTotal.cacheWrite)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{@render costCell(monthTotal.cost)}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                {/if}
            </table>
        </div>

        <div class="overflow-x-auto mb-6">
            <table class="w-full text-sm text-left" data-part="usage-purposes">
                <caption class="text-left text-lg font-semibold mb-1">{language.usageStats.byPurpose}</caption>
                <thead>
                    <tr class="border-b border-darkborderc text-textcolor2">
                        <th scope="col" class="py-1 pr-2 font-medium">{language.usageStats.purpose}</th>
                        <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.requests}</th>
                        <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.inputTokens}</th>
                        <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.outputTokens}</th>
                        <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.cacheReads}</th>
                        <th scope="col" class="py-1 px-2 font-medium text-right">{language.usageStats.cacheWrites}</th>
                        <th scope="col" class="py-1 pl-2 font-medium text-right">{language.usageStats.cost}</th>
                    </tr>
                </thead>
                <tbody>
                    {#each purposes as row (row.purpose)}
                        <tr class="border-b border-darkborderc/50" data-purpose={row.purpose}>
                            <th scope="row" class="py-1 pr-2 font-normal">{language.usageStats[purposeLabelKey(row.purpose)]}{@render estimatedTag(row.estimated)}</th>
                            <td class="py-1 px-2 text-right tabular-nums">{number(row.requests)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(row.input)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(row.output)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(row.cacheRead)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(row.cacheWrite)}</td>
                            <td class="py-1 pl-2 text-right tabular-nums">{@render costCell(row.cost)}</td>
                        </tr>
                    {/each}
                </tbody>
                {#if monthTotal !== null}
                    <tfoot>
                        <tr>
                            <th scope="row" class="py-1 pr-2 text-left">{language.usageStats.total}</th>
                            <td class="py-1 px-2 text-right tabular-nums">{number(monthTotal.requests)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(monthTotal.input)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(monthTotal.output)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(monthTotal.cacheRead)}</td>
                            <td class="py-1 px-2 text-right tabular-nums">{number(monthTotal.cacheWrite)}</td>
                            <td class="py-1 pl-2 text-right tabular-nums">{@render costCell(monthTotal.cost)}</td>
                        </tr>
                    </tfoot>
                {/if}
            </table>
        </div>
    {/if}
{/if}

{#if ready}
    <section aria-labelledby="usage-manage-title" data-part="usage-manage" class="mb-6">
        <h3 id="usage-manage-title" class="text-lg font-semibold mb-1">{language.usageStats.manageTitle}</h3>

        <label class="flex flex-col gap-1 mb-2 max-w-xs">
            <span class="text-textcolor2">{language.usageStats.retentionLabel}</span>
            <SelectInput bind:value={retentionPick} describedBy="usage-retention-help" onchange={onRetentionChange}>
                <option value="off">{language.usageStats.retentionOff}</option>
                {#each USAGE_RETENTION_CHOICES as choice (choice)}
                    <option value={String(choice)}>{language.usageStats.retentionMonths(choice)}</option>
                {/each}
            </SelectInput>
        </label>
        <p id="usage-retention-help" class="text-textcolor2 text-sm mb-4">{language.usageStats.retentionHelp}</p>

        {#if !empty}
            <div data-part="usage-clear" class="flex flex-col gap-2 mb-2 max-w-xs">
                <label class="flex flex-col gap-1">
                    <span class="text-textcolor2">{language.usageStats.clearScopeLabel}</span>
                    <SelectInput bind:value={clearPick} onchange={() => { cleared = false }}>
                        <option value="all">{language.usageStats.clearScopeAll}</option>
                        {#each clearableMonths as row (row.month)}
                            <option value={"before:" + row.month}>{language.usageStats.clearScopeBefore(row.month)}</option>
                        {/each}
                    </SelectInput>
                </label>
                <div>
                    <Button styled="danger" onclick={() => { void onClear() }}>{language.usageStats.clearButton}</Button>
                </div>
            </div>
        {/if}
        {#if cleared}
            <p class="text-textcolor2 text-sm" role="status" tabindex="-1" data-part="usage-cleared">{language.usageStats.clearedNotice}</p>
        {/if}
    </section>
{/if}

<p class="text-textcolor2 text-sm mb-2" data-part="usage-note">{language.usageStats.note}</p>
<p class="text-textcolor2 text-sm mb-2" data-part="usage-price-source">{language.usageStats.priceSource}</p>
