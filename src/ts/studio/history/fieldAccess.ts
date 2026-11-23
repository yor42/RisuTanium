// The helpers that read the field registry. They live apart from the data so that a test that replaces the data
// module still runs these real bodies against the replaced tables.

import { CONTAINER_SEEDS, FIELD_PRESENTATION, FIELD_SPECS, type ContainerName, type FieldFacts, type FieldPresentation, type Holder, type SetPath } from './fieldRegistry'

// The registered paths in registry order.
export function registryPaths(): SetPath[] {
    return Object.keys(FIELD_SPECS) as SetPath[]
}

export function factsOf(path: SetPath): FieldFacts {
    return FIELD_SPECS[path]
}

export function isHeldBy(path: SetPath, holder: Holder): boolean {
    return factsOf(path).holders.includes(holder)
}

// The holder property a path reads and writes: `property` when given, else the path itself.
export function propertyOf(path: SetPath): string {
    return factsOf(path).property ?? path
}

// Where a path lives on its holder: a dotted path `a.b` is key `b` of container `a`, any other path is a key of the holder
// itself (`container` is null).
export function slotOf(path: SetPath): { container: ContainerName | null; key: string } {
    const property = propertyOf(path)
    const dot = property.indexOf('.')
    return dot < 0 ? { container: null, key: property } : { container: property.slice(0, dot) as ContainerName, key: property.slice(dot + 1) }
}

// A new copy of a container's seed on every call, so no two characters share a container or its `tag` array.
export function freshSeed(container: ContainerName): Record<string, unknown> {
    return structuredClone(CONTAINER_SEEDS[container]) as Record<string, unknown>
}

// A container a nested path can be read from and written into: an object that is not an array.
export function isUsableContainer(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function fieldLabelKey(path: SetPath): FieldPresentation['labelKey'] {
    return FIELD_PRESENTATION[path].labelKey
}
