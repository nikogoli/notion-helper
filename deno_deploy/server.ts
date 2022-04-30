import { serve, PathParams } from "https://deno.land/x/sift@0.5.0/mod.ts";
import { ConnInfo } from "https://deno.land/std/http/server.ts";

import { Client} from "https://deno.land/x/notion_sdk/src/mod.ts"
import {
    BlockObjectRequest,
    ListBlockChildrenResponse,
} from "https://deno.land/x/notion_sdk/src/api-endpoints.ts"

import { 
    zenn_article_to_blocks,
    zenn_scrap_to_blocks,
    note_article_to_blocks,
    PageData,
 } from "https://pax.deno.dev/nikogoli/notion-helper/mod.ts"



type RequestJson = {
    url: string,
    html_doc: string,
    target_id: string,
}


type BlockError = {
    block: BlockObjectRequest,
    message: string,
}


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
    let new_page_id: null | string = null
    const notion_response = await notion.pages.create({
        parent: {page_id: target_id},
        properties: properties,
        icon: icon,
        children: children,
    })
    .then( res => {
        if ("parent" in res && res.parent.type == "page_id"){
            new_page_id = res.parent.page_id
        }
    })
    .catch((e) =>{
        return { ok: false, data: JSON.stringify(e), status: 400 }
    })


    if (children_ids.length == 0 || max >= 4){
        return { ok: true, data: JSON.stringify(notion_response), status: 200 }
    }
    if (new_page_id === null){
        return { ok: false, data: JSON.stringify({messag: "fail to get created-page-id"}), status: 400 }
    }

    let count = 0
    const response = await notion.blocks.children.list({ block_id: new_page_id })
    response.results.forEach( (notion_block, idx) => {
        const id = topblock_ids[idx+100*count]
        if (id in data){ data[id].notion_id = notion_block.id }
    })
    let has_more = response.has_more
    let next_cursor = response.next_cursor
    while(has_more && next_cursor){
        count += 1
        await notion.blocks.children.list({ block_id: new_page_id, start_cursor: next_cursor })
        .then( response => {
            response.results.forEach( (notion_block, idx) => {
                const id = topblock_ids[idx+100*count]
                if (id in data){ data[id].notion_id = notion_block.id }
            })
            has_more = response.has_more
            next_cursor = response.next_cursor
        })
    }

    const errors: Array<BlockError> = []
    const id_and_childs = children_ids.reduce( (dict, child_id) =>{
        const { block, parent_id } = data[child_id]
        if (parent_id === null){ return dict }
        const notion_id = data[parent_id].notion_id
        if (notion_id.length == 0){
            errors.push({ message:"missing notion-id", block: data[parent_id].block })
            return dict
        }
        if (notion_id in dict){
            dict[notion_id].push(block)
        } else {
            dict[notion_id] = [block]
        }
        return dict
    }, {} as Record<string, Array<BlockObjectRequest>> )
    if (errors.length < 0){
        errors.forEach(e => console.log(e))
    }

    const failed_logs: Record<string, string> = (errors.length == 0) ? {} : {"some children": "cannot find parent-blocks-notion-id"}
    await Object.keys(id_and_childs).reduce((promise, id) => {
        return promise.then(async () => {
            await notion.blocks.children.append({block_id: id, children: id_and_childs[id]})
        }).catch((e) =>{
            failed_logs[`parent: ${id}`] = JSON.stringify(e)
        } )
    }, Promise.resolve())

    if ([...Object.keys(failed_logs)].length > 0){
        return { ok: false, data: JSON.stringify({...notion_response, logs:failed_logs}), status: 409}
    } else {
        return { ok: true, data: JSON.stringify(notion_response), status: 200}
    }
}



async function data_to_page(
  	request: Request,
){
    const header_ops = check_origin(request.headers, HEADER_OPS)
    const headers = new Headers(header_ops)

    const auth_head = request.headers.get("Authorization")
    if (auth_head === null) {
        return new Response("", {headers, "status" : 401 , "statusText" : "Unauthorized" })
    }

    const is_valid = (auth_head.split(" ")[1] == Deno.env.get("USER_TOKEN"))
    if (is_valid == false ){
        return  new Response("", {headers, "status" : 401 , "statusText" : "Unauthorized" })
    }

    const request_json: RequestJson = await request.json()
    const { url, html_doc, target_id } = request_json
    
    if (url.startsWith("https://zenn.dev")){
        if (!url.includes("articles") && !url.includes("scrap")){
            return new Response("not proper URL", {headers: headers, status: 501})
        }
    
        const convertion_result =  (url.includes("articles")) ? await zenn_article_to_blocks(url, html_doc) : await zenn_scrap_to_blocks(url, html_doc)
        if (convertion_result.ok == false){
            const { name, message, stack } = convertion_result.data
            return new Response(JSON.stringify({name, message, stack}), {headers, status:400})
        }
    
        const { ok, data, status } = await call_api(target_id, convertion_result.data)
        if (ok == false){ console.log(JSON.parse(data)) }
        return new Response(data, {headers, status})
    }
    else if (url.startsWith("https://note.com/") && url.includes("/n/")){
        const convertion_result = await note_article_to_blocks(url, html_doc)
        if (convertion_result.ok == false){
            const { name, message, stack } = convertion_result.data
            return new Response(JSON.stringify({name, message, stack}), {headers, status:400})
        }
    
        const { ok, data, status } = await call_api(target_id, convertion_result.data)
        if (ok == false){ console.log(JSON.parse(data)) }
        return new Response(data, {headers, status})
    }
    else {
        return new Response(`${url} is not proper URL`, {headers: headers, status: 501})
    }
    
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