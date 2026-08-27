// ============ Site Cloner - dashboard.js ============
// Full-tab version. User yahan se koi bhi open tab select karke clone kar sakta hai.
// Actual work (fetch/zip/download) background.js me hi hota hai — isliye ye dashboard
// tab bhi close kar do to job background me chalti rahegi.

const cloneBtn = document.getElementById('cloneBtn');
const btnText = document.getElementById('btnText');
const tabSelect = document.getElementById('tabSelect');
const refreshTabs = document.getElementById('refreshTabs');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const logEl = document.getElementById('log');
const optCrawl = document.getElementById('optCrawl');
const depthRow = document.getElementById('depthRow');

let allTabs = [];

const params = new URLSearchParams(location.search);
const preselectTabId = params.get('tabId') ? parseInt(params.get('tabId'), 10) : null;

init();

async function init() {
  await loadTabs();
  checkRunningJob();
}

async function loadTabs() {
  const tabs = await chrome.tabs.query({});
  allTabs = tabs.filter(t => /^https?:/.test(t.url || ''));
  tabSelect.innerHTML = '';
  allTabs.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = (t.title ? t.title + ' — ' : '') + t.url;
    tabSelect.appendChild(opt);
  });
  if (preselectTabId && allTabs.some(t => t.id === preselectTabId)) {
    tabSelect.value = preselectTabId;
  }
  if (allTabs.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'Koi clone-able (http/https) tab nahi mila';
    tabSelect.appendChild(opt);
    cloneBtn.disabled = true;
  }
}

refreshTabs.addEventListener('click', loadTabs);

function checkRunningJob() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (res) => {
    if (res && res.running) {
      cloneBtn.disabled = true;
      btnText.textContent = 'Background me clone ho raha hai...';
      progressWrap.style.display = 'block';
      setProgress(0, (res.url ? res.url + ' — ' : '') + 'chal raha hai...');
    }
  });
}

optCrawl.addEventListener('change', () => {
  depthRow.style.display = optCrawl.checked ? 'flex' : 'none';
});

cloneBtn.addEventListener('click', async () => {
  const tabId = parseInt(tabSelect.value, 10);
  if (!tabId) { log('Pehle ek tab select karo.', 'err'); return; }

  cloneBtn.disabled = true;
  progressWrap.style.display = 'block';
  logEl.innerHTML = '';
  setProgress(2, 'Page ka DOM padh raha hai...');

  try {
    const [{ result: pageData }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPageData
    });

    const options = {
      optAssets: document.getElementById('optAssets').checked,
      optCss: document.getElementById('optCss').checked,
      optJs: document.getElementById('optJs').checked,
      doCrawl: optCrawl.checked,
      maxPages: parseInt(document.getElementById('maxPages').value, 10) || 10
    };

    chrome.runtime.sendMessage({ action: 'startClone', pageData, options }, (res) => {
      if (!res || !res.ok) {
        log('Error: ' + (res ? res.error : 'background se response nahi mila'), 'err');
        cloneBtn.disabled = false;
        return;
      }
      log('Job background me shuru ho gaya ✅ — ' + pageData.baseUrl, 'ok');
      log('Ye tab band kar sakte ho, ya doosre tab par ja sakte ho — download apne aap hoga.', '');
      btnText.textContent = 'Background me chal raha hai...';
    });
  } catch (err) {
    log('Error: ' + err.message, 'err');
    setProgress(0, 'Fail ho gaya ❌');
    cloneBtn.disabled = false;
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'progress') {
    setProgress(msg.pct, msg.text);
    if (msg.pct >= 100) {
      cloneBtn.disabled = false;
      btnText.textContent = '🕸️ Selected Tab ko Clone Karo';
    }
  } else if (msg.type === 'log') {
    log(msg.message, msg.cls);
  } else if (msg.type === 'error') {
    log('Error: ' + msg.message, 'err');
    cloneBtn.disabled = false;
    btnText.textContent = '🕸️ Selected Tab ko Clone Karo';
  }
});

function log(msg, cls) {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setProgress(pct, text) {
  progressFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
  progressText.textContent = text;
}

// Runs inside the target tab's page context
function extractPageData() {
  const baseUrl = document.baseURI;
  const html = document.documentElement.outerHTML;
  const css = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]')).map(l => l.href);
  const js = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
  const imgs = [];
  Array.from(document.querySelectorAll('img')).forEach(img => {
    [img.currentSrc, img.src, img.getAttribute('data-src'), img.getAttribute('data-lazy-src'), img.getAttribute('data-original')]
      .forEach(c => {
        if (c && !c.startsWith('data:')) {
          try { imgs.push(new URL(c, baseUrl).href); } catch (e) {}
        }
      });
  });

  // srcset ko safely parse karo — data: URIs ke andar comma hota hai isliye naive split(',') use nahi karte
  function extractSrcsetUrls(attrVal) {
    const out = [];
    const re = /data:[^,]+,[A-Za-z0-9+/=]+|[^\s,]+/g;
    let m;
    while ((m = re.exec(attrVal))) {
      const token = m[0];
      if (/^\d+(\.\d+)?[wx]$/.test(token)) continue;
      if (token.startsWith('data:')) continue;
      try { out.push(new URL(token, baseUrl).href); } catch (e) {}
    }
    return out;
  }

  const srcsetUrls = [];
  Array.from(document.querySelectorAll('img[srcset], source[srcset]')).forEach(el => {
    extractSrcsetUrls(el.getAttribute('srcset') || '').forEach(u => srcsetUrls.push(u));
  });

  const icons = Array.from(document.querySelectorAll('link[rel*="icon"][href]')).map(l => l.href);
  const links = Array.from(document.querySelectorAll('a[href]')).map(a => a.href);
  const title = document.title;
  return { baseUrl, html, css, js, imgs: [...imgs, ...srcsetUrls], icons, links, title };
}
