import {
    EmojiRequest,
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
    ScrapInfo,
    TokenizeError,
    UnitScrap,
    VALID_IMAGEFILE,
} from "./mod.ts";


function embed_to_block (
    elem: Element
): {type: "block", block: BlockObjectRequest} | {type: "error", error:TokenizeError}  {
    const [ _zenn, embed_type ] = elem.classList
    let name = ""
    const default_block: Extract<BlockObjectRequest, {type?:"callout"}> = { type:"callout", callout: { color: "default", rich_text: to_richtx("text", `埋め込み要素 ${name} (取得不可能) `) }}

    if (embed_type === undefined){        
        return { type: "block", block: default_block }
    }

    const a_elem = elem.nextElementSibling
    if (a_elem === null){
        return { type: "error", error: { msg: "failed to get corresponding A-element", type:"unexpected node-tree", elem } }
    }

    const link = a_elem.getAttribute("href")
    if (link === null){
        return { type:"error", error: { msg: "A-element does not have 'href'", type:"attribute missing", elem: a_elem } }
    }

    switch (embed_type){
        case "zenn-embedded-link-card":
        case "zenn-embedded-github":
            return { type: "block", block: create_block({ type: "BOOKMARK", link}) }
        case "zenn-embedded-tweet":
            return { type: "block", block: { type:"embed", embed:{ url: link } }}
        default:{
            name = embed_type.split("-").reverse()[0]
            return { type: "block", block: default_block }
        }
    } 
}


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
        else if (child_nd.nodeName == "EMBED-KATEX"){
            elements.shift()
            plaintx_to_richtx(child_nd).forEach( tx => texts.push(tx) )
        }
        else if ( ["A", "SUP", "CODE", "STRONG", "EM", "S"].includes(child_nd.nodeName)){
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
                if (elem.nextElementSibling?.nodeName == "BR"){
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
            else if (elem.nodeName == "TABLE"){
                const text = elem.innerHTML.replaceAll("\n", "").replaceAll(/\<\/th\>\<\/tr\>|\<\/td\>\<\/tr\>/g,"\n")
                    .replaceAll(/\<\/th\>|\<\/td\>/g,"\t").replaceAll(/\<.+?\>/g, "").trimEnd()
                blocks.push( create_block({type: "TABLE", text}) )
            }
            else if (elem.nodeName == "HR"){
                blocks.push( create_block({ type: "HR" }) )
            }
            else if (elem.nodeName == "IMG"){
                const link = elem.getAttribute("src")
                if (link !== null){
                    blocks.push( create_block({ type: "IMG", link }) )
                } else {
                    errors.push({ msg: "IMG-element does not have 'src'", type:"attribute missing", elem})
                }
            }
            else if (elem.nodeName == "SECTION"){
                if (elem.className == "footnotes") {
                    const firstline: Extract<BlockObjectRequest, {type?:"paragraph"}> = { type: "paragraph", paragraph:{ rich_text: to_richtx("text", "注釈")} }
                    const children = Array.from(elem.getElementsByClassName("footnote-item"))
                        .map(item => item.getElementsByTagName("p")[0])
                        .map(p => {
                            const { firstline, children } = arrange_children( to_blocks(p) )
                            return create_block({ type:"OLITEM", firstline, children })
                        })
                    blocks.push( create_block({ type:"FOOTNOTE", firstline, children }) )
                }
                else if (elem.className == "zenn-katex"){
                    blocks.push( create_block({ type:"EQUATION", text: elem.innerText.split("\n")[1] }) )
                } else {
                    errors.push({ msg: "This SECTION-element is not implemented", type:"not implemented", elem })
                }
            }
            else if (elem.nodeName == "BLOCKQUOTE"){
                const { firstline, children } = arrange_children( to_blocks(elem) )
                blocks.push( create_block({ type:"BLOCKQUOTE", firstline, children }) )
            }
            else if (elem.nodeName == "ASIDE"){
                if (elem.className == "msg message" || elem.className == "msg alert"){
                    const kind = (elem.className.split(" ")[1] == "message") ? "message": "alert"
                    const content_node = elem.getElementsByClassName("msg-content")[0]
                    const { firstline, children } = arrange_children( to_blocks(content_node) )
                    blocks.push( create_block({ type:"MESSAGE", kind, firstline, children }) )
                } else {
                    errors.push({ msg: "This ASIDE-element is not implemented", type:"not implemented", elem })
                }
            }
            else if (elem.nodeName == "DETAILS"){
                const title = elem.getElementsByTagName("summary")[0].innerText
                const content_node = elem.getElementsByClassName("details-content")[0]
                const firstline: Extract<BlockObjectRequest, {type?:"paragraph"}>  = { type:"paragraph", paragraph:{ rich_text: to_richtx("text", title) } }
                const children = to_blocks(content_node)
                blocks.push( create_block({ type:"DETAILS", firstline, children }) )
            }
            else if (elem.nodeName == "DIV"){
                const [base_class, ..._others] = elem.classList
                if ( base_class == "code-block-container" ) {
                    const code_node = elem.getElementsByTagName("code")[0]
                    const language = (code_node.className!="") ? code_node.className.split("-").reverse()[0] : "plain text"
                    blocks.push( create_block({ type:"CODE", language, text:code_node.innerText.slice(0, -1) }) )
                }
                else if ( base_class == "zenn-embedded"){
                    const result = embed_to_block(elem)
                    if (result.type == "block"){
                        blocks.push(result.block)
                    } else {
                        errors.push(result.error)
                    }
                }            
                else if ( base_class.startsWith("embed-") ){
                    const iframe = elem.children[0]
                    const link = iframe.getAttribute("src")
                    if (link !== null){
                        blocks.push( { type:"embed", embed: {url: link} } )
                    } else {
                        blocks.push( { type:"callout", callout: { color: "default", rich_text: to_richtx("text", "埋め込み要素(取得失敗)") } } )
                    }
                } 
                else {
                    errors.push({ msg: "This DIV-element is not implemented", type:"not implemented", elem })
                }
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


export async function zenn_scrap_to_blocks(
    url: string,
    html: null | string = null
): Promise<{ok: true, data: PageData<ScrapInfo>} | {ok: false, data:Record<string, unknown>}> {
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
                const content = to_blocks(scrap_node)
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
        
        const block_info: Record<string, BlockInfo<ScrapInfo>> = {}

        block_info["blank"] = {
            self_id: "blank",
            notion_id: "",
            options: { thread_idx: "", scrap_idx: "" },
            block: { object: "block", type: "paragraph", paragraph: {rich_text: []} },
            parent_id: null
        }
        block_info["divider"] = {
            self_id: "divider",
            notion_id: "",
            options: { thread_idx: "", scrap_idx: "" },
            block: { object: "block", type: "divider", divider: {} },
            parent_id: null
        }

        const refere_id = crypto.randomUUID()
        block_info[refere_id] = {
            self_id: refere_id, notion_id: "",
            options: { thread_idx: "", scrap_idx: "" },
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
                const options = { thread_idx, scrap_idx }
                const child_ids = set_record_and_get_childs({count, block, options, self_id, dict: block_info, parent_id: null})
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

        return { ok: true, data: body_data }

    } catch(e) {
        return { ok: false, data: e }
    }
}


export async function zenn_article_to_blocks(
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

        const page_title = document.getElementsByClassName("ArticleHeader_title__ytjQW")[0].innerText
        const icon: CreatePageBodyParameters["icon"] = { type:"emoji", emoji:document.getElementsByClassName("Emoji_nativeEmoji__JRjFi")[0].innerText as EmojiRequest}
        const author = document.getElementsByClassName("SidebarUserBio_name__6kFYE")[0].innerText
        const topics = document.getElementsByClassName("ArticleSidebar_topicLinksContainer__kLlbK")[0].innerText.split("\n")
        

        const article_body = document.getElementsByClassName("znc BodyContent_anchorToHeadings__Vl0_u")[0]
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