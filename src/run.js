#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { stringify } = require('csv-stringify/sync');

const { ensureDir, readCsvSimple, safeFilename } = require('./utils/io');
const { acceptDialogs } = require('./utils/selectors');
const inv = require('./pages/investharyana');
const ocmms = require('./pages/ocmms');

function parseArgs(argv) {
  const out = { headful: false, parties: 'parties.csv', out: 'out/report.csv', party: '' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headful') out.headful = true;
    else if (a === '--parties') out.parties = argv[++i];
    else if (a === '--party') out.party = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

async function dumpDebugArtifacts(page, party, label) {
  const baseDir = path.join('out', 'debug', safeFilename(party.party || 'party'));
  ensureDir(baseDir);
  const shotPath = path.join(baseDir, `${label}.png`);
  const htmlPath = path.join(baseDir, `${label}.html`);
  await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => '');
  if (html) fs.writeFileSync(htmlPath, html);
  console.error(`Debug artifacts saved: ${shotPath} / ${htmlPath}`);
}

async function waitForStableURL(page, re, { timeoutMs = 120000, stableMs = 1500, pollMs = 200 } = {}) {
  const start = Date.now();
  let lastUrl = '';
  let stableStart = 0;

  while (Date.now() - start < timeoutMs) {
    const url = page.url();

    if (re.test(url)) {
      if (url === lastUrl) {
        if (!stableStart) stableStart = Date.now();
        if (Date.now() - stableStart >= stableMs) return true;
      } else {
        lastUrl = url;
        stableStart = Date.now();
      }
    } else {
      lastUrl = url;
      stableStart = 0;
    }

    await page.waitForTimeout(pollMs);
  }
  return false;
}

async function waitForOcmmsPage(context, currentPage) {
  // Clicking may open in same tab or a new tab/popup.
  // The site sometimes bounces between investharyana ↔ ocmms; we only proceed if the URL
  // stays on OCMMS for a short stable window.
  const popupPromise = currentPage.waitForEvent('popup', { timeout: 45000 }).catch(() => null);
  const newPagePromise = context.waitForEvent('page', { timeout: 45000 }).catch(() => null);

  // Same-tab navigation case: wait until URL becomes OCMMS and remains stable.
  const sameTabPromise = (async () => {
    const ok = await waitForStableURL(currentPage, /ocmms|hrocmms\.nic\.in/i, { timeoutMs: 120000, stableMs: 1500 });
    return ok ? currentPage : null;
  })().catch(() => null);

  const candidate = await Promise.race([popupPromise, newPagePromise, sameTabPromise]);
  if (!candidate) return null;

  // If we got a new page/popup, it can still be mid-redirect. Wait for stable OCMMS URL.
  await candidate.waitForLoadState('domcontentloaded').catch(() => {});
  const ok = await waitForStableURL(candidate, /ocmms|hrocmms\.nic\.in/i, { timeoutMs: 120000, stableMs: 1500 });
  if (!ok) return null;

  return candidate;
}

async function ensureBackToInvestHaryana(page) {
  // Try going back until we are on investharyana.
  for (let i = 0; i < 4; i++) {
    if (/investharyana\.in/i.test(page.url())) return true;
    const backOk = await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForTimeout(500);
    if (!backOk) break;
  }
  // Hard fallback
  await page.goto('https://investharyana.in/#/listproject', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(800);
  return /investharyana\.in/i.test(page.url());
}

async function runParty(browser, party) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await acceptDialogs(page);

  // Helpful during redirect ping-pong (investharyana ↔ ocmms)
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      console.log(`[${party.party}] [nav] ${frame.url()}`);
    }
  });

  const results = [];

  // --- Login
  const debugDir = path.join('out', 'debug', safeFilename(party.party || 'party'));
  let loginRes;
  try {
    loginRes = await inv.loginInvestHaryana(page, { username: party.party, password: party.password, debugDir });
  } catch (e) {
    await dumpDebugArtifacts(page, party, 'login-exception');
    throw e;
  }

  if (loginRes.needsCaptcha) {
    console.log(`\n[${party.party}] CAPTCHA detected. Solve it in the browser and click Sign In. Waiting for login...\n`);
  }

  try {
    await inv.waitForLoggedIn(page, 20000);
  } catch {
    await dumpDebugArtifacts(page, party, 'login-not-complete');
    throw new Error('Login did not complete after Sign In');
  }

  // --- View CAFs
  await inv.gotoViewCafs(page);
  const cafs = await inv.listCafRows(page);

  for (const caf of cafs) {
    if (!caf.cafPin) continue;

    await inv.gotoViewCafs(page);
    await inv.openCafDetailByRowIndex(page, caf.rowIndex);

    const cafPin = (await inv.currentCafPinFromSidebar(page)) || caf.cafPin;

    await inv.gotoServiceInProgress(page);

    const svcRows = await inv.extractServiceInProgressRows(page);

    // Identify rows that REALLY have a Track Service Form button.
    // Do not rely on extracted text blobs; instead verify the actual button/link exists and is visible.
    const trackRows = [];
    for (const r of svcRows) {
      const hasTrack = await inv.rowHasTrackServiceForm(page, r.rowIndex);
      if (hasTrack) trackRows.push(r);
    }

    if (trackRows.length === 0) {
      // Explicitly go back to CAF list (avoid accidental clicks / stale state)
      await inv.gotoViewCafs(page);
      continue;
    }

    // For this CAF: click Track Service Form once per UNIQUE department (first row per dept)
    const deptToRow = new Map();
    for (const r of trackRows) {
      const dept = (r.department || '').trim() || 'HARYANA STATE POLLUTION CONTROL BOARD';
      if (!deptToRow.has(dept)) deptToRow.set(dept, r);
    }

    for (const [dept, row] of deptToRow.entries()) {
      // Ensure we are still on Service In Progress screen before each click
      if (!/investharyana\.in/i.test(page.url())) {
        await ensureBackToInvestHaryana(page);
        await inv.gotoViewCafs(page);
        await inv.openCafDetailByRowIndex(page, caf.rowIndex);
        await inv.gotoServiceInProgress(page);
      }

      // Save where we want to return after finishing OCMMS for this dept.
      // If we let the main tab navigate into /#/i-serviceform/.../track, the browser history can get
      // stuck bouncing between track ↔ OCMMS. We always prefer coming back to this URL.
      const returnUrl = page.url();

      const clickInfo = await inv.clickTrackServiceFormByRowIndex(page, row.rowIndex);
      console.log(`[${party.party}] [CAF ${cafPin}] dept="${dept}" clicked="${clickInfo.clickedLabel}"`);
      if (!clickInfo.clickedLabel) {
        // No clickable Track button after all; ensure no modal is left open and move on.
        await inv.closeAnyModal(page);
        continue;
      }

      if (!clickInfo.clickedLabel || !/track service form/i.test(clickInfo.clickedLabel)) {
        await dumpDebugArtifacts(page, party, `track-click-mismatch-${safeFilename(cafPin)}-${safeFilename(dept)}`);
        // Don't crash entire run; just skip this dept
        continue;
      }

      const ocmmsPage = await waitForOcmmsPage(context, page);
      if (!ocmmsPage) {
        // Either we clicked the wrong thing (modal), or the site bounced without landing stably on OCMMS.
        await inv.closeAnyModal(page);
        await dumpDebugArtifacts(page, party, `ocmms-not-opened-or-not-stable-${safeFilename(cafPin)}-${safeFilename(dept)}`);
        // Ensure we are back on Service In Progress before trying the next dept
        await ensureBackToInvestHaryana(page);
        await page.goto(returnUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(800);
        continue;
      }

      const openedNew = ocmmsPage !== page;
      const backToServiceInProgress = async () => {
        // Hard-return to the known Service In Progress URL to avoid SPA history redirect loops.
        if (returnUrl && /serviceclearanceaction/i.test(returnUrl)) {
          await page.goto(returnUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
          await page.waitForTimeout(800);
          return;
        }
        // Fallback: original recovery
        await ensureBackToInvestHaryana(page);
        await inv.gotoViewCafs(page);
        await inv.openCafDetailByRowIndex(page, caf.rowIndex);
        await inv.gotoServiceInProgress(page);
      };
      await acceptDialogs(ocmmsPage);
      await ocmmsPage.waitForLoadState('domcontentloaded').catch(() => {});
      await ocmmsPage.waitForURL(/ocmms|hrocmms\.nic\.in/i, { timeout: 60000 }).catch(() => {});

      if (!/ocmms|hrocmms\.nic\.in/i.test(ocmmsPage.url())) {
        await dumpDebugArtifacts(ocmmsPage, party, `ocmms-wrong-url-${safeFilename(cafPin)}-${safeFilename(dept)}`);
        if (openedNew) await ocmmsPage.close().catch(() => {});
        // Return to invest if same page
        if (!openedNew) await backToServiceInProgress();
        continue;
      }

      try {
        await ocmms.gotoCompletedApplications(ocmmsPage);
      } catch (e) {
        if (String(e?.message || e) === 'OCMMS_NAV_AWAY') {
          await dumpDebugArtifacts(ocmmsPage, party, `ocmms-bounced-away-${safeFilename(cafPin)}-${safeFilename(dept)}`);
          if (openedNew) await ocmmsPage.close().catch(() => {});
          await backToServiceInProgress();
          continue;
        }
        throw e;
      }

      let completedRows;
      try {
        completedRows = await ocmms.extractCompletedRows(ocmmsPage);
      } catch (e) {
        if (String(e?.message || e) === 'OCMMS_NAV_AWAY') {
          await dumpDebugArtifacts(ocmmsPage, party, `ocmms-bounced-away-${safeFilename(cafPin)}-${safeFilename(dept)}`);
          if (openedNew) await ocmmsPage.close().catch(() => {});
          await backToServiceInProgress();
          continue;
        }
        throw e;
      }

      for (const cr of completedRows) {
        results.push({
          party: party.party,
          caf: cafPin,
          department: dept,
          track_service_form_completed: cr.applicationNo,
          status: cr.status,
          keeping_with: cr.keepingWith,
          letter: cr.letter,
          color: cr.greenish ? 'Green' : (cr.cssColor || ''),
          submission_date: cr.submissionDate || '',
        });
      }

      if (openedNew) {
        await ocmmsPage.close().catch(() => {});
      } else {
        // Same-tab case: go back to the exact Service In Progress URL (avoid track↔ocmms history loop)
        await backToServiceInProgress();
      }
    }

    // After finishing this CAF, go back to CAF list
    await inv.gotoViewCafs(page);
  }

  // After finishing the party: logout (best-effort)
  await inv.logout(page).catch(() => {});

  await context.close();
  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node src/run.js --parties parties.csv --out out/report.csv [--headful] [--party username]');
    process.exit(0);
  }

  const partiesPath = path.resolve(args.parties);
  const outPath = path.resolve(args.out);

  if (!fs.existsSync(partiesPath)) {
    throw new Error(`parties.csv not found at ${partiesPath}`);
  }

  ensureDir(path.dirname(outPath));

  let parties = readCsvSimple(partiesPath);
  if (!parties.length) throw new Error('No parties found in parties.csv');
  if (!parties[0].party || !('password' in parties[0])) {
    throw new Error('parties.csv must have headers: party,password');
  }
  if (args.party) {
    const match = parties.filter((p) => p.party === args.party);
    if (!match.length) {
      throw new Error(`Party not found in parties.csv: ${args.party}`);
    }
    parties = match;
  }

  const browser = await chromium.launch({
    headless: !args.headful,
    args: ['--disable-gpu', '--disable-software-rasterizer'],
  });

  const all = [];
  for (const p of parties) {
    console.log(`\n=== PARTY ${p.party} ===`);
    try {
      const rows = await runParty(browser, p);
      all.push(...rows);
      console.log(`Collected ${rows.length} rows for ${p.party}`);
    } catch (e) {
      console.error(`Error for party ${p.party}:`, e.message);
      all.push({
        party: p.party,
        caf: '',
        department: '',
        track_service_form_completed: '',
        status: `ERROR: ${e.message}`,
        keeping_with: '',
        letter: '',
        color: '',
        submission_date: '',
      });
    }
  }

  await browser.close();

  const deduped = [];
  const seen = new Set();
  for (const r of all) {
    const key = [
      r.party,
      r.caf,
      r.department,
      r.track_service_form_completed,
      r.status,
      r.keeping_with,
      r.letter,
      r.color,
      r.submission_date,
    ].join('||');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  const records = deduped.map(r => ({
    party: r.party,
    caf: r.caf,
    department: r.department,
    'trackServiceForm#(completed)': r.track_service_form_completed,
    status: r.status,
    'keeping with': r.keeping_with,
    letter: r.letter,
    color: r.color,
    submissionDate: r.submission_date,
  }));

  const csv = stringify(records, {
    header: true,
    columns: [
      'party',
      'caf',
      'department',
      'trackServiceForm#(completed)',
      'status',
      'keeping with',
      'letter',
      'color',
      'submissionDate',
    ],
  });

  fs.writeFileSync(outPath, csv);
  console.log(`\nWrote: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
