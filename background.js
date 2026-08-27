// ============ Site Cloner - background.js ============
// Poora cloning process yahan chalta hai (service worker) taaki tab navigate/close
// karne ya popup band karne se process na ruke.
importScripts('libs/jszip.min.js');

let jobRunning = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'startClone') {
    if (jobRunning) {
      sendResponse({ ok: false, error: 'Ek clone job already chal raha hai, complete hone do.' });
      return true;
    }
    jobRunning = true;
    chrome.storage.local.set({ cloningUrl: msg.pageData.baseUrl, cloningTitle: msg.pageData.title || '' });
    runClone(msg.pageData, msg.options)
      .catch(err => {
        console.error(err);
        notifyPopup({ type: 'error', message: err.message });
        chrome.action.setBadgeText({ text: 'ERR' });
        chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Site Cloner - Fail',
          message: 'Clone process fail ho gaya: ' + err.message
        });
      })
      .finally(() => {
        jobRunning = false;
        chrome.storage.local.remove(['cloningUrl', 'cloningTitle']);
      });
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'getStatus') {
    chrome.storage.local.get(['cloningUrl', 'cloningTitle'], (data) => {
      sendResponse({ running: jobRunning, url: data.cloningUrl || null, title: data.cloningTitle || null });
    });
    return true;
  }
});

function notifyPopup(payload) {
  chrome.runtime.sendMessage(payload).catch(() => { });
}

function setProgress(pct, text) {
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
  chrome.action.setBadgeText({ text: pct >= 100 ? '✓' : Math.round(pct) + '' });
  notifyPopup({ type: 'progress', pct, text });
}

// ---------- Generic helpers ----------

function resolveUrl(base, rel) {
  try { return new URL(rel, base).href; } catch (e) { return null; }
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch (e) { return url; }
}

function extOf(url) {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.([a-zA-Z0-9]{1,6})(?:$)/);
    return m ? m[1].toLowerCase() : '';
  } catch (e) { return ''; }
}

function safeName(url, fallbackExt, usedNames) {
  let base;
  try {
    const u = new URL(url);
    base = u.pathname.split('/').filter(Boolean).pop() || 'file';
    base = base.split('?')[0].split('#')[0];
  } catch (e) {
    base = 'file';
  }
  base = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!/\.[a-zA-Z0-9]{1,6}$/.test(base) && fallbackExt) base += '.' + fallbackExt;
  let final = base;
  let i = 1;
  while (usedNames.has(final)) {
    const dot = base.lastIndexOf('.');
    final = dot > -1 ? base.slice(0, dot) + '_' + i + base.slice(dot) : base + '_' + i;
    i++;
  }
  usedNames.add(final);
  return final;
}

