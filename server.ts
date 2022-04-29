/*
import { serve } from "https://deno.land/std@0.120.0/http/server.ts";

function handler(req: Request): Response {
  console.log(req)
  return new Response("Hello world");
}

console.log("Listening on http://localhost:8000");
await serve(handler);
*/


import { serve } from "https://deno.land/x/sift@0.5.0/mod.ts";
import { ConnInfo } from "https://deno.land/std/http/server.ts";

import { Client} from "https://deno.land/x/notion_sdk/src/mod.ts"
import {
    BlockObjectRequest,
    CreatePageBodyParameters,
    RichTextItemRequest,
} from "https://deno.land/x/notion_sdk/src/api-endpoints.ts"

import { 
    article_to_blocks,
    scrap_to_blocks,
    ZennResponse,
 } from "https://pax.deno.dev/nikogoli/notion-helper/mod.ts"


type BlockInfo = {
    self_id: string,
    notion_id: string,
    block: BlockObjectRequest,
    thread_idx: string,
    scrap_idx: string,
    parent_id: null | string,
}


type BlocksFromZenn = {
    properties: { title: Required<RichTextItemRequest>[] },
    icon: CreatePageBodyParameters["icon"],
    children: BlockObjectRequest[];
}


type RequestJson = {
    html_doc: string,
    target_id: string,
}


const HEADER_OPS = {
    'Access-Control-Allow-Method':  'OPTIONS, POST, PATCH, GET',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Origin, Authorization',
    'Access-Control-Allow-Origin': 'https://zenn.dev',
}


async function data_to_page(
  	request: Request,
	
){
    const headers = new Headers(HEADER_OPS)

    const auth_head = request.headers.get("Authorization")
    if ( auth_head !== null ){
        const token = auth_head.split(" ")[1]
        if (token != Deno.env.get("USER_TOKEN")){
            return  new Response("", {headers, "status" : 401 , "statusText" : "Unauthorized" })
        }
    }
	
	const request_json: RequestJson = await request.json()
  	const { html_doc, target_id } = request_json

    const orig_url = request.headers.get("origin")
    if (orig_url === null || !orig_url.includes("articles") || !orig_url.includes("scrap")){
        throw new Error(JSON.stringify(request.headers))
    }

    const { title, author, topics, icon, max, topblock_ids, children_ids, data } = (orig_url.includes("articles"))
        ? await article_to_blocks(orig_url, html_doc)
        : await scrap_to_blocks(orig_url, html_doc)

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
        return new Response(JSON.stringify(e), {headers, status:400})
    })

    if (children_ids.length == 0){
        return new Response(JSON.stringify(notion_response), {headers, status:200})
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
        return new Response(JSON.stringify({...notion_response, logs:failed_logs}), {headers, status:600})
    }
    return new Response(JSON.stringify(notion_response), {headers, status:200})
}


async function handle_rooted_req(
    request: Request,
    _connInfo: ConnInfo,
    params: {target: string, method: string}
) {
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
}


serve({
    "/": (_request: Request) => {
        return new Response("Hellow", {headers: HEADER_OPS, status: 200})
    },

    "/withid/:target/:method": (
        request: Request,
        connInfo: ConnInfo,
        params: {target: string, method: string}
    ) => handle_rooted_req(request, connInfo, params),

    404: (request: Request) => {
        if (request.method == "OPTIONS"){
            return new Response("options", {headers: HEADER_OPS, status: 200})
        }
        return new Response("not found", {headers: HEADER_OPS, status: 404})
    },
})