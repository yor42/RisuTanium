import { beforeEach, describe, expect, it, vi } from "vitest";
import type { character, customscript } from "../storage/database.svelte";

const database: { presetRegex: customscript[] } = { presetRegex: [] };

vi.mock("../storage/database.svelte", () => ({
    getDatabase: () => database,
}));

vi.mock("../process/modules", () => ({
    getModuleRegexScripts: () => [] as customscript[],
    moduleUpdate: () => {},
}));

const parserCalls: { data: string, chatID: number }[] = [];

vi.mock("../parser/parser.svelte", () => ({
    applyMarkdownToNode: () => {},
    risuChatParser: (data: string, arg: { chatID?: number } = {}) => {
        parserCalls.push({ data, chatID: arg.chatID ?? -1 });
        return data.replaceAll("{{char}}", "Risu");
    },
}));

import { applyEdittransRegex } from "./translator";

const script = (v: Partial<customscript>): customscript => ({
    comment: "",
    in: "",
    out: "",
    type: "edittrans",
    ...v,
} as customscript);

const alwaysExistChar = { customscript: [] } as unknown as character;

const apply = (text: string, scripts: customscript[], chatID = -1) => {
    database.presetRegex = scripts;
    return applyEdittransRegex(text, "chatid", alwaysExistChar, chatID);
};

