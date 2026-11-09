<script lang="ts">
	import { requestSuggestionData } from "src/ts/process/suggestionRequest";
    import type { OpenAIChat } from "../../ts/process/index.svelte";
    import { isBusyIn } from "../../ts/process/chatOrigin";
    import { type character, type Message, type groupChat } from "../../ts/storage/database.svelte";
	import { DBState } from 'src/ts/stores.svelte';
    import { isComposerLocked } from "src/ts/process/composerActions.svelte";
    import { selectedCharID } from "../../ts/stores.svelte";
    import { isTauri } from 'src/ts/platform';
    import { translate } from "src/ts/translator/translator";
    import { CopyIcon, LanguagesIcon, RefreshCcwIcon } from "@lucide/svelte";
    import { alertConfirm } from "src/ts/alert";
    import { language } from "src/lang";
    import { getUserName, replacePlaceholders } from "../../ts/util";
    import { onDestroy, untrack } from 'svelte';
    import { chatSurface } from "./chatSurface.svelte";
    import { ParseMarkdown } from "src/ts/parser/parser.svelte";
    import {defaultAutoSuggestPrompt} from "../../ts/storage/defaultPrompts.js";

    interface Props {
        send: () => any;
        messageInput: (string:string) => any;
    }

    let { send, messageInput }: Props = $props();
    let suggestMessages:string[] = $state(DBState.db.characters[$selectedCharID]?.chats[DBState.db.characters[$selectedCharID].chatPage]?.suggestMessages)
    let suggestMessagesTranslated:string[] = $state()
    let toggleTranslate:boolean = $state(DBState.db.autoTranslate)
    let progress:boolean = $state();
    let progressChatPage=-1;
    let abortController:AbortController|undefined;
    let suggestionRequestId = 0;
    let chatPage:number = $state()

    const cancelSuggestionRequest = () => {
        suggestionRequestId += 1
        progress = false
        abortController?.abort()
        abortController = undefined
    }

    // Only a reply or preview in the shown chat holds the suggestions; a reply written in another chat
    // neither clears them nor asks for new ones.
    const shownTarget = $derived.by(() => {
        const shownChar = DBState.db.characters?.[$selectedCharID]
        const shownChatId = shownChar?.chats?.[shownChar.chatPage]?.id
        return shownChar?.chaId && shownChatId ? { chaId: shownChar.chaId, chatId: shownChatId } : null
    })
    const shownKey = $derived(shownTarget ? `${shownTarget.chaId}\u0000${shownTarget.chatId}` : null)
    const shownBusy = $derived(shownTarget ? isBusyIn(shownTarget) : false)

    const updateSuggestions = () => {
        if($selectedCharID > -1) {
            if(shownBusy){
                suggestMessages = []
                return
            }
            if(progressChatPage > 0 && progressChatPage != chatPage){
                cancelSuggestionRequest()
            }
            let currentChar = DBState.db.characters[$selectedCharID];
            suggestMessages = currentChar?.chats[currentChar.chatPage].suggestMessages
        }
    }

    const requestSuggestions = () => {
        if(shownBusy || $selectedCharID <= -1 || (suggestMessages && suggestMessages.length > 0) || progress){
            return
        }

        const requestCharId = $selectedCharID
        const currentChar:character|groupChat = DBState.db.characters[requestCharId];
        if(!currentChar){
            return
        }
        const requestChatPage = currentChar.chatPage
        const currentChat = currentChar.chats[requestChatPage]
        if(!currentChat){
            return
        }
        let messages:Message[] = []
        
        messages = [...messages, ...currentChat.message];
        let lastMessages:Message[] = messages.slice(Math.max(messages.length - 10, 0));
        if(lastMessages.length === 0)
            return
        const prompt = DBState.db.autoSuggestPrompt && DBState.db.autoSuggestPrompt.length > 0 ? DBState.db.autoSuggestPrompt : defaultAutoSuggestPrompt
        let promptbody:OpenAIChat[] = [
            {
                role:'system',
                content: replacePlaceholders(prompt, currentChar.name)
            },
            {
                role: 'user', 
                content: lastMessages.map(b=>(b.role==='char'? currentChar.name : getUserName())+":"+b.data).reduce((a,b)=>a+','+b)
            }
        ]

        if(DBState.db.subModel === "textgen_webui" || DBState.db.subModel === 'mancer' || DBState.db.subModel.startsWith('local_')){
            promptbody = [
                {
                    role: 'system',
                    content: replacePlaceholders(DBState.db.autoSuggestPrompt, currentChar.name)
                },
                ...lastMessages.map(({ role, data }) => ({
                    role: role === "user" ? "user" as const : "assistant" as const,
                    content: data,
                })),
            ]
        }

        const requestId = suggestionRequestId + 1
        const requestController = isTauri ? undefined : new AbortController()
        suggestionRequestId = requestId
        abortController = requestController
        progress = true
        progressChatPage = requestChatPage

        // A tree switch changes the last message; the suggestions of the departed path must not land.
        const requestTailId = currentChat.message[currentChat.message.length - 1]?.chatId
        const tailIdOf = () => {
            const messages = DBState.db.characters[requestCharId]?.chats[requestChatPage]?.message
            return messages?.[messages.length - 1]?.chatId
        }
        const isStillCurrentRequest = () => suggestionRequestId === requestId && $selectedCharID === requestCharId && DBState.db.characters[requestCharId]?.chatPage === requestChatPage && tailIdOf() === requestTailId

        requestSuggestionData(promptbody, currentChar as character, requestController?.signal ?? null, isStillCurrentRequest).then(rq2=>{
            if(!rq2){
                return
            }
            const stillCurrentRequest = isStillCurrentRequest()
            const currentTargetChat = DBState.db.characters[requestCharId]?.chats[requestChatPage]
            if(rq2.type !== 'fail' && rq2.type !== 'streaming' && rq2.type !== 'multiline' && progress && stillCurrentRequest && currentTargetChat){
                var suggestMessagesNew = rq2.result.split('\n').filter(msg => msg.startsWith('-')).map(msg => msg.replace('-','').trim())
                currentTargetChat.suggestMessages = suggestMessagesNew
                suggestMessages = suggestMessagesNew
            }
        }).catch(error => {
            if(!requestController?.signal.aborted && suggestionRequestId === requestId){
                console.error(error)
            }
        }).finally(() => {
            if(suggestionRequestId === requestId){
                progress = false
                abortController = undefined
            }
        })
    }

    // Asked once at mount, then only when the shown chat's own busy state falls.
    requestSuggestions()
    let seenKey = untrack(() => shownKey)
    let seenBusy = untrack(() => shownBusy)
    $effect(() => {
        const key = shownKey
        const busy = shownBusy
        const sameChat = key === seenKey
        const wasBusy = seenBusy
        seenKey = key
        seenBusy = busy
        // A change of the shown chat requests nothing: `updateSuggestions` takes that chat's own list.
        if(!sameChat || wasBusy === busy){
            return
        }
        untrack(() => {
            if(busy){
                cancelSuggestionRequest()
                suggestMessages = []
                return
            }
            requestSuggestions()
        })
    })

    const translateSuggest = async (toggle, messages)=>{
        if(toggle && messages && messages.length > 0) {
            suggestMessagesTranslated = []
            for(let i = 0; i < suggestMessages.length; i++){
                let msg = suggestMessages[i]
                let translated = await translate(msg, false)
                suggestMessagesTranslated[i] = translated
            }
        }
    }

    onDestroy(() => {
        cancelSuggestionRequest()
    })

    $effect.pre(() => {
        $selectedCharID
        //FIXME add selectedChatPage for optimize render
        chatPage = DBState.db.characters[$selectedCharID].chatPage
        updateSuggestions()
    });
    $effect.pre(() => {translateSuggest(toggleTranslate, suggestMessages)});

    // The toggle is seeded from the setting at mount; a setting changed during a Settings visit
    // is taken up on release, while a toggle the user set by hand otherwise stays.
    let autoTranslateAtHide = DBState.db.autoTranslate
    let wasSurfaceHidden = false
    $effect(() => {
        if(chatSurface.hidden){
            wasSurfaceHidden = true
            autoTranslateAtHide = untrack(() => DBState.db.autoTranslate)
            return
        }
        if(!wasSurfaceHidden){
            return
        }
        wasSurfaceHidden = false
        untrack(() => {
            if(DBState.db.autoTranslate !== autoTranslateAtHide){
                toggleTranslate = DBState.db.autoTranslate
            }
        })
    });
