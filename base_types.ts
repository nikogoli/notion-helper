import {
    CreatePageBodyParameters,
    BlockObjectRequest,
    RichTextItemRequest,
} from "https://deno.land/x/notion_sdk/src/api-endpoints.ts"

import {
    Element,
} from "https://deno.land/x/deno_dom/deno-dom-wasm.ts"


export type ToBlockInput = {
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


export type TokenizeError = {
    msg: string,
    type: "not implemented" | "attribute missing" | "unexpected node-tree",
    elem: Element
}


export type UnitScrap = {
    thread_idx: string,
    scrap_idx: string,
    date_time: string | null, // "yyyy-mm-ddThh:mm:ss+00:00"
    content: Array<BlockObjectRequest>,
}


export type ScrapInfo = {
    thread_idx: string,
    scrap_idx: string,
}


export type BlockInfo<T> = {
    self_id: string,
    notion_id: string,
    block: BlockObjectRequest,
    parent_id: null | string,
    options: T
}


export type PageData<T> = {
    title: Required<RichTextItemRequest>[],
    author: string,
    topics: string[],
    icon: CreatePageBodyParameters["icon"],
    max: number,
    topblock_ids: string[],
    children_ids: string[],
    data: Record<string, BlockInfo<T>>,
}