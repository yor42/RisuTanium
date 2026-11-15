<script lang="ts">
    // Renders a message body the way the shell does, so tests can drive Svelte's own DOM updates under marked text.
    // `html` mode is ChatBody's `{#if}...{:else}{@html}` shape; `text` mode is a comment message's text node directly in the body.
    let { mode, html = '', text = '', pending = false }: { mode: 'html' | 'text', html?: string, text?: string, pending?: boolean } = $props()
</script>

<div data-part="chat-message-container">
    <div data-part="chat-message-body">{#if mode === 'text'}{text}{:else if pending}<span role="status">...</span>{:else}{@html html}{/if}</div>
</div>
