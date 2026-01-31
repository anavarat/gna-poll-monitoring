// Centralize selectors / finders so adjustments are easy.

function textIncludes(reOrStr) {
  const re = reOrStr instanceof RegExp ? reOrStr : new RegExp(String(reOrStr), 'i');
  return (el) => re.test((el.textContent || '').trim());
}

async function clickByText(page, text, opts = {}) {
  // clicks the first element that matches exact-ish text among common clickable elements
  const { timeout = 15000 } = opts;
  await page.waitForTimeout(250);
  const handle = await page.waitForFunction((t) => {
    const norm = (s) => (s || '').trim().toLowerCase();
    const target = norm(t);
    const candidates = Array.from(document.querySelectorAll('a,button,li,span,div'))
      .filter(e => {
        const cs = window.getComputedStyle(e);
        if (cs && cs.visibility === 'hidden') return false;
        if (cs && cs.display === 'none') return false;
        return true;
      });
    let el = candidates.find(e => norm(e.textContent) === target);
    if (!el) el = candidates.find(e => norm(e.textContent).includes(target));
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    return el;
  }, text, { timeout });

  if (!handle) throw new Error(`clickByText: element not found for text=${text}`);
  await handle.evaluate((el) => el.click());
}

async function acceptDialogs(page) {
  page.on('dialog', async (dialog) => {
    try { await dialog.accept(); } catch {}
  });
}

module.exports = { textIncludes, clickByText, acceptDialogs };
