const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');

let mainWindow;

function normalizeMac(mac) {
  return String(mac || '')
    .trim()
    .toUpperCase()
    .replace(/:/g, '-');
}

function getLocalMacs() {
  const ifaces = os.networkInterfaces();
  const macs = new Set();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (!entry || entry.internal) continue;
      const mac = normalizeMac(entry.mac);
      if (mac && mac !== '00-00-00-00-00-00') macs.add(mac);
    }
  }
  return Array.from(macs);
}

function loadAllowedMacs() {
  // Embedded allowlist so no external config is required.
  return [
    'E4-B9-7A-18-F6-42',
    '3C-6A-A7-EB-24-4A',
  ].map(normalizeMac);
}

function isAllowedMachine() {
  const allowed = loadAllowedMacs();
  if (!allowed.length) return true;
  const local = getLocalMacs();
  return local.some((m) => allowed.includes(m));
}

function getCliBase() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'cli');
  }
  return path.resolve(__dirname, '..');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  if (!isAllowedMachine()) {
    const local = getLocalMacs();
    dialog.showErrorBox(
      'Unauthorized Device',
      `This app is not licensed for this machine.\nDetected MACs:\n${local.join('\n') || '(none)'}`
    );
    app.quit();
    return;
  }

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('run-cli', async (event, args) => {
  // args: { parties, out, party, headful }
  const base = getCliBase();
  const cliPath = app.isPackaged
    ? path.join(base, 'polu-cli.cjs')
    : path.join(base, 'src', 'run.js');
  const nodeCmd = process.execPath; // Electron runtime (Node mode via env)

  const rawParties = String(args.parties || '').trim().replace(/^["']|["']$/g, '');
  const rawOut = String(args.out || '').trim().replace(/^["']|["']$/g, '');
  const partiesPath = path.isAbsolute(rawParties)
    ? rawParties
    : path.join(base, rawParties || 'parties.csv');
  const outPath = path.isAbsolute(rawOut)
    ? rawOut
    : path.join(base, rawOut || 'out/report.csv');

  const cmdArgs = [cliPath];
  cmdArgs.push('--parties', partiesPath, '--out', outPath);
  if (args.headful) cmdArgs.push('--headful');
  if (args.party) cmdArgs.push('--party', args.party);

  return new Promise((resolve, reject) => {
    if (event?.sender) event.sender.send('cli-start', { partiesPath, outPath, cmdArgs });
    if (!fs.existsSync(partiesPath)) {
      const htmlPath = outPath.replace(/\.csv$/i, '.html');
      const stderr = `parties.csv not found at ${partiesPath}`;
      const payload = { code: 1, ok: false, stdout: '', stderr, outPath, htmlPath };
      if (event?.sender) event.sender.send('cli-complete', payload);
      resolve(payload);
      return;
    }
    const env = { ...process.env };
    // In dev, let Playwright use the default cache. In packaged builds, prefer bundled browsers.
    if (app.isPackaged) env.PLAYWRIGHT_BROWSERS_PATH = path.join(base, 'cli-browsers');
    env.ELECTRON_RUN_AS_NODE = '1';
    env.NODE_PATH = path.join(base, 'node_modules');
    const child = spawn(nodeCmd, cmdArgs, {
      cwd: base,
      env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      const chunk = d.toString();
      stdout += chunk;
      if (event?.sender) event.sender.send('cli-log', chunk);
    });
    child.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderr += chunk;
      if (event?.sender) event.sender.send('cli-log', chunk);
    });
    child.on('close', (code) => {
      const htmlPath = outPath.replace(/\.csv$/i, '.html');
      const payload = { code, ok: code === 0, stdout, stderr, outPath, htmlPath };
      if (event?.sender) event.sender.send('cli-complete', payload);
      resolve(payload);
    });
  });
});




