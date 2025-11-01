

(() => {
    function isDecorativeImg(img){
        const altAttr = img.getAttribute('alt');
        const role = (img.getAttribute('role') || '').toLowerCase();
        const ariaHidden = (img.getAttribute('aria-hidden') || '').toLowerCase();
        const hasEmptyAlt = altAttr !== null && altAttr.trim() === '';
        return hasEmptyAlt && (role === 'presentation' || ariaHidden ==='true')
    }

    function resolveBgSource(el){
        const styleBg = getComputedStyle(el).backgroundImage || '';
        const urls = Array.from(styleBg.matchAll(/url\((['"]?)(.*?)\1\)/gi))
                            .map(m => m[2])
                            .filter(Boolean);
        if (urls.length){
            return urls[0];
        }

        const attrNames = [
            'data-bg', 'data-background', 'data-background-image',
            'data-bg-src', 'data-lazy-bg', 'data-src'
        ];
        for (const a of attrNames){
            const v = (el.getAttribute(a) || '').trim();
            if (!v) continue;
            const m = v.match(/^url\((['"]?)(.*?)\1\)$/i);
            return m ? m[2] : v;
        }

        return null;
        }


    function parseLastFromSrcsetString(s) {
        if (!s) return null;
        const last = s.split(',').map(x => x.trim().split(' ')[0]).filter(Boolean).pop();
        return last || null;
        } 

        function pickBestSrc(img) {
            const fromSrcset = parseLastFromSrcsetString(img.getAttribute('srcset'));
            const fromDataSrcset = parseLastFromSrcsetString(img.getAttribute('data-srcset'));

            return (
                img.currentSrc ||
                img.src ||
                img.getAttribute('data-src') ||
                img.getAttribute('data-lazy-src') ||
                img.getAttribute('data-original') ||
                fromDataSrcset ||   
                fromSrcset ||
                null
            );
        }

    function extractContextAroundImg(img){
        const bits = [];

        const title = (img.getAttribute('title') || '').trim();
        if (title) bits.push(`title=${title}`);

        const aria = (img.getAttribute('aria-label') || '').trim();
        if (aria) bits.push(`aria-label=${aria}`);

        const ids = (img.getAttribute('aria-describedby') || '')
                .trim().split(/\s+/).filter(Boolean);



        if (ids.length){
                const parts = ids.map(id => {
                const node = document.getElementById(id);
                return (node?.textContent || '').trim();
                }).filter(Boolean);

                if (parts.length) bits.push(`describedBy= ${parts.join(' ').slice(0, 200)}`);
        }

        const figcap = img.closest('figure')?.querySelector('figcaption');
        const capText = (figcap?.textContent || '').trim();
        if (capText) bits.push(`caption="${capText.slice(0, 160)}"`);

        const head = img.closest('section, article, main, div')?.querySelector('h1,h2,h3,h4');
        const headText = (head?.textContent || '').trim();
        if (headText) bits.push(`heading="${headText.slice(0, 120)}"`);

        return bits.join(' | ')
    }

    function collectImgElements(){
        const imgs = Array.from(document.images|| []);
        return imgs.map((img, i) => {

            if (!img.dataset.avIndex) img.dataset.avIndex = String(i);

            const rect = img.getBoundingClientRect();
            const renderW = Math.round(rect.width);
            const renderH = Math.round(rect.height);

            let hasAlt =  !!(img.getAttribute('alt') || '').trim();
            let decorative = isDecorativeImg(img);

            const bestSrc = pickBestSrc(img);

            return{
            type: 'img',
            index: i,
            avIndex: img.dataset.avIndex,
            src: bestSrc,
            width: img.naturalWidth || 0,
            height: img.naturalHeight || 0,
            renderW,
            renderH,
            hasAlt,
            decorative,
            context: extractContextAroundImg(img),
            frameURL: location.href
            };
        });
    }

    function collectBgImgs(){
        const els = Array.from(document.querySelectorAll('[role="img"], [data-av-describe], [data-bg], [data-background], [data-background-image], [data-bg-src], [data-lazy-bg]'));
        const out = [];
        let i = 0;

        for (const el of els){
            i += 1;

            const src = resolveBgSource(el);
            if (!src) continue

            if (!el.dataset.avBgId){
                el.dataset.avBgId = 'bg-' + Math.random().toString(36).slice(2, 9);
            }

            const hasAriaLabel   = !!(el.getAttribute('aria-label') || '').trim();
            const hasLabelledby  = !!(el.getAttribute('aria-labelledby') || '').trim();



            out.push({
                type: 'bg',
                bgId: el.dataset.avBgId,
                src,
                width: el.clientWidth || 0,
                height: el.clientHeight || 0,
                hasAlt: hasAriaLabel || hasLabelledby,
                decorative: false,
                frameURL: location.href
            })
        }
        return out
    }

    function collectTargets(){
        const imgs = collectImgElements();
        const MIN = 32;
        const sizeOk = (x) => ((x.width >= MIN && x.height >= MIN) || (x.renderW >= MIN && x.renderH >= MIN));

        const imgTargets = imgs.filter(x =>
            x.src &&
            !x.hasAlt &&
            !x.decorative &&
            sizeOk(x)
        );

        let bgTargets = collectBgImgs().filter(x => !x.hasAlt && (x.width >= MIN && x.height >= MIN));
;

        bgTargets = bgTargets.filter(x =>
            !x.hasAlt
        );

        const combined = [...imgTargets, ...bgTargets];

        return {
            images: combined,
            totals: {
                imgsAll: imgs.length,
                imgsNeedingAlt: imgTargets.length,
                bgCandidates: bgTargets.length
            }
        }
    }

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        (async() => {

            if(!msg || !msg.type) return;
            if (window.top !== window){
                return;
            }
            if (msg.type === 'PING'){
                sendResponse({ok: true, from: 'content', frameURL: location.href});
                return
            }
            if (msg && msg.type === 'COLLECT_IMAGES'){
                const {images, totals} = collectTargets();
                sendResponse({ok: true, images, totals, frameURL: location.href});
                return
            }

            if (msg && msg.type === 'WRITE_ALT_BATCH'){
                const results = [];
                const mine = (msg.payload || []).filter(x => x.frameURL === location.href)
                for (const item of mine){
                    try{
                        if (item.type === 'img'){
                            const img = document.querySelector(`img[data-av-index="${item.avIndex}"]`) || document.images[item.index];

                            if (!img){
                                results.push({...item, ok: false, error: 'img not found'});
                                continue;
                            }

                            img.setAttribute('alt', String(item.alt || '').trim());
                            results.push({...item, ok:true});
                        } else if(item.type === 'bg'){
                            const el = document.querySelector(`[data-av-bg-id="${item.bgId}"]`);
                            if (!el){
                                results.push({...item, ok: false, error: 'bg element not found'});
                                continue;
                            }

                            if (!el.hasAttribute('role')) el.setAttribute('role', 'img');
                            el.setAttribute('aria-label', String(item.alt || '').trim());
                            results.push({...item, ok: true});
                        } else {
                            results.push({...item, ok: false, error: 'unknown type'})
                        }
                    } catch(e) {
                        results.push({...item, ok: false, error: String(e)})
                    }
                }
                sendResponse({ok: true, results, frameURL: location.href});
                return;
            }
        })();
        return true;
    });
})();