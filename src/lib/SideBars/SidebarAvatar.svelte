<script lang="ts">
  import { warnOnReject } from "src/ts/warnOnReject";
  import { language } from "src/lang";
  import { useCharImageLookups } from "src/ts/media/charImageLookups";

  interface Props {
    rounded: boolean;
    // Required unless `loc` is given. "slot" selects the folder form, whose background is `backgroundimg`
    // or the image at `backgroundLoc`.
    src?: string|Promise<string>;
    // Image location looked up by this component; its read is held until the location changes or the avatar is destroyed.
    loc?: string;
    backgroundLoc?: string;
    size?: string;
    bordered?: boolean;
    color?: string;
    backgroundimg?: string|Promise<string>;
    children?: import('svelte').Snippet;
    chaId?: string;
  }

  let {
    rounded,
    src,
    loc,
    backgroundLoc,
    size = "22",
    bordered = false,
    color = '',
    backgroundimg = '',
    children,
    chaId
  }: Props = $props();

  const lookups = useCharImageLookups();

  // Deriveds, so the `{#await}` heads re-run only when the location or hide-all-images changes. A lookup called
  // straight in a head would re-run (and ask again) on unrelated database writes. Each is read only by the head of
  // the branch that shows it, so a lookup starts only for the branch that is rendered.
  const backgroundInput = $derived(backgroundLoc !== undefined ? lookups.getIf('bg', !!backgroundLoc, backgroundLoc, 'thumb', '') : backgroundimg);
  const srcInput = $derived(loc !== undefined ? lookups.getIf('src', !!loc, loc, 'thumb', '/none.webp') : src);
</script>

<span class="flex shrink-0 items-center justify-center avatar"
      class:border = {bordered}
      class:border-selected={bordered}
      class:rounded-md={bordered}
      data-char-id={chaId}
>
  {#if src || loc !== undefined}
    {#if src === "slot"}
      {#await warnOnReject('SidebarAvatar: backgroundimg rejected', backgroundInput)}
      <div
        class="bg-skin-border sidebar-avatar rounded-md bg-top flex items-center justify-center {
          color === 'red' ? 'bg-red-700/50' :
          color === 'yellow' ? 'bg-yellow-700/50' :
          color === 'green' ? 'bg-green-700/50' :
          color === 'blue' ? 'bg-blue-700/50' :
          color === 'indigo' ? 'bg-indigo-700/50' :
          color === 'purple' ? 'bg-purple-700/50' :
          color === 'pink' ? 'bg-pink-700/50' :
          'bg-darkbg/50'
        }"
        style:width={size + "px"}
        style:height={size + "px"}
        style:minWidth={size + "px"}
        class:rounded-md={!rounded} class:rounded-full={rounded}
      ></div>
      {:then resolvedBgImg}
      <div
        class="bg-skin-border sidebar-avatar rounded-md bg-top flex items-center justify-center {
          color === 'red' ? 'bg-red-700/50' :
          color === 'yellow' ? 'bg-yellow-700/50' :
          color === 'green' ? 'bg-green-700/50' :
          color === 'blue' ? 'bg-blue-700/50' :
          color === 'indigo' ? 'bg-indigo-700/50' :
          color === 'purple' ? 'bg-purple-700/50' :
          color === 'pink' ? 'bg-pink-700/50' :
          'bg-darkbg/50'
        }"
        style:width={size + "px"}
        style:height={size + "px"}
        style:minWidth={size + "px"}
        style:background-image={resolvedBgImg ? `url('${resolvedBgImg}')` : undefined}
        style:background-size={resolvedBgImg ? "cover" : undefined}
        style:background-position={resolvedBgImg ? "center" : undefined}
        class:rounded-md={!rounded} class:rounded-full={rounded}
      >
      {#if !resolvedBgImg}
        {@render children?.()}
      {/if}
        </div>
      {:catch}
      <div
        class="bg-skin-border sidebar-avatar rounded-md bg-top flex items-center justify-center {
          color === 'red' ? 'bg-red-700/50' :
          color === 'yellow' ? 'bg-yellow-700/50' :
          color === 'green' ? 'bg-green-700/50' :
          color === 'blue' ? 'bg-blue-700/50' :
          color === 'indigo' ? 'bg-indigo-700/50' :
          color === 'purple' ? 'bg-purple-700/50' :
          color === 'pink' ? 'bg-pink-700/50' :
          'bg-darkbg/50'
        }"
        style:width={size + "px"}
        style:height={size + "px"}
        style:minWidth={size + "px"}
        class:rounded-md={!rounded} class:rounded-full={rounded}
      >
        {@render children?.()}
      </div>
    {/await}
    {:else}
      {#await warnOnReject('SidebarAvatar: src rejected', srcInput)}
        <div
          class="bg-skin-border sidebar-avatar rounded-md bg-top"
          style:width={size + "px"}
          style:height={size + "px"}
          style:minWidth={size + "px"}
          class:rounded-md={!rounded} class:rounded-full={rounded} 
></div>
      {:then img}
        <img
          src={img}
          class="bg-skin-border sidebar-avatar rounded-md object-cover object-top"
          style:width={size + "px"}
          style:height={size + "px"}
          style:minWidth={size + "px"}
          class:rounded-md={!rounded} class:rounded-full={rounded} 
          alt={language.sidebarUi.avatarAlt}
          draggable="false"
        />
      {:catch}
        <div
          class="bg-skin-border sidebar-avatar rounded-md bg-top"
          style:width={size + "px"}
          style:height={size + "px"}
          style:minWidth={size + "px"}
          class:rounded-md={!rounded} class:rounded-full={rounded}
></div>
      {/await}
    {/if}
  {:else}
    <div
      class="bg-skin-border sidebar-avatar rounded-md bg-top"
      style:width={size + "px"}
      style:height={size + "px"}
      style:minWidth={size + "px"}
      class:rounded-md={!rounded} class:rounded-full={rounded} 
></div>
  {/if}
</span>
