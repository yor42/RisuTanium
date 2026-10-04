/**
 * `decodeTranslatorPresetFile` reports an invalid file in the active UI language, read when the
 * error is thrown. The language module is switched per test and restored to English afterwards.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("src/ts/util", () => ({
    encryptBuffer: async (data: Uint8Array) =>
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    decryptBuffer: async (data: Uint8Array) =>
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
}));

vi.mock("src/ts/rpack/rpack_js.js", () => ({
    encodeRPack: async (data: Uint8Array) => data,
    decodeRPack: async (data: Uint8Array) => data,
}));

import { changeLanguage } from "src/lang";
import { languageEnglish } from "src/lang/en";
import { languageKorean } from "src/lang/ko";
import { decodeTranslatorPresetFile } from "./presets";

const garbage = new Uint8Array([1, 2, 3, 4]);

afterEach(() => changeLanguage("en"));

describe("decodeTranslatorPresetFile: invalid file error", () => {
    it("compatibility guard: English throws the exact English text", async () => {
        await expect(decodeTranslatorPresetFile(garbage)).rejects.toThrow(
            new Error("Invalid translator preset file.")
        );
    });

    it("regression reproducer: Korean throws the Korean locale value", async () => {
        changeLanguage("ko");
        const korean = languageKorean.errors.invalidTranslatorPresetFile;
        expect(korean).not.toBe(languageEnglish.errors.invalidTranslatorPresetFile);
        await expect(decodeTranslatorPresetFile(garbage)).rejects.toThrow(new Error(korean));
    });
});
