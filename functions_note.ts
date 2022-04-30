import {
    CreatePageBodyParameters,
    BlockObjectRequest,
    RichTextItemRequest,
} from "https://deno.land/x/notion_sdk/src/api-endpoints.ts"

import {
    DOMParser,
    HTMLDocument,
    Element,
} from "https://deno.land/x/deno_dom/deno-dom-wasm.ts"


import {
    arrange_children,
    create_block,
    nest_count,
    plaintx_to_richtx,
    set_record_and_get_childs,
    to_richtx,
    BlockInfo,
    PageData,
    TokenizeError,
} from "./mod.ts";


function to_blocks(
    element: Element,
    texts: Array<RichTextItemRequest> = []
): Array<BlockObjectRequest>{
    const errors: Array<TokenizeError> = []
    const blocks: Array<BlockObjectRequest> = []
    const elements = Array.from(element.children)
    
    Array.from(element.childNodes).forEach( child_nd => {
        if (child_nd.nodeName == "#text"){
            if (child_nd.textContent.replaceAll("\n", "").replaceAll("　", "") != ""){
                plaintx_to_richtx(child_nd).forEach( tx => texts.push(tx) )
            }
        }
        else if (child_nd.nodeName == "NWC-FORMULA"){
            const elem = elements.shift()
            if (elem === undefined){ 
                console.log(child_nd)
                throw new Error("faild to get the corresponding element for this node")
            }
            const is_block = elem.getAttribute("is-block")
            if (is_block){
                blocks.push(create_block({ type:"EQUATION", text: elem.innerHTML }))
            } else {
                plaintx_to_richtx(elem).forEach( tx => texts.push(tx) )
            }
        }
        else if ( ["A", "CODE", "STRONG", "EM", "S"].includes(child_nd.nodeName)){
            const elem = elements.shift()
            if (elem == undefined){
                console.log(child_nd)
                throw new Error("faild to get the corresponding element for this node")
            }
            if (elem.nodeName != "A" || (elem.nodeName == "A" && elem.getAttribute("style") === null) ){
                const inner_blocks = to_blocks(elem, texts)
                texts = []
                const list = inner_blocks.reduce( (tx_list, block) => {
                    if (block.type == "paragraph"){
                        block.paragraph.rich_text.forEach(tx => tx_list.push(tx))
                        return tx_list
                    } else {
                        if (tx_list.length > 0){
                            blocks.push( create_block({ type:"PARAGRAPH", rich_text: tx_list }) )
                        }
                        blocks.push(block)
                        return []
                    }
                }, [] as Array<RichTextItemRequest>)
                if (list.length > 0){
                    list.forEach(tx => texts.push(tx))
                }
            }
        } else {
            if (texts.length > 0){
                blocks.push( create_block({ type:"PARAGRAPH", rich_text: texts }) )
                texts = []
            }
            const elem = elements.shift()
            if (elem === undefined){ 
                console.log(child_nd)
                throw new Error("faild to get the corresponding element for this node")
            }
            if (elem.nodeName == "P"){
                if (elem.childNodes.length > 0){
                    to_blocks(elem).forEach( tk => blocks.push(tk) )
                    if (elem.nextElementSibling !== null && elem.nextElementSibling.nodeName == "P"){
                        blocks.push({ type:"paragraph", paragraph:{ rich_text: [] } })
                    }
                }
            }
            else if (elem.nodeName == "BR"){
                if (elem.nextSibling?.nodeName == "BR"){
                    blocks.push( create_block({ type: "BR"}) )
                }
            }
            else if (elem.nodeName == "UL" || elem.nodeName == "OL") {
                Array.from(elem.children).map(li => to_blocks(li))
                .map(contents => {
                    const { firstline, children } = arrange_children(contents)
                    blocks.push( (elem.nodeName == "UL") ? create_block({type:"ULITEM", firstline, children}) : create_block({type:"OLITEM", firstline, children})
                    )
                })
            }
            else if (elem.nodeName == "H1"){
                blocks.push( create_block({type: "H1", text: elem.innerText.trimStart()}) )
            }
            else if (elem.nodeName == "H2"){
                blocks.push( create_block({type: "H2", text: elem.innerText.trimStart()}) )
            }
            else if ( ["H3", "H4", "H5", "H6"].includes(elem.nodeName) ){
                blocks.push( create_block({type: "H3", text: elem.innerText.trimStart()}) )
            }
            else if (elem.nodeName == "HR"){
                blocks.push( create_block({ type: "HR" }) )
            }
            else if (elem.nodeName == "FIGURE"){
                const cont_type = elem.getAttribute("embedded-service")
                if (cont_type !== null){
                    const link = elem.getAttribute("data-src")
                    if (link === null){
                        errors.push({ msg: "FIGURE-element does not have 'data-src'", type:"attribute missing", elem})
                    }
                    else if (cont_type == "note" || cont_type == "youtube"){
                        blocks.push( create_block({ type: "BOOKMARK", link}) )
                    }
                    else if (cont_type == "twitter"){
                        blocks.push( { type:"embed", embed:{ url: link} } )
                    }
                    else {
                        errors.push({ msg: "This FIGURE-element is not implemented", type:"not implemented", elem })
                    }
                } else {
                    const [ inner_ele, capition ] = elem.children
                    if (inner_ele.nodeName == "A"){
                        const link = inner_ele.getAttribute("href")
                        if (link === null){
                            errors.push({ msg: "A-element does not have 'href'", type:"attribute missing", elem:inner_ele})
                        }
                        else {
                            blocks.push(create_block({ type:"IMG", link }))
                        }
                    }
                    else if (inner_ele.nodeName == "BLOCKQUOTE"){
                        const p_tag = inner_ele.getElementsByTagName("p")[0]
                        const { firstline, children } = arrange_children( to_blocks(p_tag) )
                        blocks.push( create_block({ type:"BLOCKQUOTE", firstline, children }) )
                    }
                    else {
                        errors.push({ msg: "This inner element is not implemented", type:"not implemented", elem:inner_ele })
                    }
                    if (capition.children.length > 0){
                        to_blocks(capition).forEach(b => blocks.push(b))
                    }
                }
            }
            else if (elem.nodeName == "PRE"){
                const code_node = elem.getElementsByTagName("code")[0]
                const language = (code_node.className!="") ? code_node.className.split(" ").reverse()[0] : "plain text"
                blocks.push( create_block({ type:"CODE", language, text:code_node.innerText }) )
            }
        }
    })
    if (texts.length > 0){
        blocks.push( create_block({ type:"PARAGRAPH", rich_text: texts }) )
        texts = []
    }
    if (errors.length > 0){
        const is_throw = errors.reduce( (bool, er) => {
            console.log({ msg: er.msg, elem: er.elem.outerHTML })
            return (bool) ? bool : er.type != "not implemented"
        }, false)
        if (is_throw){ throw new Error("Some error in block making") }
    }
    return blocks
}


