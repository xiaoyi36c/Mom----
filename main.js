const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');

const DEFAULT_CONFIG = {
  mode: 'custom', // 'custom' = 自定义文案池, 'auto' = 自动 API 获取
  customTexts: [
    { id: 't1', content: '🔥 本服招人，活跃工会，长期收人，来的++++', enabled: true, tag: '招人' },
    { id: 't2', content: '今晚 8 点组团副本开荒，装备免费送，要来的速度 M 我', enabled: true, tag: '招人' },
    { id: 't3', content: '江湖路远，有缘再见~ 祝各位武运昌隆！', enabled: true, tag: '串子' },
    { id: 't4', content: '野外 BOSS 已被我拿下，散是满天星，聚是一团火', enabled: true, tag: '串子' },
  ],
  apis: [
    { id: 'a1', name: '语录', url: 'https://uapis.cn/api/v1/saying', type: 'json', field: 'text', enabled: true },
    { id: 'a2', name: 'emo文案', url: 'https://api.4qb.cn/api/emowenan', type: 'text', field: '', enabled: true },
    { id: 'a3', name: '疯狂星期四', url: 'https://api.4qb.cn/api/kfcyiyan', type: 'text', field: '', enabled: true },
  ],
  params: {
    copyDelay: 2,
    afterSendDelay: 10,
    loopCount: 0,
    minLen: 0,
    maxLen: 200,
    regex: '',
  },
};

let win = null;
let task = null;

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH())) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf-8'));
      return {
        mode: saved.mode === 'auto' ? 'auto' : 'custom',
        customTexts: Array.isArray(saved.customTexts)
          ? saved.customTexts.map((t) => ({
              id: t.id || 't' + Date.now() + Math.random().toString(36).slice(2, 6),
              content: String(t.content || ''),
              tag: String(t.tag || ''),
              enabled: t.enabled !== false,
            }))
          : DEFAULT_CONFIG.customTexts.slice(),
        apis: Array.isArray(saved.apis) ? saved.apis : DEFAULT_CONFIG.apis,
        params: Object.assign({}, DEFAULT_CONFIG.params, saved.params || {}),
      };
    }
  } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH(), JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) { /* ignore */ }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function log(level, msg) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  send('task-log', { time, level, msg });
}

/* ---------- HTTP fetch ---------- */
function fetchText(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'MMOShouter/2.0' } }, (res) => {
      if (res.statusCode >= 300 && res.headers.location) {
        res.resume();
        return resolve(fetchText(new URL(res.headers.location, url).href, timeoutMs));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.setEncoding('utf-8');
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(chunks.join('')));
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

async function fetchFromApi(api) {
  const raw = await fetchText(api.url);
  if (api.type === 'json') {
    const data = JSON.parse(raw);
    let node = data;
    for (const key of String(api.field || '').split('.').filter(Boolean)) {
      node = node ? node[key] : undefined;
    }
    return String(node != null ? node : '').trim();
  }
  return raw.trim();
}

/* ---------- SendKeys (no native deps) ---------- */
function sendKeys(keys) {
  return new Promise((resolve, reject) => {
    const cmd = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys}')`;
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd], { windowsHide: true });
    let done = false;
    const finish = (err) => { if (!done) { done = true; err ? reject(err) : resolve(); } };
    ps.on('close', (code) => (code === 0 ? finish() : finish(new Error(`SendKeys exit ${code}`))));
    ps.on('error', finish);
    setTimeout(finish, 5000);
  });
}

/* ---------- Task engine ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function filterText(text, params) {
  if (params.regex) {
    try {
      const m = text.match(new RegExp(params.regex));
      if (m) text = m[1] !== undefined && m.length > 1 ? m[1] : m[0];
    } catch (e) { /* invalid regex -> keep original */ }
  }
  return text.trim();
}

/* ---------- Text source strategies ---------- */
function pickCustomText(pool, used) {
  // pool: [{ id, content, tag }], used: Set of index
  const n = pool.length;
  if (!n) return null;
  if (used.size >= n) used.clear();
  let idx;
  do { idx = Math.floor(Math.random() * n); } while (used.has(idx));
  used.add(idx);
  return { idx, text: pool[idx] };
}

