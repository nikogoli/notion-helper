import {
    Client,
    APIResponseError
} from "https://deno.land/x/notion_sdk/src/mod.ts"

import {
    BlockObjectResponse,
    ListBlockChildrenResponse,
    QueryDatabaseResponse,
    RichTextItemResponse,
} from "https://deno.land/x/notion_sdk/src/api-endpoints.ts"


const BLANK_PARAGRAPH_TO = "\n<br>\n" // or "\n\n"
const CONVERT_CALLOUT_TO_MESSAGE = true
const EMOJI_FOR_PAGE_LINK = "\u{1F4C4}" // or ""


type QueryResp = Extract<QueryDatabaseResponse["results"][number], {url:string}>
type QueryRespValue = QueryResp["properties"][keyof QueryResp["properties"]]

type ValidResultItem = Extract<QueryDatabaseResponse["results"][number], {url: string}>
type PropsStredResultItem = Omit<ValidResultItem, "properties"> & {properties: Record<string, string>}


function md_link(
    text:string
): string{
    return "#" + text.replaceAll("#","").trim().toLowerCase()
        .replaceAll(/[\!@#\$%\^&\*\(\)\+\|~=\\`\[\]\{\};':\"\,\./\<\>\?]/g, "")
        .replaceAll(" ", "-")
        .replaceAll("　", "")
        .replaceAll(/[！＠＃＄％＾＆＊（）＋｜〜＝￥｀「」｛｝；’：”、。・＜＞？【】『』《》〔〕［］‹›«»〘〙〚〛]/g, "")
}


function eval_mention(
    obj: Extract<RichTextItemResponse, {type:"mention"}>,
    text: string
): string{
    if (text=="Untitled"){
        text = "Integration-cannot-access page"
    }
    switch (obj.mention.type){
        case "database":
        case "page":
            return `[${EMOJI_FOR_PAGE_LINK}${text}](${obj.href})`
        case "date":
            return text
        case "link_preview":
            return `[${text}](${obj.mention.link_preview.url})`
        case "template_mention":
            return text
        case "user":
            return `${text} (id:${obj.mention.user.id})`
    }
}


function richtext_to_text(
    obj: []|Array<RichTextItemResponse>
): string{
    if (obj.length==0) { return BLANK_PARAGRAPH_TO }
    const text_list = obj.map(cell => {
        let {plain_text} = cell
        const { bold, italic, strikethrough, code } = cell.annotations
        if (code) { plain_text = "`"+plain_text+"`" }
        if (bold) { plain_text = `**${plain_text}**` }
        if (italic) { plain_text = `*${plain_text}*` }
        if (strikethrough) { plain_text = `~~${plain_text}~~` }

        switch (cell.type){
            case "text":
                return plain_text
            case "equation":
                return "$" + cell.equation.expression + "$"
            case "mention":
                return eval_mention(cell, plain_text)
        }
    })
    return text_list.join("")//.replaceAll("\n", "<br>")
}


async function extract_text_from_colmun(
    notion: Client,
    obj:Extract<BlockObjectResponse, {type:"column_list"}>,
    nest_count: number
): Promise<string> {
    const { results } = await notion.blocks.children.list({block_id: obj.id})
    const id_list = results.reduce((list, col) => {
        if ("type" in col && col.has_children){ list.push(col.id) }
        return list
    }, [] as Array<string>)
    if (id_list.length==0) { throw new Error("invalid column list") }

    const inner_blocks: Array<BlockObjectResponse> = []
    await id_list.reduce((promise, id) => {
        return promise.then(async () => {
            await notion.blocks.children.list({block_id: id})
            .then(response => response.results.forEach(item => {
                    if ("type" in item){ inner_blocks.push(item) }
                })
            )
        } )
    }, Promise.resolve())
    if (inner_blocks.length==0){ throw new Error("invalid column") }

    const extracted: Array<string> = []
    await inner_blocks.reduce( (promise, block) => {
        return promise.then(async () => {
            extracted.push(await extract_text(notion, block, nest_count))
        })
    }, Promise.resolve())
    return extracted.join("\n")
}


async function extract_from_callout(
    notion: Client,
    obj: Extract<BlockObjectResponse, {type:"callout"}>,
    nest_count: number,
    as_message: boolean
): Promise<string> {
    const tabs = (nest_count>0) ? [...Array(nest_count).keys()].map(_x => "  ").join("") : ""
    let block_text = richtext_to_text(obj.callout.rich_text)
    if (obj.callout.icon!==null){
        const {icon} = obj.callout
        if (icon.type=="emoji"){
            block_text = icon.emoji + block_text
        }
        else if (icon.type=="file" || icon.type=="external"){
            const {url} = ("file" in icon) ? icon.file : icon.external
            block_text = `![](${url}) ` + block_text
        }
        else { throw new Error("invalid icon") }
    }

    if (obj.has_children){
        const { results } = await notion.blocks.children.list({block_id: obj.id})
        const nested = results.filter(x => "type" in x) as Array<BlockObjectResponse>
        await nested.reduce( (promise, item) => {
        return promise.then(async () => {
            const text = await extract_text(notion, item, nest_count+1)
            block_text = block_text + "\n" + text
        })
    }, Promise.resolve()) }

    if (as_message){
        return `\n${tabs}:::message\n${tabs}${block_text}\n${tabs}:::`
    } else {
        return  "\n" + tabs + block_text
    }
}


async function extract_text_from_syns(
    notion: Client,
    obj: Extract<BlockObjectResponse, {type:"synced_block"}>,
    nest_count: number
): Promise<string> {
    let inner_blocks: Array<BlockObjectResponse>
    if (obj.synced_block.synced_from === null){
        const { results } = await notion.blocks.children.list({block_id: obj.id})
        inner_blocks = results.filter(x => "type" in x) as Array<BlockObjectResponse>
    } else {
        try {
            const origin_id = obj.synced_block.synced_from.block_id
            const { results } = await notion.blocks.children.list({block_id: origin_id})
            inner_blocks = results.filter(x => "type" in x) as Array<BlockObjectResponse>         
        } catch (e) {
            const APIerror = e as APIResponseError
            if (APIerror.code =="object_not_found"){
                return `Failed to get a synced block. The original block (id:${obj.synced_block.synced_from.block_id}) does not exist, or the integration does not have access to it or its parent page.`
            } else {
                throw new Error(e)
            }
        }
    }

    const extracted: Array<string> = []
    await inner_blocks.reduce( (promise, block) => {
        return promise.then(async () => {
            extracted.push(await extract_text(notion, block, nest_count))
        })
    }, Promise.resolve())
    return extracted.join("\n")
}


async function extract_text_from_tabel(
    notion: Client,
    obj:Extract<BlockObjectResponse, {type:"table"}>,
    nest_count: number
): Promise<string> {
    const { results } = await notion.blocks.children.list({block_id: obj.id})
    const { table_width, has_column_header } = obj.table

    const config_row = [...Array(table_width).keys()].reduce((pre, _x) => pre + " --- |", "|")
    const tabs = (nest_count>0) ? [...Array(nest_count).keys()].map(_x => "  ").join("") : ""

    const table_mds: Array<string> = []
    results.forEach(item => {
        if ("type" in item && item.type=="table_row"){
            const md = item.table_row.cells.map(cell => (cell.length) ? richtext_to_text(cell) : " " ).join(" | ")
            table_mds.push(`${tabs}| ${md} |`)
        }
    })
    if (table_mds.length == 0) {throw new Error("table rows do not exist")}

    if (has_column_header) {
        return [table_mds[0], config_row].concat(table_mds.slice(1)).join("\n")
    } else {
        const blank_header = config_row.replaceAll("---", "   ")
        return [blank_header, config_row].concat(table_mds).join("\n")
    }
}


async function create_table_from_database(
    notion: Client,
    obj:Extract<BlockObjectResponse, {type:"child_database"}>,
    nest_count: number
) : Promise<string> {
    const tabs = (nest_count>0) ? [...Array(nest_count).keys()].map(_x => "  ").join("") : ""
    const linked_text = `${tabs}[${EMOJI_FOR_PAGE_LINK}${obj.child_database.title}](https://www.notion.so/${obj.id.replaceAll("-","")})`
    const tabble_md = arrange_table( await notion.databases.query({database_id: obj.id}) )

    return linked_text + "\n" + tabs + tabble_md.replaceAll("\n", "\n"+tabs) + "\n"
}



async function extract_text(
    notion: Client,
    blockobj:BlockObjectResponse,
    nest_count = 0
): Promise<string> {

    function from_filelike(
        obj: Extract<BlockObjectResponse, {type:"audio"|"file"|"image"|"pdf"|"video"}>
    ):string{
        let inner_block: Extract<BlockObjectResponse, {type:"file"}>["file"]
        switch (obj.type){
            case "audio":
                inner_block = obj.audio
                break
            case "file":
                inner_block = obj.file
                break
            case "image":
                inner_block = obj.image
                break
            case "pdf":
                inner_block = obj.pdf
                break
            case "video":
                inner_block = obj.video
                break
        }
        const file_url = (inner_block.type=="external")
            ? inner_block.external.url
            : inner_block.file.url
        let caption = richtext_to_text(inner_block.caption)
        if (caption == BLANK_PARAGRAPH_TO) {caption = obj.type }
        if (obj.type == "image") { return `![${caption}](<${file_url}>)` }
        else { return `[${caption}](<${file_url}>)` }
    }

    function from_embedlike(
        obj: Extract<BlockObjectResponse, {type:"bookmark"|"embed"}>
    ){
        let inner_block: Extract<BlockObjectResponse, {type:"bookmark"}>["bookmark"]
        switch (obj.type){
            case "bookmark":
                inner_block = obj.bookmark
                break
            case "embed":
                inner_block = obj.embed
                break
        }
        //let caption = richtext_to_text(inner_block.caption)
        //if (caption == BLANK_PARAGRAPH_TO) {caption = obj.type }
        //return `[${caption}](<${inner_block.url}>)`
        return inner_block.url
    } 

    const tabs = (nest_count>0) ? [...Array(nest_count).keys()].map(_x => "  ").join("") : ""

    let block_text:string
    switch (blockobj.type){
        // ------------------ children ごと文字列化して return する specific な処理
        case "breadcrumb": // 諦める
            return "breadcrumb"
        case "table_of_contents": // 最後に差し替える
            return "INSERT_TABLE_OF_CONTENTS_HERE"
        case "child_database":
            return await create_table_from_database(notion, blockobj, nest_count)
        case "child_page":
            return `${tabs}[${EMOJI_FOR_PAGE_LINK}${blockobj.child_page.title}](https://www.notion.so/${blockobj.id.replaceAll("-","")})`
        case "callout": 
            return await extract_from_callout(notion, blockobj, nest_count, CONVERT_CALLOUT_TO_MESSAGE)
        case "column_list":
            return await extract_text_from_colmun(notion, blockobj, nest_count)
        case "link_to_page":{
            const id = ("page_id" in blockobj.link_to_page) ? blockobj.link_to_page.page_id : blockobj.link_to_page.database_id
            return `${tabs}[link_to_page](https://www.notion.so/${ id.replaceAll("-","")})` }
        case "synced_block":
            return await extract_text_from_syns(notion, blockobj, nest_count)
        case "table":
            return await extract_text_from_tabel(notion, blockobj, nest_count)
        case "template": // よくわからないので放置
            return "template"

        case "column": // これを対象に extract_text が呼ばれることはない
        case "table_row": // 上に同じ
            throw new Error("Unexpected block")

        // ------------------ return するかどうかは children の有無で決める general な処理
        case "audio":
            block_text = "\n" + tabs + from_filelike(blockobj)
            break
        case "bookmark":
            block_text = "\n" + tabs + from_embedlike(blockobj) + "\n"
            break 
        case "bulleted_list_item":
            block_text =  "- " + richtext_to_text(blockobj.bulleted_list_item.rich_text)
            break
        case "code": {
            const {language, rich_text} = blockobj.code
            block_text = `\n${tabs}\`\`\`${language}\n${tabs}${richtext_to_text(rich_text)}\n${tabs}\`\`\`\n`
            break }
        case "divider":
            block_text = "\n" + tabs + "------"
            break
        case "embed":
            block_text = "\n" + tabs + from_embedlike(blockobj) + "\n"
            break
        case "equation":
            block_text = `\n${tabs}\$\$\n${tabs}${blockobj.equation.expression}\n${tabs}\$\$\n`
            break
        case "file":
            block_text =  "\n" + tabs + from_filelike(blockobj)
            break
        case "heading_1": {
            block_text = "\n" + tabs + "# " + richtext_to_text(blockobj.heading_1.rich_text)
            if (blockobj.has_children){ nest_count -= 1 }
            break }
        case "heading_2": {
            block_text = "\n" + tabs + "## " + richtext_to_text(blockobj.heading_2.rich_text)
            if (blockobj.has_children){ nest_count -= 1 }
            break }
        case "heading_3": {
            block_text = "\n" + tabs + "### " + richtext_to_text(blockobj.heading_3.rich_text)
            if (blockobj.has_children){ nest_count -= 1 }
            break }
        case "image":
            block_text = "\n" + tabs + from_filelike(blockobj)
            break
        case "link_preview":
            block_text = "\n" + tabs + blockobj.link_preview.url
            break
        case "numbered_list_item":
            block_text = "1. " + richtext_to_text(blockobj.numbered_list_item.rich_text)
            break
        case "paragraph":
            block_text = richtext_to_text(blockobj.paragraph.rich_text)
            break
        case "pdf":
            block_text = "\n" + tabs + from_filelike(blockobj)
            break
        case "quote":
            block_text = "> " + richtext_to_text(blockobj.quote.rich_text) + "\n"
            break
        case "to_do": {
            const checked = (blockobj.to_do.checked) ? "[x] ": "[ ] "
            const text = richtext_to_text(blockobj.to_do.rich_text)
            block_text = "- " + checked + text
            break }
        case "toggle":
            block_text = "- " + richtext_to_text(blockobj.toggle.rich_text)
            break
        case "video":
            block_text = "\n" + tabs + from_filelike(blockobj)
            break
        case "unsupported":
            block_text = "unsupported block"
            break

        default:
            throw new Error
    }

    if (blockobj.has_children){
        const { results } = await notion.blocks.children.list({block_id: blockobj.id})
        const nested = results.filter(x => "type" in x) as Array<BlockObjectResponse>
        await nested.reduce( (promise, item) => {
            return promise.then(async () => {
                const text = await extract_text(notion, item, nest_count+1)
                block_text = block_text + "\n" + text
            })
        }, Promise.resolve())
    }
    return tabs + block_text
}


export async function extract(
    notion: Client,
    response: ListBlockChildrenResponse
): Promise<string>{
    const { results } = response
    const extracted: Array<string> = []
    const top_blocks = results.filter(x => "type" in x) as Array<BlockObjectResponse>
    await top_blocks.reduce( (promise, item) => {
        return promise.then(async () => {
            extracted.push( await extract_text(notion, item))
        } )
    }, Promise.resolve() )
    let md = extracted.join("\n")

    if (md.includes("INSERT_TABLE_OF_CONTENTS_HERE")){
        const headings = md.match(/\t*?#+? .+?\n/g)
        if (headings!==null){
            const conts_tb = [...headings].map(t => {
                const [tabs, ...texts] = t.trim().split(" ")
                const link = md_link(t)
                return `${tabs.slice(1).replaceAll("#","  ")}- [**${texts.join(" ")}**](${link})`
            })
            if (conts_tb[0][0]==" ") { conts_tb[0] = conts_tb[0].trimStart()}
            md = md.replace("INSERT_TABLE_OF_CONTENTS_HERE", conts_tb.join("\n"))
        }
    }
    return md
}


function extract_prop_text(prop_obj: QueryRespValue): string{
    function from_rollup(obj: Extract<QueryRespValue, {type:"rollup"}>["rollup"]): string{
        const {type} = obj
        switch (type){
            case "number": return String(obj.number)
            case "date": return (obj.date!==null) ? obj.date.start : "" 
            case "array": return obj.array.map(x => extract_prop_text(x as QueryRespValue)).join()
            default:  throw new Error
        }
    }
    function from_formula(obj: Extract<QueryRespValue, {type:"formula"}>["formula"]): string{
        const {type} = obj
        switch (type){
            case "string": return obj.string ?? ""
            case "number": return (obj.number!==null) ? String(obj.number) : ""
            case "date": return (obj.date!==null) ? obj.date.start : ""
            case "boolean": return (obj.boolean!==null) ? String(obj.boolean) : ""
            default: throw new Error
        }
    }

    const {type} = prop_obj
    switch (type) {
        case "checkbox":
            return String(prop_obj.checkbox)
        case "created_by": {
            const by = prop_obj.created_by
            return ("name" in by) ? by.name ?? by.id : by.id }
        case "created_time":
            return prop_obj.created_time
        case "date":
            return (prop_obj.date!==null) ? prop_obj.date.start : ""
        case "email":
            return prop_obj.email ?? ""
        case "files":
            return prop_obj.files.map(f=> ("file" in f) ? f.file.url : f.external.url ).join()
        case "formula":
            return from_formula(prop_obj.formula)
        case "last_edited_by": {
            const by = prop_obj.last_edited_by
            return ("name" in by) ? by.name ?? by.id : by.id }
        case "last_edited_time":
            return prop_obj.last_edited_time
        case "multi_select":
            return prop_obj.multi_select.map(s=> s.name).join()
        case "number":
            return (prop_obj.number!==null) ? String(prop_obj.number) : ""
        case "people":{
            const pp = prop_obj.people
            return pp.map(p => ("name" in p) ? p.name ?? p.id : p.id).join() }
        case "phone_number":
            return prop_obj.phone_number ?? ""
        case "relation":
            return prop_obj.relation.map(r=>r.id).join()
        case "rich_text":
            return richtext_to_text(prop_obj.rich_text)
        case "rollup":
            return from_rollup(prop_obj.rollup)
        case "select":
            return (prop_obj.select!==null) ? prop_obj.select.name : ""
        case "title":
            return richtext_to_text(prop_obj.title)
        case "url":
            return prop_obj.url ?? ""
        default:
            throw new Error
    }
}



export function get_and_extract_data(
    response: QueryDatabaseResponse
) :Array<PropsStredResultItem>{
    const {results} = response
    const indexed_data: Array<PropsStredResultItem> = []
    results.forEach(item => {
        if ("properties" in item) {
            const { properties, ...rest } = item
            const copied = { properties:{temp:"temp"} as Record<string, string>, ...rest}
            const extracted = {} as Record<string, string>
            Object.keys(properties).forEach( key => {
                if (properties[key].type == "title") {
                    extracted[key+"(TITLE)"] = extract_prop_text(properties[key])
                } else {
                    extracted[key] = extract_prop_text(properties[key])
                }
            })
            copied["properties"] = extracted
            indexed_data.push(copied)
        }
    })
    return indexed_data
}


export function arrange_table(
    response: QueryDatabaseResponse
): string {
    const data = get_and_extract_data(response)
    const col_labels = Object.keys(data[0].properties).reduce((pre,lb) => {
        if (lb.includes("(TITLE)")) {
            pre[0] = [lb]
        } else {
            pre[1].push(lb)
        }
        return pre
    }, [[],[]] as Array<Array<string>>)
    .reduce((pre, now, idx) => {
        if (idx==0){ pre.push(now[0]) }
        else { now.sort().reverse().forEach(x => pre.push(x)) }
        return pre
    }, [] as Array<string>)

    const header_row = col_labels.reduce((pre, lb) => `${pre} ${lb} |`, "|").replace("(TITLE)","")
    const config_row = col_labels.reduce((pre, _lb) => `${pre} --- |`, "|")

    const row_mds = data.map(d => {
        const {created_by, last_edited_by, created_time, url, properties} = d
        return col_labels.map(lb => properties[lb]).reduce((pre, text, idx) => {
            if (idx==0) { text = `[${text}](${url})` }
            return `${pre} ${text} |`
        }, "|")
    })

    return [header_row, config_row, ...row_mds].join("\n")
}