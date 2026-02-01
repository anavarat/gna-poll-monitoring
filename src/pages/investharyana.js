const fs = require('fs');
const path = require('path');
const { ensureDir } = require('../utils/io');
const { clickByText } = require('../utils/selectors');

async function loginInvestHaryana(page, { username, password, debugDir }) {
  await page.goto('https://investharyana.in/#/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // Close initial dashboard modal if present
  const closeBtn = page.getByRole('button', { name: /close/i }).first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click().catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }

  // Open Login/Register modal
  const loginTrigger = page.getByText(/login\/register/i).first();
  await loginTrigger.click({ timeout: 15000, force: true }).catch(() => {});

  // Prefer inputs inside a login modal/container if present
  const loginContainer = page.locator('.modal, .modal-dialog, .modal-content, .login, .login-modal')
    .filter({ has: page.getByText(/login|sign in/i) })
    .first();
  const base = (await loginContainer.count()) ? loginContainer : page;

  // Wait for username input
  const userInput = base.locator('input[placeholder*="user" i], input[id*="user" i]').first();
  try {
    await userInput.waitFor({ timeout: 8000 });
  } catch (e) {
    if (debugDir) {
      ensureDir(debugDir);
      const shotPath = path.join(debugDir, 'login-wait.png');
      await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    }
    await userInput.waitFor({ timeout: 15000 });
  }

  // Fill with Playwright to trigger input events
  await userInput.click({ force: true });
  await userInput.fill(username);

  // Pick a password input that is visible and not a confirm field
  const passCandidates = base.locator('input[type="password"], input[placeholder*="password" i]');
  let passInput = passCandidates.first();
  const passCount = await passCandidates.count();
  for (let i = 0; i < passCount; i++) {
    const candidate = passCandidates.nth(i);
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) continue;
    const id = (await candidate.getAttribute('id').catch(() => '')) || '';
    if (/confirm/i.test(id)) continue;
    passInput = candidate;
    break;
  }

  await passInput.click({ force: true });
  const passHandle = await passInput.elementHandle().catch(() => null);
  if (passHandle) {
    await passHandle.evaluate((el) => el.removeAttribute('readonly')).catch(() => {});
  }
  await passInput.fill(password);

  const hasCaptcha = await page.locator('input[placeholder*="captcha" i]').first().isVisible().catch(() => false);
  if (hasCaptcha) {
    return { needsCaptcha: true };
  }

  await clickSignIn(page);
  return { needsCaptcha: false };
}

async function clickSignIn(page) {
  const signInButton = page.getByRole('button', { name: /sign in/i }).first();
  const signInInput = page.locator('input[type="submit"][value*="sign in" i]').first();
  if (await signInButton.isVisible().catch(() => false)) {
    await signInButton.click();
    return;
  }
  if (await signInInput.isVisible().catch(() => false)) {
    await signInInput.click();
    return;
  }
  await page.getByText(/sign in/i).first().click().catch(() => {});
}

async function waitForLoggedIn(page, timeoutMs = 30000) {
  await page.waitForFunction(() => {
    const url = location.href || '';
    const body = (document.body && document.body.innerText) || '';
    const hasWelcome = /welcome/i.test(body);
    const hasViewCaf = Array.from(document.querySelectorAll('a,button'))
      .some(e => /view caf/i.test((e.textContent || '').trim()));
    const onList = /\/listproject/i.test(url);
    return hasWelcome || hasViewCaf || onList;
  }, { timeout: timeoutMs });
}

