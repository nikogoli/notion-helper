async function arrange_scrap() {

	const VALID_LANGNAME = ["abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript", "c++", "c#", "css", "dart", "diff", "docker", "elixir", "elm", "erlang", "flow", "fortran", "f#", "gherkin", "glsl", "go", "graphql", "groovy", "haskell", "html", "java", "javascript", "json", "julia", "kotlin", "latex", "less", "lisp", "livescript", "lua", "makefile", "markdown", "markup", "matlab", "mermaid", "nix", "objective-c", "ocaml", "pascal", "perl", "php", "plain text", "powershell", "prolog", "protobuf", "python", "r", "reason", "ruby", "rust", "sass", "scala", "scheme", "scss", "shell", "solidity", "sql", "swift", "typescript", "vb.net", "verilog", "vhdl", "visual basic", "webassembly", "xml", "yaml", "java/c/c++/c#"]

	const VALID_IMAGEFILE = ["png", "jpg", "jpeg", "gif", "tif", "tiff", "bmp", "svg", "heic"]
	
	function check_textnode(node){
		const text = node.wholeText.replaceAll("\n", "").replaceAll("　", "")
		return ( text != "" )
	}


	function tokenize_base( child, parag_list, annos ){
		if ( ["CODE", "A", "SUP", "BR", "EMBED-KATEX", "#text"].includes(child.nodeName)){
			const text = child.innerText
			const is_eq = false
			switch(child.nodeName){
				case "#text":{
					if (check_textnode(child)){
						const annotations = annos
						parag_list[parag_list.length-1].words.push({ text: child.wholeText, annotations, href: null, is_eq })
					}
					break
				}
				case "CODE": {
					const annotations = [...annos, "CODE"]
					parag_list[parag_list.length-1].words.push({ text, annotations, href: null, is_eq })
					break
				}
				case "A":
				case "SUP": {
					const annotations = annos
					const href = (child.nodeName=="SUP") ? child.children[0].href : child.href
					parag_list[parag_list.length-1].words.push({ text, annotations, href, is_eq })
					break
				}
				case "EMBED-KATEX": {
					const annotations = annos
					const exp = child.innerText.split("\n")[0]
					parag_list[parag_list.length-1].words.push({ text: exp, annotations, href: null, is_eq: true })
					break
				}
				case "BR": {
					if (child.style["0"] != "display"){
						const annotations = annos
						parag_list[parag_list.length-1].words.push({ text: "\n", annotations, href: null, is_eq })
					}
				}
			}
		} else if ( ["STRONG", "EM", "S"].includes(child.nodeName)){
			const node_list = tokenize_p(child, [...annos, child.nodeName])
			node_list.forEach( nd => {
				const base_words = parag_list[parag_list.length-1].words
				parag_list[parag_list.length-1].words = [...base_words, ...nd.words]
			})
		}
	}


	function tokenize_other( child, parag_list, annos ){
		if ( ["H1", "H2", "H3"].includes(child.nodeName)){
			parag_list.push({ type: child.nodeName, text: child.innerText, children: null })
		}
		else if (child.nodeName == "TABLE"){
			parag_list.push({ type: "TABLE", text: child.innerText, children: null })
		}
		else if ( child.nodeName=="HR" ){
			parag_list.push({ type: "HR", children: null })
		}
		else if ( child.nodeName == "UL" || child.nodeName == "OL" ){
			Array.from(child.children).forEach(li => {
				const children = []
				if (Array.from(li.children).map(x => x.nodeName).includes("P") ){
					tokenize_page(li, annos).forEach( tk => children.push(tk) )
				} else {
					tokenize_li(li, annos).forEach( tk => children.push(tk) )
				}
				if (children[0].type == "PARAGRAPH"){
					const others = (children.length > 1) ? children.slice(1) : null
					parag_list.push({ type: `${child.nodeName}ITEM`, firstline: children[0], children: others })
				} else {
					parag_list.push({ type: `${child.nodeName}ITEM`, firstline: null, children })
				}
			})
		}
		else if (child.nodeName == "IMG"){
			parag_list.push({ type: "IMG", link: child.src, children: null })
		}
		else if (child.nodeName == "SECTION") {
			if (child.className == "footnotes") {
				const footnote = { type: "FOOTNOTE", children: [] }
				const p_in_ol_items = Array.from(child.getElementsByClassName("footnote-item")).map(no => no.children[0])
				p_in_ol_items.forEach( p => tokenize_p(p, annos)
					.forEach(tk => footnote.children.push(tk))
				)
				parag_list.push({ type: "BR", children: null })
				parag_list.push(footnote)
			}
			else if (child.className == "zenn_katex"){
				parag_list.push({ type: "EQUATION", text: child.innerText.split("\n")[0], children: null })
			}
		}
		else if (child.nodeName == "BLOCKQUOTE"){
			const children = []
			tokenize_page(child, annos).forEach( tk => children.push(tk) )
			if (children[0].type == "PARAGRAPH"){
				const others = (children.length > 1) ? children.slice(1) : null
				parag_list.push({ type: "BLOCKQUOTE", firstline: children[0], children: others })
			} else {
				parag_list.push({ type: "BLOCKQUOTE", firstline: null, children })
			}
		}
		else if (child.nodeName == "ASIDE"){
			if (child.className == "msg message" || child.className == "msg alert"){
				const kind = child.className.split(" ")[1]
				const content_node = child.getElementsByClassName("msg-content")[0]
				const children = []
				tokenize_page(content_node, annos).forEach( tk => children.push(tk) )
				if (children[0].type == "PARAGRAPH"){
					const others = (children.length > 1) ? children.slice(1) : null
					parag_list.push({ type: "MESSAGE", kind, firstline: children[0], children: others })
				} else {
					parag_list.push({ type: "MESSAGE", kind, firstline:null,  children})
				}
			}
		}
		else if (child.nodeName == "DETAILS"){
			const title = child.getElementsByTagName("summary")[0].innerText
			const content_node = child.getElementsByClassName("details-content")[0]
			const detail_item = { type: "DETAILS", title, children: [] }				
			tokenize_page(content_node, annos).forEach( tk => detail_item.children.push(tk) )
			parag_list.push(detail_item)
		}
		else if (child.nodeName == "DIV"){
			if ( child.className == "code-block-container" ) {
				const code_node = child.getElementsByTagName("code")[0]
				const lang = (code_node.className!="") ? code_node.className.split("-").reverse()[0] : "plain text"
				parag_list.push({ type: "CODE", text: code_node.innerText.slice(0, -1), lang, children: null })
			}
		}
	}


	function tokenize_li(node, annos=[]){
		const parag_list = []
		Array.from(node.childNodes).forEach( child => {
			if ( ["CODE", "A", "SUP", "BR", "EMBED-KATEX", "#text", "STRONG", "EM", "S"].includes(child.nodeName)){
				if (child.nodeName=="A" && child.style["0"] == "display"){
					parag_list.push({ type: "BOOKMARK", link: child.href, children: null })
				} else {
					if (child.nodeName!="#text"
					|| (child.nodeName == "#text" && check_textnode(child)) ){
						if ( parag_list.length == 0 || parag_list[parag_list.length-1].type != "PARAGRAPH"){
							parag_list.push({type: "PARAGRAPH", words: [], children: null} )
						}
						tokenize_base(child, parag_list, annos)
					}
				}
			} else if (["H1", "H2", "H3", "TABLE", "HR", "UL", "OL", "IMG", "SECTION", "BLOCKQUOTE", "BLOCKQUOTE", "ASIDE", "DETAILS", "DIV"].includes(child.nodeName)) {
				tokenize_other(child, parag_list, annos)
			}
		})
		return parag_list
	}


	function tokenize_p(node, annos=[]){
		const parag_list = [ {type: "PARAGRAPH", words: [], children: null} ]
		Array.from(node.childNodes).forEach( child => {
			if ( ["CODE", "A", "SUP", "BR", "EMBED-KATEX", "#text", "STRONG", "EM", "S"].includes(child.nodeName)){
				tokenize_base(child, parag_list, annos)
			}
			else if (child.nodeName == "IMG"){
				parag_list.push({ type: "IMG", link: child.src, children: null })
				parag_list.push({ type: "PARAGRAPH", words: [], children: null })
			}
			else {
				console.log(child)
				throw new Error("invaild item in p")
			}
		})
		const last = parag_list.pop()
		if (last.words.length==0){ return parag_list }
		else { return [...parag_list, last] }
	}


	function tokenize_page(node, annos=[]){
		const tokens = []
		Array.from(node.childNodes).forEach( child => {
			if (child.nodeName == "P"){
				tokenize_p(child, annos).forEach( tk =>	tokens.push(tk) )
			}
			if (child.nodeName == "A" && child.style["0"] == "display"){

				tokens.push({ type: "BOOKMARK", link: child.href, children: null })
			}
			if (child.nodeName == "BR"){
				tokens.push({ type: "BR", children: null })
			}
			else if (["H1", "H2", "H3", "TABLE", "HR", "UL", "OL", "IMG", "SECTION", "BLOCKQUOTE", "BLOCKQUOTE", "ASIDE", "DETAILS", "DIV"].includes(child.nodeName)) {
				tokenize_other(child, tokens, annos)
			}
		})
		return tokens
	}

	function to_richtx(type, text, link = "") {
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

	function set_annos(tx_obj, annos) {
		if (annos.length == 0) { return tx_obj }
		annos.forEach((an) => {
			if (an == "EM") { tx_obj[0].annotations.italic = true }
			else if (an == "STRONG") { tx_obj[0].annotations.bold = true }
			else if (an == "S") { tx_obj[0].annotations.strikethrough = true }
			else if (an == "CODE") { tx_obj[0].annotations.code = true }
		})
		return tx_obj
	}

	function to_one_text(words) {
		return words.map((wrd, idx) => {
			if (wrd.is_eq) { return set_annos(to_richtx("equation", wrd.text), wrd.annotations)}
			else {
				if (wrd.text == "\n" && words[idx - 1].text == "\n") { return [] }
				const base_tx = set_annos(to_richtx("text", wrd.text), wrd.annotations)
				if (wrd.href !== null && "text" in base_tx[0]) {
					base_tx[0].text.link = { url: wrd.href }
				}
				return base_tx
			}
		}).filter((x) => x.length > 0).flat()
	}

	function switch_items(item) {
		switch (item.type) {
		case "H1":
		case "H2":
		case "H3": {
			const head_item = {rich_text: to_richtx("text", item.text)}
			if (item.type == "H1") {
				return {object: "block", type: "heading_1", heading_1: head_item}
			} else if (item.type == "H2") {
				return {object: "block", type: "heading_2", heading_2: head_item}
			} else {
				return {object: "block", type: "heading_3", heading_3: head_item}
			}
		}
		case "BR":
			return { object: "block", type: "paragraph", paragraph: {rich_text: []}	}
		case "HR": 
			return { object: "block", type: "divider", divider: {} }
		case "TABLE": {
			const rows = item.text.split("\n")
			const cells = rows.map((row) => row.split("	"))
			const table_width = cells[0].length
			const table_rows = cells.map((row) => {
				const new_cells = row.map((text) => to_richtx("text", text))
				return { object: "block", type: "table_row", table_row: {cells: new_cells} }
			})
			return {
				object: "block", type: "table", table: {
					table_width,
					has_column_header: true,
					has_row_header: false,
					children: table_rows
				}
			}
		}
		case "ULITEM":
		case "OLITEM": {
			const list_item = {
				rich_text: item.firstline !== null ? to_one_text(item.firstline.words) : []
			}
			if (item.children !== null) {
				list_item.children = item.children.map((it) => switch_items(it))
			}
			return item.type == "ULITEM"
				? {object: "block", type: "bulleted_list_item", bulleted_list_item: list_item}
				: {object: "block", type: "numbered_list_item", numbered_list_item: list_item}
		}
		case "PARAGRAPH": {
			return {object: "block", type: "paragraph", paragraph: {rich_text: to_one_text(item.words)}}
		}
		case "BLOCKQUOTE": {
			const quote_item = {
				rich_text: item.firstline !== null ? to_one_text(item.firstline.words) : []
			}
			if (item.children !== null) {
				quote_item.children = item.children.map((it) => switch_items(it))
			}
			return {object: "block", type: "quote", quote: quote_item}
		}
		case "DETAILS": {
			const toggle_item = { rich_text: to_richtx("text", item.title) }
			if (item.children.length > 0) {
				toggle_item.children = item.children.map((it) => switch_items(it))
			}
			return {object: "block", type: "toggle", toggle: toggle_item}
		}
		case "FOOTNOTE":
		case "ASIDE": {
			let first
			if (item.type == "FOOTNOTE") { first = to_richtx("text", "注釈") } else {
				first = item.firstline !== null ? to_one_text(item.firstline.words) : []
			}
			const callout_item = { rich_text: first }
			callout_item.color = item.type == "FOOTNOTE"
				? "default"
				: item.type == "ASIDE" && item.kind == "message" ? "yellow_background" : "red_background"
			if (item.children.length > 0) {
				callout_item.children = item.children.map((it) => {
					const block = switch_items(it)
					if (item.type == "FOOTNOTE" && block.type == "paragraph") {
						return { object: "block", type: "numbered_list_item",
								numbered_list_item: {rich_text: block.paragraph.rich_text} }
					} else {
						return block
					}
				})
			}
			return {object: "block", type: "callout", callout: callout_item}
		}
		case "EQUATION":
			return {object: "block", type: "equation", equation: {expression: item.text}}
		case "BOOKMARK":
			return {object: "block", type: "bookmark", bookmark: {url: item.link}}
		case "IMG": {
			const extention = item.link.split(".").reverse()[0]
			if (VALID_IMAGEFILE.includes(extention)) {
				return { object: "block", type: "image",
						image: {type: "external", external: {url: item.link}} }
			} else {
				console.warn("URL without an extention is not acceptable for image block, thus instead, create embed block.\n")
				return {object: "block", type: "embed", embed: {url: item.link}}
			}
		}
		case "CODE": {
			let language = item.lang
			if (language == "tsx" || language == "ts") { language = "typescript" }
			else if (VALID_LANGNAME.includes(language) == false) {
				console.warn(`language name '${language}' is not valid for notion's code block, thus instead, "plain text" is used.`)
				language = "plain text"
			}
			return { object: "block", type: "code",
					code: {language, rich_text: to_richtx("text", item.text)}
			}
		}
		default:
			console.log(item)
			throw new Error("invalid input")
		}
	}

	function set_record_and_get_childs(count, block, thread_idx, scrap_idx, self_id, dict, parent_id=null) {		
		dict[self_id] = {self_id, notion_id: "", thread_idx, scrap_idx, block, parent_id}

		if (count <= 2
			|| !["callout", "quote", "toggle", "bulleted_list_item", "numbered_list_item"].includes(block.type)) {
			return []
		}
		let children
		if (block.type == "callout" && "children" in block.callout) {
			children = block.callout.children
			block.callout = {rich_text: block.callout.rich_text}
		} else if (block.type == "quote" && "children" in block.quote) {
			children = block.quote.children
			block.quote = {rich_text: block.quote.rich_text}
		} else if (block.type == "bulleted_list_item" && "children" in block.bulleted_list_item) {
			children = block.bulleted_list_item.children
			block.bulleted_list_item = {rich_text: block.bulleted_list_item.rich_text}
		} else if (block.type == "numbered_list_item" && "children" in block.numbered_list_item) {
			children = block.numbered_list_item.children
			block.numbered_list_item = {rich_text: block.numbered_list_item.rich_text}
		} else {
			throw new Error("invalid input in create record")
		}
		const child_ids = children.map((child) => {
			const child_id = crypto.randomUUID()
			set_record_and_get_childs(count - 1, child, thread_idx, scrap_idx, child_id, dict, self_id)
			return child_id
		})
		return child_ids
	}

	const title = document.getElementsByClassName("View_title__ASFih")[0].innerText
	const topics = document.getElementsByClassName("TopicList_container__bqtFg")[0].innerText.split("\n")

	const scraps = []
	try{
		Array.from(document.getElementsByClassName("ScrapThread_item__4G_47"))
		.forEach( (items, th_idx) => {
			const thread_idx = `${th_idx}`
			Array.from(items.getElementsByClassName("znc BodyCommentContent_bodyCommentContainer__WXWq0"))
			.forEach( (scrap_node, sc_idx) =>  {
				const scrap_idx = `${th_idx}_${sc_idx}`
				const content = tokenize_page(scrap_node)			
				const date_time = scrap_node.parentElement.parentNode.previousElementSibling.getElementsByClassName("ThreadItemContent_date__kLnfZ")[0].dateTime
				scraps.push({thread_idx, scrap_idx, date_time, content })
			})
		})
	} catch (e) {
		console.log(e)
	}
	
	const page_title = title
	let count = 0
	function nest_count(node) {
		if (node.children !== null) {
			count += 1
			node.children.forEach((n) => nest_count(n))
		}
	}

	const block_info = {}

	block_info["blank"] = {
		self_id: "blank", notion_id: "",
		thread_idx: "", scrap_idx: "",
		block: { object: "block", type: "paragraph", paragraph: {rich_text: []} },
		parent_id: null
	}
	block_info["divider"] = {
		self_id: "divider", notion_id: "",
		thread_idx: "", scrap_idx: "",
		block: { object: "block", type: "divider", divider: {} },
		parent_id: null
	}
	

	let topblock_ids = []
	let children_ids = []
	let thread_number = "0"
	let max = 0
	try{
		scraps.forEach((scrap) => {
			const {thread_idx, scrap_idx} = scrap
			const block_ids = scrap.content.map((item) => {
				nest_count(item)
				if (max < count) {
				max = count
				}
				const block = switch_items(item)
				const self_id = crypto.randomUUID()
				const child_ids = set_record_and_get_childs(count, block, thread_idx, scrap_idx, self_id, block_info)
				if (child_ids.length > 0){
					children_ids = [...children_ids, ...child_ids]
				}
				count = 0
				return self_id
			})
			if (thread_idx != thread_number) {
				topblock_ids = [...topblock_ids, "blank", "divider", "blank", ...block_ids]
				thread_number = thread_idx
			} else {
				topblock_ids = [...topblock_ids, "blank", "blank", ...block_ids]
			}
		})
	} catch (e) {
		console.log(e)
	}

	const url = chrome.runtime.getURL('.env')
	const response = await fetch(url)
	const response_text = await response.text()
	const env_obj = JSON.parse(response_text)
	const { URL_PREFIX, USER_TOKEN, TARGET_ID } = env_obj

	const headers = new Headers()
	headers.append("Authorization", `Bearer ${USER_TOKEN}`)
	headers.append("Access-Control-Request-Headers", "Content-Type, Origin, Authorization")	
	headers.append('Content-Type', 'application/json')
	headers.append("Access-Control-Request-Method", "POST")


	const body_data = {
		target_id: TARGET_ID,
		title: page_title,
		topics,
		topblock_ids,
		children_ids,
		data: block_info
	}
	
	const URL = `${URL_PREFIX}/withid/pages/create`

	
	const page_response = await fetch(URL, {
		//mode: "no-cors",
		credentials: "include",
		method: 'POST',
		headers: headers,
		body: JSON.stringify(body_data),
	})
	
	const responseText = await page_response.text()

	if (page_response.ok){
		const responseJson = JSON.parse(responseText)
		const { object, id } = responseJson
		window.alert(`create '${object}'.\nCheck "https://notion.so/${id.replaceAll("-","")}"!!`)
		console.log(`create '${object}'.\nCheck "https://notion.so/${id.replaceAll("-","")}"!!`)
		console.log(responseJson)
	} else {
		if (page_response.status == "401"){
			window.alert("Request refused. Please check wheather USER-TOKEN is valid.")
		}
		else if (page_response.status == "400"){
			try {
				const responseJson = JSON.parse(responseText)
				if ("code" in responseJson){
					const { name, status, code, body } = responseJson
					const { message } = JSON.parse(body)
					window.alert(`creation failed\nname: ${name}\ncode: ${code}\nstatus: ${status}\n${message.slice(0,200)}...`)
					console.error({ name, status, code, message })
				} else {
					console.error(responseJson)
				}
			} catch(e){
				console.error(responseText)
			}
		}
		else if (page_response.status == "600"){
			const responseJson = JSON.parse(responseText)
			const { object, id, logs } = responseJson
			const ids = [...Object.keys(JSON.parse(logs))].join("\n")
			window.alert(`create '${object}'.\nCheck "https://notion.so/${id.replaceAll("-","")}"!!\n\nHowever, failed to append some children blocks to following parent(s):\n${ids}`)
			console.log(`create '${object}'.\nCheck "https://notion.so/${id.replaceAll("-","")}"!!`)
			console.log(responseJson)
			console.log(JSON.parse(logs))
		}
		else {
			console.error(responseText)
		}
	}
}



chrome.action.onClicked.addListener((tab) => {
	chrome.scripting.executeScript({
		target: { tabId: tab.id },
		function: arrange_scrap,
	})
})