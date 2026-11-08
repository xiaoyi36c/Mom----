/* ===== MMO 喊话大师 Renderer ===== */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const DEFAULT_CUSTOM_TEXTS = [
  { id: 't1', content: '🔥 本服招人，活跃工会，长期收人，来的++++', enabled: true, tag: '招人' },
  { id: 't2', content: '今晚 8 点组团副本开荒，装备免费送，要来的速度 M 我', enabled: true, tag: '招人' },
  { id: 't3', content: '江湖路远，有缘再见~ 祝各位武运昌隆！', enabled: true, tag: '串子' },
  { id: 't4', content: '野外 BOSS 已被我拿下，散是满天星，聚是一团火', enabled: true, tag: '串子' },
];

let config = { mode: 'custom', customTexts: [], apis: [], params: {} };
let running = false;
let elapsedTimer = null;
let startedAt = null;

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg, type = 'success') {
  const el = $('#toast') || createToast();
  el.textContent = msg;
  el.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 2600);
}
function createToast() {
  const el = document.createElement('div');
  el.id = 'toast';
  document.body.appendChild(el);
  return el;
}

/* ---------- 导航 ---------- */
$$('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => gotoPage(btn.dataset.page));
});
$$('[data-goto]').forEach((btn) => {
  btn.addEventListener('click', () => gotoPage(btn.dataset.goto));
});
function gotoPage(name) {
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${name}`));
}

/* ---------- 窗口控制 ---------- */
$('#btnMin').addEventListener('click', () => window.api.winMinimize());
$('#btnMax').addEventListener('click', () => window.api.winMaximize());
$('#btnClose').addEventListener('click', () => window.api.winClose());

/* ---------- 日志 ---------- */
function addLog({ time, level, msg }) {
  const line = document.createElement('div');
  line.className = `log-line ${level}`;
  line.innerHTML = `<span class="log-time">${time}</span><span class="log-msg"></span>`;
  line.querySelector('.log-msg').textContent = msg;
  $('#terminal').appendChild(line);
  $('#terminal').scrollTop = $('#terminal').scrollHeight;

  const mini = document.createElement('div');
  mini.className = `log-line ${level}`;
  mini.innerHTML = `<span class="log-time">${time}</span><span class="log-msg"></span>`;
  mini.querySelector('.log-msg').textContent = msg;
  $('#logMini').appendChild(mini);
  while ($('#logMini').children.length > 9) $('#logMini').firstChild.remove();
  $('#logMini').scrollTop = $('#logMini').scrollHeight;
}
$('#btnClearLogs').addEventListener('click', () => {
  $('#terminal').innerHTML = '';
  $('#logMini').innerHTML = '';
  toast('日志已清空');
});

/* ---------- 模式切换 ---------- */
function setMode(mode) {
  config.mode = mode === 'auto' ? 'auto' : 'custom';
  $$('#modeToggle .mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === config.mode));
  refreshModeSummary();
  refreshStats();
  saveConfig();
}
$$('#modeToggle .mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (running) return toast('任务运行中，请先停止', 'error');
    setMode(btn.dataset.mode);
    toast(`已切换到「${btn.dataset.mode === 'auto' ? '自动获取' : '自定义'}」模式`);
  });
});
function refreshModeSummary() {
  const auto = config.mode === 'auto';
  $('#msIcon').textContent = auto ? '🌐' : '📝';
  $('#msTitle').textContent = auto ? '自动获取文案模式' : '自定义文案模式';
  $('#msDesc').textContent = auto
    ? '从已启用数据源随机拉取，过滤后发送'
    : '从文案池中随机抽取，发送完后自动循环';
  const num = auto
    ? config.apis.filter((a) => a.enabled && a.url).length
    : config.customTexts.filter((t) => t.enabled && String(t.content || '').trim()).length;
  $('#msStatNum').textContent = num;
  $('#msStatLabel').textContent = auto ? '启用数据源' : '可用文案';
  $('#modeSummary').classList.toggle('auto', auto);
}

/* ---------- 自定义文案管理 ---------- */
function newCustomId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}
function renderCustom() {
  const list = $('#customList');
  const empty = $('#customEmpty');
  list.innerHTML = '';
  const items = config.customTexts;
  if (!items.length) {
    empty.hidden = false;
    $('#customCount').textContent = '0 条';
    $('#navCustomCount').textContent = '0';
    return;
  }
  empty.hidden = true;
  items.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'custom-row' + (t.enabled ? '' : ' disabled');
    const preview = (t.content || '').slice(0, 60) + ((t.content || '').length > 60 ? '…' : '');
    row.innerHTML = `
      <label class="switch"><input type="checkbox" data-k="enabled" ${t.enabled ? 'checked' : ''}><span class="track"></span></label>
      <div class="custom-body">
        <textarea class="custom-text" data-k="content" rows="1" placeholder="在此输入文案…">${escapeText(t.content)}</textarea>
        <div class="custom-meta">
          <input type="text" class="custom-tag" data-k="tag" value="${escapeAttr(t.tag || '')}" placeholder="标签（如：招人/串子）" maxlength="12" />
          <span class="custom-len">${(t.content || '').length} 字</span>
        </div>
      </div>
      <button class="icon-btn" title="删除">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
      </button>`;
    const ta = row.querySelector('.custom-text');
    autoSizeTextarea(ta);
    row.querySelectorAll('[data-k]').forEach((input) => {
      const evt = input.tagName === 'TEXTAREA' || input.tagName === 'INPUT' && input.type === 'text' ? 'input' : 'change';
      input.addEventListener(evt, () => {
        let val = input.type === 'checkbox' ? input.checked : input.value;
        config.customTexts[i][input.dataset.k] = val;
        if (input.dataset.k === 'content') {
          row.querySelector('.custom-len').textContent = (val || '').length + ' 字';
          autoSizeTextarea(ta);
        }
        if (input.dataset.k === 'enabled') {
          row.classList.toggle('disabled', !input.checked);
        }
        refreshStats();
        saveConfig();
      });
    });
    row.querySelector('.icon-btn').addEventListener('click', () => {
      config.customTexts.splice(i, 1);
      renderCustom();
      refreshStats();
      saveConfig();
      toast('已删除');
    });
    list.appendChild(row);
  });
  $('#customCount').textContent = `${items.length} 条`;
  $('#navCustomCount').textContent = items.length;
}

function autoSizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = (el.scrollHeight) + 'px';
}

function escapeText(s) { return String(s || '').replace(/</g, '&lt;'); }
function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

$('#btnAddCustom').addEventListener('click', () => {
  config.customTexts.push({ id: newCustomId(), content: '', tag: '', enabled: true });
  renderCustom();
  refreshStats();
  saveConfig();
  // focus the new row
  const rows = $$('#customList .custom-row');
  rows[rows.length - 1]?.querySelector('.custom-text')?.focus();
});

$('#btnClearCustom').addEventListener('click', () => {
  if (!config.customTexts.length) return toast('文案库已经是空的');
  config.customTexts = [];
  renderCustom();
  refreshStats();
  saveConfig();
  toast('已清空文案库');
});

$('#btnBulkImport').addEventListener('click', () => {
  const raw = $('#bulkInput').value || '';
  if (!raw.trim()) return toast('请先粘贴内容', 'error');
  const parts = raw.split(/\s*---+\s*/);
  const lines = [];
  parts.forEach((seg) => {
    seg.split(/\r?\n/).forEach((ln) => {
      const v = ln.trim();
      if (v) lines.push(v);
    });
  });
  if (!lines.length) return toast('未解析到有效内容', 'error');
  lines.forEach((content) => {
    config.customTexts.push({ id: newCustomId(), content, tag: '', enabled: true });
  });
  renderCustom();
  refreshStats();
  saveConfig();
  $('#bulkInput').value = '';
  toast(`已导入 ${lines.length} 条文案`);
});

/* ---------- 数据源 ---------- */
function renderSources() {
  const list = $('#sourceList');
  list.innerHTML = '';
  config.apis.forEach((api, i) => {
    const row = document.createElement('div');
    row.className = 'source-row';
    row.innerHTML = `
      <label class="switch"><input type="checkbox" data-k="enabled" ${api.enabled ? 'checked' : ''}><span class="track"></span></label>
      <input type="text" data-k="name" value="${escapeAttr(api.name)}" placeholder="名称" />
      <input type="text" data-k="url" value="${escapeAttr(api.url)}" class="mono" placeholder="https://..." />
      <select data-k="type"><option value="text" ${api.type === 'text' ? 'selected' : ''}>文本</option><option value="json" ${api.type === 'json' ? 'selected' : ''}>JSON</option></select>
      <input type="text" data-k="field" value="${escapeAttr(api.field)}" class="mono" placeholder="text / data.list" />
      <button class="icon-btn" title="删除" ${config.apis.length <= 1 ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
      </button>`;
    row.querySelectorAll('[data-k]').forEach((input) => {
      input.addEventListener('input', () => {
        config.apis[i][input.dataset.k] = input.type === 'checkbox' ? input.checked : input.value;
        refreshStats();
        saveConfig();
      });
      input.addEventListener('change', () => {
        config.apis[i][input.dataset.k] = input.type === 'checkbox' ? input.checked : input.value;
        refreshStats();
        saveConfig();
      });
    });
    row.querySelector('.icon-btn').addEventListener('click', () => {
      if (config.apis.length <= 1) return toast('至少保留一个数据源', 'error');
      config.apis.splice(i, 1);
      renderSources();
      refreshStats();
      saveConfig();
    });
    list.appendChild(row);
  });
}

$('#btnAddSource').addEventListener('click', () => {
  config.apis.push({ id: 'a' + Date.now(), name: '', url: '', type: 'text', field: '', enabled: true });
  renderSources();
  refreshStats();
  saveConfig();
  const rows = $$('#sourceList .source-row');
  rows[rows.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

/* ---------- 参数 ---------- */
const DEFAULT_PARAMS = { copyDelay: 2, afterSendDelay: 10, loopCount: 0, minLen: 0, maxLen: 200, regex: '' };

function bindRange(id, valId, key) {
  const el = $(id);
  el.addEventListener('input', () => {
    config.params[key] = Number(el.value);
    $(valId).textContent = el.value + 's';
    const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.setProperty('--fill', pct + '%');
    refreshStats();
    saveConfig();
  });
}
bindRange('#paramCopyDelay', '#valCopyDelay', 'copyDelay');
bindRange('#paramAfterDelay', '#valAfterDelay', 'afterSendDelay');
['#paramLoop', '#paramMinLen', '#paramMaxLen', '#paramRegex'].forEach((id, idx) => {
  const key = ['loopCount', 'minLen', 'maxLen', 'regex'][idx];
  $(id).addEventListener('input', () => {
    config.params[key] = key === 'regex' ? $(id).value : (Number($(id).value) || 0);
    refreshStats();
    saveConfig();
  });
});

function renderParams() {
  const p = config.params;
  $('#paramCopyDelay').value = p.copyDelay;
  $('#valCopyDelay').textContent = p.copyDelay + 's';
  setRangeFill('#paramCopyDelay');
  $('#paramAfterDelay').value = p.afterSendDelay;
  $('#valAfterDelay').textContent = p.afterSendDelay + 's';
  setRangeFill('#paramAfterDelay');
  $('#paramLoop').value = p.loopCount;
  $('#paramMinLen').value = p.minLen;
  $('#paramMaxLen').value = p.maxLen;
  $('#paramRegex').value = p.regex || '';
}
function setRangeFill(sel) {
  const el = $(sel);
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty('--fill', pct + '%');
}

$('#btnSaveParams').addEventListener('click', async () => {
  await saveConfig();
  toast('参数已保存');
});
$('#btnResetParams').addEventListener('click', () => {
  config.params = { ...DEFAULT_PARAMS };
  renderParams();
  refreshStats();
  saveConfig();
  toast('已恢复默认参数');
});

async function saveConfig() {
  try {
    await window.api.saveConfig(JSON.parse(JSON.stringify(config)));
  } catch (e) { /* ignore */ }
}

/* ---------- 统计 ---------- */
function refreshStats() {
  const enabledApis = config.apis.filter((a) => a.enabled && a.url).length;
  const enabledCustom = config.customTexts.filter((t) => t.enabled && String(t.content || '').trim()).length;
  $('#navSourceCount').textContent = config.apis.length;
  $('#navCustomCount').textContent = config.customTexts.length;
  $('#statLoop').textContent = config.params.loopCount === 0 ? '∞' : config.params.loopCount;
  if (config.mode === 'auto') {
    $('#statPool').textContent = enabledApis;
    $('#statPoolLabel').textContent = '启用数据源';
  } else {
    $('#statPool').textContent = enabledCustom;
    $('#statPoolLabel').textContent = '可用文案';
  }
  refreshModeSummary();
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/* ---------- 任务控制 ---------- */
function setRunningUI(state) {
  running = state;
  $('#btnStart').disabled = state;
  $('#btnStop').disabled = !state;
  const dot = $('#tbStatus');
  dot.innerHTML = state ? '<i class="dot live"></i>运行中' : '<i class="dot idle"></i>待机';
  $('#engineDot').className = 'dot ' + (state ? 'live' : 'idle');
  $('#engineText').textContent = state ? '引擎运行中' : '引擎待机';
  $('#engineSub').textContent = state ? '任务正在执行' : '就绪，等待任务';
  if (state) {
    startedAt = Date.now();
    clearInterval(elapsedTimer);
    elapsedTimer = setInterval(() => {
      if (startedAt) $('#statElapsed').textContent = fmtElapsed(Date.now() - startedAt);
    }, 1000);
  } else {
    clearInterval(elapsedTimer);
  }
}

$('#btnStart').addEventListener('click', async () => {
  await saveConfig();
  const res = await window.api.startTask(JSON.parse(JSON.stringify(config)));
  if (!res.ok) return toast(res.msg, 'error');
  $('#statSent').textContent = '0';
  $('#statElapsed').textContent = '00:00';
  setPhase('fetching', null);
  setRunningUI(true);
});

$('#btnStop').addEventListener('click', async () => {
  await window.api.stopTask();
  addLog({ time: now(), level: 'warn', msg: '正在停止任务…' });
});

/* ---------- 任务事件 ---------- */
const PHASES = {
  fetching: '抽取文案中',
  paste: '粘贴中',
  send: '按回车发送',
  wait: '等待下一轮',
};
function setPhase(phase, remain, total) {
  const chip = $('#phaseChip');
  if (!phase) {
    chip.textContent = '空闲';
    chip.className = 'phase-chip';
    return;
  }
  chip.textContent = PHASES[phase] || phase;
  chip.className = 'phase-chip ' + (phase === 'wait' ? 'run' : 'act');
  const wrap = $('#progressWrap');
  if (phase === 'wait' && remain != null) {
    wrap.hidden = false;
    $('#progressLabel').textContent = `下一轮 ${remain}s`;
    const totalWait = total || config.params.afterSendDelay;
    $('#progressFill').style.width = `${((totalWait - remain) / totalWait) * 100}%`;
  } else {
    wrap.hidden = true;
  }
}

window.api.on('task-log', (d) => addLog(d));
window.api.on('task-current', (d) => {
  $('#currentSource').textContent = `来源 · ${d.source}`;
  $('#currentText').textContent = d.text;
  setPhase('fetching');
});
window.api.on('task-phase', (d) => setPhase(d.phase, d.remain, config.params.afterSendDelay));
window.api.on('task-stats', (d) => {
  $('#statSent').textContent = d.sent;
  if (startedAt) $('#statElapsed').textContent = fmtElapsed(d.elapsed);
});
window.api.on('task-stopped', () => {
  setRunningUI(false);
  setPhase(null);
});

function now() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

/* ---------- 初始化 ---------- */
(async function init() {
  config = await window.api.loadConfig();
  if (!config.params) config.params = { ...DEFAULT_PARAMS };
  if (!Array.isArray(config.customTexts)) config.customTexts = DEFAULT_CUSTOM_TEXTS.slice();
  if (!config.mode) config.mode = 'custom';
  // sync mode toggle UI
  $$('#modeToggle .mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === config.mode));
  renderCustom();
  renderSources();
  renderParams();
  refreshStats();
  setRunningUI(false);
  addLog({ time: now(), level: 'info', msg: `MMO 喊话大师已就绪 · 当前模式「${config.mode === 'auto' ? '自动获取' : '自定义'}」` });
})();