async function gotoViewCafs(page) {
  // easiest: click top nav "View CAFs"
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    const norm = s => (s || '').trim().toLowerCase();
    const el = Array.from(document.querySelectorAll('a')).find(a => norm(a.textContent).includes('view caf'));
    if (el) el.click();
  });
  // fallback direct
  await page.waitForTimeout(500);
  const url = page.url();
  if (!url.includes('/listproject')) {
    await page.goto('https://investharyana.in/#/listproject', { waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(800);
}

async function listCafRows(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);

  return await page.evaluate(() => {
    // Locate CAF table by header label "CAF Pin"
    const tables = Array.from(document.querySelectorAll('table'));
    const table = tables.find(t => (t.innerText || '').toLowerCase().includes('caf pin')) || tables[0];
    if (!table) return [];

    const trs = Array.from(table.querySelectorAll('tbody tr'));
    const out = [];
    trs.forEach((tr, idx) => {
      const tds = Array.from(tr.querySelectorAll('td'));
      if (tds.length < 2) return;
      const cafPin = (tds[1]?.innerText || tds[0]?.innerText || '').trim();
      // detail button is usually last cell
      const btn = tr.querySelector('button') || tr.querySelector('a');
      out.push({ cafPin, rowIndex: idx, hasButton: !!btn });
    });
    return out;
  });
}

async function openCafDetailByRowIndex(page, rowIndex) {
  await page.evaluate((i) => {
    const tables = Array.from(document.querySelectorAll('table'));
    const table = tables.find(t => (t.innerText || '').toLowerCase().includes('caf pin')) || tables[0];
    if (!table) return;
    const tr = Array.from(table.querySelectorAll('tbody tr'))[i];
    if (!tr) return;
    const btn = tr.querySelector('button') || tr.querySelector('a');
    if (btn) btn.click();
  }, rowIndex);

  // Wait for left nav to appear
  await page.waitForFunction(() => {
    return !!Array.from(document.querySelectorAll('a,button')).find(e => (e.textContent || '').toLowerCase().includes('service in progress'));
  }, { timeout: 20000 });
}

async function gotoServiceInProgress(page) {
  await page.evaluate(() => {
    const norm = s => (s || '').trim().toLowerCase();
    const el = Array.from(document.querySelectorAll('a,button')).find(e => norm(e.textContent).includes('service in progress'));
    if (el) el.click();
  });
  await page.waitForTimeout(1000);
}

async function extractServiceInProgressRows(page) {
  // Return service rows with department, buttons present
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);

  return await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    // This table has header Department / Service Name / Stage
    const table = tables.find(t => (t.innerText || '').toLowerCase().includes('service name') && (t.innerText || '').toLowerCase().includes('department')) || tables[0];
    if (!table) return [];
    const trs = Array.from(table.querySelectorAll('tbody tr'));
    return trs.map((tr, idx) => {
      const tds = Array.from(tr.querySelectorAll('td'));
      const department = (tds[0]?.innerText || '').trim();
      const serviceName = (tds[1]?.innerText || '').trim();
      const statusText = (tr.innerText || '').includes('Service Cleared') ? 'Service Cleared' : '';
      const buttons = Array.from(tr.querySelectorAll('button, a'))
        .map(b => (b.textContent || '').trim())
        .filter(Boolean);
      // normalize action labels
      const actions = buttons.map(t => t.replace(/\s+/g, ' ').trim());
      return { rowIndex: idx, department, serviceName, statusText, actions };
    });
  });
}

async function closeAnyModal(page) {
  // Close bootstrap/modal dialogs if opened (e.g., View Service Form).
  const modal = page.locator('.modal-dialog, .modal-content').first();
  if (await modal.isVisible().catch(() => false)) {
    // try close button
    const closeBtn = page.locator('button.close, .modal-header button.close, button[aria-label="Close"], .modal-footer button').first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click({ force: true }).catch(() => {});
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(500);
  }
}

async function rowHasTrackServiceForm(page, rowIndex) {
  const table = page.locator('table').filter({ hasText: /service name/i }).first();
  const row = table.locator('tbody tr').nth(rowIndex);

  const trackBtn = row.locator('button, a').filter({ hasText: /^\s*Track\s+Service\s+Form\s*$/i }).first();
  if (await trackBtn.count() === 0) return false;
  return await trackBtn.isVisible().catch(() => false);
}

