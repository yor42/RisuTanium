<script lang="ts">
    import { language } from 'src/lang'
    import { greetingKey, greetingPeriod, msUntilNextPeriod } from './homeGreeting'

    // The clock is re-read at each period boundary and whenever the page becomes visible again, so
    // a landing left open across a boundary or a suspended tab never shows a stale period. There is
    // one pending timeout at a time and no interval.
    let now = $state(new Date())
    const period = $derived(greetingPeriod(now))

    $effect(() => {
        const timer = setTimeout(() => {
            now = new Date()
        }, msUntilNextPeriod(now))
        return () => clearTimeout(timer)
    })

    $effect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                now = new Date()
            }
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => document.removeEventListener('visibilitychange', onVisible)
    })
</script>

<header data-part="home-greeting" class="home-greeting w-full text-left">
    <p data-part="home-eyebrow" class="home-greeting-eyebrow">{language.settingsShellModesNameRp}</p>
    <h1 class="home-greeting-title">{language[greetingKey(period)]}</h1>
</header>

<style>
    .home-greeting {
        margin-top: 0.5rem;
    }

    .home-greeting-eyebrow {
        margin: 0;
        color: var(--home-ink-2);
        font-size: var(--home-text-sm);
        letter-spacing: var(--home-tracking-eyebrow);
        text-transform: var(--home-eyebrow-transform);
        line-height: var(--home-leading-body);
    }

    .home-greeting-title {
        margin: 0;
        color: var(--home-ink);
        font-size: var(--home-h1-size);
        font-weight: var(--home-weight-strong);
        letter-spacing: var(--home-tracking-h1);
        line-height: var(--home-leading-tight);
    }
</style>
