import { resolveIntlTag } from './intlTag'

// The app language as an Intl tag. Every formatter getter below reads it, so a caller that runs in a
// reactive context (a template expression, `$derived`, `$effect`) re-runs when the language changes.
const app = $state({ tag: 'en' })

// One formatter per language and option set, built lazily and reused. The caches are bounded by the
// number of languages times the number of distinct option sets the app uses.
const dateFormats = new Map<string, Intl.DateTimeFormat>()
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>()

/** Sets the app language from a UI language code (the string `changeLanguage` takes) and returns its Intl tag. */
export function setAppLanguage(uiLanguage: string): string {
    app.tag = resolveIntlTag(uiLanguage)
    return app.tag
}

/** The Intl tag of the app language; reactive. */
export function appIntlTag(): string {
    return app.tag
}

/** The date formatter of the app language for `options`; reactive. Equal option objects share one formatter. */
export function appDateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${app.tag}|${JSON.stringify(options)}`
    let format = dateFormats.get(key)
    if (!format) {
        format = new Intl.DateTimeFormat(app.tag, options)
        dateFormats.set(key, format)
    }
    return format
}

/** The relative-time formatter of the app language for `options`; reactive. Equal option objects share one formatter. */
export function appRelativeFormat(options: Intl.RelativeTimeFormatOptions): Intl.RelativeTimeFormat {
    const key = `${app.tag}|${JSON.stringify(options)}`
    let format = relativeFormats.get(key)
    if (!format) {
        format = new Intl.RelativeTimeFormat(app.tag, options)
        relativeFormats.set(key, format)
    }
    return format
}
