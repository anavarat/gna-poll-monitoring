const { isGreenish } = require('../utils/color');

function isContextDestroyedError(e) {
  const msg = String(e?.message || e || '');
  return msg.includes('Execution context was destroyed') || msg.includes('Cannot find context with specified id');
}

function isOnOcmms(page) {
  const url = String(page?.url?.() || '');
  return /ocmms|hrocmms\.nic\.in/i.test(url);
}

async function waitForStableOcmms(page, { timeoutMs = 60000, stableMs = 1200, pollMs = 200 } = {}) {
  const start = Date.now();
  let last = '';
  let stableStart = 0;
  while (Date.now() - start < timeoutMs) {
    const url = page.url();
    if (/ocmms|hrocmms\.nic\.in/i.test(url)) {
      if (url === last) {
        if (!stableStart) stableStart = Date.now();
        if (Date.now() - stableStart >= stableMs) return true;
      } else {
        last = url;
        stableStart = Date.now();
      }
    } else {
      last = url;
      stableStart = 0;
    }
    await page.waitForTimeout(pollMs);
  }
  return false;
}

async function evalRetry(page, fn, arg, { tries = 6, delayMs = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      if (!isOnOcmms(page)) throw new Error('OCMMS_NAV_AWAY');
      if (typeof arg !== 'undefined') return await page.evaluate(fn, arg);
      return await page.evaluate(fn);
    } catch (e) {
      // If we navigated away from OCMMS, stop retrying and let caller recover.
      if (String(e?.message || e) === 'OCMMS_NAV_AWAY') throw e;

      if (!isContextDestroyedError(e) || i === tries - 1) throw e;
      await page.waitForTimeout(delayMs);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await waitForStableOcmms(page, { timeoutMs: 15000 }).catch(() => {});
    }
  }
}

async function stabilizeOcmms(page) {
  // Give redirects time to complete before we run any evaluate.
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await waitForStableOcmms(page, { timeoutMs: 45000, stableMs: 1200 }).catch(() => false);
  // OCMMS pages often take time to finish internal loads.
  await page.waitForTimeout(300);
}

async function gotoCompletedApplications(page) {
  // OCMMS home: tabs include In-Complete Application and Completed Application
  // We click the Completed Application tab until the table header changes.
  await stabilizeOcmms(page);

  // Ensure the tab text exists first
  await page.getByText(/completed application/i).first().waitFor({ timeout: 20000 }).catch(() => {});

  // Click by text using DOM evaluation (some tabs are <li>) with retry.
  await evalRetry(page, () => {
    const norm = s => (s || '').trim().toLowerCase();
    const t = 'completed application';
    const candidates = Array.from(document.querySelectorAll('li,a,button,span,div'));
    const el = candidates.find(e => norm(e.textContent) === t) || candidates.find(e => norm(e.textContent).includes(t));
    if (el) {
      el.click();
      const a = el.querySelector && el.querySelector('a');
      if (a) a.click();
    }
  });

  // Wait for the completed table to appear (it includes "Submission Date" or "Keeping with" in header)
  await page.waitForTimeout(800);
  await page.waitForFunction(() => {
    const header = document.querySelector('table thead') || document.querySelector('table');
    const txt = (header?.innerText || '').toLowerCase();
    return txt.includes('submission') || txt.includes('keeping with');
  }, { timeout: 30000 }).catch(() => {});
}

async function extractCompletedRows(page) {
  // Returns rows with: applicationNo, submissionDate, status, keepingWith, letter, cssColor, greenish
  await stabilizeOcmms(page);

  const rows = await evalRetry(page, () => {
    const norm = s => (s || '').trim().toLowerCase();
    const tables = Array.from(document.querySelectorAll('table'));
    const table = tables.find(t => {
      const header = t.querySelector('thead') || t;
      const txt = norm(header.innerText || '');
      return txt.includes('application no') && txt.includes('submission') && txt.includes('keeping with');
    });
    if (!table) return [];

    const headerCells = Array.from(table.querySelectorAll('thead th')).map(th => norm(th.textContent));
    const idx = (label) => headerCells.findIndex(h => h.includes(label));
    const applicationNoIdx = idx('application no');
    const submissionDateIdx = idx('submission');
    const statusIdx = idx('status');
    const keepingWithIdx = idx('keeping with');

    const trs = Array.from(table.querySelectorAll('tbody tr'));
    const out = [];
    for (const tr of trs) {
      const tds = Array.from(tr.querySelectorAll('td'));
      if (tds.length < 4) continue;

      const applicationNoRaw = (tds[applicationNoIdx]?.innerText || tds[0]?.innerText || '').trim();
      const applicationNo = applicationNoRaw.replace(/\s+/g, ' ');
      if (!/^\d{4,}$/.test(applicationNo)) continue;

      const submissionDate = (tds[submissionDateIdx]?.innerText || tds[1]?.innerText || '').trim();
      const status = (tds[statusIdx]?.innerText || '').trim();
      const keepingWith = (tds[keepingWithIdx]?.innerText || '').trim();

      const badgeEl = Array.from(tr.querySelectorAll('span,div,td,i,strong,b'))
        .find(e => {
          const t = (e.textContent || '').trim();
          return t.length === 1 && /[a-z]/i.test(t);
        }) || null;
      const letter = (badgeEl?.textContent || '').trim();

      out.push({ applicationNo, submissionDate, status, keepingWith, letter });
    }
    return out;
  });

  // Enrich with computed style color for each row's last cell element.
  const enriched = [];
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];

    const cssColor = await evalRetry(page, (rowIndex) => {
      const norm = s => (s || '').trim().toLowerCase();
      const tables = Array.from(document.querySelectorAll('table'));
      const table = tables.find(t => {
        const header = t.querySelector('thead') || t;
        const txt = norm(header.innerText || '');
        return txt.includes('application no') && txt.includes('submission') && txt.includes('keeping with');
      });
      if (!table) return '';
      const tr = Array.from(table.querySelectorAll('tbody tr'))[rowIndex];
      if (!tr) return '';
      const badgeEl = Array.from(tr.querySelectorAll('span,div,td,i,strong,b'))
        .find(e => {
          const t = (e.textContent || '').trim();
          return t.length === 1 && /[a-z]/i.test(t);
        }) || null;
      const el = badgeEl || tr;
      if (!el) return '';
      return window.getComputedStyle(el).color;
    }, idx);

    const greenish = isGreenish(cssColor || '');
    enriched.push({ ...r, cssColor: cssColor || '', greenish });
  }

  return enriched;
}

module.exports = { gotoCompletedApplications, extractCompletedRows };
