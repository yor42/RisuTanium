<script lang="ts">
    // Test-only host for one real message body. The key matches the one Chat.svelte puts around ChatBody, so a
    // ReloadGUIPointer set remounts the body here exactly as it does in the chat.
    import ChatBody from 'src/lib/ChatScreens/ChatBody.svelte'
    import { ReloadChatPointer, ReloadGUIPointer } from 'src/ts/stores.svelte'

    let translated = $state(false)
    let translating = $state(false)
    let retranslate = $state(false)
</script>

{#key `${$ReloadGUIPointer}|${$ReloadChatPointer[0] ?? 0}`}
    <ChatBody
        character="char"
        idx={0}
        msgDisplay="FIRST"
        role="char"
        bind:translated
        bind:translating
        bind:retranslate
        modelShortName=""
    />
{/key}
