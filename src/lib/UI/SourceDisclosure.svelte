<script module lang="ts">
    export interface Destination {
        label: string;
        href: string;
        upstream: boolean;
    }

    // The hairline upstream tag, defined once so the plain link rows and the
    // destinations inside a disclosure draw it the same way. It never shrinks:
    // a title wraps at its spaces before the tag is squeezed.
    export const UPSTREAM_TAG_CLASS =
        "shrink-0 rounded-[var(--home-radius-1)] border border-darkborderc px-1.5 text-[length:var(--home-text-xs)] text-[color:var(--home-ink-2)]";
</script>

<script lang="ts">
    import { ChevronDownIcon, FolderCodeIcon } from "@lucide/svelte";
    import { fade, slide } from "svelte/transition";
    import { openURL } from "src/ts/globalApi.svelte";
    import { language } from "src/lang";
    import { keyEventBlocked } from "src/ts/keyEventBlocked";

    // A plain disclosure, not an ARIA menu: the revealed region is an
    // ordinary list of links that navigate away, not a set of in-page
    // commands, so this carries no role="menu"/role="menuitem"/
    // aria-haspopup. `aria-expanded` and `aria-controls` on the trigger are
    // the only ARIA this control needs; they are the first uses of either
    // attribute in src/lib, so there is no existing pattern here to copy.
    //
    // Four separately-observable close paths, none of which is left
    // implicit:
    //   - Escape (window-scoped, so it fires no matter which item holds
    //     focus) closes and returns focus to the trigger.
    //   - Activating an item closes, then calls openURL.
    //   - Clicking outside the disclosure closes, without moving focus.
    //   - Focus leaving the disclosure (via `focusout` with a `relatedTarget`
    //     containment check, not `blur`) closes. A bare `blur` would fight
    //     Escape's own focus-return, since moving focus back to the trigger
    //     blurs whatever the user was last focused on.

    interface Props {
        title: string;
        // Shown only inside the revealed region, above the destinations.
        description: string;
        // Defaults to the GitHub repo icon below: the only other caller
        // (the Email disclosure in CommunityList.svelte) passes its own icon
        // rather than this component guessing from the destinations.
        icon?: typeof FolderCodeIcon;
        // Defaults to the four GitHub destinations below. The Email
        // disclosure in CommunityList.svelte passes its own two mailto
        // destinations instead.
        destinations?: Destination[];
    }

    // Fork entries first: this build's own source is the more likely
    // destination for someone looking at this build. Constants, not derived
    // from git remotes -- a built app has no git to read them from.
    const defaultDestinations: Destination[] = [
        { label: language.homeSourceRepoLabel, href: "https://github.com/yor42/RisuTanium", upstream: false },
        { label: language.homeSourceIssuesLabel, href: "https://github.com/yor42/RisuTanium/issues", upstream: false },
        { label: language.homeSourceRepoLabel, href: "https://github.com/kwaroran/RisuAI", upstream: true },
        { label: language.homeSourceIssuesLabel, href: "https://github.com/kwaroran/RisuAI/issues", upstream: true }
    ];

    let {
        title,
        description,
        icon: Icon = FolderCodeIcon,
        destinations = defaultDestinations
    }: Props = $props();

    // Unique per instance, so aria-controls never risks colliding between
    // the GitHub and Email disclosures that both mount this component.
    const listId = `source-disclosure-list-${Math.random().toString(36).slice(2)}`;

    let open = $state(false);
    let cardEl: HTMLDivElement | undefined = $state();
    let triggerEl: HTMLButtonElement | undefined = $state();

    // Respects prefers-reduced-motion for the open/close transitions below:
    // nothing else in this codebase reads that preference yet, but
    // animating a height change (the slide on the revealed list) is exactly
    // the motion it exists to suppress. The open/close behaviour itself
    // (aria-expanded, the list mounting/unmounting) is unaffected -- only
    // the transition duration collapses to zero.
    let reduceMotion = $state(false);

    $effect(() => {
        const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
        reduceMotion = mql.matches;
        function handleChange(event: MediaQueryListEvent) {
            reduceMotion = event.matches;
        }
        mql.addEventListener("change", handleChange);
        return () => mql.removeEventListener("change", handleChange);
    });

    // Svelte's CSS-based transitions (slide and fade both are) build their
    // keyframes through the Web Animations API, calling the element's own
    // `animate()`. That method is absent from the DOM implementation the
    // component tests below run under (happy-dom has no
    // `Element.prototype.animate`), and Svelte does not feature-detect it
    // itself -- a zero duration is the one input that makes the transition
    // engine skip that call entirely and finish synchronously instead, so
    // it is reused here for both reduced motion and missing WAAPI support.
    const supportsAnimate = typeof Element !== "undefined" && typeof Element.prototype.animate === "function";

    const transitionDuration = $derived(reduceMotion || !supportsAnimate ? 0 : 300);

    function close() {
        open = false;
    }

    function closeAndReturnFocus() {
        open = false;
        triggerEl?.focus();
    }

    function toggle() {
        open = !open;
    }

    // The items are <a href> elements, not bare buttons: that gives native
    // keyboard activation, lets a user right-click to copy the repository
    // or email address, and (together with rel="noopener noreferrer" below)
    // keeps the real href in place for a middle-click, which fires auxclick
    // rather than click and so never reaches this handler. target="_blank"
    // is part of that same fallback, but only for http(s) hrefs -- a
    // mailto: href never gets it (see the anchor below), because opening it
    // in a new tab leaves that tab on a permanent blank page once the OS
    // mail client takes over. That fallback path is the only thing the
    // anchor's own target attribute affects here: this handler always
    // intercepts a plain left-click first, calling openURL below instead of
    // letting the browser navigate. On the web, openURL hands a mailto:
    // href to the OS from the current tab, leaving no stray blank tab.
    function activate(event: MouseEvent, href: string) {
        event.preventDefault();
        close();
        openURL(href);
    }

    function handleWindowKeydown(event: KeyboardEvent) {
        if (keyEventBlocked(event)) {
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            closeAndReturnFocus();
        }
    }

    // With two instances of this component mounted at once (the Source &
    // Issues and Email disclosures on the home screen), a click on one
    // instance's trigger is an outside click from the other instance's own
    // handler here, so opening one closes the other. That single-open
    // behaviour is emergent, not shared state, but it is intended and tests
    // depend on it.
    function handleDocumentClick(event: MouseEvent) {
        const target = event.target as Node | null;
        if (cardEl && target && !cardEl.contains(target)) {
            close();
        }
    }

    function handleFocusOut(event: FocusEvent) {
        const next = event.relatedTarget as Node | null;
        if (!cardEl) {
            return;
        }
        if (!next || !cardEl.contains(next)) {
            close();
        }
    }

    $effect(() => {
        if (!open) {
            return;
        }
        window.addEventListener("keydown", handleWindowKeydown);
        document.addEventListener("click", handleDocumentClick);
        return () => {
            window.removeEventListener("keydown", handleWindowKeydown);
            document.removeEventListener("click", handleDocumentClick);
        };
    });
