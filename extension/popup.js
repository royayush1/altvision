const $ = s => document.querySelector(s);

const statusEl   = $('#status');
const resultsEl  = $('#results');
const describeBtn= $('#describe');
const writeAltsChk = $('#writeAlts');
const prepareBtn = $('#prepare');
const langSel    = $('#lang');

let session = null;
let translator = null;

function setStatus(text){ statusEl.textContent = text || ''; }
function clearResults(){ resultsEl.innerHTML = ''; }

function card(html){
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = html;
  resultsEl.appendChild(div);
  return div;
}


async function blobToImageBitmap(blob){ return await createImageBitmap(blob); }

async function decodeViaImageElement(blob){
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('html-image-decode-failed'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function rasterizeToPng(img, maxSide = 1024){
  const w = img.naturalWidth  || img.width  || 1;
  const h = img.naturalHeight || img.height || 1;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  let canvas, ctx;
  if (typeof OffscreenCanvas !== 'undefined'){
    canvas = new OffscreenCanvas(tw, th);
    ctx = canvas.getContext('2d');
  } else {
    canvas = document.createElement('canvas');
    canvas.width = tw; canvas.height = th;
    ctx = canvas.getContext('2d');
  }
  ctx.drawImage(img, 0, 0, tw, th);

  if (canvas.convertToBlob){
    return await canvas.convertToBlob({type: 'image/png'});
  }
  return await new Promise(res => canvas.toBlob(res, 'image/png'));
}

function drawBitmapToCanvas(bitmap){
  const { width, height } = bitmap;
  if (typeof OffscreenCanvas !== 'undefined'){
    const off = new OffscreenCanvas(width, height);
    const ctx = off.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return off;
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas;
  }
}

async function canvasToPngBlob(canvas){
  if (canvas.convertToBlob){
    return await canvas.convertToBlob({type: 'image/png'});
  }
  return await new Promise(res => canvas.toBlob(res, 'image/png'));
}

async function normalizeImageBlob(blob){
  const type = (blob.type || '').toLowerCase();

  if (type.startsWith('image/png') || type.startsWith('image/jpeg')){
    try {
      await blobToImageBitmap(blob);  
      return blob;                    
    } catch {
    }
  }

  try {
    const img = await decodeViaImageElement(blob);
    return await rasterizeToPng(img);
  } catch {
    try {
      const bmp = await blobToImageBitmap(blob);
      const canvas = drawBitmapToCanvas(bmp);
      return await canvasToPngBlob(canvas);
    } catch (e) {
      throw e;
    }
  }
}

async function ensurePromptSession(){
  const opts = {
    expectedInputs: [
      {type: 'text', languages: ['en']},
      {type: 'image'}
    ],
    expectedOutputs: [
      {type: 'text', languages: ['en']}
    ],
    monitor(m){
      m.addEventListener('downloadprogress', e => {
        setStatus(`Downloading model... ${Math.round(e.loaded * 100)}%`);
      });
    }
  };
  const availability = await LanguageModel.availability(opts);
  if (availability === 'unavailable'){
    throw new Error('Built-in model unavailable on this device (see chrome://on-device-internals).');
  }
  if (!session){
    setStatus('Preparing on-device model... (first time may take a few minutes)');
    session = await LanguageModel.create(opts);
    setStatus('Model ready');
  }
  return session;
}

async function ensureTranslator(to){
  if (!to || typeof Translator === 'undefined') return null;
  const avail = await Translator.availability({
    sourceLanguage: 'en',
    targetLanguage: to,
  });
  if (avail !== 'available' && avail !== 'downloadable' && avail !== 'downloading'){
    return null;
  }
  if (avail === 'available' || avail === 'downloadable' || avail === 'downloading'){
    translator = await Translator.create({
      sourceLanguage: 'en',
      targetLanguage: to,
      monitor(m) {
        m.addEventListener('downloadprogress', e => {
          setStatus(`Downloading Translator language package ... ${Math.round(e.loaded * 100)}%`);
        });
      },
    });
  }
  return translator;
}

function sendToTab(tabId, msg){
  return new Promise(resolve => chrome.tabs.sendMessage(tabId, msg, resolve));
}

function fetchImageBytes(url){
  return new Promise(resolve => chrome.runtime.sendMessage({type: 'FETCH_IMAGE_BYTES', url}, resolve));
}

async function promptWithTimeout(session, prompt, ms=12000){
  return await Promise.race([
    session.prompt(prompt),
    new Promise((_, reject) => setTimeout(() => reject(new Error('model-timeout')), ms))
  ]);
}

prepareBtn?.addEventListener('click', async() => {
  try{
    await ensurePromptSession();
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e.message || e}`);
  }
});

describeBtn?.addEventListener('click', async() => {
  describeBtn.disabled = true;
  clearResults();
  setStatus('');

  try{
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id) throw new Error('No active tab');

    setStatus('Scanning images on page...');
    const collect = await sendToTab(tab.id, {type: 'COLLECT_IMAGES'});
    if (!collect?.ok) throw new Error('Could not collect images.');
    const items = collect.images || [];

    setStatus(`${collect.totals.imgsNeedingAlt} image(s) missing alt text. ${collect.totals.bgCandidates} background image(s) missing alt text.`);

    if(!items.length){
      setStatus('No images found needing alt text');
      return;
    }

    const s = await ensurePromptSession();
    const toLang = (langSel.value || '').trim();
    const t = await ensureTranslator(toLang);

    const writeBack = [];
    setStatus(`Generating descriptions for ${items.length} items...`);

    for (const meta of items){
      const fetched = await fetchImageBytes(meta.src);
      if(!fetched?.ok){
        card(`<div>Failed to fetch: ${meta.src}<br><small>${fetched?.error || 'unknown error'}</small></div>`);
        continue;
      }

      let bytes = fetched.bytes ? new Uint8Array(fetched.bytes) : null;
      let byteLen = fetched.length ?? (bytes ? bytes.length : 0);

      if (!bytes || byteLen === 0) {
        const retry = await new Promise(resolve =>
          chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_BYTES', url: meta.src, cacheBust: true }, resolve)
        );
        if (retry?.ok && retry.length > 0 && retry.bytes) {
          bytes = new Uint8Array(retry.bytes);
          byteLen = retry.length;
        }
      }

      if (!bytes || byteLen === 0) {
        card(`<div>Skipping tiny/empty image (${byteLen} bytes): ${meta.src}</div>`);
        continue;
      }

      const originalBlob = new Blob([bytes], {type: fetched.contentType || 'application/octet-stream'});

      const pageTitle = (tab?.title || '').trim();
      const hint = (() => {
        try { const u = new URL(meta.src, tab.url); return decodeURIComponent(u.pathname.split('/').pop() || ''); }
        catch { return ''; }
      })();

      let blob = null;
      let desc = '';

      try {
        blob = await normalizeImageBlob(originalBlob);
      } catch (e) {

        const textOnlyPrompt = [
          {
            role: 'user',
            content: [
              { type: 'text', value:
                    `You are an accessibility assistant. The image bytes could not be decoded.
                    Generate alt text under 120 characters using only the filename and the page title.

                    Filename: ${hint || '(unknown)'}
                    Page title: ${pageTitle}

                    If unsure, output a short, neutral label like "site logo" or "regional map".` }
                                ]
          }
        ];
        try { desc = await promptWithTimeout(s, textOnlyPrompt, 20000); } catch {}
        if (!desc || !desc.trim()){
          card(
            `<div>Could not decode image: ${meta.src}<br>` +
            `<small>type=${String(fetched.contentType || 'unknown')}, bytes=${byteLen} — ${String(e)}</small></div>`
          );
          continue;
        }
      }

      if (!desc || !desc.trim()){
        const prompt = [
          {
            role: 'user',
            content: [
              { type: 'text', value:
`You are an accessibility assistant. Produce alt text under 120 characters, objective,
no "image of" prefix; describe the salient subject/context. If any text is visible, include it succinctly.` },
              { type: 'image', value: blob }
            ]
          }
        ];

        try {
          desc = await promptWithTimeout(s, prompt, 25000);
        } catch {}

        if (!desc || !desc.trim()){
          const fallback = [
            {
              role: 'user',
              content: [
                { type: 'text', value:
`Try again. Be specific but concise (≤120 chars). If visible, include key text. Filename: ${hint}` },
                { type: 'image', value: blob }
              ]
            }
          ];
          try { desc = await promptWithTimeout(s, fallback, 20000); } catch {}
        }
      }

      if (!desc || !desc.trim()){
        card(`<div>No description produced for: ${meta.src}</div>`);
        continue;
      }
      desc = desc.trim();

      if (t && toLang){
        try { desc = await t.translate(desc, {to: toLang}); } catch {}
      }

      const hostname = (() => { try { return new URL(meta.src, tab.url).hostname; } catch { return ''; } })();

      if (blob){
        const objectURL = URL.createObjectURL(blob);
        const el = card(`
          <img class="thumb" src="${objectURL}" alt="">
          <div class="row">
            <strong>${meta.type === 'bg' ? 'BG' : 'IMG'}</strong>
            <small>${hostname}</small>
            <button class="copy">Copy</button>
          </div>
          <div>${desc}</div>
          <small>${meta.width || 0}x${meta.height || 0} · frame: ${(meta.frameURL || '').replace(/^https?:\/\//,'').slice(0,40)}...</small>
        `);
        el.querySelector('img.thumb')?.addEventListener('load', () => URL.revokeObjectURL(objectURL), { once: true });
        el.querySelector('.copy')?.addEventListener('click', (e) => {
          navigator.clipboard.writeText(desc);
          e.target.textContent = 'Copied';
          setTimeout(() => (e.target.textContent = 'Copy'), 900);
        });
      } else {
        const el = card(`
          <div class="row">
            <strong>${meta.type === 'bg' ? 'BG' : 'IMG'}</strong>
            <small>${hostname}</small>
            <button class="copy">Copy</button>
          </div>
          <div>${desc}</div>
          <small>no preview · frame: ${(meta.frameURL || '').replace(/^https?:\/\//,'').slice(0,40)}...</small>
        `);
        el.querySelector('.copy')?.addEventListener('click', (e) => {
          navigator.clipboard.writeText(desc);
          e.target.textContent = 'Copied';
          setTimeout(() => (e.target.textContent = 'Copy'), 900);
        });
      }

      if (writeAltsChk.checked){
        if (meta.type === 'img'){
          writeBack.push({
            type: 'img',
            index: meta.index,
            avIndex: meta.avIndex,
            frameURL: meta.frameURL,
            alt: desc
          });
        } else if (meta.type === 'bg'){
          writeBack.push({
            type: 'bg',
            bgId: meta.bgId,
            frameURL: meta.frameURL,
            alt: desc
          });
        }
      }
    } 

    if (writeBack.length){
      setStatus('Adding the alts directly to the page for the necessary elements');
      const res = await sendToTab(tab.id, {type: 'WRITE_ALT_BATCH', payload: writeBack});
      if(!res?.ok){
        setStatus('Descriptions generated but could not write into page');
      } else {
        const okCount = (res.results || []).filter(r => r.ok).length;
        setStatus(`Out of ${items.length} items/imgs, wrote ${okCount} attribute(s)`);
      }
    } else {
      setStatus('Done');
    }
  } catch (e){
    console.error(e);
    setStatus(`Error: ${e.message || e}`);
  } finally {
    describeBtn.disabled = false;
  }
});



