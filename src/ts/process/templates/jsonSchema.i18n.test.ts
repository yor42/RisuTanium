/**
 * `convertInterfaceToSchema` reports a malformed or unsupported interface line in the active UI
 * language, read when the error is thrown. The language module is switched per test and restored
 * to English afterwards.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("src/ts/parser/parser.svelte", () => ({
    risuChatParser: (text: string) => text,
}));
vi.mock("src/ts/storage/database.svelte", () => ({
    getDatabase: () => ({}),
}));
vi.mock("src/ts/util", () => ({
    jsonOutputTrimmer: (text: string) => text,
}));

import { changeLanguage } from "src/lang";
import { languageEnglish } from "src/lang/en";
import { languageKorean } from "src/lang/ko";
import { convertInterfaceToSchema } from "./jsonSchema";

const syntaxErrorInterface = "interface Out {\n  broken\n}";
const unsupportedTypeInterface = "interface Out {\n  field: unknownType\n}";

afterEach(() => changeLanguage("en"));

describe("convertInterfaceToSchema: error text", () => {
    it("compatibility guard: English throws the exact English strings", () => {
        expect(() => convertInterfaceToSchema(syntaxErrorInterface)).toThrow("SyntaxError Found");
        expect(() => convertInterfaceToSchema(unsupportedTypeInterface)).toThrow("Unsupported Type Detected");
        expect(languageEnglish.errors.jsonSchemaSyntaxError).toBe("SyntaxError Found");
        expect(languageEnglish.errors.jsonSchemaUnsupportedType).toBe("Unsupported Type Detected");
    });

    it("regression reproducer: Korean throws the Korean locale values", () => {
        changeLanguage("ko");
        const syntaxKo = languageKorean.errors.jsonSchemaSyntaxError;
        const typeKo = languageKorean.errors.jsonSchemaUnsupportedType;
        expect(syntaxKo).not.toBe(languageEnglish.errors.jsonSchemaSyntaxError);
        expect(typeKo).not.toBe(languageEnglish.errors.jsonSchemaUnsupportedType);

        // The schema converter throws bare strings, not Error objects.
        let thrownSyntax: unknown;
        let thrownType: unknown;
        try { convertInterfaceToSchema(syntaxErrorInterface); } catch (e) { thrownSyntax = e; }
        try { convertInterfaceToSchema(unsupportedTypeInterface); } catch (e) { thrownType = e; }
        expect(thrownSyntax).toBe(syntaxKo);
        expect(thrownType).toBe(typeKo);
    });
});
