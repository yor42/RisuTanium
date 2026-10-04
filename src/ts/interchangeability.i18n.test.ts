/**
 * `convertModuleToCharacter` refuses an MCP module with an error in the active UI language, read
 * when the error is thrown. The language module is switched per test and restored to English
 * afterwards.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("src/ts/characters", () => ({
    createBlankChar: () => ({ name: "", chaId: "" }),
}));

import { changeLanguage } from "src/lang";
import { languageEnglish } from "src/lang/en";
import { languageKorean } from "src/lang/ko";
import type { RisuModule } from "./process/modules";
import { convertModuleToCharacter } from "./interchangeability";

const mcpModule = { name: "m", description: "", mcp: { url: "http://x" } } as unknown as RisuModule;

afterEach(() => changeLanguage("en"));

describe("convertModuleToCharacter: MCP module refusal", () => {
    it("compatibility guard: English throws the exact English text", () => {
        expect(() => convertModuleToCharacter(mcpModule)).toThrow(
            new Error("MCP modules are not supported for character conversion.")
        );
        expect(languageEnglish.errors.mcpModuleConversionUnsupported).toBe(
            "MCP modules are not supported for character conversion."
        );
    });

    it("regression reproducer: Korean throws the Korean locale value", () => {
        changeLanguage("ko");
        const korean = languageKorean.errors.mcpModuleConversionUnsupported;
        expect(korean).not.toBe(languageEnglish.errors.mcpModuleConversionUnsupported);
        expect(() => convertModuleToCharacter(mcpModule)).toThrow(new Error(korean));
    });
});
