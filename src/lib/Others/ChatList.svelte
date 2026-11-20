<script>
    import { language } from "../../lang";

    import { DBState } from 'src/ts/stores.svelte';
    import { ReloadGUIPointer, selectedCharID } from "../../ts/stores.svelte";
    import { DownloadIcon, SquarePenIcon, HardDriveUploadIcon, PlusIcon, TrashIcon, XIcon } from "@lucide/svelte";
    import { exportChat, importChat, createNewChat, removeChatConfirmed } from "../../ts/characters";
    import TextInput from "../UI/GUI/TextInput.svelte";
    import { changeChatTo } from "src/ts/globalApi.svelte";

    let editMode = $state(false)
    /** @type {{close?: any}} */
    let { close = () => {} } = $props();
</script>

<div class="absolute w-full h-full z-40 bg-black/50 flex justify-center items-center">
    <div class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl w-72 max-h-full overflow-y-auto">
        <div class="flex items-center text-textcolor mb-4">
            <h2 class="mt-0 mb-0">{language.chatList}</h2>
            <div class="grow flex justify-end">
                <button class="text-textcolor2 hover:text-textcolor mr-2 cursor-pointer items-center" aria-label={language.uiCommon.close} onclick={close}>
                    <XIcon size={24} aria-hidden="true"/>
                </button>
            </div>
        </div>
        {#each DBState.db.characters[$selectedCharID].chats as chat, i}
            <button onclick={() => {
                if(!editMode){
                    changeChatTo(i)
                    close()
                }
            }} class="flex items-center text-textcolor border-t-1 border-solid border-0 border-darkborderc p-2 cursor-pointer" class:bg-selected={i === DBState.db.characters[$selectedCharID].chatPage}>
                {#if editMode}
                    <TextInput label={language.chatNameField} bind:value={DBState.db.characters[$selectedCharID].chats[i].name} padding={false}/>
                {:else}
                    <span>{chat.name}</span>
                {/if}
                <div class="grow flex justify-end">
                    <div class="text-textcolor2 hover:text-textcolor mr-2 cursor-pointer" role="button" tabindex="0" aria-label={language.chatShellExportChat} onclick={async (e) => {
                        e.stopPropagation()
                        exportChat(i)
                    }} onkeydown={(e) => {
                        if (e.target !== e.currentTarget) return
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            e.currentTarget.click()
                        }
                    }}>
                        <DownloadIcon size={18} aria-hidden="true"/>
                    </div>
                    <div class="text-textcolor2 hover:text-draculared cursor-pointer" role="button" tabindex="0" aria-label={language.chatShellDeleteChat} onclick={async (e) => {
                        e.stopPropagation()
                        await removeChatConfirmed(DBState.db.characters[$selectedCharID], chat)
                    }} onkeydown={(e) => {
                        if (e.target !== e.currentTarget) return
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            e.currentTarget.click()
                        }
                    }}>
                        <TrashIcon size={18} aria-hidden="true"/>
                    </div>
                </div>
            </button>
        {/each}
        <div class="flex mt-2 items-center">
            <button class="text-textcolor2 hover:text-textcolor cursor-pointer mr-1" aria-label={language.newChat} onclick={() => {
                const cha = DBState.db.characters[$selectedCharID]
                const newIndex = createNewChat(cha)
                changeChatTo(newIndex)
                close()
            }}>
                <PlusIcon aria-hidden="true"/>
            </button>
            <button class="text-textcolor2 hover:text-textcolor mr-2 cursor-pointer" aria-label={language.chatShellImportChat} onclick={() => {
                importChat()
            }}>
                <HardDriveUploadIcon size={18} aria-hidden="true"/>
            </button>
            <button class="text-textcolor2 hover:text-textcolor cursor-pointer" aria-label={language.othersUi.editMode} aria-pressed={editMode} onclick={() => {
                editMode = !editMode
            }}>
                <SquarePenIcon size={18} aria-hidden="true"/>
            </button>
        </div>
    </div>
</div>

<style>
    .break-any{
        word-break: normal;
        overflow-wrap: anywhere;
    }
</style>