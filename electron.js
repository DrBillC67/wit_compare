const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let backendProcess;

function waitForBackendAndCreateWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  const targetUrl = 'http://localhost:5001';
  const maxAttempts = 30;
  let attempts = 0;
  function tryLoad() {
    const http = require('http');
    http.get(targetUrl, res => {
      if (res.statusCode === 200) {
        win.loadURL(targetUrl);
      } else {
        retry();
      }
    }).on('error', retry);
  }
  function retry() {
    attempts++;
    if (attempts < maxAttempts) {
      setTimeout(tryLoad, 500);
    } else {
      win.loadURL('data:text/html,Backend failed to start.');
    }
  }
  tryLoad();
}

app.whenReady().then(() => {
  // Start backend server as a child process
  const serverPath = path.join(__dirname, 'server', 'index.js');
  backendProcess = spawn(process.execPath, [serverPath], {
    cwd: __dirname,
    env: { ...process.env, PORT: '5001' },
    stdio: 'inherit',
  });

  // Wait for the backend to be ready, then open the window
  waitForBackendAndCreateWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) waitForBackendAndCreateWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
  if (backendProcess) {
    backendProcess.kill();
  }
});
