<script lang="ts">
    import { customSideBarConfigDialogStore, DBState } from "src/ts/stores.svelte";
    import Button from "../UI/GUI/Button.svelte";
    import { language } from "src/lang";
    import { getFullSettingsData, getLabel } from "src/ts/setting/utils";
    import TextInput from "../UI/GUI/TextInput.svelte";
    import { backCloseHandler, registerBackHandler } from "src/ts/backHandlers";
    import { afterFlush } from "src/ts/afterFlush";
    import { fillLang } from "src/lang/fill";
    import { removeSidebarItem, sidebarItemUndoAction } from "src/ts/setting/sidebarItemUndo";
    import { postUndoToast } from "src/ts/toast/toastHost.svelte";


    let configPage: "list" | "add" | "addSettingsSubmenu" = $state("list");
    let search = $state("");

    function closeDialog() {
        customSideBarConfigDialogStore.open = false;
    }

    // Removes the row, offers Undo, then moves focus to a neighbouring Delete (same index, else the
    // previous one) or to Add Item, so focus never drops to the page when the focused row goes away.
    async function deleteItem(id: string) {
        const removed = removeSidebarItem(id);
        if (removed === null) {
            return;
        }
        postUndoToast({
            text: fillLang(language.othersUi.sidebarItemRemoved, { name: removed.item.label }),
            actionLabel: language.uiCommon.undo,
            action: sidebarItemUndoAction(removed.item, removed.index),
        });
        await afterFlush();
        const deletes = document.querySelectorAll<HTMLElement>("[data-sidebar-item-delete]");
        const target =
            deletes[removed.index] ??
            deletes[removed.index - 1] ??
            document.querySelector<HTMLElement>("[data-sidebar-item-add] button");
        target?.focus();
    }

    // Back does what the Close button and the backdrop do, whatever page is showing. The effect
    // reads no reactive state.
    $effect(() => registerBackHandler(backCloseHandler({
        isOpen: () => customSideBarConfigDialogStore.open,
        snapshot: () => customSideBarConfigDialogStore.open,
        close: closeDialog,
    })));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
    onclick={closeDialog}
>
    <div
        class="bg-darkbg p-4 rounded max-h-full overflow-auto flex flex-col gap-2"
        onclick={(e) => e.stopPropagation()}
    >
        {#if configPage === "list"}
            <div
                class="m-4 border-darkborderc p-2 border rounded-sm flex flex-col w-xl max-w-full"
            >
                {#if DBState.db.customSidebarItems.length === 0}
                    <div class="text-textcolor2">
                        {language.othersUi.noCustomSidebarItems}
                    </div>
                {/if}

                {#each DBState.db.customSidebarItems as item}
                    <div
                        class="border-darkborderc p-2 border rounded-sm flex items-start"
                    >
                        <div class="flex-1">{item.label}</div>

                        <button
                            class="ml-2"
                            data-sidebar-item-delete
                            onclick={() => deleteItem(item.id)}
                        >
                            {language.uiCommon.delete}
                        </button>
                    </div>
                {/each}
            </div>

            <div style="display: contents" data-sidebar-item-add>
                <Button
                    onclick={() => {
                        configPage = "add";
                    }}
                >
                    {language.othersUi.addItem}
                </Button>
            </div>

            <Button onclick={closeDialog}>
                {language.uiCommon.close}
            </Button>
        {/if}

        {#if configPage === "add"}
            <Button
                onclick={() => {
                    DBState.db.customSidebarItems.push({
                        id: crypto.randomUUID(),
                        type: "model",
                        subType: "none",
                        label: language.model,
                    });
                    configPage = "list";
                }}
            >
                {language.model}
            </Button>

            <Button
                onclick={() => {
                    DBState.db.customSidebarItems.push({
                        id: crypto.randomUUID(),
                        type: "preset",
                        subType: "none",
                        label: language.presets,
                    });
                    configPage = "list";
                }}
            >
                {language.presets}
            </Button>

            <Button
                onclick={() => {
                    DBState.db.customSidebarItems.push({
                        id: crypto.randomUUID(),
                        type: "loadout",
                        subType: "none",
                        label: language.loadouts,
                    });
                    configPage = "list";
                }}
            >
                {language.loadouts}
            </Button>

            <Button
                onclick={() => {
                    DBState.db.customSidebarItems.push({
                        id: crypto.randomUUID(),
                        type: "persona",
                        subType: "none",
                        label: language.persona,
                    });
                    configPage = "list";
                }}
            >
                {language.persona}
            </Button>

            <Button
                onclick={() => {
                    search = "";
                    configPage = "addSettingsSubmenu";
                }}
            >
                {language.settings}
            </Button>

            <Button
                onclick={() => {
                    configPage = "list";
                }}
            >
                {language.othersUi.backToList}
            </Button>
        {/if}

        {#if configPage === "addSettingsSubmenu"}
            <div class="flex flex-col gap-2">
                <TextInput bind:value={search} placeholder={language.settingsPage.searchEllipsis} />
                <Button
                    onclick={() => {
                        configPage = "add";
                    }}
                >
                    {language.settingsPage.back}
                </Button>

                {#each getFullSettingsData(search) as type}
                    <Button
                        onclick={() => {
                            DBState.db.customSidebarItems.push({
                                id: crypto.randomUUID(),
                                type: "setting",
                                subType: type.id,
                                label: getLabel(type) || type.id,
                            });
                            configPage = "list";
                        }}
                    >
                        {getLabel(type) || type.id}
                    </Button>
                {/each}
            </div>
        {/if}
    </div>
</div>
