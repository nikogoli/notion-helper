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
import {
    Client,
} from "https://deno.land/x/notion_sdk/src/mod.ts"

import {
    BlockObjectRequest,    
    RichTextItemRequest,
} from "https://deno.land/x/notion_sdk/src/api-endpoints.ts"

type BlockInfo = {
    self_id: string,
    notion_id: string,
    block: BlockObjectRequest,
    thread_idx: string,
    scrap_idx: string,
    parent_id: null | string,
}


type RequestJson = {
    target_id: string,
    title: string,
    topics: Array<string>,
    topblock_ids: Array<string>,
    children_ids: Array<string>,
    data: Record<string, BlockInfo>
}


const HEADER_OPS = {
    'Access-Control-Allow-Method':  'OPTIONS, POST, PATCH, GET',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Origin, Authorization',
    'Access-Control-Allow-Origin': 'https://zenn.dev',
}


function to_richtx(
    type: "text" | "equation",
    text: string,
    link = ""
) {
	if (type == "equation") {
		return [{
			type: "equation",
			equation: {"expression": text},
			annotations: {
				bold: false, italic: false, strikethrough: false,
				underline: false, code: false, color: "default"
			}
		}]
	} else if (type == "text") {
		return [{
			type: "text",
			text: { content: text, link: link == "" ? null : {url: link} },
			annotations: {
				bold: false, italic: false, strikethrough: false,
				underline: false, code: false, color: "default"
			}
		}]
	} else {
		throw new Error("invalid type")
	}
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
  	const { target_id, title, topics, topblock_ids, children_ids, data } = request_json

  	const page_title = to_richtx("text", title) as Array<Extract<RichTextItemRequest, {type?:"text"}>>
  	const blocks:Array<BlockObjectRequest> = []
	const notion = new Client({auth: Deno.env.get("NOTION_TOKEN")})

    topblock_ids.forEach(id => {
        if (id in data){
            blocks.push(data[id].block)
        }
    })

    const notion_response = await notion.pages.create({
        parent: {page_id: target_id},
        properties: {title: page_title},
        children: blocks,
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
        return new Response("Requested function is not implemented", {headers: HEADER_OPS, status: 501})
    }
}


serve({
    "/": (request: Request) => {
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
        return new Response("requested URL is not found", {headers: HEADER_OPS, status: 404})
    },
})