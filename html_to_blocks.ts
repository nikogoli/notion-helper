import {
    BlockObjectRequest,
    BlockObjectRequestWithoutChildren,
    LanguageRequest,
    RichTextItemRequest,
    TextRequest,
} from "https://deno.land/x/notion_sdk/src/api-endpoints.ts"

import {
    Element,
    Node,
} from "https://deno.land/x/deno_dom/deno-dom-wasm.ts"


import {
    BlockInfo,
    ToBlockInput,
    VALID_IMAGEFILE,
    VALID_LANGNAME,
} from "./mod.ts"


export function arrange_children(
    contents: Array<BlockObjectRequest>,
){
    let firstline: null | Extract<BlockObjectRequest, {type?:"paragraph"}>
    let children: null | Array<BlockObjectRequest>
    if (contents.length == 0){
        firstline = {type:"paragraph", paragraph: { rich_text:[] }}
        children = null
    } else if (contents.length == 1) {
        firstline = (contents[0].type == "paragraph") ? contents[0] : null
        children = (firstline !== null) ? null : contents
    } else {
        firstline = (contents[0].type == "paragraph") ? contents[0] : null
        children = (firstline !== null) ? contents.slice(1) : contents
    }
    return {firstline, children}
}


export function plaintx_to_richtx(
    base_node: Node | Element
): Array<Required<RichTextItemRequest>>{
    const annotations: Array<string> = []
    let link = ""
    let tag = "start"

    let base = base_node
    while( tag != "end" ){
        const par = base.parentElement
        if (par !== null && ["A", "SUP", "CODE", "STRONG", "EM", "S", "B", "I"].includes(par.nodeName) ){
            if (par.nodeName == "A"){ link = par.getAttribute("href") ?? "" }
            annotations.push(par.nodeName)
            tag = par.nodeName
            base = par
        } else{
            tag = "end"
        }
    }

    switch (base_node.nodeName){
        case "EMBED-KATEX": {
            const input = (base_node as Element).innerText.split("\n")[0]
            const text = to_richtx( "equation", input, link )
            return set_annos(text, annotations)
        }
        case "NWC-FORMULA": {
            const input = (base_node as Element).innerHTML
            const text = to_richtx( "equation", input, link )
            return set_annos(text, annotations) 
        }
        default: {
            const text = to_richtx( "text", base_node.textContent.trim(), link)
            return set_annos(text, annotations)
        }
    }
}


export function to_richtx(
    type:"text" | "equation",
    text: string,
    link = "",
): Array<Required<RichTextItemRequest>> {
    if (text.length > 2000){
        text = text.slice(0,1985) + "... (too long)"
        console.warn("Text is too long, thus, the words over 2000 are omitted.")
    }
    if (type=="equation") {
        return [{
            type: "equation",
            equation: { "expression": text as TextRequest },
            annotations: {
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
                color: "default"
            }
        }]
    } else if (type=="text") {
        return [ {
            type:"text",
            text: {
                content: text,
                link: (link=="") ? null : { url: link as TextRequest }
            },
            annotations: {
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
                color: "default"
            }
        }]
    } else {
        throw new Error("invalid type")
    }
}


export function set_annos(
    tx_obj: Array<Required<RichTextItemRequest>>,
    annos: Array<string>,
){
    if (annos.length == 0){ return tx_obj }
    annos.forEach(an => {
        if (an=="EM" || an == "I"){ tx_obj[0].annotations.italic = true }
        else if (an=="STRONG" || an == "B"){ tx_obj[0].annotations.bold = true }
        else if (an=="S"){ tx_obj[0].annotations.strikethrough = true }
        else if (an=="CODE"){ tx_obj[0].annotations.code = true }
    })
    return tx_obj
}


