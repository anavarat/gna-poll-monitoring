# polu automation

Automates the workflow:

InvestHaryana (party login) → View CAFs → per CAF → Service In Progress → if HSPCB provides **Track Service Form** → redirect to HSPCB OCMMS → **Completed Application** → read big-letter badge color.

Outputs CSV with columns:

- party (username)
- caf
- department
- track service form # (completed)  *(we interpret as the OCMMS Application No)*
- status
- keeping with
- letter
- color

## Setup

```bash
cd /Users/outlander/workDir/study/39agentic/01claw/00polu
npm i
npx playwright install chromium
```

## Input

Create `parties.csv`:

```csv
party,password
user1,pass1
user2,pass2
```

## Run

```bash
node src/run.js --parties parties.csv --out out/report.csv --headful
```

If CAPTCHA blocks login, the script will pause and ask you to solve it in the visible browser window, then press Enter in the terminal to continue.

---

What’s done:
- `src/run.js` – main runner (party → CAFs → Track Service Form → OCMMS → Completed Application → extract rows → write CSV)
- `src/investharyana.js` – InvestHaryana navigation + CAF/service scraping
- `src/ocmms.js` – OCMMS “Completed Application” navigation + table extraction
- `src/color.js` – green-ish classifier (HSL range)
- `src/io.js`, `src/selectors.js` – helpers
- `README.md`, `parties.example.csv`
- `package.json` scripts updated (`npm run run` for headful)

Your CSV schema is implemented as columns:
- party
- caf
- department
- track service form #(completed)
- status
- keeping with
- letter
- color

### Take it for a spin
1) Create `parties.csv`:
```csv
party,password
deep_guhna,H@rekr1shna05
```

2) Run (visible browser):
```bash
cd /Users/outlander/workDir/study/39agentic/01claw/00polu
npm run run
```

It will pause if CAPTCHA is detected and wait for you to solve it, then press Enter in the terminal.

Output goes to:
`/Users/outlander/workDir/study/39agentic/01claw/00polu/out/report.csv`