</script>

<div class="ml-4 flex flex-wrap">
    {#if progress}
        <div class="flex bg-textcolor2 p-2 rounded-lg items-center">
            <div class="loadmove mx-2"></div>
            <div>{language.creatingSuggestions}</div>
        </div>        
    {:else if !shownBusy}
        {#if DBState.db.translator !== ''}
            <div class="flex mr-2 mb-2">
                <button class={"bg-textcolor2 hover:bg-darkbutton font-bold py-2 px-4 rounded-sm " + (toggleTranslate ? 'text-green-500' : 'text-textcolor')}
                    onclick={() => {
                        toggleTranslate = !toggleTranslate
                    }}
                >
                    <LanguagesIcon/>
                </button>
            </div>    
        {/if}
        

        <div class="flex mr-2 mb-2">
            <button class="bg-textcolor2 hover:bg-darkbutton font-bold py-2 px-4 rounded-sm text-textcolor"
                onclick={() => {
                    alertConfirm(language.askReRollAutoSuggestions).then((result) => {
                        if(result) {
                            suggestMessages = []
                            cancelSuggestionRequest()
                            requestSuggestions()
                        }
                    })
                }}
            >
                <RefreshCcwIcon/>
            </button>
        </div>
        {#each suggestMessages??[] as suggest, i}
            <div class="flex mr-2 mb-2">
                <button class="bg-textcolor2 hover:bg-darkbutton text-textcolor font-bold py-2 px-4 rounded-sm" onclick={() => {
                    if(isComposerLocked()){
                        return
                    }
                    suggestMessages = []
                    messageInput(suggest)
                    send()
                }}>
                {#await ParseMarkdown((DBState.db.translator !== '' && toggleTranslate && suggestMessagesTranslated && suggestMessagesTranslated.length > 0) ? suggestMessagesTranslated[i]??suggest : suggest) then md}
                    {@html md}
                {/await}
                </button>
                <button class="bg-textcolor2 hover:bg-darkbutton text-textcolor font-bold py-2 px-4 rounded-sm ml-1" onclick={() => {
                    if(isComposerLocked()){
                        return
                    }
                    messageInput(suggest)
                }}>
                    <CopyIcon/>
                </button>
            </div>
        {/each}
        
    {/if}
</div>

<style>
    
    .loadmove {
        animation: spin 1s linear infinite;
        border-radius: 50%;
        border: 0.4rem solid rgba(0,0,0,0);
        width: 1rem;
        height: 1rem;
        border-top: 0.4rem solid var(--risu-theme-textcolor);
        border-left: 0.4rem solid var(--risu-theme-textcolor);
    }

    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
</style>

