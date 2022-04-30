import { serve, PathParams } from "https://deno.land/x/sift@0.5.0/mod.ts";
import { ConnInfo } from "https://deno.land/std/http/server.ts";

import { Client} from "https://deno.land/x/notion_sdk/src/mod.ts"
import {
    BlockObjectRequest,
} from "https://deno.land/x/notion_sdk/src/api-endpoints.ts"

import { 
    zenn_article_to_blocks,
    zenn_scrap_to_blocks,
    note_article_to_blocks,
    PageData,
    ScrapInfo,
 } from "https://pax.deno.dev/nikogoli/notion-helper/mod.ts"


type RequestJson = {
    url: string,
    html_doc: string,
    target_id: string,
}


type ToBlockFunc<T> = (url: string, html?: null | string)
    => Promise<{ok: true, data: PageData<T>} | { ok: false, data: Record<string, unknown>}>


const HEADER_OPS = {
    'Access-Control-Allow-Method':  'OPTIONS, POST, PATCH, GET',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Origin, Authorization',
}


async function call_api<T>(
    target_id: string,
    body: PageData<T>,
) {
    const { title, author, topics, icon, max, topblock_ids, children_ids, data } = body
    const children = topblock_ids.map(id => data[id].block)
    const properties = {title}

    const notion = new Client({auth: Deno.env.get("NOTION_TOKEN")})
    const notion_response = await notion.pages.create({
        parent: {page_id: target_id},
        properties: properties,
        icon: icon,
        children: children,
    })
    .catch((e) =>{
        return {ok: false, data: JSON.stringify(e), status: 400 }
    })

    if ( "status" in notion_response ){
        return notion_response
    }    
    else if (children_ids.length == 0 ){
        return { ok: true, data: JSON.stringify(notion_response), status: 200 }
    }
    else if (max >= 4){
        return { ok: true, data: JSON.stringify({...notion_response, message: "Omit children-appending because nest too deep", log: `maximum nest depth is ${max}`}), status: 201 }
    }

    const item_id = notion_response.id    

    let count = 0
    let { results, has_more, next_cursor } = await notion.blocks.children.list({ block_id: item_id })    
    results.forEach( (notion_block, idx) => {
        const id = topblock_ids[idx+100*count]
        if (id in data){ data[id].notion_id = notion_block.id }
    })

    while(has_more && next_cursor){
        count += 1;
        ( { results, has_more, next_cursor } = await notion.blocks.children.list({ block_id: item_id, start_cursor: next_cursor }) )
        results.forEach( (notion_block, idx) => {
            const id = topblock_ids[idx+100*count]
            if (id in data){ data[id].notion_id = notion_block.id }
        })
    }

    const errors: Array<{message: string, block: BlockObjectRequest}> = []
    const id_and_childs: Record<string, Array<BlockObjectRequest>> = {}
    children_ids.forEach( child_id => {
        const { block, parent_id } = data[child_id]
        if (parent_id !== null){
            const notion_id = data[parent_id].notion_id
            if (notion_id.length == 0){
                errors.push({ message:"missing notion-id", block: data[parent_id].block })
            } else {
                id_and_childs[notion_id] = (notion_id in id_and_childs) ? [...id_and_childs[notion_id], block] : [ block ]
            }
        }
    })
    if (errors.length < 0){
        errors.forEach(e => console.log(e))
    }

    const failed_logs: Array<{parent_id:string, error:string}> = []
    await Object.keys(id_and_childs).reduce((promise, id) => {
        return promise.then(async () => {
            await notion.blocks.children.append({block_id: id, children: id_and_childs[id]})
        }).catch((e) =>{
            failed_logs.push({ parent_id: id, error: JSON.stringify(e) })
        } )
    }, Promise.resolve())

    if (failed_logs.length > 0){
        return { ok: true, data: JSON.stringify({...notion_response, message: "Some children-appending failed", logs:failed_logs}), status: 201}
    }
    else if (errors.length > 0){
        return { ok: true, data: JSON.stringify({...notion_response, message: "Some children-appending failed because parents have no notion-id", logs:errors}), status: 201}
    } else {
        return { ok: true, data: JSON.stringify(notion_response), status: 200}
    }
}


