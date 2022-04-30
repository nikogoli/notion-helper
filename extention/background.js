async function arrange_scrap() {

	const url = chrome.runtime.getURL('.env')
	const env_obj = await fetch(url)
		.then(async response => await response.text() )
		.then( tx => JSON.parse(tx) )
	const { URL_PREFIX, USER_TOKEN, TARGET_ID } = env_obj

	const headers = new Headers()
	headers.append("Authorization", `Bearer ${USER_TOKEN}`)

	const body_data = {
		url: window.location.href,
		html_doc: document.body.outerHTML,
		target_id: TARGET_ID
	}
	
	const URL = `${URL_PREFIX}/withid/pages/create`
	const page_response = await fetch(URL, {
		credentials: "include",
		method: 'POST',
		headers: headers,
		body: JSON.stringify(body_data),
	})
	
	const responseText = await page_response.text()

	switch(page_response.status){
		case "200": {
			const responseJson = JSON.parse(responseText)
			const { object, id } = responseJson
			const test = `create '${object}'.\nCheck "https://notion.so/${id.replaceAll("-","")}"!!`
			window.alert(test)
			console.log(test)
			console.log(responseJson)
			return
		}
		case "201": {
			const responseJson = JSON.parse(responseText)
			const { object, id, message } = responseJson
			const test = `create '${object}', though ${message}.\n\nCheck "https://notion.so/${id.replaceAll("-","")}"`
			window.alert(test)
			console.log(test)
			console.log(responseJson)
			return
		}
		case "400":{
			await JSON.parse(responseText)
			.then( json => {
				if ("stack" in json){
					const { name, message, stack } = json
					window.alert(`Convertion failed.\n${name}: ${message}\n${stack}`)
					console.error(json)
				} else {
					const { name, status, code, body } = json
					const { message } = JSON.parse(body)
					window.alert(`Creation failed\nname: ${name}\ncode: ${code}\nstatus: ${status}\n${message.slice(0,200)}...`)
					console.error({ name, status, code, message })
				}
			})
			.catch(_e => {
				window.alert("Creation Faild. Please check console-message.")
				console.error(responseText)
			})
			return
		}
		case "401": {
			window.alert("Request refused. Please check wheather USER-TOKEN is valid.")
			console.log(page_response)
			return
		}
		case "404": {
			window.alert("Requested URL is not found.")
			console.log(page_response)
			return
		}
		case "501":{
			window.alert("Requested URL is not proper one.")
			console.log(page_response)
			return
		}
	}
}



chrome.action.onClicked.addListener((tab) => {
	chrome.scripting.executeScript({
		target: { tabId: tab.id },
		function: arrange_scrap,
	})
})