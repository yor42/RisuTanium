// The helpers that read the field registry. They live apart from the data so that a test that replaces the data
// module still runs these real bodies against the replaced tables.

import { FIELD_PRESENTATION, FIELD_SPECS, type FieldFacts, type FieldPresentation, type Holder, type SetPath } from './fieldRegistry'

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

export function fieldLabelKey(path: SetPath): FieldPresentation['labelKey'] {
    return FIELD_PRESENTATION[path].labelKey
}
