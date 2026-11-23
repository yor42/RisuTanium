// The helpers that read the field registry. They live apart from the data so that a test that replaces the data
// module still runs these real bodies against the replaced tables.

import { CONTAINER_SEEDS, FIELD_PRESENTATION, FIELD_SPECS, type BiasRow, type ContainerName, type FieldFacts, type FieldPresentation, type Holder, type SetPath } from './fieldRegistry'

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

// An array of 2-tuples `[string, finite number]`. There is no range check: a stored value outside -100..100 is still a
// readable list. The parse guard of a stored record and the live reader share this one predicate.
export function isBiasList(value: unknown): value is BiasRow[] {
    return (
        Array.isArray(value) &&
        value.every((row) => Array.isArray(row) && row.length === 2 && typeof row[0] === 'string' && typeof row[1] === 'number' && Number.isFinite(row[1]))
    )
}

// Whether `value` is of the type the path registers: a string, a boolean or a bias list.
export function isValueOf(path: SetPath, value: unknown): value is string | boolean | BiasRow[] {
    const kind = factsOf(path).value
    if (kind === 'bool') {
        return typeof value === 'boolean'
    }
    return kind === 'biasList' ? isBiasList(value) : typeof value === 'string'
}

// Equality of two set values: structural for a bias list, strict for a string or a boolean.
export function valuesEqual(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
            return false
        }
        return a.every((row, i) => valuesEqual(row, b[i]))
    }
    return a === b
}

// A fresh plain copy: a bias list gets new row arrays, anything else is returned as it is. Never shares an array with
// the live holder or a reactive proxy.
export function cloneValue<T extends string | boolean | BiasRow[]>(value: T): T {
    return (Array.isArray(value) ? value.map((row) => [row[0], row[1]]) : value) as T
}

export function fieldLabelKey(path: SetPath): FieldPresentation['labelKey'] {
    return FIELD_PRESENTATION[path].labelKey
}
