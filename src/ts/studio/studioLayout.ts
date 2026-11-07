// Width classes of the Studio screen: three columns, tree drawer, list then detail.

export type StudioLayout = 'wide' | 'drawer' | 'stack'

export const STUDIO_WIDE_MIN = 1024
export const STUDIO_DRAWER_MIN = 600

export function studioLayoutOf(width: number): StudioLayout {
    if (width >= STUDIO_WIDE_MIN) return 'wide'
    if (width >= STUDIO_DRAWER_MIN) return 'drawer'
    return 'stack'
}
