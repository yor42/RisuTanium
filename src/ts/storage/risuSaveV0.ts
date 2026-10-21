import { gzipSync } from "fflate";

/**
 * Writer for upstream's block save format ("v0"): header `RISUSAVE\0`, then blocks
 * `[type u8][compression u8][nameLength u8][name UTF-8][dataLength u32 LE][data]`
 * with no checksum and no remote pointers, the root block last. It exists for the
 * `.bin` database entry of a tree that carries upstream's SaveKV namespaces, which
 * only this format can hold; the fork's own storage never uses it.
 *
 * The module is pure (fflate only) so that it runs in any environment and shares no
 * code with the fork's block store. Every value is written as JSON, so a tree is
 * expected to be JSON-clean: a value JSON cannot represent is dropped or changed
 * exactly as `JSON.stringify` does, and one it cannot encode at all makes the write
 * throw.
 *
 * A name that does not fit the one-byte length, data that does not fit the four-byte
 * length, and two blocks of different kinds sharing a name are broken invariants:
 * the writer throws and never wraps a length or lets one block replace another.
 */

const HEADER_BYTES = new TextEncoder().encode("RISUSAVE\0");
const MAX_NAME_BYTES = 255;
const MAX_DATA_BYTES = 0xFFFFFFFF;

const BLOCK_TYPE = {
    config: 0,
    root: 1,
    character: 2,
    preset: 4,
    modules: 5,
    plugins: 9,
    loadouts: 10,
    pluginStorage: 11,
    kv: 12,
} as const;

/** Top-level keys that live in their own blocks and are therefore absent from the root block. */
const ROOT_EXCLUDED = new Set(["characters", "botPresets", "modules", "loadouts", "plugins", "pluginCustomStorage"]);

const KV_NAME_PREFIX = "kv:";

const utf8 = new TextEncoder();

interface PlannedBlock {
    type: number;
    name: string;
    kind: string;
    json: string;
    gzip: boolean;
}

function concat(parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const part of parts) {
        total += part.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function jsonOf(value: unknown, what: string): string {
    const json: string | undefined = JSON.stringify(value);
    if (json === undefined) {
        throw new Error(`${what} cannot be written as JSON`);
    }
    return json;
}

function frame(block: PlannedBlock): Uint8Array {
    const name = utf8.encode(block.name);
    if (name.length > MAX_NAME_BYTES) {
        throw new Error(`block name "${block.name}" does not fit the one-byte name length`);
    }
    const raw = utf8.encode(block.json);
    const data = block.gzip ? gzipSync(raw, { mtime: 0 }) : raw;
    if (data.length > MAX_DATA_BYTES) {
        throw new Error(`block "${block.name}" does not fit the four-byte data length`);
    }
    const head = new Uint8Array(3 + name.length + 4);
    head[0] = block.type;
    head[1] = block.gzip ? 1 : 0;
    head[2] = name.length;
    head.set(name, 3);
    new DataView(head.buffer).setUint32(3 + name.length, data.length, true);
    return concat([head, data]);
}

/**
 * Writes `db` and the SaveKV namespaces `kv` (namespace -> block content, written
 * verbatim) as an upstream-format save.
 *
 * Block order is upstream's: preset, modules, loadouts, plugins, pluginStorage, one
 * block per character in list order (named by its `chaId`; a repeated id is written
 * again, as the list holds it), one `kv:<namespace>` block per namespace in
 * insertion order, config, then root. A list that is absent or null gets no block
 * and no directory entry. The root block holds every other top-level key and a
 * `__directory` naming exactly the non-root blocks written, once each.
 */
export function writeRisuSaveV0(db: object, kv: Readonly<Record<string, unknown>>): Uint8Array {
    const tree = db as Record<string, unknown>;
    const planned: PlannedBlock[] = [];
    const kindOfName = new Map<string, string>();

    const plan = (type: number, name: string, kind: string, value: unknown) => {
        if (name === "root") {
            throw new Error('block name "root" is reserved for the root block');
        }
        const seen = kindOfName.get(name);
        if (seen !== undefined && seen !== kind) {
            throw new Error(`block name "${name}" is used by both ${seen} and ${kind}`);
        }
        kindOfName.set(name, kind);
        planned.push({ type, name, kind, json: jsonOf(value, `block "${name}"`), gzip: true });
    };
    const planList = (type: number, name: string, value: unknown) => {
        if (value !== undefined && value !== null) {
            plan(type, name, name, value);
        }
    };

    planList(BLOCK_TYPE.preset, "preset", tree.botPresets);
    planList(BLOCK_TYPE.modules, "modules", tree.modules);
    planList(BLOCK_TYPE.loadouts, "loadouts", tree.loadouts);
    planList(BLOCK_TYPE.plugins, "plugins", tree.plugins);
    planList(BLOCK_TYPE.pluginStorage, "pluginStorage", tree.pluginCustomStorage);

    if (Array.isArray(tree.characters)) {
        for (const character of tree.characters as unknown[]) {
            const chaId = (character as { chaId?: unknown } | null)?.chaId;
            // A finite non-zero number is a usable id; its block is named by its text form and the character keeps the number.
            const usable = typeof chaId === "string" ? chaId !== "" : typeof chaId === "number" && Number.isFinite(chaId) && chaId !== 0;
            if (!usable) {
                throw new Error("a character without a usable id cannot be written as a block");
            }
            plan(BLOCK_TYPE.character, String(chaId), "character", character);
        }
    }

    for (const [namespace, content] of Object.entries(kv)) {
        plan(BLOCK_TYPE.kv, KV_NAME_PREFIX + namespace, "kv", content);
    }

    plan(BLOCK_TYPE.config, "config", "config", { version: 1 });

    const root: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(tree)) {
        if (!ROOT_EXCLUDED.has(key)) {
            root[key] = value;
        }
    }
    root.__directory = [...kindOfName.keys()];

    return concat([
        HEADER_BYTES,
        ...planned.map(frame),
        frame({ type: BLOCK_TYPE.root, name: "root", kind: "root", json: jsonOf(root, "the root block"), gzip: false }),
    ]);
}