export async function note_article_to_blocks(
    url: string,
    html: null | string = null
): Promise<{ok: true, data: PageData<null>} | {ok: false, data:Record<string, unknown>}> {
    try {
        let document: HTMLDocument | null
        if (html !== null){
            document = new DOMParser().parseFromString(html, "text/html")
        } else {
            const response = await fetch(url, {method: "GET"})
            const text = await response.text()
            document = new DOMParser().parseFromString(text, "text/html")
        }
        if (document === null){ throw new Error() }

        const page_title = document.getElementsByClassName("o-noteContentText__title")[0].innerText.replaceAll(/\s/g, "")
        console.log(page_title)
        const link = document.getElementsByClassName("o-noteEyecatch")[0].children[0].getAttribute("href")
        const icon: CreatePageBodyParameters["icon"] = (link===null) ? null : { type: "external", external: { url: link} }
        const author = document.getElementsByClassName("o-noteContentText__author")[0].innerText.split("\n")[0]
        const topics = document.getElementsByClassName("m-tagList__body")[0].innerText.replaceAll("#", "").split("\n")
        
        
        const article_body = document.getElementsByClassName("note-common-styles__textnote-body")[0]
        const content = to_blocks(article_body)
        
        const block_info: Record<string, BlockInfo<null>> = {}

        block_info["blank"] = {
            self_id: "blank",
            notion_id: "",
            options: null,
            block: { object: "block", type: "paragraph", paragraph: {rich_text: []} },
            parent_id: null
        }
        block_info["divider"] = {
            self_id: "divider",
            notion_id: "",
            options: null,
            block: { object: "block", type: "divider", divider: {} },
            parent_id: null
        }

        const refere_id = crypto.randomUUID()
        block_info[refere_id] = {
            self_id: refere_id,
            notion_id: "",
            options: null,
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
            const options = null
            const child_ids = set_record_and_get_childs({count, block, options, self_id, dict: block_info, parent_id: null})
            if (child_ids.length > 0){
                children_ids = [...children_ids, ...child_ids]
            }
            else if (block.type == "heading_3" && content[idx-1].type != "heading_1" && content[idx-1].type != "heading_2" ){
                topblock_ids.push("blank")
            }
            topblock_ids.push(self_id)
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

        return { ok: true, data: body_data }

    } catch(e) {
        return { ok: false, data: e }
    }
}