async function pickAutoText(apis, params, used, isRunning) {
  // Try random APIs until we get a fresh, filter-passing text. Bounded retries.
  let lastErr = null;
  for (let retry = 0; retry < 30 && isRunning(); retry++) {
    const api = apis[Math.floor(Math.random() * apis.length)];
    try {
      const raw = await fetchFromApi(api);
      const filtered = filterText(raw, params);
      const lenOk = filtered.length >= params.minLen && (params.maxLen <= 0 || filtered.length <= params.maxLen);
      if (filtered && lenOk && !used.has(filtered)) {
        return { api, text: filtered };
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(300);
  }
  return { error: lastErr };
}

async function runTask(config) {
  const { params } = config;
  const mode = config.mode === 'auto' ? 'auto' : 'custom';
  const used = new Set();
  let sent = 0;
  const startedAt = Date.now();

  task.sent = 0;
  task.startedAt = startedAt;
  task.mode = mode;

  if (mode === 'custom') {
    const pool = (config.customTexts || []).filter((t) => t.enabled && String(t.content || '').trim());
    log('info', `任务启动 · 模式「自定义文案」· 文案池 ${pool.length} 条 · 循环 ${params.loopCount === 0 ? '无限' : params.loopCount} 次`);
    if (!pool.length) {
      log('error', '文案池为空，请先添加自定义文案');
      send('task-stopped', { sent: 0 });
      task = null;
      return;
    }

    while (task.running) {
      if (params.loopCount > 0 && sent >= params.loopCount) break;

      const picked = pickCustomText(pool, used);
      if (!task.running) break;
      if (!picked) {
        log('warn', '文案池为空，跳过本轮');
        await sleep(1500);
        continue;
      }
      const text = picked.text.content.trim();
      send('task-current', { source: `自定义文案 · ${picked.text.tag || '#' + (picked.idx + 1)}`, text });
      used.add(picked.text.content);
      clipboard.writeText(text);
      log('ok', `已复制（${text.length}字）: ${text.slice(0, 40)}${text.length > 40 ? '…' : ''}`);

      await sleep(params.copyDelay * 1000);
      if (!task.running) break;

      send('task-phase', { phase: 'paste' });
      try { await sendKeys('^v'); } catch (e) { log('error', `粘贴失败: ${e.message}`); }
      await sleep(400);
      if (!task.running) break;

      send('task-phase', { phase: 'send' });
      try { await sendKeys('{ENTER}'); } catch (e) { log('error', `发送失败: ${e.message}`); }

      sent++;
      task.sent = sent;
      send('task-stats', { sent, elapsed: Date.now() - startedAt });
      log('ok', `第 ${sent} 条已发送`);

      if (params.loopCount > 0 && sent >= params.loopCount) break;

      let remain = params.afterSendDelay;
      while (remain > 0 && task.running) {
        send('task-phase', { phase: 'wait', remain });
        await sleep(1000);
        remain--;
      }
    }
  } else {
    // auto mode
    const apis = (config.apis || []).filter((a) => a.enabled && a.url);
    log('info', `任务启动 · 模式「自动获取」· ${apis.length} 个数据源 · 循环 ${params.loopCount === 0 ? '无限' : params.loopCount} 次`);
    if (!apis.length) {
      log('error', '请至少启用一个有效数据源');
      send('task-stopped', { sent: 0 });
      task = null;
      return;
    }

    while (task.running) {
      if (params.loopCount > 0 && sent >= params.loopCount) break;

      const result = await pickAutoText(apis, params, used, () => task.running);
      if (!task.running) break;
      if (!result.text) {
        log('warn', result.error ? `获取文案失败: ${result.error.message}` : '未获取到符合条件的新文案，稍后重试');
        await sleep(1500);
        continue;
      }

      const text = result.text;
      send('task-current', { source: `API · ${result.api.name || result.api.url}`, text });
      used.add(text);
      clipboard.writeText(text);
      log('ok', `已复制（${text.length}字）: ${text.slice(0, 40)}${text.length > 40 ? '…' : ''}`);

      await sleep(params.copyDelay * 1000);
      if (!task.running) break;

      send('task-phase', { phase: 'paste' });
      try { await sendKeys('^v'); } catch (e) { log('error', `粘贴失败: ${e.message}`); }
      await sleep(400);
      if (!task.running) break;

      send('task-phase', { phase: 'send' });
      try { await sendKeys('{ENTER}'); } catch (e) { log('error', `发送失败: ${e.message}`); }

      sent++;
      task.sent = sent;
      send('task-stats', { sent, elapsed: Date.now() - startedAt });
      log('ok', `第 ${sent} 条已发送`);

      if (params.loopCount > 0 && sent >= params.loopCount) break;

      let remain = params.afterSendDelay;
      while (remain > 0 && task.running) {
        send('task-phase', { phase: 'wait', remain });
        await sleep(1000);
        remain--;
      }
    }
  }

  const total = ((Date.now() - startedAt) / 1000).toFixed(1);
  log('info', `任务结束 · 共发送 ${sent} 条 · 耗时 ${total}s`);
  send('task-stopped', { sent, total });
  task = null;
}

/* ---------- Window ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 1020,
    minHeight: 700,
    frame: false,
    show: false,
    backgroundColor: '#0a0a10',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ---------- IPC ---------- */
ipcMain.handle('config-load', () => loadConfig());
ipcMain.handle('config-save', (e, cfg) => { saveConfig(cfg); return true; });

ipcMain.handle('task-start', (e, cfg) => {
  if (task) return { ok: false, msg: '任务已在运行' };
  const mode = cfg.mode === 'auto' ? 'auto' : 'custom';
  if (mode === 'custom') {
    const pool = (cfg.customTexts || []).filter((t) => t.enabled && String(t.content || '').trim());
    if (!pool.length) return { ok: false, msg: '请先在「自定义文案」中添加至少一条文案' };
  } else {
    const apis = (cfg.apis || []).filter((a) => a.enabled && a.url);
    if (!apis.length) return { ok: false, msg: '请至少启用一个有效数据源' };
  }
  saveConfig(cfg);
  task = { running: true };
  send('task-started', { mode });
  runTask(cfg).catch((err) => {
    log('error', `任务异常: ${err.message}`);
    send('task-stopped', { sent: task ? task.sent : 0 });
    task = null;
  });
  return { ok: true };
});

ipcMain.handle('task-stop', () => {
  if (task) task.running = false;
  return true;
});

ipcMain.handle('task-isrunning', () => !!task);

ipcMain.on('win-minimize', () => win && win.minimize());
ipcMain.on('win-maximize', () => { if (win) win.isMaximized() ? win.unmaximize() : win.maximize(); });
ipcMain.on('win-close', () => { if (task) task.running = false; win && win.close(); });

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (task) task.running = false;
  app.quit();
});