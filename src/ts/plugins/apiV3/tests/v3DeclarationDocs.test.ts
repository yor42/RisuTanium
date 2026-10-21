import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

// Vitest runs from the repository root.
const declarationPath = join(process.cwd(), 'src', 'ts', 'plugins', 'apiV3', 'risuai.d.ts')

function parseDeclarations() {
    const text = readFileSync(declarationPath, 'utf8')
    const sourceFile = ts.createSourceFile(declarationPath, text, ts.ScriptTarget.Latest, true)
    const host = ts.createCompilerHost({})
    host.getSourceFile = (fileName) => (fileName === declarationPath ? sourceFile : undefined)
    const program = ts.createProgram({ rootNames: [declarationPath], options: { noResolve: true, noLib: true }, host })
    const diagnostics = program.getSyntacticDiagnostics(sourceFile)
    return { sourceFile, diagnostics }
}

function findMember(sourceFile: ts.SourceFile, name: string): ts.MethodSignature | undefined {
    let found: ts.MethodSignature | undefined
    const visit = (node: ts.Node) => {
        if (!found && ts.isMethodSignature(node) && node.name.getText(sourceFile) === name) {
            found = node
            return
        }
        ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return found
}

describe('risuai.d.ts documentation', () => {
    test('parses without syntax diagnostics', () => {
        const { sourceFile, diagnostics } = parseDeclarations()
        const messages = diagnostics.map((d) => {
            const pos = sourceFile.getLineAndCharacterOfPosition(d.start ?? 0)
            return `${pos.line + 1}:${pos.character + 1} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`
        })
        expect(messages).toEqual([])
    })

    test('addTTSPreprocessor keeps its whole @example in the JSDoc', () => {
        const { sourceFile } = parseDeclarations()
        const member = findMember(sourceFile, 'addTTSPreprocessor')
        expect(member).toBeDefined()
        const example = ts.getJSDocTags(member!)
            .filter((tag) => tag.tagName.text === 'example')
            .map((tag) => ts.getTextOfJSDocComment(tag.comment) ?? '')
            .join('\n')
        expect(example).toContain('ctx.text.replace(')
        expect(example).toContain('});')
    })
})