beforeEach(() => {
    database.presetRegex = [];
    parserCalls.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("applyEdittransRegex", () => {
    it("applies preset scripts of the edittrans type only", () => {
        expect(apply("hello world", [
            script({ in: "world", out: "there" }),
            script({ in: "hello", out: "bye", type: "editdisplay" }),
        ])).toBe("hello there");
    });

    it("skips a script with an invalid regex and keeps the remaining ones", () => {
        expect(apply("hello world", [
            script({ in: "(unclosed", out: "x" }),
            script({ in: "world", out: "there" }),
        ])).toBe("hello there");
    });

    it("skips a script with an empty in", () => {
        expect(apply("hello", [
            script({ in: "", out: "INJECTED" }),
        ])).toBe("hello");
    });

    it("drops unsupported and repeated flags instead of throwing", () => {
        expect(apply("Hello hello", [
            script({ in: "hello", out: "hi", ableFlag: true, flag: "ggi z" }),
        ])).toBe("hi hi");
    });

    it("falls back to the u flag when only unsupported flag characters are left", () => {
        expect(apply("aaa", [
            script({ in: "a", out: "b", ableFlag: true, flag: "z<cbs>" }),
        ])).toBe("baa");
    });

    it("regression reproducer: a flag text with only tags left is global, like an off flag box", () => {
        expect(apply("aaa", [
            script({ in: "a", out: "b", ableFlag: true, flag: "<cbs>" }),
        ])).toBe("bbb");
        expect(apply("aaa", [
            script({ in: "a", out: "b", ableFlag: false, flag: "i" }),
        ])).toBe("bbb");
    });

    it("parses curly braced syntaxes in IN with the cbs flag", () => {
        expect(apply("Risu said hi", [
            script({ in: "{{char}}", out: "Seia", ableFlag: true, flag: "g<cbs>" }),
        ])).toBe("Seia said hi");
    });

    it("does not parse curly braced syntaxes in IN without the cbs flag", () => {
        expect(apply("Risu said hi", [
            script({ in: "{{char}}", out: "Seia", ableFlag: true, flag: "g" }),
        ])).toBe("Risu said hi");
        expect(parserCalls).toEqual([]);
    });

    it("forwards the chatID to the parser so message scoped syntaxes resolve", () => {
        apply("Risu said hi", [
            script({ in: "{{char}}", out: "Seia", ableFlag: true, flag: "g<cbs>" }),
        ], 7);
        expect(parserCalls).toEqual([{ data: "{{char}}", chatID: 7 }]);
    });

    it("sorts scripts by the order flag, higher first", () => {
        expect(apply("a", [
            script({ in: "b", out: "c", ableFlag: true, flag: "g<order 1>" }),
            script({ in: "a", out: "b", ableFlag: true, flag: "g<order 2>" }),
        ])).toBe("c");
    });

    it("keeps the declaration order when no order flag is set", () => {
        expect(apply("a", [
            script({ in: "b", out: "c" }),
            script({ in: "a", out: "b" }),
        ])).toBe("b");
    });

    it("moves the match to the top with the move_top flag", () => {
        expect(apply("body\n<note>keep</note>", [
            script({ in: "<note>.*?</note>", out: "$&", ableFlag: true, flag: "g<move_top>" }),
        ])).toBe("<note>keep</note>\nbody\n");
    });

    it("moves the match to the bottom with the move_bottom flag", () => {
        expect(apply("<note>keep</note>\nbody", [
            script({ in: "<note>(.*?)</note>", out: "[$1]", ableFlag: true, flag: "g<move_bottom>" }),
        ])).toBe("\nbody\n[keep]");
    });

    it("leaves the text alone when a move script does not match", () => {
        expect(apply("body", [
            script({ in: "<note>.*?</note>", out: "$&", ableFlag: true, flag: "g<move_top>" }),
        ])).toBe("body");
    });

    describe("move flags with several matches", () => {
        const move = (text: string, flag: string, inRe = "a\\d", out = "$&") => apply(text, [
            script({ in: inRe, out, ableFlag: true, flag }),
        ]);

        it("regression reproducer: g<move_top> moves every match, the last match on top", () => {
            expect(move("a1 b a2 c a3", "g<move_top>")).toBe("a3\na2\na1\n b  c ");
        });

        it("regression reproducer: g<move_bottom> moves every match, in source order", () => {
            expect(move("a1 b a2 c a3", "g<move_bottom>")).toBe(" b  c \na1\na2\na3");
        });

        it("regression reproducer: a tag-only flag text is global for a move", () => {
            expect(move("a1 b a2", "<move_top>")).toBe("a2\na1\n b ");
            expect(move("a1 b a2", "<order 1, move_bottom>")).toBe(" b \na1\na2");
        });

        it("guard: a flag text without g moves only the first match", () => {
            expect(move("a1 b a2", "i<move_top>")).toBe("a1\n b a2");
            expect(move("a1 b a2", "i<move_bottom>")).toBe(" b a2\na1");
        });

        it("regression reproducer: $<name> resolves a participating group, empty when it did not participate or does not exist", () => {
            expect(move("a", "g<move_bottom>", "(?<n>a)|(?<m>b)", "[$<n>|$<m>|$<z>]")).toBe("\n[a||]");
            expect(move("b", "g<move_bottom>", "(?<n>a)|(?<m>b)", "[$<n>|$<m>]")).toBe("\n[|b]");
        });

        it("regression reproducer: $<name> of a participating empty group is empty", () => {
            expect(move("a", "g<move_bottom>", "(?<n>)a", "[$<n>]")).toBe("\n[]");
        });

        it("guard: $<name> stays literal when the regex has no named groups", () => {
            expect(move("a", "g<move_bottom>", "(a)", "[$<n>|$1]")).toBe("\n[$<n>|a]");
        });

        it("regression reproducer: a pattern matching at every position terminates and moves every match", () => {
            const text = "y".repeat(100000);
            const start = performance.now();
            const result = move(text, "g<move_bottom>", "x*", "$&");
            expect(performance.now() - start).toBeLessThan(2000);
            expect(result.length).toBe(text.length + 100001);
            const top = move(text, "g<move_top>", "x*", "$&");
            expect(top.length).toBe(text.length + 100001);
        });
    });

    it("ignores custom flags that are not supported here", () => {
        expect(apply("hello world", [
            script({ in: "world", out: "there", ableFlag: true, flag: "g<repeat_back><no_end_nl>" }),
        ])).toBe("hello there");
    });

    it("returns the text untouched for an empty charArg", () => {
        database.presetRegex = [script({ in: "hello", out: "bye" })];
        expect(applyEdittransRegex("hello", "", alwaysExistChar)).toBe("hello");
    });
});
