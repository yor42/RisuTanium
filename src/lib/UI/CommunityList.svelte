<script lang="ts">
    import { GlobeIcon, MailIcon, Send } from "@lucide/svelte";
    import { getVersionString, openURL } from "src/ts/globalApi.svelte";
    import { language } from "src/lang";
    import SourceDisclosure, { UPSTREAM_TAG_CLASS, type Destination } from "./SourceDisclosure.svelte";

    // Discriminated on `kind` rather than a bare optional `href`, so a
    // disclosure entry can never also carry a direct-navigate href and vice
    // versa (MC-065: the root element differs, because a revealed list of
    // links cannot live inside a <button>). `upstream` marks an entry owned
    // by upstream, which keeps its label (MC-054). The disclosures read the
    // description; a link row never shows one (MC-2832).
    type RelatedLink =
      | {
          kind: 'link';
          title: string;
          href: string;
          icon: typeof MailIcon;
          upstream?: boolean;
        }
      | {
          kind: 'disclosure';
          title: string;
          description: string;
          destinations?: Destination[];
          icon?: typeof MailIcon;
        };

    // Fork entries first, matching the GitHub disclosure's own ordering:
    // this build's own address is the more likely destination for someone
    // looking at this build.
    const emailDestinations: Destination[] = [
      { label: language.homeSourceEmailForkLabel, href: "mailto:yoonch1022@naver.com", upstream: false },
      { label: language.homeSourceEmailUpstreamLabel, href: "mailto:support@risuai.net", upstream: true }
    ];

    const relatedLinks: RelatedLink[] = [
      {
        kind: 'link',
        title: language.homeLinkDiscordTitle,
        href: "https://discord.gg/Exy3NrqkGm",
        icon: Send,
        // Upstream's own Discord, with no fork equivalent (`MC-054`).
        upstream: true
      },
      {
        kind: 'link',
        title: language.homeLinkWebsiteTitle,
        href: "https://risuai.net",
        icon: GlobeIcon,
        // Upstream's own website, with no fork equivalent (`MC-054`).
        upstream: true
      },
      {
        // Four fixed GitHub destinations rendered by SourceDisclosure.svelte.
        kind: 'disclosure',
        title: language.homeLinkGithubTitle,
        description: language.homeLinkGithubDescription
      },
      {
        // A disclosure too: there are two addresses (fork and upstream), and
        // a plain link can only carry one href.
        kind: 'disclosure',
        title: language.homeLinkEmailTitle,
        description: language.homeLinkEmailDescription,
        destinations: emailDestinations,
        icon: MailIcon
      }
    ];

    const headingId = `home-community-heading-${Math.random().toString(36).slice(2)}`;
</script>

<section data-part="home-community" aria-labelledby={headingId} class="@container flex w-full flex-col gap-2">
  <h3 id={headingId} class="text-[length:var(--home-text-sm)] font-normal text-[color:var(--home-ink-2)]">{language.homeCommunityHeading}</h3>
  <ul class="flex flex-col @min-[36rem]:grid @min-[36rem]:grid-cols-2 @min-[36rem]:items-start @min-[36rem]:gap-x-[var(--home-space-6)]">
    {#each relatedLinks as relatedLink}
      <li>
        {#if relatedLink.kind === 'disclosure'}
          <SourceDisclosure
            title={relatedLink.title}
            description={relatedLink.description}
            destinations={relatedLink.destinations}
            icon={relatedLink.icon}
          />
        {:else}
          {@const Icon = relatedLink.icon}
          <!--
            No aria-label: it would replace the content name. The sr-only
            marker joins the title instead, so the name is title then
            "(upstream)"; the visible tag is aria-hidden.
          -->
          <button
            type="button"
            class="risu-focus-ring flex min-h-11 w-full flex-wrap items-start gap-x-3 gap-y-1 rounded-[var(--home-radius-3)] px-2 py-2.5 text-left text-textcolor hover:bg-darkbutton"
            onclick={() => {
              openURL(relatedLink.href)
            }}
          >
            <span aria-hidden="true" data-part="home-row-icon" class="mt-1 shrink-0 text-[color:var(--home-ink-2)]">
              <Icon class="h-4 w-4" strokeWidth={1.5} />
            </span>
            <span data-part="home-community-title" class="max-w-full flex-1 text-[length:var(--home-text-md)] [overflow-wrap:break-word]">{relatedLink.title}</span>
            {#if relatedLink.upstream}
              <span aria-hidden="true" data-part="home-upstream-tag" class={UPSTREAM_TAG_CLASS}>{language.homeSourceUpstreamLabel}</span>
              <span class="sr-only">({language.homeSourceUpstreamLabel})</span>
            {/if}
          </button>
        {/if}
      </li>
    {/each}
  </ul>
  <p data-part="home-version" class="px-2 text-[length:var(--home-text-sm)] text-[color:var(--home-ink-2)]">{language.homeVersion} {getVersionString()}</p>
</section>
