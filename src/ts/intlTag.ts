// Maps the app's UI language codes (the strings `changeLanguage` in
// `src/lang/index.ts` takes) to a BCP-47 tag the runtime's `Intl` accepts.
// Pure and Svelte-free so both `src/lang` and the date helpers can share it.

// `src/lang/index.ts`'s app language codes are mostly valid BCP-47 tags
// already ('ko', 'de', 'vi', 'zh-Hant', 'es', 'ja'). 'cn' is the one exception --
// it means Simplified Chinese in this codebase (see `changeLanguage`'s
// `languageChinese` branch) but is not itself a valid `Intl` locale tag, so
// it maps to 'zh-Hans' here.
const LANGUAGE_TO_INTL_TAG: Record<string, string> = {
    cn: 'zh-Hans',
}

// Verifies the mapped/passed-through tag is one `Intl.RelativeTimeFormat`
// actually supports before using it, falling back to 'en' otherwise -- both
// for a code this module has never heard of and for a structurally invalid
// tag, which `supportedLocalesOf` throws a `RangeError` on rather than
// returning an empty list for (verified against the runtime this project
// ships on).
export function resolveIntlTag(uiLanguage: string): string {
    const mapped = LANGUAGE_TO_INTL_TAG[uiLanguage] ?? uiLanguage
    if (!mapped) {
        return 'en'
    }
    try {
        return Intl.RelativeTimeFormat.supportedLocalesOf([mapped]).length > 0 ? mapped : 'en'
    } catch {
        return 'en'
    }
}
