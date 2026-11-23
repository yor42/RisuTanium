/**
 * The Studio schema hint decides what a request would make of the schema text without running a macro: it shares the
 * request's line parser (`parseInterfaceSchema`) but never calls the chat parser, which could set chat variables.
 * `convertInterfaceToSchema` keeps its output for a fixed corpus.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const parser = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("src/ts/parser/parser.svelte", () => ({
    risuChatParser: (text: string) => {
        parser.calls.push(text);
        return text.replace("{{kind}}", "string");
    },
}));
vi.mock("src/ts/storage/database.svelte", () => ({
    getDatabase: () => ({}),
}));
vi.mock("src/ts/util", () => ({
    jsonOutputTrimmer: (text: string) => text,
}));

import { checkSchemaText, convertInterfaceToSchema, isInterfaceSchemaText, parseInterfaceSchema } from "./jsonSchema";

const goodInterface = "interface Out {\n  name: string\n  tags: string[]\n  mood: 'happy' | 'sad'\n  flag: boolean\n}";

beforeEach(() => {
    parser.calls.length = 0;
});

describe("S4a-T10: the hint verdicts", () => {
    it("valid JSON, a valid interface, a broken interface, an unsupported type and macro text", () => {
        expect(checkSchemaText('{"type":"object"}')).toEqual({ kind: "ok" });
        expect(checkSchemaText(goodInterface)).toEqual({ kind: "ok" });
        expect(checkSchemaText("interface Out {\n  broken\n}")).toEqual({ kind: "invalid", error: "SyntaxError Found" });
        expect(checkSchemaText("interface Out {\n  field: unknownType\n}")).toEqual({ kind: "invalid", error: "Unsupported Type Detected" });
        expect(checkSchemaText("interface Out {\n  field: {{kind}}\n}")).toEqual({ kind: "macros" });
        const json = checkSchemaText("{not json");
        expect(json.kind).toBe("invalid");
        expect(json.kind === "invalid" && json.error.length > 0).toBe(true);
    });

    it("interface text is told from JSON by the request's own test", () => {
        expect(isInterfaceSchemaText("interface A {}")).toBe(true);
        expect(isInterfaceSchemaText("export interface A {}")).toBe(true);
        expect(isInterfaceSchemaText(" interface A {}")).toBe(false);
        expect(isInterfaceSchemaText("{}")).toBe(false);
    });
});

describe("S4a-T10: the request parser is unchanged (compatibility guard: the same output before and after the split)", () => {
    const expected = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": false,
        "properties": {
            name: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            mood: { type: "string", enum: ["happy", "sad"] },
            flag: { type: "boolean" },
        },
        "required": ["name", "tags", "mood", "flag"],
    };

    it("interface text converts to the same schema through both entry points", () => {
        expect(convertInterfaceToSchema(goodInterface)).toEqual(expected);
        expect(parseInterfaceSchema(goodInterface)).toEqual(expected);
    });

    it("JSON text is parsed as is and a macro in interface text is resolved by the chat parser first", () => {
        expect(convertInterfaceToSchema('{"a":1}')).toEqual({ a: 1 });
        expect(convertInterfaceToSchema("interface Out {\n  field: {{kind}}\n}")).toMatchObject({ properties: { field: { type: "string" } } });
        expect(parser.calls).toEqual(["interface Out {\n  field: {{kind}}\n}"]);
    });
});

describe("S4a-T11: the hint never runs a macro", () => {
    it("checking macro text, a good interface, a broken interface and JSON never calls the chat parser", () => {
        checkSchemaText("interface Out {\n  a: {{setvar::a::1}}\n}");
        checkSchemaText(goodInterface);
        checkSchemaText("interface Out {\n  broken\n}");
        checkSchemaText('{"type":"object"}');
        expect(parser.calls).toEqual([]);
    });
});