export function create_block(
    item: ToBlockInput
): Required<BlockObjectRequest> {
    const { type } = item
    switch (item.type){
        case "H1":
            return { object: "block", type: "heading_1", heading_1: { rich_text: to_richtx("text", item.text) } }
        case "H2":
            return { object: "block", type: "heading_2", heading_2: { rich_text: to_richtx("text", item.text) } }
        case "H3":
            return { object: "block", type: "heading_3", heading_3: { rich_text: to_richtx("text", item.text) } }
        case "BR":
            return { object: "block", type: "paragraph", paragraph: { rich_text: [] }  }
        case "HR":
            return { object: "block", type: "divider", divider: {} }
        case "TABLE": {
            const rows = item.text.split("\n")
            const cells = rows.map(row => row.split("\t"))
            const table_width = cells[0].length
            const table_rows = cells.map(row => {
                const new_cells = row.map( text => to_richtx("text", text) )
                return {object:"block", type:"table_row", table_row: {cells: new_cells}}
            })
            return {
                object: 'block', type: "table",
                table: {
                    table_width,
                    has_column_header: true,
                    has_row_header: false,
                    children: table_rows as Array<BlockObjectRequestWithoutChildren>
                }
            }
        }
        case "ULITEM":
        case "OLITEM": {
            const rich_text = (item.firstline===null) ? [] : item.firstline.paragraph.rich_text
            const children = (item.children===null) ? undefined : item.children as Array<BlockObjectRequestWithoutChildren>
            return (item.type == "ULITEM")
                ? { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text, children } }
                : { object: "block", type: "numbered_list_item", numbered_list_item: { rich_text, children } }
        }
        case "PARAGRAPH": {
            const rich_text = (item.rich_text===null) ? [] : item.rich_text
            return { object: "block", type: "paragraph", paragraph: { rich_text } }
        }
        case "BLOCKQUOTE":{
            const rich_text = (item.firstline===null) ? [] : item.firstline.paragraph.rich_text
            const children = (item.children===null) ? undefined : item.children as Array<BlockObjectRequestWithoutChildren>
            return { object: "block", type: "quote", quote: { rich_text, children } }
        }
        case "DETAILS": {
            const rich_text = (item.firstline===null) ? [] : item.firstline.paragraph.rich_text
            const children = (item.children===null) ? undefined : item.children as Array<BlockObjectRequestWithoutChildren>
            return { object: "block", type: "toggle", toggle: { rich_text, children } }
        }
        case "FOOTNOTE":
        case "MESSAGE": {
            const rich_text = (item.firstline===null) ? [] : item.firstline.paragraph.rich_text
            const color = (type == "FOOTNOTE")
                ? "default"
                : (type == "MESSAGE" && item.kind=="message") ? "yellow_background" : "red_background"
            const children = (item.children===null) ? undefined : item.children as Array<BlockObjectRequestWithoutChildren>
            return { object: "block", type: "callout", callout: { rich_text, color, children } }  
        }
        case "EQUATION":{
            return { object: "block", type: "equation", equation: { expression: item.text } }
        }
        case "BOOKMARK":
            return { object: "block", type: "bookmark", bookmark:{ url: item.link } }
        case "IMG":{
            const extention = item.link.split(".").reverse()[0]
            if ( VALID_IMAGEFILE.includes(extention) ){
                return { object: "block", type: "image", image: { type: "external", external: { url: item.link } } }
            } else {
                console.warn("URL without an extention is not acceptable for image block, thus instead, create embed block.\n")
                return { object: "block", type: "embed", embed: { url: item.link } }
            }
        }            
        case "CODE": {
            let language: LanguageRequest
            if (VALID_LANGNAME.includes(item.language)){
                language = item.language as LanguageRequest
            }
            else if (item.language == "tsx" || item.language == "ts"){
                language = "typescript"
            }
            else if (item.language == "jsx" || item.language == "js"){
                language = "javascript"
            }
            else {
                console.warn(`language name '${item.language}' is not valid for notion's code block, thus instead, "plain text" is used.\n`)
                language = "plain text"
            }
            return { object: "block", type: "code", code: { language, rich_text: to_richtx("text", item.text) } }
        }
        default:
            console.log(item)
            throw new Error("invalid input")
    }
}


export function set_record_and_get_childs<T>(
    input: {
        count: number,
        block: BlockObjectRequest,
        self_id: string,
        parent_id: null | string
        dict: Record<string, BlockInfo<T>>,
        options: T,
    }
) {
    const { count, self_id, block, dict, parent_id, options } = input
    dict[self_id] = { self_id, notion_id: "", block, parent_id, options }    

    if (block.type === undefined){ throw new Error() }

    if (count <= 2
        || !["callout", "quote", "toggle", "bulleted_list_item", "numbered_list_item"].includes(block.type)) {
        return []
    }
    
    let children: Array<BlockObjectRequest>
    if (block.type == "callout" && block.callout.children !== undefined) {
        children = block.callout.children
        block.callout = {rich_text: block.callout.rich_text}
    } else if (block.type == "quote" && block.quote.children !== undefined) {
        children = block.quote.children
        block.quote = {rich_text: block.quote.rich_text}
    } else if (block.type == "bulleted_list_item" && block.bulleted_list_item.children !== undefined) {
        children = block.bulleted_list_item.children
        block.bulleted_list_item = {rich_text: block.bulleted_list_item.rich_text}
    } else if (block.type == "numbered_list_item" && block.numbered_list_item.children !== undefined) {
        children = block.numbered_list_item.children
        block.numbered_list_item = {rich_text: block.numbered_list_item.rich_text}
    } else {
        throw new Error("invalid input in create record")
    }
    const child_ids = children.map((child) => {
        const child_id = crypto.randomUUID()
        set_record_and_get_childs({
            count: count-1, block: child, self_id:child_id, dict, parent_id: self_id, options
        })        
        return child_id
    })
    return child_ids
}


export function nest_count(
    ct: number,
    block: BlockObjectRequest
){
    let children: Array<BlockObjectRequest> = []
    if (block.type == "callout" && block.callout.children !== undefined) {
        children = block.callout.children
    } else if (block.type == "quote" && block.quote.children !== undefined) {
        children = block.quote.children
    } else if (block.type == "bulleted_list_item" && block.bulleted_list_item.children !== undefined) {
        children = block.bulleted_list_item.children
    } else if (block.type == "numbered_list_item" && block.numbered_list_item.children !== undefined) {
        children = block.numbered_list_item.children
    }
    if (children.length > 0){
        ct += 1
        ct = Math.max(...children.map(block => nest_count(ct, block)))
    }
    return ct
}
