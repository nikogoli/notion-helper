import {
    EmojiRequest,
    CreatePageBodyParameters,
    BlockObjectRequest,
    BlockObjectRequestWithoutChildren,
    LanguageRequest,
    RichTextItemRequest,
    TextRequest,
} from "https://deno.land/x/notion_sdk/src/api-endpoints.ts"

import {
    DOMParser,
    Element,
    Node,
} from "https://deno.land/x/deno_dom/deno-dom-wasm.ts"

const VALID_LANGNAME = ["abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript", "c++", "c#", "css", "dart", "diff", "docker", "elixir", "elm", "erlang", "flow", "fortran", "f#", "gherkin", "glsl", "go", "graphql", "groovy", "haskell", "html", "java", "javascript", "json", "julia", "kotlin", "latex", "less", "lisp", "livescript", "lua", "makefile", "markdown", "markup", "matlab", "mermaid", "nix", "objective-c", "ocaml", "pascal", "perl", "php", "plain text", "powershell", "prolog", "protobuf", "python", "r", "reason", "ruby", "rust", "sass", "scala", "scheme", "scss", "shell", "solidity", "sql", "swift", "typescript", "vb.net", "verilog", "vhdl", "visual basic", "webassembly", "xml", "yaml", "java/c/c++/c#"]

const VALID_IMAGEFILE = ["png", "jpg", "jpeg", "gif", "tif", "tiff", "bmp", "svg", "heic"]


type ToBlockInput = {
    type: "H1" | "H2" | "H3" | "TABLE" | "EQUATION",
    text: string,
} | {
    type: "BR" | "HR",
} | {
    type: "PARAGRAPH" ,
    rich_text: Array<RichTextItemRequest>,
} | {
    type: "ULITEM" | "OLITEM" | "BLOCKQUOTE" | "FOOTNOTE" | "DETAILS",
    firstline: Extract<BlockObjectRequest, {type?: "paragraph"}> | null,
    children: Array<BlockObjectRequest> | null,
} | {
    type: "BOOKMARK" | "IMG",
    link: string,
} | {
    type: "CODE",
    text: string,
    language: string,
} | {
    type: "MESSAGE",
    kind: "message" | "alert",
    firstline: Extract<BlockObjectRequest, {type?: "paragraph"}> | null,
    children: Array<BlockObjectRequest> | null,
}

type UnitScrap = {
    thread_idx: string,
    scrap_idx: string,
    date_time: string | null, // "yyyy-mm-ddThh:mm:ss+00:00"
    content: Array<BlockObjectRequest>,
}


type ScrapBlockInfo = {
    self_id: string,
    notion_id: string,
    block: BlockObjectRequest,
    thread_idx: string,
    scrap_idx: string,
    parent_id: null | string,
}


type BlockInfo = {
    self_id: string,
    notion_id: string,
    block: BlockObjectRequest,
    parent_id: null | string,
}


function check_textnode(
    elem: Node
){
    const text = elem.textContent.replaceAll("\n", "").replaceAll("　", "")
    return ( text != "" )
}


