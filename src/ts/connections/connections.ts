import type { KeyFieldId } from 'src/ts/process/request/secretKey'

/**
 * Providers a stored key belongs to. `oaicomp:<kid>` reuses the persisted key of upstream's
 * `OaiCompAPIKeys`, so an unknown kid still migrates and translates back verbatim.
 */
export type ConnectionProvider =
    | 'openai' | 'reverse_proxy' | 'anthropic' | 'openrouter' | 'nanogpt' | 'mistral' | 'cohere'
    | 'ollama' | 'novellist' | 'mancer' | 'novelai' | 'horde' | 'google' | 'vertex' | 'custom'
    | `oaicomp:${string}`

/**
 * One stored credential. `key` stays a plain string: multi-line rotation lists and `${NAME}`
 * references pass through verbatim. `url` is used only by `reverse_proxy` and `custom`.
 * `options` is reserved and never written. `keyWrapped` is an opaque Keystore envelope of the key,
 * present only with `key === ''` (a both-set connection is a transient state whose plain `key` wins);
 * it is read and written only through keyAccess.
 */
export type Connection = {
    id: string
    name: string
    provider: ConnectionProvider
    key: string
    keyWrapped?: string
    url?: string
    options?: { [k: string]: string | number | boolean }
}

/** The global provider slots: one connection each, the first of its provider. */
export type GlobalSlot =
    | 'openAIKey' | 'claudeAPIKey' | 'openrouterKey' | 'nanogptKey' | 'mistralKey' | 'cohereAPIKey'
    | 'ollamaApiKey' | 'novellistAPI' | 'mancerHeader' | 'novelai.token' | 'hordeConfig.apiKey'
    | 'google.accessToken' | 'vertexPrivateKey'

/** `vertexPrivateKey` is a slot but not a `KeyFieldId`, so a PEM never reaches the line picker. */
export type ConnectionSlot = KeyFieldId | 'vertexPrivateKey'

export const GLOBAL_SLOT_PROVIDERS: Record<GlobalSlot, ConnectionProvider> = {
    'openAIKey': 'openai',
    'claudeAPIKey': 'anthropic',
    'openrouterKey': 'openrouter',
    'nanogptKey': 'nanogpt',
    'mistralKey': 'mistral',
    'cohereAPIKey': 'cohere',
    'ollamaApiKey': 'ollama',
    'novellistAPI': 'novellist',
    'mancerHeader': 'mancer',
    'novelai.token': 'novelai',
    'hordeConfig.apiKey': 'horde',
    'google.accessToken': 'google',
    'vertexPrivateKey': 'vertex',
}

const PROVIDER_LABELS: Record<string, string> = {
    openai: 'OpenAI',
    reverse_proxy: 'Reverse proxy',
    anthropic: 'Claude',
    openrouter: 'OpenRouter',
    nanogpt: 'NanoGPT',
    mistral: 'Mistral',
    cohere: 'Cohere',
    ollama: 'Ollama',
    novellist: 'NovelList',
    mancer: 'Mancer',
    novelai: 'NovelAI',
    horde: 'AI Horde',
    google: 'Google Gemini',
    vertex: 'Vertex AI',
    custom: 'Custom model',
}

/** The default display name of a provider; an OaiComp provider is named by its kid. */
export function providerLabel(provider: ConnectionProvider): string {
    if (provider.startsWith('oaicomp:')) {
        return provider.slice('oaicomp:'.length)
    }
    return PROVIDER_LABELS[provider] ?? provider
}

/** The parts of the database that connections read and write. */
export type ConnectionHolder = {
    connections?: Connection[]
    proxyConnectionId?: string
    customModels?: { id: string, connectionId?: string }[]
}

