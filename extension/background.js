chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (
        async() => {
            if (msg?.type !== 'FETCH_IMAGE_BYTES') return;
                try{
                    const url = msg.cacheBust
                    ? msg.url + (msg.url.includes('?') ? '&' : '?') + '__t=' + Date.now()
                    : msg.url;
                    const res = await fetch(url, {
                        method: 'GET',
                        mode: 'cors',
                        credentials: 'omit', 
                        cache: 'no-store',
                        redirect: 'follow',
                        referrerPolicy: 'no-referrer',
                        headers: {'Accept': 'image/*,*/*;q=0.8'}});
                
                    if (!res.ok){
                        sendResponse({ ok: false, status: res.status, error: `HTTP ${res.status}` });
                        return;
                    }

                    const contentType = res.headers.get('content-type') || 'application/octet-stream';
                    const ab = await res.arrayBuffer()
                    const u8 = new Uint8Array(ab)
                    sendResponse({ok: true, contentType, length: u8.length, bytes: Array.from(u8)})
                } catch(e){
                sendResponse({ok: false, error: String(e)})
            }
        })();
        return true;
})