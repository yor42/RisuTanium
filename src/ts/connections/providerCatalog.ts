import { providerLabel, proxyName, storedConnections, uniqueName, type ConnectionHolder, type ConnectionProvider } from './connections'

export type ProviderGroup = 'cloud' | 'router' | 'local' | 'compatible' | 'services'
export type ProviderIcon = 'cloud' | 'route' | 'house' | 'server' | 'plug'

export type ProviderEntry = {
    provider: ConnectionProvider
    group: ProviderGroup
    icon: ProviderIcon
    label: string
    /** Only a reverse proxy and a custom endpoint carry a URL. */
    takesUrl: boolean
    /** The key is one secret that is sent whole (a PEM, or a service key): it uses the masked single-line field and is never a rotation list. Every other key is a rotation list (KeyListInput). */
    singleKey: boolean
}

const GROUP_ICONS: Record<ProviderGroup, ProviderIcon> = {
    cloud: 'cloud',
    router: 'route',
    local: 'house',
    compatible: 'server',
    services: 'plug',
}

/** The non-chat services, in the order the add flow lists them. Their keys are sent whole by their readers. */
const SERVICE_PROVIDERS: readonly ConnectionProvider[] = [
    'elevenlabs', 'huggingface', 'fishspeech', 'novelai_media', 'stability', 'fal', 'openai_image',
    'wavespeed', 'deepl', 'deeplx', 'memory_openai', 'voyage', 'embedding_custom',
]

const GROUPS: Record<ProviderGroup, readonly ConnectionProvider[]> = {
    cloud: [
        'openai', 'anthropic', 'google', 'vertex', 'mistral', 'cohere', 'novelai', 'novellist', 'mancer',
        'oaicomp:deepseek', 'oaicomp:deepinfra',
    ],
    router: ['openrouter', 'nanogpt', 'horde'],
    local: ['ollama'],
    compatible: ['reverse_proxy', 'custom'],
    services: SERVICE_PROVIDERS,
}

/** The OaiComp key identifiers the add flow offers; a test keeps them equal to the model list's. */
export const OAICOMP_KIDS: readonly string[] = ['deepseek', 'deepinfra']

/** What the add flow calls a custom connection; the stored provider label stays the migration default. */
const CUSTOM_ENDPOINT_LABEL = 'Custom endpoint'

/** Providers that allow several connections: each is its own endpoint. */
export function allowsSeveral(provider: ConnectionProvider): boolean {
    return provider === 'reverse_proxy' || provider === 'custom'
}

/** Every provider the add flow can create, in display order. */
export const PROVIDER_CATALOG: readonly ProviderEntry[] = (Object.keys(GROUPS) as ProviderGroup[]).flatMap(
    (group) => GROUPS[group].map((provider): ProviderEntry => ({
        provider,
        group,
        icon: GROUP_ICONS[group],
        label: provider === 'custom' ? CUSTOM_ENDPOINT_LABEL : providerLabel(provider),
        takesUrl: allowsSeveral(provider),
        singleKey: provider === 'vertex' || group === 'services',
    })),
)

/** The catalog entry of a provider, or undefined for one the add flow never creates. */
export function catalogEntry(provider: ConnectionProvider): ProviderEntry | undefined {
    return PROVIDER_CATALOG.find((entry) => entry.provider === provider)
}

/**
 * The providers the add flow offers: each one without a stored connection, and a reverse proxy or
 * a custom endpoint always, because several can coexist.
 */
export function addableProviders(db: ConnectionHolder): ProviderEntry[] {
    const present = new Set(storedConnections(db).map((conn) => conn.provider))
    return PROVIDER_CATALOG.filter((entry) => allowsSeveral(entry.provider) || !present.has(entry.provider))
}

/** The name the add flow prefills: the default name, suffixed only while the user has not typed one. */
export function addPrefillName(db: ConnectionHolder, provider: ConnectionProvider, url = ''): string {
    const base = provider === 'reverse_proxy' ? proxyName(url) : provider === 'custom' ? CUSTOM_ENDPOINT_LABEL : providerLabel(provider)
    return uniqueName(base, storedConnections(db))
}
