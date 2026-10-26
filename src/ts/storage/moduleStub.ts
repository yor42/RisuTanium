import { SaveParkError } from './savePark'

/**
 * The module stub marker: a stand-in for a module whose body is not resident. A string-keyed, enumerable own property
 * whose key starts with a private-use character (like `COLD_POINTER_HEADER`), because it must survive a `$state` proxy,
 * `$state.snapshot`, `structuredClone`, a JSON round trip, an `Object.keys` walk and msgpackr, and every encoder that
 * would otherwise write the stand-in in place of the module walks only those. A Symbol or a non-enumerable key would
 * vanish from the plain copies and the encoders would write the empty stand-in as the module.
 *
 * Imports only the zero-import park module, so it loads in any environment.
 */
export const MODULE_STUB_KEY = '\uEF02moduleStub'
export const MODULE_STUB_VALUE = 1

/**
 * Whether `value` is a module stub. The own-key check comes first: a plain read of a missing key through a `$state`
 * proxy would create and keep a source for that key.
 */
export function isModuleStub(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false
    }
    return Object.hasOwn(value, MODULE_STUB_KEY) && (value as Record<string, unknown>)[MODULE_STUB_KEY] === MODULE_STUB_VALUE
}

/**
 * Whether `value` is an object that carries the stub marker key, whatever its value. Stricter than `isModuleStub`: a
 * file from outside that holds the key is refused as a whole, because a loader or encoder would take it for a stand-in
 * for a module whose body is somewhere else. The own-key check avoids creating a source through a `$state` proxy.
 */
export function hasModuleStubKey(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false
    }
    return Object.hasOwn(value, MODULE_STUB_KEY)
}

function textOf(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

/**
 * A module stub reached an encoder that would write it as the module. It is a `SaveParkError` of kind `module-stub`
 * about `modules`, so every catch site that already parks or refuses on `SaveParkError` shows the generic "your
 * modules" wording; the module's id and name are in the message for the console and the developer. The same refusal
 * covers a foreign module that already holds the exact marker key: it is refused, never saved wrong.
 */
export class ModuleStubRefusal extends SaveParkError {
    constructor(
        public readonly moduleId: string,
        public readonly moduleName: string,
        public readonly where: string,
    ) {
        super('module-stub', 'modules',
            `${where} refused the module "${moduleName}" (${moduleId}): it holds the module stub marker and cannot be saved as it is.`)
        this.name = 'ModuleStubRefusal'
    }
}

/**
 * Throws `ModuleStubRefusal` for the first module stub in `modules`. An absent value, a non-list and an object of
 * modules are tolerated: an array is scanned by element and any other object by its values; the list-shape checks
 * belong to the encoders.
 */
export function assertNoModuleStubs(modules: unknown, where: string): void {
    if (typeof modules !== 'object' || modules === null) {
        return
    }
    const slots = Array.isArray(modules) ? modules : Object.values(modules)
    for (let index = 0; index < slots.length; index++) {
        const slot: unknown = slots[index]
        if (isModuleStub(slot)) {
            const fields = slot as Record<string, unknown>
            throw new ModuleStubRefusal(textOf(fields.id), textOf(fields.name), where)
        }
    }
}
