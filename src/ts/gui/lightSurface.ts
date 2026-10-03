// Fixed text colours for the surfaces that are light under every colour scheme
// (the mobilechat bubble and the cardboard card). Each value is at least 4.5:1
// on gray-100 and gray-200. Only the --FontColor* variables read by the
// .chattext rules are redefined, so theme-paired classes keep their pairing.
export const LIGHT_SURFACE_FONT_COLORS = {
    '--FontColorStandard': '#1f2937',
    '--FontColorBold': '#111827',
    '--FontColorItalic': '#374151',
    '--FontColorItalicBold': '#111827',
    '--FontColorQuote1': '#1e40af',
    '--FontColorQuote2': '#7c2d12',
} as const

export const LIGHT_SURFACE_STYLE = Object.entries(LIGHT_SURFACE_FONT_COLORS)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
