import { providerLabel, proxyName, storedConnections, uniqueName, type ConnectionHolder, type ConnectionProvider } from './connections'

export type ProviderGroup = 'cloud' | 'router' | 'local' | 'compatible'
export type ProviderIcon = 'cloud' | 'route' | 'house' | 'server'

export type ProviderEntry = {
    provider: ConnectionProvider
    group: ProviderGroup
    icon: ProviderIcon
    label: string
    /** Only a reverse proxy carries a URL. */
    takesUrl: boolean
    /** A PEM spans lines and is a single secret: it uses the legacy masked single-line field. Every other key is a rotation list (KeyListInput). */
    multilineKey: boolean
}

const GROUP_ICONS: Record<ProviderGroup, ProviderIcon> = {
    cloud: 'cloud',
    router: 'route',
    local: 'house',
    compatible: 'server',
}

const GROUPS: Record<ProviderGroup, readonly ConnectionProvider[]> = {
    cloud: [
        'openai', 'anthropic', 'google', 'vertex', 'mistral', 'cohere', 'novelai', 'novellist', 'mancer',
        'oaicomp:deepseek', 'oaicomp:deepinfra',
    ],
    router: ['openrouter', 'nanogpt', 'horde'],
    local: ['ollama'],
    compatible: ['reverse_proxy'],
}

/** The OaiComp key identifiers the add flow offers; a test keeps them equal to the model list's. */
export const OAICOMP_KIDS: readonly string[] = ['deepseek', 'deepinfra']

/** Every provider the add flow can create, in display order. `custom` belongs to a custom model and is not listed. */
export const PROVIDER_CATALOG: readonly ProviderEntry[] = (Object.keys(GROUPS) as ProviderGroup[]).flatMap(
    (group) => GROUPS[group].map((provider): ProviderEntry => ({
        provider,
        group,
        icon: GROUP_ICONS[group],
        label: providerLabel(provider),
        takesUrl: provider === 'reverse_proxy',
        multilineKey: provider === 'vertex',
    })),
)

/** The catalog entry of a provider, or undefined for one the add flow never creates. */
export function catalogEntry(provider: ConnectionProvider): ProviderEntry | undefined {
    return PROVIDER_CATALOG.find((entry) => entry.provider === provider)
}

/**
 * The providers the add flow offers: each one without a stored connection, and a reverse proxy
 * always, because several proxies can coexist.
 */
export function addableProviders(db: ConnectionHolder): ProviderEntry[] {
    const present = new Set(storedConnections(db).map((conn) => conn.provider))
    return PROVIDER_CATALOG.filter((entry) => entry.provider === 'reverse_proxy' || !present.has(entry.provider))
}

/** The name the add flow prefills: the default name, suffixed only while the user has not typed one. */
export function addPrefillName(db: ConnectionHolder, provider: ConnectionProvider, url = ''): string {
    const base = provider === 'reverse_proxy' ? proxyName(url) : providerLabel(provider)
    return uniqueName(base, storedConnections(db))
}
