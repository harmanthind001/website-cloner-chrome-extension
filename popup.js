// ============ Site Cloner - popup.js ============
// Popup ka kaam sirf: DOM snapshot lena + background ko job saupna.
// Actual fetching/zipping/downloading background.js (service worker) me hoti hai,
// isliye tab navigate/back/close karne se ya popup band karne se process nahi rukta.

const cloneBtn = document.getElementById('cloneBtn');
const btnText = document.getElementById('btnText');
const currentUrlEl = document.getElementById('currentUrl');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const logEl = document.getElementById('log');
const optCrawl = document.getElementById('optCrawl');
const depthRow = document.getElementById('depthRow');

let activeTab = null;

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  if (!tab || !/^https?:/.test(tab.url)) {
    cloneBtn.disabled = true;
    btnText.textContent = 'Ye page clone nahi ho sakta';
  }

  // Agar koi job already background me chal rahi hai to us job wala URL dikhao
  // (fixed rahega, chahe user is tab me kahin bhi navigate kar chuka ho).
  chrome.runtime.sendMessage({ action: 'getStatus' }, (res) => {
    if (res && res.running) {
      currentUrlEl.textContent = res.url || 'Clone chal raha hai...';
      cloneBtn.disabled = true;
      btnText.textContent = 'Background me clone ho raha hai...';
      progressWrap.style.display = 'block';
      logEl.classList.add('show');
      setProgress(0, 'Chal raha hai (popup band karke bhi chalta rahega)...');
    } else {
      // Koi job chal nahi rahi — normal behaviour: active tab ka URL dikhao
      currentUrlEl.textContent = tab?.url || 'No active tab';
    }
  });
}

optCrawl.addEventListener('change', () => {
  depthRow.style.display = optCrawl.checked ? 'flex' : 'none';
});

document.getElementById('openTabBtn').addEventListener('click', () => {
  const url = chrome.runtime.getURL('dashboard.html') + (activeTab ? '?tabId=' + activeTab.id : '');
  chrome.tabs.create({ url });
  window.close();
});

cloneBtn.addEventListener('click', async () => {
  cloneBtn.disabled = true;
  progressWrap.style.display = 'block';
  logEl.classList.add('show');
  logEl.innerHTML = '';
  setProgress(2, 'Page ka DOM padh raha hai...');

  try {
    const [{ result: pageData }] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
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
      // URL ko is exact snapshot par lock kar do — ab ye tab navigate karne se change nahi hoga
      currentUrlEl.textContent = pageData.baseUrl;
      log('Job background me shuru ho gaya ✅', 'ok');
      log('Ab tum ye tab navigate/close kar sakte ho — download apne aap ho jayega.', '');
      btnText.textContent = 'Background me chal raha hai...';
    });
  } catch (err) {
    log('Error: ' + err.message, 'err');
    setProgress(0, 'Fail ho gaya ❌');
    cloneBtn.disabled = false;
  }
});

// Background se aane wale progress/log updates sunta hai (agar popup open hai)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'progress') {
    setProgress(msg.pct, msg.text);
    if (msg.pct >= 100) {
      cloneBtn.disabled = false;
      btnText.textContent = '🕸️ Is Site ko Clone Karo';
    }
  } else if (msg.type === 'log') {
    log(msg.message, msg.cls);
  } else if (msg.type === 'error') {
    log('Error: ' + msg.message, 'err');
    cloneBtn.disabled = false;
    btnText.textContent = '🕸️ Is Site ko Clone Karo';
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

// Extracts fully-rendered page data from the active tab (runs in page context)
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
      if (/^\d+(\.\d+)?[wx]$/.test(token)) continue; // descriptor jaise "300w" / "2x"
      if (token.startsWith('data:')) continue; // already inline, fetch ki zaroorat nahi
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