</script>

<!--
  The root keeps the trigger as its direct child, so the trigger's parent
  scopes one disclosure's revealed region. The trigger is the row: it draws
  its own focus ring, and its title follows the shared row rule (no min-w-0,
  break-word, flex-1) so a short title is never split beside the chevron.
-->
<div bind:this={cardEl} onfocusout={handleFocusOut}>
    <button
        class="risu-focus-ring flex min-h-11 w-full flex-wrap items-start gap-x-3 gap-y-1 rounded-[var(--home-radius-3)] px-2 py-2.5 text-left text-textcolor hover:bg-darkbutton"
        aria-expanded={open}
        aria-controls={listId}
        bind:this={triggerEl}
        onclick={toggle}
    >
        <span aria-hidden="true" data-part="home-row-icon" class="mt-1 shrink-0 text-[color:var(--home-ink-2)]">
            <Icon class="h-4 w-4" strokeWidth={1.5} />
        </span>
        <span data-part="home-community-title" class="max-w-full flex-1 text-[length:var(--home-text-md)] [overflow-wrap:break-word]">{title}</span>
        <!--
          The visual echo of aria-expanded, not a substitute for it: the
          chevron is aria-hidden and rotates on open, but the state itself is
          carried to assistive tech by aria-expanded above.
        -->
        <span
            aria-hidden="true"
            class={"mt-1 shrink-0 text-[color:var(--home-ink-2)] transition-transform duration-300" + (open ? " rotate-180" : "")}
        >
            <ChevronDownIcon class="h-4 w-4" strokeWidth={1.5} />
        </span>
    </button>
    {#if open}
        <!--
          slide on this wrapper animates the height, so the revealed region
          visibly expands downward on open and collapses on close; fade on
          the <ul> inside fades the revealed links in and out. Both collapse
          to a zero-length transition when the user has asked for reduced
          motion, but the open/close state above is unaffected either way --
          only the animation is skipped.
        -->
        <div transition:slide={{ duration: transitionDuration }}>
            <p class="px-2 pb-1 pl-9 text-[length:var(--home-text-sm)] text-[color:var(--home-ink-2)]">{description}</p>
            <ul
                id={listId}
                class="flex flex-col gap-1 pl-7"
                transition:fade={{ duration: transitionDuration }}
            >
                {#each destinations as destination}
                    <li>
                        <a
                            href={destination.href}
                            target={destination.href.startsWith("mailto:") ? undefined : "_blank"}
                            rel="noopener noreferrer"
                            class="risu-focus-ring flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--home-radius-3)] px-2 text-[length:var(--home-text-md)] text-textcolor transition-colors duration-200 hover:bg-darkbutton"
                            aria-label={destination.upstream ? `${destination.label} (${language.homeSourceUpstreamLabel})` : undefined}
                            onclick={(event) => activate(event, destination.href)}
                        >
                            <span class="max-w-full flex-1 [overflow-wrap:break-word]">{destination.label}</span>
                            {#if destination.upstream}
                                <span aria-hidden="true" data-part="home-upstream-tag" class={UPSTREAM_TAG_CLASS}>
                                    {language.homeSourceUpstreamLabel}
                                </span>
                            {/if}
                        </a>
                    </li>
                {/each}
            </ul>
        </div>
    {/if}
</div>
