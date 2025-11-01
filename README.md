# AltVision — On-device AI Alt-Text Assistant (Chrome Built-in AI)

**AltVision** is a Chrome Extension that scans any page for images and unlabeled background images, then generates concise, WCAG-quality alt text **entirely on-device** using Chrome’s built-in AI (Gemini Nano). Optional: translate the generated alt into your chosen language using the on-device **Translator API**. One click can also write the alt directly into the page (`alt=""` or `aria-label`).

## Problem
Missing or poor alt text blocks millions of users (screen readers, low bandwidth, cognitive load). Manually writing accurate alts across large pages is slow and error-prone.

## Solution
One-click **on-device** alt generation with quality prompts, fallback logic, translation, lazy-image handling, and safe write-back. No servers. No data leaves the browser.

## Built-in Chrome AI APIs used
- **Prompt API (Chrome Extensions)** — image+text prompt to Gemini Nano for alt generation  
- **Translator API** — optional translation of the alt text to a target language

## Features
- Detects:
  - `<img>` without alt (skips decorative: `alt=""` + `role="presentation"`)
  - background images needing labels (`role="img"`) — including **lazy** BGs via common `data-*` attributes
- Quality prompt tuned for <120 chars, objective, no filler
- Timeout + simple fallback prompt
- Optional translation (download packs on demand)
- One-click write-back to `alt` / `aria-label`
- Transparent status updates
- Privacy-first: all inference runs locally

## Install (Unpacked)
1. `chrome://extensions` → toggle **Developer mode**
2. **Load unpacked** → select the `extension/` folder
3. Ensure you’re on a **Chrome version that supports Built-in AI** (Dev/Canary/Stable as per contest docs)
4. **Trial tokens** already included in `manifest.json` under `"trial_tokens": ["<your token>"]` for:
   - Prompt API for Extensions
   - Translator API

> Check model availability via `chrome://on-device-internals`.

## Usage
1. Open any page with images (or the test page below).
2. Click the extension icon → **Prepare AI** (first time only).
3. Be sure to refresh page just in case
4. Choose a language (optional).
5. Click **Describe images on this page**.
6. Review cards; click **Copy** to copy alt; leave **Write into alt** checked to write into the page.

## Live Test Page
- **Robust Test Page:** `test/altVision-testFile.html`

## Developer Scripts
None required; it’s a plain Manifest V3 extension. To modify:
- Edit files under `extension/`
- Reload from `chrome://extensions`

## Permissions
- `"activeTab"`, `"scripting"`, `"storage"`, `"host_permissions": ["<all_urls>"]`  
Used to scan DOM, fetch images for local inference, and write alt/aria attributes.

## Privacy
- No network inference calls; model runs on device
- Only image bytes are fetched **locally** by the extension to feed the on-device model
- No analytics or telemetry

## Known Limitations
- Very small images (<32px rendered or actual) are skipped
- Some complex SVGs may hit the fallback path; timeout prevents blocking
- Some sites use unusual lazy loaders; we handle common `data-*` patterns

## How judges can test (quick)
1. Load unpacked extension
2. Open the **Live Test Page**
3. Click **Prepare AI** → **Describe images on this page**
4. Verify cards are produced, click **Copy**, and see alts written to DOM
5. Toggle a non-English language and repeat

## License
MIT (see LICENSE)
