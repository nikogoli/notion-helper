import { Client } from "https://deno.land/x/notion_sdk/src/mod.ts";
import {
    BlockObjectRequest,
    RichTextItemRequest,
    RichTextItemResponse,
} from "https://deno.land/x/notion_sdk/src/api-endpoints.ts";

type RowBlock = {
    id: string,
    object: "block",
    type: "table_row",
    table_row: {cells: Array<[]|Array<RichTextItemResponse>>}
  }

type TableProps = {
    id: string,
    has_row_header: boolean,
    has_column_header: boolean,
    table_width: number,
    rows: Array<RowBlock>
}

const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN")
const notion = new Client({auth: NOTION_TOKEN});


async function get_tables_and_append_new_one(
    notion: Client,
    id: string
) {
    const { results } = await notion.blocks.children.list({block_id: id})
  
    // 親要素以下の table block object の情報を取得する
    const table_list: Array<TableProps> = []
    await results.reduce( (promise, block) => {
      return promise.then( async () => {
        if ("type" in block && block.type=="table") {
          const { id } = block
          const {has_row_header, has_column_header, table_width} = block.table
          const rows = await notion.blocks.children.list({ block_id: id }).then(
            response => response.results.filter( obj => "type" in obj && obj.type=="table_row" )
          ) as Array<RowBlock>
          table_list.push( {id, has_row_header, has_column_header, table_width, rows})
        }
      })
    }, Promise.resolve())
    const results_list = table_list.filter( x => x!==null)
    if (!results_list.length) {throw new Error("子要素にテーブルが見つかりません")}
  
    // 行データを更新する：準備
    const old_table_id = results_list[0].id
    let {has_row_header, has_column_header, table_width, rows } = results_list[0]
  
    // 行データを更新する：処理
    function func( has_row_header:boolean, has_column_header:boolean, table_width:number, rows :Array<RowBlock>)  {
      return { has_row_header, has_column_header, table_width, rows }
    }
    ({has_row_header, has_column_header, table_width, rows } = func( has_row_header, has_column_header, table_width, rows ))
  
    // 更新した行データから、table block object を作成する
    const table_props = { "object": 'block', "type": "table", "has_children": true,
      "table": { "table_width": table_width,
        "has_column_header": has_row_header,
        "has_row_header": has_column_header,
        "children": rows
      }
    } as BlockObjectRequest
  
    // テーブルの追加
    await notion.blocks.children.append({
      block_id: id,
      children: [table_props]
    })
  
    return await notion.blocks.delete({ block_id: old_table_id })
}

async function get_tables_and_update(
    notion: Client,
    id: string
  ) {
    const { results } = await notion.blocks.children.list({block_id: id})
  
    // 親要素以下の table block object の情報を取得する
    const table_list: Array<TableProps> = []
    await results.reduce( (promise, block) => {
      return promise.then( async () => {
        if ("type" in block && block.type=="table") {
          const { id } = block
          const {has_row_header, has_column_header, table_width} = block.table
          const rows = await notion.blocks.children.list({ block_id: id }).then(
            response => response.results.filter( obj => "type" in obj && obj.type=="table_row" )
          ) as Array<RowBlock>
          table_list.push( {id, has_row_header, has_column_header, table_width, rows})
        }
      })
    }, Promise.resolve())
    const results_list = table_list.filter( x => x!==null)
    if (!results_list.length) {throw new Error("子要素にテーブルが見つかりません")}
  
    // 行データを更新する：準備
    const old_table_id = results_list[0].id
    let {has_row_header, has_column_header, table_width, rows } = results_list[0]
  
    // 行データを更新する：処理
    function func( has_row_header:boolean, has_column_header:boolean, table_width:number, rows :Array<RowBlock>)  {
      const rev_rows = rows.map(row => {
        // 行のセルを逆順にする
        const new_cells = row.table_row.cells.reverse()
        return {"id":row.id, "object":row.object, "type":row.type, "table_row":{cells:new_cells}}
      })
      return { has_row_header, has_column_header, table_width, "rows":rev_rows }
    }
    ({has_row_header, has_column_header, table_width, rows } = func( has_row_header, has_column_header, table_width, rows ))
  
    // 各行を update
    await rows.reduce( (promise, row) => {
      return promise.then( async () => {
        await notion.blocks.update({
          block_id:row.id,
          table_row:{cells: (row.table_row.cells as Array<[]|Array<RichTextItemRequest>>)}
        }).then(res => console.log(res))
      })
    }, Promise.resolve())
}