// Jaise: /hosting/virtual-machines/volume-block-storage/  ->  pages/hosting/virtual-machines/volume-block-storage/index.html
// Website ka asli folder-structure mirror karta hai.
function urlToLocalPath(url) {
  const u = new URL(url);
  let p = u.pathname;
  if (p === '' || p === '/') p = '/index.html';
  else if (p.endsWith('/')) p += 'index.html';
  else if (!/\.[a-zA-Z0-9]{1,6}$/.test(p)) p += '/index.html';
  p = p.replace(/^\//, '');
  p = p.split('/').map(seg => seg.replace(/[^a-zA-Z0-9._-]/g, '_') || '_').join('/');
  return 'pages/' + p;
}

// fromPath aur targetPath dono root-relative hain (zip ke andar). Sahi "../.." nikalta hai.
function toRelative(fromPath, targetPath) {
  const depth = fromPath.split('/').length - 1;
  return depth > 0 ? '../'.repeat(depth) + targetPath : targetPath;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Rate-limit se bachne ke liye adaptive delay — 429 milte hi ye badhta jata hai
let rateLimitDelay = 300;
function bumpRateLimitDelay() {
  rateLimitDelay = Math.min(rateLimitDelay * 2, 8000);
}
function relaxRateLimitDelay() {
  rateLimitDelay = Math.max(300, Math.round(rateLimitDelay * 0.85));
}

async function fetchText(url, attempt = 0) {
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (res.status === 429) {
      bumpRateLimitDelay();
      if (attempt < 4) {
        const retryAfter = parseFloat(res.headers.get('retry-after'));
        const wait = !isNaN(retryAfter) ? retryAfter * 1000 : rateLimitDelay * (attempt + 1);
        await sleep(wait);
        return fetchText(url, attempt + 1);
      }
      throw new Error('HTTP 429 (rate limited, gave up after retries)');
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    relaxRateLimitDelay();
    return await res.text();
  } catch (e) {
    if (attempt < 1 && !/^HTTP /.test(e.message)) {
      await sleep(600);
      return fetchText(url, attempt + 1);
    }
    throw e;
  }
}

async function fetchBlob(url, attempt = 0) {
  const res = await fetch(url, { credentials: 'omit' });
  if (res.status === 429) {
    bumpRateLimitDelay();
    if (attempt < 4) {
      const retryAfter = parseFloat(res.headers.get('retry-after'));
      const wait = !isNaN(retryAfter) ? retryAfter * 1000 : rateLimitDelay * (attempt + 1);
      await sleep(wait);
      return fetchBlob(url, attempt + 1);
    }
    throw new Error('HTTP 429 (rate limited, gave up after retries)');
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  relaxRateLimitDelay();
  return await res.blob();
}

function findCssUrls(cssText) {
  const urls = new Set();
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  let m;
  while ((m = re.exec(cssText))) {
    const u = m[2].trim();
    if (u && !u.startsWith('data:')) urls.add(u);
  }
  const importRe = /@import\s+(?:url\()?['"]?([^'");]+)['"]?\)?/g;
  while ((m = importRe.exec(cssText))) {
    const u = m[1].trim();
    if (u && !u.startsWith('data:')) urls.add(u);
  }
  return Array.from(urls);
}

// Raw (unrendered) HTML text se tags ke attributes nikalne ke liye — crawled pages
// browser me render nahi hote isliye DOM available nahi hota, regex se parse karte hain.
function extractTagAttrs(html, tagRegex, attrNames) {
  const out = [];
  let m;
  while ((m = tagRegex.exec(html))) {
    const tag = m[0];
    const rec = {};
    attrNames.forEach(a => {
      const am = new RegExp(a + '=["\']([^"\']*)["\']', 'i').exec(tag);
      rec[a] = am ? am[1] : null;
    });
    out.push(rec);
  }
  return out;
}

function extractPageResourceUrls(html) {
  const linkTags = extractTagAttrs(html, /<link\b[^>]*>/gi, ['rel', 'href']);
  const css = linkTags.filter(t => t.rel && /stylesheet/i.test(t.rel) && t.href).map(t => t.href);
  const scriptTags = extractTagAttrs(html, /<script\b[^>]*>/gi, ['src']);
  const js = scriptTags.filter(t => t.src).map(t => t.src);
  const imgTags = extractTagAttrs(html, /<img\b[^>]*>/gi, ['src']);
  const imgs = imgTags.filter(t => t.src && !t.src.startsWith('data:')).map(t => t.src);
  return { css, js, imgs };
}

// ---------- Shared resource-download routine (used for main page + crawled pages) ----------

async function downloadCss(cssUrl, zip, urlMap, usedCss, usedImg, optAssets) {
  if (urlMap.has(cssUrl)) return;
  let cssText = await fetchText(cssUrl);
  const localName = safeName(cssUrl, 'css', usedCss);
  const localPath = 'assets/css/' + localName;
  if (optAssets) {
    const nested = findCssUrls(cssText);
    for (const ref of nested) {
      const abs = resolveUrl(cssUrl, ref);
      if (!abs) continue;
      let localAssetPath = urlMap.get(abs);
      if (!localAssetPath) {
        try {
          const blob = await fetchBlob(abs);
          const ext = extOf(abs) || (blob.type.split('/')[1] || 'bin');
          const name = safeName(abs, ext, usedImg);
          localAssetPath = 'assets/img/' + name;
          zip.file(localAssetPath, blob);
          urlMap.set(abs, localAssetPath);
        } catch (e) { continue; }
      }
      cssText = cssText.split(ref).join('../../' + localAssetPath);
    }
  }
  zip.file(localPath, cssText);
  urlMap.set(cssUrl, localPath);
}

async function downloadJs(jsUrl, zip, urlMap, usedJs) {
  if (urlMap.has(jsUrl)) return;
  const blob = await fetchBlob(jsUrl);
  const localName = safeName(jsUrl, 'js', usedJs);
  const localPath = 'assets/js/' + localName;
  zip.file(localPath, blob);
  urlMap.set(jsUrl, localPath);
}

async function downloadImg(imgUrl, zip, urlMap, usedImg) {
  if (urlMap.has(imgUrl) || imgUrl.startsWith('data:')) return;
  const blob = await fetchBlob(imgUrl);
  const ext = extOf(imgUrl) || (blob.type.split('/')[1] || 'png');
  const localName = safeName(imgUrl, ext, usedImg);
  const localPath = 'assets/img/' + localName;
  zip.file(localPath, blob);
  urlMap.set(imgUrl, localPath);
}

// ---------- Main flow ----------

async function runClone(pageData, options) {
  const { optAssets, optCss, optJs, doCrawl, maxPages } = options;

  setProgress(5, 'Process background me shuru ho gaya...');
  const zip = new JSZip();
  const usedCss = new Set(), usedJs = new Set(), usedImg = new Set();
  const urlMap = new Map(); // absolute resource URL -> root-relative local path
  const rootOrigin = new URL(pageData.baseUrl).origin;
  const mainUrl = normalizeUrl(pageData.baseUrl);

  // Page registry: absolute page URL -> { localPath }
  const pageRegistry = new Map();
  pageRegistry.set(mainUrl, { localPath: 'index.html' });
  const pagesHtml = new Map(); // absolute page URL -> raw html text
  pagesHtml.set(mainUrl, pageData.html);

  // ---- Crawl queue (from links found on the main rendered page) ----
  let crawlQueue = [];
  if (doCrawl) {
    const seen = new Set([mainUrl]);
    crawlQueue = (pageData.links || [])
      .map(normalizeUrl)
      .filter(l => { try { return new URL(l).origin === rootOrigin; } catch (e) { return false; } })
      .filter(l => { if (seen.has(l)) return false; seen.add(l); return true; })
      .slice(0, maxPages);
    crawlQueue.forEach(link => pageRegistry.set(link, { localPath: urlToLocalPath(link) }));
  }

  // ---- Main page CSS ----
  if (optCss) {
    setProgress(12, `Main page CSS download ho rahi hai (${pageData.css.length})...`);
    for (const cssUrl of pageData.css) {
      try { await downloadCss(cssUrl, zip, urlMap, usedCss, usedImg, optAssets); }
      catch (e) { notifyPopup({ type: 'log', message: `✗ CSS fail: ${cssUrl} (${e.message})`, cls: 'err' }); }
    }
  }

  // ---- Main page JS ----
  if (optJs) {
    setProgress(30, `Main page JS download ho rahi hai (${pageData.js.length})...`);
    for (const jsUrl of pageData.js) {
      try { await downloadJs(jsUrl, zip, urlMap, usedJs); }
      catch (e) { notifyPopup({ type: 'log', message: `✗ JS fail: ${jsUrl} (${e.message})`, cls: 'err' }); }
    }
  }

  // ---- Main page images ----
  if (optAssets) {
    const imgUrls = [...new Set([...pageData.imgs, ...pageData.icons])].filter(u => u && !u.startsWith('data:'));
    setProgress(45, `Main page images download ho rahi hain (${imgUrls.length})...`);
    for (const imgUrl of imgUrls) {
      try { await downloadImg(imgUrl, zip, urlMap, usedImg); }
      catch (e) { notifyPopup({ type: 'log', message: `✗ Image fail: ${imgUrl} (${e.message})`, cls: 'err' }); }
    }
  }

  // ---- Crawl: fetch each internal page + its own CSS/JS/images ----
  if (doCrawl && crawlQueue.length) {
    let done = 0;
    for (const link of crawlQueue) {
      setProgress(55 + (done / crawlQueue.length) * 30, `Pages fetch ho rahe hain (${done}/${crawlQueue.length})...`);
      try {
        const html = await fetchText(link);
        pagesHtml.set(link, html);
        const res = extractPageResourceUrls(html);

        if (optCss) {
          for (const href of res.css) {
            const abs = resolveUrl(link, href);
            if (!abs) continue;
            try { await downloadCss(abs, zip, urlMap, usedCss, usedImg, optAssets); }
            catch (e) { notifyPopup({ type: 'log', message: `✗ CSS fail: ${abs} (${e.message})`, cls: 'err' }); }
          }
        }
        if (optJs) {
          for (const src of res.js) {
            const abs = resolveUrl(link, src);
            if (!abs) continue;
            try { await downloadJs(abs, zip, urlMap, usedJs); }
            catch (e) { notifyPopup({ type: 'log', message: `✗ JS fail: ${abs} (${e.message})`, cls: 'err' }); }
          }
        }
        if (optAssets) {
          for (const src of res.imgs) {
            const abs = resolveUrl(link, src);
            if (!abs) continue;
            try { await downloadImg(abs, zip, urlMap, usedImg); }
            catch (e) { notifyPopup({ type: 'log', message: `✗ Image fail: ${abs} (${e.message})`, cls: 'err' }); }
          }
        }
        notifyPopup({ type: 'log', message: `✓ Page: ${link}`, cls: 'ok' });
      } catch (e) {
        notifyPopup({ type: 'log', message: `✗ Page fail: ${link} — ${e.message}`, cls: 'err' });
        pageRegistry.delete(link); // link broken rehne do original absolute URL par (rewrite na ho)
      }
      done++;
      await sleep(250); // thoda pause — rate-limit/bot-protection se bachne ke liye
    }
  }

  // ---- Rewrite every collected page: resource URLs + internal links -> local relative paths ----
  setProgress(88, 'Sab pages rewrite ho rahe hain (internal links link karte hue)...');
  const sortedPageEntries = Array.from(pageRegistry.entries()).sort((a, b) => b[0].length - a[0].length);
  for (const [url, html0] of pagesHtml.entries()) {
    const reg = pageRegistry.get(url);
    if (!reg) continue;
    let html = html0;
    const pageLocalPath = reg.localPath;

    for (const [absUrl, localPath] of urlMap.entries()) {
      if (absUrl && html.includes(absUrl)) {
        html = html.split(absUrl).join(toRelative(pageLocalPath, localPath));
      }
    }
    // Longer URLs pehle replace karo taaki ek page ka URL doosre ke prefix se clash na kare
    for (const [pgUrl, info] of sortedPageEntries) {
      if (pgUrl === url) continue;
      if (html.includes(pgUrl)) {
        html = html.split(pgUrl).join(toRelative(pageLocalPath, info.localPath));
      }
    }
    zip.file(pageLocalPath, html);
  }

  // ---- Build & download ZIP ----
  setProgress(93, 'ZIP file ban rahi hai...');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, meta => {
    setProgress(93 + (meta.percent / 100) * 6, 'ZIP ban rahi hai... ' + Math.round(meta.percent) + '%');
  });

  const dataUrl = await blobToDataUrl(blob);
  const siteName = (new URL(pageData.baseUrl).hostname || 'site').replace(/[^a-zA-Z0-9.-]/g, '_');
  const filename = `${siteName}_clone_${Date.now()}.zip`;

  chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, () => {
    setProgress(100, 'Ho gaya! ✅');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Site Cloner - Complete ✅',
      message: `${siteName} clone ho gayi (${pagesHtml.size} pages). Downloads folder me "${filename}" check karo.`
    });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}