function arrange_children(
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


function plaintx_to_richtx(
    base_node: Node | Element
): Array<Required<RichTextItemRequest>>{
    const annotations: Array<string> = []
    let link: undefined | string = undefined
    let tag = "start"
    let base = base_node
    while( tag != "end" ){
        const par = base.parentElement
        if (par !== null && ["A", "SUP", "CODE", "EMBED-KATEX", "STRONG", "EM", "S"].includes(par.nodeName) ){
            if (par.nodeName == "A"){ link = par.getAttribute("href") ?? undefined }
            annotations.push(par.nodeName)
            tag = par.nodeName
            base = par
        } else{
            tag = "end"
        }
    }
    const text = to_richtx(
        (base_node.nodeName == "EMBED-KATEX") ? "equation" : "text",
        (base_node.nodeName == "EMBED-KATEX") ? (base_node as Element).innerText : base_node.textContent,
        link
    )
    return set_annos(text, annotations)
}


function flatten_childs(
    el: Element,
){
    const results: Array<{Node:Node}|{Elem:Element}> = []
    const elems = Array.from(el.children)
    el.childNodes.forEach( (child, _idx) => {
        if (child.nodeName == "#text"){
            if (check_textnode(child)){
                results.push({Node: child})
            }
        } else {
            const elem = elems.shift()
            if (elem === undefined){ throw new Error("failed to get element") }

            if (elem.nodeName == "A" && elem.getAttribute("style") == "display: none"){
                results.push({Elem: elem})
            }
            //else if ( elem.nodeName == "BR"){
            //    if (el.childNodes[idx-1].nodeName == "BR" ){
            //        results.push({Elem: elem})    
            //    }
            //}
            else if (["A", "SUP", "CODE", "STRONG", "EM", "S"].includes(elem.nodeName)){
                flatten_childs(elem).forEach(x => results.push(x))
            } else {
                results.push({Elem: elem})
            }
        }
    })
    return results
}


function tokenize_other(
    elem: Element,
): BlockObjectRequest{
    switch (elem.nodeName){
        case "H1":
            return to_block({type: "H1", text: elem.innerText.trimStart()})
        case "H2":
            return to_block({type: "H2", text: elem.innerText.trimStart()})
        case "H3":
        case "H4":
            return to_block({type: "H3", text: elem.innerText.trimStart()})
        case "TABLE":{
            const text = elem.innerHTML.replaceAll("\n", "").replaceAll(/\<\/th\>\<\/tr\>|\<\/td\>\<\/tr\>/g,"\n").replaceAll(/\<\/th\>|\<\/td\>/g,"\t").replaceAll(/\<.+?\>/g, "").trimEnd()
            return to_block({type: "TABLE", text})
        }
        case "HR":
            return to_block({ type: "HR" })
        case "IMG":{
            const link = elem.getAttribute("src")
            if (link !== null){
                return to_block({ type: "IMG", link })
            } else {
                throw new Error("IMG element doen not have 'src'.")
            }
        }
        case "SECTION":{
            if (elem.className == "footnotes") {
                const firstline: Extract<BlockObjectRequest, {type?:"paragraph"}> = { type: "paragraph", paragraph:{ rich_text: to_richtx("text", "注釈")} }
                const children = Array.from(elem.getElementsByClassName("footnote-item"))
                    .map(no => no.getElementsByTagName("p")[0])
                    .map(p => {
                        const { firstline, children } = arrange_children( tokenize_p(p) )
                        return to_block({ type:"OLITEM", firstline, children })
                    })
                return to_block({ type:"FOOTNOTE", firstline, children })
            }
            else if (elem.className == "zenn-katex"){
                return to_block({ type:"EQUATION", text: elem.innerText.split("\n")[1] })
            } else {
                return to_block({type:"PARAGRAPH", rich_text: []})
            }
        }
        case "BLOCKQUOTE":{
            const { firstline, children } = arrange_children( tokenize_page(elem) )
            return to_block({ type:"BLOCKQUOTE", firstline, children })
        }
        case "ASIDE":{
            if (elem.className == "msg message" || elem.className == "msg alert"){
                const kind = (elem.className.split(" ")[1] == "message") ? "message": "alert"
                const content_node = elem.getElementsByClassName("msg-content")[0]
                const { firstline, children } = arrange_children( tokenize_page(content_node) )
                return to_block({ type:"MESSAGE", kind, firstline, children })
            } else {
                return to_block({type:"PARAGRAPH", rich_text: []})
            }
        }
        case "DETAILS":{
            const title = elem.getElementsByTagName("summary")[0].innerText
            const content_node = elem.getElementsByClassName("details-content")[0]
            const firstline: Extract<BlockObjectRequest, {type?:"paragraph"}>  = { type:"paragraph", paragraph:{ rich_text: to_richtx("text", title) } }
            const children = tokenize_page(content_node)
            return to_block({ type:"DETAILS", firstline, children })
        }
        case "DIV":{
            if ( elem.className == "code-block-container" ) {
                const code_node = elem.getElementsByTagName("code")[0]
                const language = (code_node.className!="") ? code_node.className.split("-").reverse()[0] : "plain text"
                return to_block({ type:"CODE", language, text:code_node.innerText.slice(0, -1) })
            } else if ( elem.className.startsWith("embed-") ){
                const iframe = elem.children[0]
                const link = iframe.getAttribute("src")
                if (link !== null){
                    return { type:"embed", embed: {url: link} }
                } else {
                    return { type:"callout", callout: { color: "default", rich_text: to_richtx("text", "埋め込み要素(取得失敗)") } }
                }
            } else if ( elem.className.startsWith("zenn-embedded") && !elem.className.includes("card") ){
                const name = elem.className.split("-").reverse()[0]
                return { type:"callout", callout: { color: "default", rich_text: to_richtx("text", `埋め込み要素 ${name} (取得不可能) `) } }
            }
            else {
                return to_block({type:"PARAGRAPH", rich_text: []})
            }
        }
        default:
            console.log(elem)
            throw new Error("invalid input")
    }
}


function tokenize_li(
    elem: Element,
){
    const blocks: Array<BlockObjectRequest> = []

    const rich_txs =  flatten_childs(elem).reduce( (list, item) => {
        if ("Elem" in item){
            if (item.Elem.nodeName == "EMBED-KATEX"){
                list.push(plaintx_to_richtx(item.Elem)[0])
                return list
            }
            if (list.length > 0){
                blocks.push( to_block({type: "PARAGRAPH", rich_text: list}) )
            }
            if (item.Elem.nodeName == "A" && item.Elem.getAttribute("style") == "display: none"){
                const link = item.Elem.getAttribute("href")
                if (link === null){
                    throw new Error("IMG element doen not have 'href'.")
                }
                blocks.push( to_block({type: "BOOKMARK", link}) )
            }
            if (item.Elem.nodeName == "IMG"){
                const link = item.Elem.getAttribute("src")
                if (link === null){  throw new Error("IMG element doen not have 'src'.") }
                blocks.push( to_block({type: "IMG", link}) )
            }
            else if (item.Elem.nodeName == "BR"){
                if (list.length == 0){
                    blocks.push( to_block({type: "PARAGRAPH", rich_text: []}) ) 
                }
            }
            else if ( item.Elem.nodeName =="UL" || item.Elem.nodeName == "OL") {
                tokenize_list(item.Elem).forEach( bl => blocks.push(bl))
            }
            else if (["H1", "H2", "H3", "H4", "TABLE", "HR", "IMG", "SECTION", "BLOCKQUOTE", "BLOCKQUOTE", "ASIDE", "DETAILS", "DIV"].includes(item.Elem.nodeName)) {
                blocks.push(tokenize_other(item.Elem))
            }
            return []
        } else {
            if (item.Node.nodeName == "#text") {
                if (check_textnode(item.Node)){
                    list.push(plaintx_to_richtx(item.Node)[0])
                }
            }
            return list
        }
    }, [] as Array<RichTextItemRequest> )
    if (rich_txs.length >0){
        blocks.push( to_block({type: "PARAGRAPH", rich_text: rich_txs}) )
    }
    
    return blocks
}


function tokenize_p(
    elem: Element,
): Array<BlockObjectRequest> {

    const blocks: Array<BlockObjectRequest> = []

    const rich_txs = flatten_childs(elem).reduce( (list, item) => {
        if ("Elem" in item){
            if (item.Elem.nodeName == "EMBED-KATEX"){
                list.push(plaintx_to_richtx(item.Elem)[0])
                return list
            }
            if (list.length > 0){
                blocks.push( to_block({type: "PARAGRAPH", rich_text: list}) )
            }
            if (item.Elem.nodeName == "IMG"){
                const link = item.Elem.getAttribute("src")
                if (link === null){ throw new Error("IMG element doen not have 'src'.") }
                blocks.push( to_block({type: "IMG", link}) )
            }
            else if (item.Elem.nodeName == "BR"){
                if (list.length == 0){
                    blocks.push( to_block({type: "PARAGRAPH", rich_text: []}) ) 
                }
            }
            return []
        } else {
            if (item.Node.nodeName == "#text") {
                if (check_textnode(item.Node)){
                    list.push(plaintx_to_richtx(item.Node)[0])
                }
            }
            return list
        }
    }, [] as Array<RichTextItemRequest> )
    if (rich_txs.length >0){
        blocks.push( to_block({type: "PARAGRAPH", rich_text: rich_txs}) )
    }
    
    return blocks
}


function tokenize_list(
    elem: Element,    
): Array<BlockObjectRequest> {
    if (elem.nodeName != "UL" && elem.nodeName != "OL"){ throw new Error("invalid input") }
    const list_items = Array.from(elem.children).map(li => {
        if (Array.from(li.children).map(x => x.nodeName).includes("P") ){
            return tokenize_page(li)
        } else {
            return tokenize_li(li)
        }
    })
    .map(contents => {
        const { firstline, children } = arrange_children(contents)
        if (elem.nodeName == "UL"){
            return to_block({type:"ULITEM", firstline, children})
        } else {
            return to_block({type:"OLITEM", firstline, children})
        }
    })
    return list_items
}


function tokenize_page(
    node: Element,
): Array<BlockObjectRequest>{
    const blocks: Array<BlockObjectRequest> = []
    Array.from(node.children).forEach( child => {
        if (child.nodeName == "P"){
            tokenize_p(child).forEach( tk => blocks.push(tk) )
        }
        else if (child.nodeName == "A" && child.getAttribute("style") != "display: none"){
            const link = child.getAttribute("href")
            if (link === null){
                throw new Error("A-element doen not have 'href'.")
            }
            blocks.push( to_block({ type: "BOOKMARK", link}) )
        }
        else if (child.nodeName == "BR"){
            blocks.push( to_block({ type: "BR"}) )
        }
        else if (child.nodeName == "UL" || child.nodeName == "OL") {
            tokenize_list(child).forEach(bl => blocks.push(bl))
        }
        else if (["H1", "H2", "H3", "H4", "TABLE", "HR", "IMG", "SECTION", "BLOCKQUOTE", "BLOCKQUOTE", "ASIDE", "DETAILS", "DIV"].includes(child.nodeName)) {
            blocks.push(tokenize_other(child))
        }
    })
    return blocks
}


function to_richtx(
    type:"text" | "equation",
    text: string,
    link = "",
): Array<Required<RichTextItemRequest>> {
    if (text.length > 2000){
        text = text.slice(0,2000)
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


function set_annos(
    tx_obj: Array<Required<RichTextItemRequest>>,
    annos: Array<string>,
){
    if (annos.length == 0){ return tx_obj }
    annos.forEach(an => {
        if (an=="EM"){ tx_obj[0].annotations.italic = true }
        else if (an=="STRONG"){ tx_obj[0].annotations.bold = true }
        else if (an=="S"){ tx_obj[0].annotations.strikethrough = true }
        else if (an=="CODE"){ tx_obj[0].annotations.code = true }
    })
    return tx_obj
}


function to_block(
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


function set_record_and_get_childs(
    input: {
        count: number,
        block: BlockObjectRequest,
        thread_idx: string,
        scrap_idx: string,
        self_id: string,
        parent_id: null|string
        dict: Record<string, ScrapBlockInfo>,
    } | {
        count: number,
        block: BlockObjectRequest,
        self_id: string,
        parent_id: null|string
        dict: Record<string, BlockInfo>,
    }
) {
    const { count, self_id, block, dict, parent_id } = input
    if ("thread_idx" in input){
        const { thread_idx, scrap_idx } = input
        dict[self_id] = { self_id, notion_id: "", thread_idx, scrap_idx, block, parent_id }
    } else {
        dict[self_id] = { self_id, notion_id: "", block, parent_id }
    }
    

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
        if ("thread_idx" in input){
            const { thread_idx, scrap_idx } = input
            set_record_and_get_childs({
                count: count-1, block: child, thread_idx, scrap_idx, self_id:child_id, dict, parent_id:self_id
            })
        } else {
            set_record_and_get_childs({
                count: count-1, block: child, self_id:child_id, dict, parent_id: self_id
            })
        }
        
        return child_id
    })
    return child_ids
}


function nest_count(
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


export async function scrap_to_blocks(
    url: string,
){
    const response = await fetch(url, {method: "GET"})
    const text = await response.text()
    const document = new DOMParser().parseFromString(text, "text/html")

    if (document === null){ throw new Error() }

    const page_title = document.getElementsByClassName("View_title__ASFih")[0].innerText
    const topics = document.getElementsByClassName("TopicList_container__bqtFg")[0].innerText.split("\n")
    const author = document.getElementsByClassName("SidebarUserBio_name__6kFYE")[0].innerText

    let icon: CreatePageBodyParameters["icon"]
    const author_img_src = document.getElementsByClassName("SidebarUserBio_container__kwCsb")[0].getElementsByTagName("img")[0].getAttribute("src")
    if (author_img_src !== null && VALID_IMAGEFILE.includes(author_img_src.split(".").reverse()[0])){
        icon = { type: "external", external: {url:author_img_src} }
    } else {
        icon = { type: "emoji", emoji: "📑" }
    }

	const scraps: Array<UnitScrap> = []

    Array.from(document.getElementsByClassName("ScrapThread_item__4G_47"))
    .forEach( (items, th_idx) => {
        const thread_idx = `${th_idx}`
        Array.from(items.getElementsByClassName("znc BodyCommentContent_bodyCommentContainer__WXWq0"))
        .forEach( (scrap_node, sc_idx) =>  {
            const scrap_idx = `${th_idx}_${sc_idx}`
            const content = tokenize_page(scrap_node)
            if (scrap_node.parentElement !== null
                && scrap_node.parentElement.parentElement !== null
                && scrap_node.parentElement.parentElement.previousElementSibling !== null
            ){
                const date_time = scrap_node.parentElement.parentElement.previousElementSibling.getElementsByClassName("ThreadItemContent_date__kLnfZ")[0].getAttribute("dateTime")
                scraps.push({thread_idx, scrap_idx, date_time, content })
            } else {
                scraps.push({thread_idx, scrap_idx, date_time: null, content })
            }
        })
    })
    
    const block_info: Record<string, ScrapBlockInfo> = {}

	block_info["blank"] = {
		self_id: "blank", notion_id: "",
		thread_idx: "", scrap_idx: "",
		block: { object: "block", type: "paragraph", paragraph: {rich_text: []} },
		parent_id: null
	}
	block_info["divider"] = {
		self_id: "divider", notion_id: "",
		thread_idx: "", scrap_idx: "",
		block: { object: "block", type: "divider", divider: {} },
		parent_id: null
	}

    const refere_id = crypto.randomUUID()
    block_info[refere_id] = {
        self_id: refere_id, notion_id: "",
        thread_idx: "", scrap_idx: "",
        block: { object: "block", type:"quote", quote: { rich_text: to_richtx("text", "オリジナルの web ページ", url) }},
        parent_id: null
    }
    
	let topblock_ids: Array<string> = [ refere_id ]
	let children_ids: Array<string> = []
	let thread_number = "0"
	let max = 0

    scraps.forEach((scrap) => {
        const {thread_idx, scrap_idx} = scrap
        const block_ids: Array<string> = []
        scrap.content.forEach((block, idx) => {
            const count = nest_count(0, block)
            if (max < count) {
                max = count
            }
            const self_id = crypto.randomUUID()
            const child_ids = set_record_and_get_childs({count, block, thread_idx, scrap_idx, self_id, dict: block_info, parent_id: null})
            if (child_ids.length > 0){
                children_ids = [...children_ids, ...child_ids]
            }
            if (block.type == "callout" && block.callout.rich_text[0].type=="text"&& block.callout.rich_text[0].text.content == "注釈"){
                block_ids.push("blank")
            }
            else if (block.type == "heading_3" && scrap.content[idx-1].type != "heading_1" && scrap.content[idx-1].type != "heading_2" ){
                block_ids.push("blank")
            }
            block_ids.push(self_id)
        })
        if (thread_idx != thread_number) {
            topblock_ids = [...topblock_ids, "blank", "divider", "blank", ...block_ids]
            thread_number = thread_idx
        } else {
            topblock_ids = [...topblock_ids, "blank", "blank", ...block_ids]
        }
    })
    
    const body_data = {
		title: to_richtx("text", page_title),
        author,
		topics,
        icon,
        max,
		topblock_ids,
		children_ids,
		data: block_info
	}

    return body_data
}


export async function article_to_blocks(
    url: string,
){
    const response = await fetch(url, {method: "GET"})
    const text = await response.text()
    const document = new DOMParser().parseFromString(text, "text/html")

    if (document === null){ throw new Error() }

    const page_title = document.getElementsByClassName("ArticleHeader_title__ytjQW")[0].innerText
    const icon: CreatePageBodyParameters["icon"] = { type:"emoji", emoji:document.getElementsByClassName("Emoji_nativeEmoji__JRjFi")[0].innerText as EmojiRequest}
    const author = document.getElementsByClassName("SidebarUserBio_name__6kFYE")[0].innerText
    const datetime = document.getElementsByTagName("time")[0].attributes["datetime"]
	

    const article_body = document.getElementsByClassName("znc BodyContent_anchorToHeadings__Vl0_u")[0]
    const content = tokenize_page(article_body)
    
    const block_info: Record<string, BlockInfo> = {}

	block_info["blank"] = {
		self_id: "blank", notion_id: "",
		block: { object: "block", type: "paragraph", paragraph: {rich_text: []} },
		parent_id: null
	}
	block_info["divider"] = {
		self_id: "divider", notion_id: "",
		block: { object: "block", type: "divider", divider: {} },
		parent_id: null
	}

    const refere_id = crypto.randomUUID()
    block_info[refere_id] = {
        self_id: refere_id, notion_id: "",
        block: { object: "block", type:"quote", quote: { rich_text: to_richtx("text", "オリジナルの web ページ", url) }},
        parent_id: null
    }
    
    
    const topblock_ids: Array<string> = ["blank", refere_id, "blank", "blank"]
	let children_ids: Array<string> = [ ]
	let max = 0
    
    content.forEach((block, idx) => {
        const count = nest_count(0, block)
        if (max < count) {
            max = count
        }
        const self_id = crypto.randomUUID()
        const child_ids = set_record_and_get_childs({count, block, self_id, dict: block_info, parent_id: null})
        if (child_ids.length > 0){
            children_ids = [...children_ids, ...child_ids]
        }
        if (block.type == "callout" && block.callout.rich_text[0].type=="text"&& block.callout.rich_text[0].text.content == "注釈"){
            topblock_ids.push("blank")
        }
        else if (block.type == "heading_3" && content[idx-1].type != "heading_1" && content[idx-1].type != "heading_2" ){
            topblock_ids.push("blank")
        }
        topblock_ids.push(self_id)
    })

    
    const body_data = {
		title: to_richtx("text", page_title),
        author,
		icon,
        datetime,
        max,
		topblock_ids,
		children_ids,
		data: block_info
	}

    return body_data
}


export async function zenn_to_blocks(
    url: string
) {
    if (url.includes("articles")){
        const { title, icon, topblock_ids, max, data  } = await article_to_blocks(url)
        if (max >= 3) { throw new Error("some nests are too deep") }
        const children = topblock_ids.map(id => data[id].block)
        const properties = {title}
        return { properties, icon, children }
    }
    else if (url.includes("scraps")){
        const { title, icon, topblock_ids, max, data } = await scrap_to_blocks(url)
        if (max >= 3) { throw new Error("some nests are too deep") }
        const children = topblock_ids.map(id => data[id].block)
        const properties = {title}
        return { properties, icon, children }
    }
    else {
        throw new Error("invalid input")
    }
}