# polu automation

Automates the workflow:

InvestHaryana (party login) → View CAFs → per CAF → Service In Progress → if HSPCB provides **Track Service Form** → redirect to HSPCB OCMMS → **Completed Application** → read big-letter badge color.

Outputs CSV with columns:

- party (username)
- caf
- department
- trackServiceForm#(completed)  *(we interpret as the OCMMS Application No)*
- status
- keeping with
- letter
- color
- submissionDate

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

## Windows usage / packaging
- Requires Node 20+ and Git.
- Install deps and Playwright Chromium:
  ```powershell
  npm ci
  npx playwright install chromium
  node src/run.js --parties parties.csv --out out/report.csv --headful
  ```
- GitHub Actions workflow `.github/workflows/build-win.yml` can produce a Windows-ready bundle artifact `polu-win.tar.gz` (includes `node_modules` + Playwright browsers).

If CAPTCHA blocks login, the script will pause and ask user to solve it in the visible browser window, then press Enter in the terminal to continue.
