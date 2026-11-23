// The pure part of the schema text handling: the interface line parser the request uses, and the verdict the Studio hint
// draws from it. It imports no chat parser and no database, so the hint can use it without running a macro or pulling the
// request chain in.
import { language } from "src/lang"

// Whether the text is interface text (parsed line by line after macros) rather than JSON.
export function isInterfaceSchemaText(int:string){
    return int.startsWith('interface ') || int.startsWith('export interface ')
}

// The line parser of interface text whose macros are already resolved. Pure: it runs no macro, so a caller that must
// not run macros (the Studio hint) can use it on text that has none.
export function parseInterfaceSchema(int:string){
    type SchemaProp = {
        "type": "array"|"string"|"number"|"boolean",
        "items"?:SchemaProp
        "enum"?:string[]
        "const"?:string
    }

    const lines = int.split('\n')
    let schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": false,
        "properties": {} as {[key:string]:SchemaProp},
        "required": [] as string[],
    }
    for(let i = 1; i < lines.length; i++){
        let content = lines[i].trim()
        if(content === '{'){
            continue
        }
        if(content === '}'){
            continue
        }
        if(content === ''){
            continue
        }

        let placeHolders:string[] = []

        content = content
            .replace(/\\"/gu, '\uE9b4a')
            .replace(/\\'/gu, '\uE9b4b')
            .replace(/"(.+?)"/gu, function(match, p1){
                placeHolders.push(match)
                return `\uE9b4d${placeHolders.length - 1}`
            })
            .replace(/'(.+?)'/gu, function(match, p1){
                placeHolders.push(`"${p1}"`)
                return `\uE9b4d${placeHolders.length - 1}`
            })

            .split('//')[0].trim() //remove comments

            .replace(/((number)|(string)|(boolean))\[\]/gu, 'Array<$1>')

        if(content.endsWith(',') || content.endsWith(';')){
            content = content.slice(0, -1)
        }

        let spData = content.replace(/ /g, '').split(':')

        if(spData.length !== 2){
            throw language.errors.jsonSchemaSyntaxError
        }

        let [property,typeData] = spData

        switch(typeData){
            case 'string':
            case 'number':
            case 'boolean':{
                schema.properties[property] = {
                    type: typeData
                }
                break
            }
            case 'Array<string>':
            case 'Array<number>':
            case 'Array<boolean>':{
                const ogType = typeData.slice(6,-1)

                schema.properties[property] = {
                    type: 'array',
                    items: {
                        type: ogType as 'string'|'number'|'boolean'
                    }
                }
                break
            }
            default:{
                const types = typeData.split("|")
                const strings:string[] = []
                for(const t of types){
                    if(!t.startsWith('\uE9b4d')){
                        throw language.errors.jsonSchemaUnsupportedType
                    }
                    const textIndex = t.replace('\uE9b4d','')
                    const text = placeHolders[parseInt(textIndex)]
                    const textParsed = JSON.parse(text.replace(/\uE9b4a/gu, '\\"').replace(/\uE9b4b/gu, "\\'"))
                    strings.push(textParsed)
                }
                if(strings.length === 1){
                    schema.properties[property] = {
                        type: 'string',
                        const: strings[0]
                    }
                }
                else{
                    schema.properties[property] = {
                        type: 'string',
                        enum: strings
                    }
                }
            }
        }

        schema.required.push(property)

    }
    return schema
}

export type SchemaCheck = { kind: 'ok' } | { kind: 'macros' } | { kind: 'invalid', error: string }

// What the request would make of schema text, decided without running any macro: JSON text must parse, interface text
// without macros must parse with the request's own line parser, and interface text that holds macros has no verdict
// until a request resolves them.
export function checkSchemaText(text:string):SchemaCheck{
    try {
        if(!isInterfaceSchemaText(text)){
            JSON.parse(text)
        }
        else if(text.includes('{{')){
            return { kind: 'macros' }
        }
        else{
            parseInterfaceSchema(text)
        }
        return { kind: 'ok' }
    } catch (error) {
        return { kind: 'invalid', error: typeof error === 'string' ? error : error instanceof Error ? error.message : String(error) }
    }
}