async function clickTrackServiceFormByRowIndex(page, rowIndex) {
  // Click ONLY the real Track Service Form button/link in this row.
  // Do NOT fall back to spans or partial matches, otherwise we can mistakenly click View Service Form.

  const table = page.locator('table').filter({ hasText: /service name/i }).first();
  const row = table.locator('tbody tr').nth(rowIndex);
  await row.scrollIntoViewIfNeeded().catch(() => {});

  const track = row.locator('button, a').filter({ hasText: /^\s*Track\s+Service\s+Form\s*$/i }).first();
  if (await track.count() === 0) return { clickedLabel: '', href: '', target: '', onclick: '', tag: '', outerHTML: '' };

  const info = await track.evaluate((el) => ({
    text: (el.textContent || '').trim(),
    href: el.getAttribute('href') || '',
    target: el.getAttribute('target') || '',
    onclick: el.getAttribute('onclick') || '',
    tag: (el.tagName || '').toLowerCase(),
    outerHTML: (el.outerHTML || '').slice(0, 5000),
  })).catch(() => ({ text: '', href: '', target: '', onclick: '', tag: '', outerHTML: '' }));

  // Prefer opening in a popup/new tab when possible so the main InvestHaryana tab doesn't get stuck
  // in a redirect loop (/#/i-serviceform/.../track ↔ OCMMS).
  const href = info.href || '';
  const canPopup = href && (href.startsWith('#/') || href.startsWith('http'));

  if (canPopup) {
    // window.open works even when the element click would navigate the current SPA route.
    await page.evaluate((u) => {
      try { window.open(u, '_blank'); } catch {}
    }, href).catch(() => {});
  } else {
    await track.click({ force: true }).catch(async () => {
      await track.evaluate((el) => el.click()).catch(() => {});
    });
  }

  return { clickedLabel: info.text, href: info.href, target: info.target, onclick: info.onclick, tag: info.tag, outerHTML: info.outerHTML };
}

async function getRowActionDetails(page, rowIndex) {
  return await page.evaluate((i) => {
    const norm = (s) => (s || '').trim();
    const tables = Array.from(document.querySelectorAll('table'));
    const table = tables.find(t => (t.innerText || '').toLowerCase().includes('service name') && (t.innerText || '').toLowerCase().includes('department')) || tables[0];
    if (!table) return [];
    const tr = Array.from(table.querySelectorAll('tbody tr'))[i];
    if (!tr) return [];
    const buttons = Array.from(tr.querySelectorAll('button, a'));
    return buttons.map((el) => ({
      text: norm(el.textContent),
      tag: (el.tagName || '').toLowerCase(),
      href: el.getAttribute('href') || '',
      onclick: el.getAttribute('onclick') || '',
      ngClick: el.getAttribute('ng-click') || '',
      id: el.getAttribute('id') || '',
      classes: el.getAttribute('class') || '',
      dataAction: el.getAttribute('data-action') || '',
    }));
  }, rowIndex);
}

async function currentCafPinFromSidebar(page) {
  return await page.evaluate(() => {
    // sidebar label like "CAF Pin (Composite Application Form): 4081710512"
    const txt = document.body.innerText || '';
    const m = txt.match(/CAF\s*Pin[^\n\r]*\s(\d{8,})/i);
    return m ? m[1] : '';
  });
}

async function logout(page) {
  // Best-effort logout. UI varies; try Account menu and direct Logout text.
  await page.waitForTimeout(300);

  // If there's an Account menu link, click it to reveal logout.
  const accountLink = page.getByRole('link', { name: /account/i }).first();
  if (await accountLink.isVisible().catch(() => false)) {
    await accountLink.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  const logoutLink = page.getByRole('link', { name: /logout/i }).first();
  const logoutBtn = page.getByRole('button', { name: /logout/i }).first();

  if (await logoutLink.isVisible().catch(() => false)) {
    await logoutLink.click({ timeout: 5000 }).catch(() => {});
    return;
  }
  if (await logoutBtn.isVisible().catch(() => false)) {
    await logoutBtn.click({ timeout: 5000 }).catch(() => {});
    return;
  }

  // Fallback: click any element containing Logout
  await page.getByText(/logout/i).first().click({ timeout: 3000, force: true }).catch(() => {});
}

module.exports = {
  loginInvestHaryana,
  clickSignIn,
  waitForLoggedIn,
  gotoViewCafs,
  listCafRows,
  openCafDetailByRowIndex,
  gotoServiceInProgress,
  extractServiceInProgressRows,
  closeAnyModal,
  rowHasTrackServiceForm,
  clickTrackServiceFormByRowIndex,
  getRowActionDetails,
  currentCafPinFromSidebar,
  logout,
};
