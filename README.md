# Site Cloner - Chrome Extension

> **Developed by Hostopy** 🚀

Kisi bhi website ka **full offline clone** (HTML + CSS + JS + Images) ek click me download karo direct browser extension ke zariye.

## ✨ Features
- Current tab ka **poora rendered DOM** (JS chalne ke baad wala HTML) capture karta hai
- Saari linked **CSS files** download karta hai, unke andar `url()` / `@import` se referenced fonts/images bhi
- Saari **JS files** download karta hai
- Saari **images, icons, srcset** download karta hai
- Sab kuch local relative paths me rewrite karke ek **ZIP** file banata hai
- Optional: same-domain internal links ko bhi crawl kar sakta hai (multi-page clone)

## 📥 Installation (Load Unpacked)
1. Ye poora folder (`site-cloner`) apne computer me kahin extract/save karo.
2. Chrome me jao: `chrome://extensions`
3. Top-right me **"Developer mode"** ON karo.
4. **"Load unpacked"** button par click karo.
5. `site-cloner` folder select karo.
6. Extension install ho jayega, toolbar me icon dikhega.

## 🚀 Use kaise kare

### Option A — Popup se (quick)
1. Jis website ko clone karna hai us par jaao aur page **fully load hone do**.
2. Extension icon par click karo.
3. Options check karo (CSS / JS / Images / Crawl internal links).
4. **"Is Site ko Clone Karo"** button dabao.
5. ZIP apne aap **Downloads folder** me save ho jayegi (direct save).

### Option B — Full Tab Dashboard se (bada UI, tab picker)
1. Popup me **"🗔 Full Tab me Kholo"** button dabao — ek naya tab khulega jisme poora dashboard hoga.
2. Dropdown se koi bhi **open tab** select karo jise clone karna hai (sirf current tab tak limited nahi).
3. Options set karo aur **"Selected Tab ko Clone Karo"** dabao.
4. Ye dashboard tab band bhi kar do to bhi clone process background me chalta rahega, aur ZIP Downloads folder me save ho jayegi.
5. Complete hone par Chrome notification aayega.

> ✅ Ab process **background service worker** me chalta hai — ek baar "Clone" dabane ke baad tum tab navigate/back kar sakte ho, tab band kar sakte ho, ya popup band kar sakte ho — cloning background me chalti rahegi. Extension icon par progress % badge dikhega, aur complete hone par Chrome notification aayega.

## ⚙️ Kaise kaam karta hai (Technical)
- "Clone" button click karte hi turant `chrome.scripting.executeScript` se active tab ke DOM se poora HTML nikal liya jata hai (already JS-rendered) — **ye snapshot us waqt ka hota hai jab tum button dabate ho**, uske baad tab navigate/close karo koi fark nahi padta.
- Ye snapshot `chrome.runtime.sendMessage` se **background service worker** (`background.js`) ko bhej diya jata hai — asli kaam (fetch, zip, download) wahi hota hai, jo tab se independent chalta hai.
- `fetch()` se har CSS/JS/image resource download hota hai (manifest me `host_permissions: <all_urls>` diya gaya hai isiliye cross-origin fetch CORS ke bina kaam karta hai).
- CSS files ke andar `url(...)` aur `@import` regex se parse karke unke assets (fonts/images) bhi fetch hote hain.
- `JSZip` library (background me `importScripts` se load hoti hai) sab files ko ek `.zip` me pack karti hai.
- `chrome.downloads.download` se final ZIP download hota hai — ye bhi background se chalta hai isliye popup band ho jaye tab bhi download ho jata hai.
- Progress extension icon ke **badge** (chhota number) me dikhta hai, aur agar popup open hai to live progress bar bhi update hoti hai. Complete hone par ek Chrome **notification** aata hai.

## ⚠️ Limitations
- Ye extension sirf tumhare **currently open tab** ka JS-rendered snapshot leta hai (main page ke liye) — agar site heavy SPA hai (React/Vue) jisme content scroll/click par load hota hai, to sirf jo abhi load hai wahi milega.
- "Crawl internal links" option se extra pages fetch hote hain — ye pages, unki CSS/JS/images sab download hoti hain aur **internal links ek doosre se properly linked hote hain** (jaise real website par), taaki ZIP extract karke offline browse kar sako.
- Crawled pages **raw HTML** hote hain (JS render nahi hota unke liye, kyunki wo tab me khulte hi nahi) — agar wahan bhi JS-heavy dynamic content hai to wo miss ho sakta hai.
- Login-protected / cookie-based private pages properly clone nahi honge (fetch cookies attach nahi karta, security ke liye).
- Kuch sites (jaise Cloudflare-protected) bot-detection ki wajah se fetch requests block kar sakti hain — aisi pages "Page fail" log me reason ke saath dikhengi.
- Bahut badi sites (sainkdo MB, ya bahut saare pages) clone karne me time lag sakta hai — dhairya rakho, progress bar dekhte raho.

## 📁 Folder Structure
```
site-cloner/
├── manifest.json      # Extension config (Manifest V3)
├── popup.html          # Small popup UI
├── popup.css
├── popup.js
├── dashboard.html       # Full-tab UI (tab picker + same job flow)
├── dashboard.css
├── dashboard.js
├── background.js       # Service worker — actual cloning engine
├── libs/
│   └── jszip.min.js    # ZIP creation library
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
# website-cloner-chrome-extension
