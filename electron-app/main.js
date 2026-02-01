const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;

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
  const cliPath = path.join(base, 'src', 'run.js');
  const nodeCmd = process.execPath; // current Node (Electron runtime)

  const partiesPath = path.isAbsolute(args.parties) ? args.parties : path.join(base, args.parties);
  const outPath = path.isAbsolute(args.out) ? args.out : path.join(base, args.out);

  const cmdArgs = [cliPath, '--parties', partiesPath, '--out', outPath];
  if (args.headful) cmdArgs.push('--headful');
  if (args.party) cmdArgs.push('--party', args.party);

  return new Promise((resolve, reject) => {
    if (event?.sender) event.sender.send('cli-start', { partiesPath, outPath, cmdArgs });
    const env = { ...process.env };
    // In dev, let Playwright use the default cache. In packaged builds, prefer bundled browsers.
    if (app.isPackaged) env.PLAYWRIGHT_BROWSERS_PATH = '0';
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