function check_url(
    url: string,
): { is_valid: false } | { type: "zenn" | "note", is_valid: true, function: ToBlockFunc<null|ScrapInfo> } {
    if (url.startsWith("https://zenn.dev")){
        const type = "zenn"
        if (url.includes("articles")){
            return { type, is_valid: true, function: zenn_article_to_blocks }
        }
        else if (url.includes("scrap")){
            return { type, is_valid: true, function: zenn_scrap_to_blocks }
        }
        else {
            return { is_valid: false }
        }
    }
    else if (url.startsWith("https://note.com/")){
        const type = "note"
        if (url.includes("/n/")){
            return { type, is_valid: true, function: note_article_to_blocks }
        } else {
            return { is_valid: false }
        }
    } else {
        return { is_valid: false }
    }
}


async function data_to_page(
  	request: Request,
){
    const header_ops = check_origin(request.headers, HEADER_OPS)
    const headers = new Headers(header_ops)

    const auth_head = request.headers.get("Authorization")
    if (auth_head === null || auth_head.split(" ")[1] != Deno.env.get("USER_TOKEN")) {
        return new Response("", {headers, "status" : 401 , "statusText" : "Unauthorized" })
    }

    const request_json: RequestJson = await request.json()
    const { url, html_doc, target_id } = request_json
    
    const checked = check_url(url)
    if (checked.is_valid == false){
        return new Response("not proper URL", {headers: headers, status: 501})
    }

    const toblock_function = checked.function
    const convertion_result = await toblock_function(url, html_doc)
    
    if (convertion_result.ok == false){
        const { name, message, stack } = convertion_result.data
        return new Response(JSON.stringify({name, message, stack}), {headers, status:400})
    }
    
    const { ok, data, status } = await call_api(target_id, convertion_result.data)
    if (ok == false){
        console.log(JSON.parse(data))
    }
    return new Response(data, {headers, status})
}



function check_origin(
    headers: Headers,
    options: Record<string,string>,
){
    const origin = headers.get("origin")
    if (origin == "https://zenn.dev"){
        return {...options,
            'Access-Control-Allow-Origin': 'https://zenn.dev'
        }
    }
    else if (origin == "https://note.com"){
        return {...options,
            'Access-Control-Allow-Origin': 'https://note.com'
        }
    }
    else {
        return options
    }
}



serve({
    "/": (_request: Request) => {
        return new Response("Hellow", {headers: HEADER_OPS, status: 200})
    },

    "/withid/:target/:method": async (
        request: Request,
        _connInfo: ConnInfo,
        params: PathParams
    ) => {
        const headers = check_origin(request.headers, HEADER_OPS)
        console.log(request.headers.get("origin"))
        if (request.method == "OPTIONS"){
            return new Response("options", {headers: headers, status: 200})
        }
        if (params === undefined){
            return new Response("not found", {headers: headers, status: 404})
        }
        const { target, method } = params
        if (target == "pages" && method == "create"){
            return await data_to_page(request)
        } else {
            return new Response("not implemented", {headers: headers, status: 501})
        }
    },

    404: (request: Request) => {
        const headers = check_origin(request.headers, HEADER_OPS)
        if (request.method == "OPTIONS"){
            return new Response("options", {headers: headers, status: 200})
        }
        return new Response("not found", {headers: headers, status: 404})
    },
})


/*
import { serve } from "https://deno.land/std@0.120.0/http/server.ts";

function handler(req: Request): Response {
  console.log(req)
  return new Response("Hello world");
}

console.log("Listening on http://localhost:8000");
await serve(handler);
*/