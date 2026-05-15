/**
 * Takes screenshots of the BrowseIQ sidebar in various states.
 * Usage: node scripts/screenshot.js
 * Output: screenshots/ directory
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const DIST_DIR = path.resolve(__dirname, '../dist');
const OUT_DIR  = path.resolve(__dirname, '../screenshots');

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Launching Chrome with extension...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      `--disable-extensions-except=${DIST_DIR}`,
      `--load-extension=${DIST_DIR}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1280,900',
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  try {
    // Wait for the extension service worker to register
    const swTarget = await browser.waitForTarget(
      t => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
      { timeout: 10000 }
    );
    const extId = swTarget.url().split('/')[2];
    console.log('Extension loaded, ID:', extId);

    // --- 1. Sidebar HTML opened directly (no page context needed) ---
    console.log('\n[1] Sidebar default state...');
    const sidebarPage = await browser.newPage();
    await sidebarPage.setViewport({ width: 400, height: 900 });
    await sidebarPage.goto(`chrome-extension://${extId}/sidebar.html`, { waitUntil: 'networkidle0' });
    await delay(1000);
    await sidebarPage.screenshot({ path: `${OUT_DIR}/01-sidebar-default.png`, fullPage: true });
    console.log('  -> 01-sidebar-default.png');

    // --- 2. Settings modal open ---
    console.log('[2] Settings modal...');
    const settingsBtn = await sidebarPage.$('#settings-btn');
    if (settingsBtn) {
      await settingsBtn.click();
      await delay(600);
      await sidebarPage.screenshot({ path: `${OUT_DIR}/02-sidebar-settings-modal.png`, fullPage: true });
      console.log('  -> 02-sidebar-settings-modal.png');

      // Close modal
      const closeBtn = await sidebarPage.$('.modal-close');
      if (closeBtn) { await closeBtn.click(); await delay(300); }
    }

    // Simulate a conversation in the sidebar
    console.log('[3] Sidebar with typed query...');
    const input = await sidebarPage.$('#query-input');
    if (input) {
      await input.type('What is this page about?');
      await delay(300);
      await sidebarPage.screenshot({ path: `${OUT_DIR}/03-sidebar-with-query.png`, fullPage: true });
      console.log('  -> 03-sidebar-with-query.png');
    }
    await sidebarPage.close();

    // --- 3. Extension injected into a real page ---
    console.log('[4] Loading a real page...');
    const page = await browser.newPage();
    // Use a locally served simple page to avoid network latency
    await page.setContent(`
      <!DOCTYPE html><html><head><title>Sample Article</title></head>
      <body style="font-family:sans-serif;max-width:800px;margin:40px auto;line-height:1.6">
        <h1>Introduction to Artificial Intelligence</h1>
        <p>Artificial intelligence (AI) is intelligence demonstrated by machines, as opposed to
        intelligence of humans and other animals. Example tasks in which this is done include
        speech recognition, computer vision, translation between languages, as well as other
        mappings of inputs.</p>
        <h2>History</h2>
        <p>The history of AI research began in 1956 at a conference at Dartmouth College.
        Since then, AI has gone through many cycles of optimism, followed by disappointment
        and loss of funding. AI research has tried many approaches including simulating the
        brain, modelling human problem solving, formal logic, large databases, and imitating
        animal behaviour.</p>
        <h2>Applications</h2>
        <p>AI applications include advanced web search engines, recommendation systems,
        natural language processing, autonomous vehicles, and many more fields.</p>
      </body></html>
    `, { waitUntil: 'networkidle0' });
    await delay(1500); // let content script inject
    await page.screenshot({ path: `${OUT_DIR}/04-page-before-sidebar.png` });
    console.log('  -> 04-page-before-sidebar.png');

    // Trigger sidebar via background service worker
    console.log('[5] Opening sidebar in page...');
    const sw = await swTarget.worker();
    await sw.evaluate(() => {
      chrome.tabs.query({ active: true }, tabs => {
        if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_SIDEBAR' });
      });
    });
    await delay(2000);
    await page.screenshot({ path: `${OUT_DIR}/05-page-with-sidebar.png` });
    console.log('  -> 05-page-with-sidebar.png');

    // Screenshot just the sidebar iframe
    const sidebarFrame = page.frames().find(f => f.url().includes('sidebar.html'));
    if (sidebarFrame) {
      const handle = await sidebarFrame.frameElement();
      if (handle) {
        await handle.screenshot({ path: `${OUT_DIR}/06-sidebar-iframe-closeup.png` });
        console.log('  -> 06-sidebar-iframe-closeup.png');
      }
    }

    console.log(`\nDone! Screenshots in: ${OUT_DIR}`);
    console.log(fs.readdirSync(OUT_DIR).map(f => `  ${f}`).join('\n'));

  } finally {
    await browser.close();
  }
})();
