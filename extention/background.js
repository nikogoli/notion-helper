async function arrange_scrap() {

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


	const page_url = document.head.getElementsByTagName("link")[0].getAttribute("href")
	if (url === null) { throw new Error() }

	const body_data = {
		url: page_url,
		html_doc: document.body.outerHTML,
		target_id: TARGET_ID
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