/** Who a connection belongs to: a slot, or one custom model by index. */
export type ConnectionOwner =
    | { slot: ConnectionSlot }
    | { modelIndex: number }

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A non-string value counts as empty. */
export function str(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

export function isWellFormedConnection(value: unknown): value is Connection {
    return isRecord(value)
        && typeof value.id === 'string'
        && typeof value.provider === 'string'
        && typeof value.key === 'string'
}

/** True when `connections` is present but is not an array of well-formed connections. */
export function isMalformedStore(db: ConnectionHolder): boolean {
    const store: unknown = db.connections
    return store !== undefined && !(Array.isArray(store) && store.every(isWellFormedConnection))
}

/** The well-formed connections in list order; none when the store is not an array. */
export function storedConnections(db: ConnectionHolder): Connection[] {
    const store: unknown = db.connections
    return Array.isArray(store) ? store.filter(isWellFormedConnection) : []
}

/** The next free `conn-<n>`: one more than the largest n in use, never derived from a secret. */
export function nextConnectionId(connections: readonly Connection[]): string {
    let max = 0
    for (const conn of connections) {
        const match = /^conn-(\d+)$/.exec(conn.id)
        if (match) {
            max = Math.max(max, Number(match[1]))
        }
    }
    return `conn-${max + 1}`
}

/** A taken name gets " 2", " 3" in call order. */
export function uniqueName(base: string, connections: readonly Connection[]): string {
    const taken = new Set(connections.map((conn) => conn.name))
    if (!taken.has(base)) {
        return base
    }
    for (let n = 2; ; n++) {
        if (!taken.has(`${base} ${n}`)) {
            return `${base} ${n}`
        }
    }
}

/** The display name of a proxy: the URL host, or "Reverse proxy" when the URL does not parse. */
export function proxyName(url: string): string {
    try {
        const host = new URL(url).host
        return host === '' ? PROVIDER_LABELS.reverse_proxy : host
    } catch {
        return PROVIDER_LABELS.reverse_proxy
    }
}

/** The display name of a custom model's connection. */
export function customModelName(model: { name?: unknown }): string {
    const name = str(model.name)
    return name === '' ? PROVIDER_LABELS.custom : name
}

/**
 * A copy of a connection that keeps every field it does not know (a later wrapped key travels
 * without a read of the plaintext). A plain spread, because `structuredClone` rejects a
 * Svelte `$state` proxy.
 */
export function cloneConnection(conn: Connection, overrides: Partial<Connection> = {}): Connection {
    const copy: Connection = { ...conn }
    if (conn.options) {
        copy.options = { ...conn.options }
    }
    return Object.assign(copy, overrides)
}

/** The stored connection `id` names, only when it has the provider asked for. */
export function connectionById(
    connections: readonly Connection[],
    id: unknown,
    provider: ConnectionProvider,
): Connection | undefined {
    if (typeof id !== 'string' || id === '') {
        return undefined
    }
    const conn = connections.find((item) => item.id === id)
    return conn !== undefined && conn.provider === provider ? conn : undefined
}

/** How many custom models name `connectionId`. */
export function customModelReferrers(db: ConnectionHolder, connectionId: string): number {
    const models: unknown = db.customModels
    if (!Array.isArray(models)) {
        return 0
    }
    return models.filter((model) => isRecord(model) && model.connectionId === connectionId).length
}

/** The index of the first custom model with `id`, as a lookup by model id always resolved it. */
export function customModelIndex(db: ConnectionHolder, id: string): number {
    const models: unknown = db.customModels
    if (!Array.isArray(models)) {
        return -1
    }
    return models.findIndex((model) => isRecord(model) && model.id === id)
}

/**
 * The one rule that decides which connection a request uses, which one a `.bin` translation reads
 * and which one a setter edits. Sync, never reads `key`. A missing, dangling or other-provider
 * reference resolves to none, so a key never goes to a URL it was not stored with.
 */
export function ownedConnection(db: ConnectionHolder, owner: ConnectionOwner): Connection | undefined {
    const connections = storedConnections(db)
    if ('modelIndex' in owner) {
        const model: unknown = Array.isArray(db.customModels) ? db.customModels[owner.modelIndex] : undefined
        return isRecord(model) ? connectionById(connections, model.connectionId, 'custom') : undefined
    }
    const slot = owner.slot
    if (slot === 'proxyKey') {
        return connectionById(connections, db.proxyConnectionId, 'reverse_proxy')
    }
    if (slot.startsWith('OaiCompAPIKeys:')) {
        const provider: ConnectionProvider = `oaicomp:${slot.slice('OaiCompAPIKeys:'.length)}`
        return connections.find((conn) => conn.provider === provider)
    }
    if (slot.startsWith('customModels:')) {
        const index = customModelIndex(db, slot.slice('customModels:'.length))
        return index < 0 ? undefined : ownedConnection(db, { modelIndex: index })
    }
    if (!Object.hasOwn(GLOBAL_SLOT_PROVIDERS, slot)) {
        return undefined
    }
    const provider = GLOBAL_SLOT_PROVIDERS[slot as GlobalSlot]
    return connections.find((conn) => conn.provider === provider)
}

/** The connection a slot resolves to. */
export function slotConnection(db: ConnectionHolder, slot: ConnectionSlot): Connection | undefined {
    return ownedConnection(db, { slot })
}

/** The connection a preset's own `proxyConnectionId` names, only for a reverse proxy. */
export function presetProxyConnection(
    db: ConnectionHolder,
    preset: { proxyConnectionId?: unknown },
): Connection | undefined {
    return connectionById(storedConnections(db), preset.proxyConnectionId, 'reverse_proxy')
}

/**
 * The working proxy reference a preset restores: its own string reference; `''` when its legacy pair
 * is present and both sides are empty (that wiped the pair before); otherwise undefined. Pure, so a
 * replay stays free of side effects.
 */
export function presetProxyRef(preset: {
    proxyConnectionId?: unknown
    proxyKey?: unknown
    forceReplaceUrl?: unknown
}): string | undefined {
    if (typeof preset.proxyConnectionId === 'string') {
        return preset.proxyConnectionId
    }
    const hasPair = preset.proxyKey !== undefined || preset.forceReplaceUrl !== undefined
    if (hasPair && str(preset.proxyKey) === '' && str(preset.forceReplaceUrl) === '') {
        return ''
    }
    return undefined
}
