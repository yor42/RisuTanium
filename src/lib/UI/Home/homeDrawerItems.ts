import type { Component } from 'svelte'
import { HomeIcon, LayoutGridIcon, Settings, ShellIcon } from '@lucide/svelte'
import { language } from 'src/lang'
import { PlaygroundStore, additionalHamburgerMenu, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'
import { openHomeLibrary } from './homeView.svelte'

/**
 * One row of the phone drawer. `plugin` is set for a plugin-defined entry, which brings its own
 * icon; the others carry a lucide `icon`.
 */
export interface HomeDrawerItem {
    id: string
    label: string
    icon: Component | null
    plugin: { icon: string, iconType: 'html' | 'img' | 'none' } | null
    current: boolean
    run: () => void
}

/**
 * The drawer's rows, in order: Home (current: the drawer exists only on the landing), Characters,
 * Playground, the plugin entries, Settings. Stores are read when this runs, never at import, so a
 * suite that mocks only some store exports can still load the module. The writes mirror the
 * sidebar rail's handlers minus the rail's own local reset state.
 */
export function homeDrawerItems(): HomeDrawerItem[] {
    const items: HomeDrawerItem[] = [
        { id: 'home', label: language.home, icon: HomeIcon, plugin: null, current: true, run: () => {} },
        { id: 'characters', label: language.character, icon: LayoutGridIcon, plugin: null, current: false, run: openHomeLibrary },
        {
            id: 'playground',
            label: language.playground.playground,
            icon: ShellIcon,
            plugin: null,
            current: false,
            run: () => {
                selectedCharID.set(-1)
                PlaygroundStore.set(1)
            },
        },
    ]
    for (const entry of additionalHamburgerMenu) {
        items.push({
            id: `plugin:${entry.id}`,
            label: entry.name,
            icon: null,
            plugin: { icon: entry.icon, iconType: entry.iconType },
            current: false,
            run: () => entry.callback(),
        })
    }
    items.push({
        id: 'settings',
        label: language.settings,
        icon: Settings,
        plugin: null,
        current: false,
        run: () => settingsOpen.set(true),
    })
    return items
}
