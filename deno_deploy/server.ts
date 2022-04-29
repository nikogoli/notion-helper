import { serve } from "https://deno.land/x/sift@0.5.0/mod.ts";
import { ConnInfo } from "https://deno.land/std/http/server.ts";

import { Client} from "https://deno.land/x/notion_sdk/src/mod.ts"
import {
    BlockObjectRequest,
} from "https://deno.land/x/notion_sdk/src/api-endpoints.ts"

import { 
    article_to_blocks,
    scrap_to_blocks,
    ZennResponse,
 } from "https://pax.deno.dev/nikogoli/notion-helper/mod.ts"



type RequestJson = {
    url: string,
    html_doc: string,
    target_id: string,
}


const HEADER_OPS = {
    'Access-Control-Allow-Method':  'OPTIONS, POST, PATCH, GET',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Origin, Authorization',
    'Access-Control-Allow-Origin': 'https://zenn.dev',
}


async function call_api(
    headers: Headers,
    target_id: string,
    body: ZennResponse,
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
        return { ok: false, data: JSON.stringify(e), status: 400 }
    })

    if (children_ids.length == 0){
        return { ok: true, data: JSON.stringify(notion_response), status: 200 }
    }

    const id_and_childs = children_ids.reduce( (dict, id) =>{
        const { block, parent_id } = data[id]
        if (parent_id !== null){
            if (parent_id in dict){
                dict[parent_id].push(block)
            } else {
                dict[parent_id] = [block]
            }
        }
        return dict
    }, {} as Record<string, Array<BlockObjectRequest>> )


    const failed_logs: Record<string, string> = {}
    await Object.keys(id_and_childs).reduce((promise, id) => {
        return promise.then(async () => {
            await notion.blocks.children.append({block_id: id, children: id_and_childs[id]})
        }).catch((e) =>{
            failed_logs[`parent: ${id}`] = JSON.stringify(e)
        } )
    }, Promise.resolve())

    if ([...Object.keys(failed_logs)].length > 0){
        return { ok: false, data: JSON.stringify({...notion_response, logs:failed_logs}), status: 600}
    } else {
        return { ok: true, data: JSON.stringify(notion_response), status: 200}
    }
}



async function data_to_page(
  	request: Request,
	
){
    const headers = new Headers(HEADER_OPS)

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

    if (!url.includes("articles") && !url.includes("scrap")){
        return new Response("not implemented", {headers: HEADER_OPS, status: 501})
    }

    const convertion_result =  (url.includes("articles")) ? await article_to_blocks(url, html_doc) : await scrap_to_blocks(url, html_doc)
    if (convertion_result.ok == false){
        return new Response(JSON.stringify(convertion_result.data), {headers, status:400})
    }

    const { ok, data, status } = await call_api(headers, target_id, convertion_result.data)
    if (ok == false){ console.log(JSON.parse(data)) }
    return new Response(data, {headers, status})
}


serve({
    "/": (_request: Request) => {
        return new Response("Hellow", {headers: HEADER_OPS, status: 200})
    },

    "/withid/:target/:method": async (
        request: Request,
        connInfo: ConnInfo,
        params: {target: string, method: string}
    ) => {
        if (request.method == "OPTIONS"){
            return new Response("options", {headers: HEADER_OPS, status: 200})
        }
        const { target, method } = params
        if (target == "pages"){
            if (method == "create"){
                return await data_to_page(request)
            }
        } else {
            return new Response("not implemented", {headers: HEADER_OPS, status: 501})
        }
    },

    404: (request: Request) => {
        if (request.method == "OPTIONS"){
            return new Response("options", {headers: HEADER_OPS, status: 200})
        }
        return new Response("not found", {headers: HEADER_OPS, status: 404})
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