'use strict';
/**
 * 「导入干员」：把用户选的基建小人 webm 做成宠物包，写进 $DSH_HOME/dsh-pet/pet/。
 *
 * 主进程只管文件与流程；解码 / 对齐 / 编码在隐藏窗口 importer/page.html 里做（Chromium 自带的
 * 解码器与 WebCodecs），所以不依赖 ffmpeg。认文件、片段清单、配置生成都在 importer/plan.js（纯函数）。
 *
 * 写盘顺序：先全部写进临时目录，成功后再替换旧的素材目录与配置——中途失败不会留下半套宠物。
 * 重复导入同一个角色（同名 = 同 id）就是覆盖更新；旧配置里的 pets（大小、位置、显示位置等）保留。
 * @module dsh-pet/runtime/electron-helper/main/import
 */
const fs = require('node:fs');
const path = require('node:path');
const plan = require('../importer/plan.js');

/** 站立人物在宠物画布里的目标身高（px，与内置素材同量级） */
const STAND_HEIGHT = 267;
/** 整个导入的超时（编码 10 来段 4-10 秒的片段，正常 1 分钟内） */
const TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 开一个隐藏窗口跑 importer/page.html，返回 ask(job) → Promise<reply>。
 */
function openWorker({ BrowserWindow, ipcMain, onProgress }) {
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 200,
    webPreferences: {
      preload: path.join(__dirname, '..', 'importer', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 隐藏窗口默认会被节流（定时器 / 解码变慢），导入期间要全速
      backgroundThrottling: false,
    },
  });
  let pending = null;
  const fromWorker = (event) => !win.isDestroyed() && event.sender === win.webContents;
  const onReply = (event, result) => {
    if (!fromWorker(event) || !pending) return;
    const p = pending;
    pending = null;
    p.resolve(result);
  };
  const onProg = (event, p) => {
    if (fromWorker(event) && onProgress) onProgress(p);
  };
  ipcMain.on('importer:reply', onReply);
  ipcMain.on('importer:progress', onProg);
  const ready = new Promise((resolve, reject) => {
    const onReady = (event) => {
      if (!fromWorker(event)) return;
      ipcMain.removeListener('importer:ready', onReady);
      resolve();
    };
    ipcMain.on('importer:ready', onReady);
    win.webContents.once('render-process-gone', () => reject(new Error('导入窗口崩溃了')));
  });
  win.loadFile(path.join(__dirname, '..', 'importer', 'page.html'));
  const ask = async (job) => {
    await ready;
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      win.webContents.send('importer:job', job);
    });
  };
  const close = () => {
    ipcMain.removeListener('importer:reply', onReply);
    ipcMain.removeListener('importer:progress', onProg);
    if (pending) pending.reject(new Error('导入已取消'));
    pending = null;
    if (!win.isDestroyed()) win.destroy();
  };
  return { ask, close };
}

/** 对齐参数：所有动作共用同一个缩放（按待机第一帧的身高），脚底按各自第一帧的最低点对齐。 */
function geometryFor(probe) {
  const relax = probe.Relax.box;
  const scale = STAND_HEIGHT / Math.max(1, relax.bottom - relax.top);
  const out = {};
  for (const [key, info] of Object.entries(probe)) {
    // 坐下 / 睡觉在游戏里坐在椅子上、躺在床上，画得比站立低：用它自己第一帧的最低点抬回同一条地面线。
    // 其余动作（含第一帧可能是空白的特别动作）都按站立的脚底线。
    const own = (key === 'Sit' || key === 'Sleep') && info.box ? info.box.bottom : relax.bottom;
    out[key] = { scale, ground: own, cx: info.width / 2 };
  }
  return out;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('导入超时')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * 跑一次导入。
 *
 * @param {object} o
 * @param {string[]} o.files - 选中的文件（或文件夹里的全部文件）。
 * @param {string} [o.folderName] - 选的是文件夹时它的名字。
 * @param {string} o.petDir - 宠物包目录（$DSH_HOME/dsh-pet/pet）。
 * @param {*} o.BrowserWindow
 * @param {*} o.ipcMain
 * @param {(p: { done: number, total: number, name: string }) => void} [o.onProgress]
 * @returns {Promise<{ ok: true, id: string, name: string, replaced: boolean, anims: number, ignored: string[] } | { ok: false, error: string }>}
 */
async function runImport({ files, folderName, petDir, BrowserWindow, ipcMain, onProgress }) {
  const parsed = plan.parseSources(files, folderName);
  if (!parsed.ok) return parsed;
  const sources = [
    ...Object.entries(parsed.roles).map(([key, file]) => ({ key, file })),
    ...parsed.extras.map((x) => ({ key: x.anim, file: x.file })),
  ].map((s) => ({ key: s.key, bytes: new Uint8Array(fs.readFileSync(s.file)) }));

  const worker = openWorker({ BrowserWindow, ipcMain, onProgress });
  try {
    return await withTimeout(
      (async () => {
        const probed = await worker.ask({ type: 'probe', sources });
        if (!probed.ok) return { ok: false, error: probed.error };
        const probe = probed.probe;
        if (!probe.Relax || !probe.Relax.box) return { ok: false, error: '待机动作是空白的（第一帧没有人物）。' };
        const frameCounts = Object.fromEntries(Object.entries(probe).map(([k, v]) => [k, v.frames]));
        const clips = plan.planClips(parsed, frameCounts);
        const encoded = await worker.ask({ type: 'encode', clips, geometry: geometryFor(probe) });
        if (!encoded.ok) return { ok: false, error: encoded.error };

        const built = new Set();
        const walks = [];
        let walkSpeed = 0;
        for (let i = 0; i < encoded.results.length; i++) {
          const r = encoded.results[i];
          r.names.forEach((n) => built.add(n));
          if (clips[i].walk) walks.push({ name: r.names[0], sec: r.frames / plan.FPS });
          if (r.bands) walkSpeed = plan.measureWalkSpeed(r.bands);
        }
        const config = plan.buildPackConfig({
          id: parsed.id,
          name: parsed.name,
          built,
          walks,
          walkSpeed,
          extras: parsed.extras.map((x) => x.anim),
        });
        const replaced = writePack(petDir, parsed.id, config, encoded.results);
        return { ok: true, id: parsed.id, name: parsed.name, replaced, anims: built.size, ignored: parsed.ignored };
      })(),
      TIMEOUT_MS,
    );
  } finally {
    worker.close();
  }
}

/**
 * 写盘：临时目录写全 → 替换素材目录 → 写配置。已有配置时保留它的 pets（用户调过的大小、位置等）。
 * @returns {boolean} 是否覆盖了已有的同名宠物包。
 */
function writePack(petDir, id, config, results) {
  fs.mkdirSync(petDir, { recursive: true });
  const animDir = path.join(petDir, id + '-animation');
  const configPath = path.join(petDir, id + '-config.json');
  const tmp = fs.mkdtempSync(path.join(petDir, '.import-' + id + '-'));
  try {
    const tmpAnim = path.join(tmp, id + '-animation');
    fs.mkdirSync(tmpAnim);
    for (const r of results) {
      for (const name of r.names) fs.writeFileSync(path.join(tmpAnim, name + '.webm'), r.bytes);
    }
    let replaced = false;
    if (fs.existsSync(configPath)) {
      replaced = true;
      try {
        const old = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (Array.isArray(old.pets) && old.pets.length) config = { ...old, ...config, pets: old.pets };
      } catch {
        // 旧配置坏了就整份重写
      }
    }
    if (fs.existsSync(animDir)) {
      replaced = true;
      fs.rmSync(animDir, { recursive: true, force: true });
    }
    fs.renameSync(tmpAnim, animDir);
    const tmpConfig = path.join(tmp, id + '-config.json');
    fs.writeFileSync(tmpConfig, JSON.stringify(config, null, 2) + '\n');
    fs.renameSync(tmpConfig, configPath);
    return replaced;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * 导入进度小窗：屏幕中央一个不抢焦点的小面板，显示「正在导入 xx · 第几段 / 共几段」。
 * 导入要一分钟左右，没有它的话选完文件什么都看不到，像是没反应。
 */
function openProgress(BrowserWindow, name) {
  const win = new BrowserWindow({
    width: 340,
    height: 104,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    backgroundColor: '#00000000',
    transparent: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true },
  });
  const esc = (t) =>
    String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const html =
    '<!doctype html><meta charset="utf-8"><style>' +
    ':root{--bg:rgba(255,255,255,.96);--fg:#222;--sub:#666;--track:#e4e4e4;--bar:#4a8cff}' +
    '@media (prefers-color-scheme:dark){:root{--bg:rgba(40,40,44,.96);--fg:#eee;--sub:#aaa;--track:#555;--bar:#6aa2ff}}' +
    'html,body{margin:0;height:100%;background:transparent;font:13px -apple-system,system-ui,"PingFang SC",sans-serif;-webkit-app-region:drag;user-select:none}' +
    '.p{box-sizing:border-box;height:100%;padding:14px 18px;border-radius:12px;background:var(--bg);color:var(--fg)}' +
    '.t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.s{color:var(--sub);margin:6px 0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.k{height:6px;border-radius:3px;background:var(--track);overflow:hidden}.b{height:100%;width:3%;background:var(--bar);transition:width .3s}' +
    '</style><div class="p"><div class="t">正在导入「' +
    esc(name) +
    '」</div><div class="s" id="s">正在读取素材…</div><div class="k"><div class="b" id="b"></div></div></div>';
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive();
  });
  return {
    update(p) {
      if (win.isDestroyed() || !p || !p.total) return;
      const pct = Math.max(3, Math.round((p.done / p.total) * 100));
      const text = '第 ' + (p.done + 1) + ' / ' + p.total + ' 段：' + p.name;
      win.webContents
        .executeJavaScript(
          'document.getElementById("s").textContent=' +
            JSON.stringify(text) +
            ';document.getElementById("b").style.width="' +
            pct +
            '%"',
        )
        .catch(() => {});
    },
    close() {
      if (!win.isDestroyed()) win.destroy();
    },
  };
}

/**
 * 菜单入口：弹选择框（可选多个 webm，或直接选文件夹）→ 导入 → 结果弹窗。
 *
 * @returns {Promise<{ ok: boolean, id?: string }>} ok 时调用方请宿主重载，新宠物随窗口重建出现。
 */
async function importPetInteractive({ dialog, BrowserWindow, ipcMain, petDir, parent }) {
  const pick = await dialog.showOpenDialog(parent, {
    title: '导入干员：选基建小人的 webm（Relax / Move / Sit / Sleep / Interact / Special），或它们所在的文件夹',
    buttonLabel: '导入',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: '透明 webm', extensions: ['webm'] }],
  });
  if (pick.canceled || !pick.filePaths.length) return { ok: false };
  let files = [];
  let folderName;
  for (const p of pick.filePaths) {
    let stat;
    try {
      stat = fs.statSync(p);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      folderName = folderName || path.basename(p);
      files = files.concat(fs.readdirSync(p).map((f) => path.join(p, f)));
    } else {
      files.push(p);
    }
  }
  const parsed = plan.parseSources(files, folderName);
  if (!parsed.ok) {
    await dialog.showMessageBox(parent, { type: 'warning', message: '没法导入', detail: parsed.error });
    return { ok: false };
  }
  if (fs.existsSync(path.join(petDir, parsed.id + '-config.json'))) {
    const r = await dialog.showMessageBox(parent, {
      type: 'question',
      message: '「' + parsed.name + '」已经导入过了，要用这次选的素材覆盖吗？',
      detail: '大小、位置等设置会保留。',
      buttons: ['覆盖', '取消'],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response !== 0) return { ok: false };
  }
  let result;
  const progress = openProgress(BrowserWindow, parsed.name);
  try {
    result = await runImport({
      files,
      folderName,
      petDir,
      BrowserWindow,
      ipcMain,
      onProgress: (p) => progress.update(p),
    });
  } catch (e) {
    result = { ok: false, error: e && e.message ? e.message : String(e) };
  } finally {
    progress.close();
  }
  if (!result.ok) {
    await dialog.showMessageBox(parent, { type: 'error', message: '导入失败', detail: result.error });
    return { ok: false };
  }
  const missing = plan.ROLES.filter((r) => !parsed.roles[r]);
  const detail =
    '共 ' +
    result.anims +
    ' 段动画。' +
    (missing.length ? '\n没有的动作：' + missing.join('、') + '（对应功能会少一些）。' : '') +
    (result.ignored.length ? '\n没用上的文件：' + result.ignored.join('、') : '') +
    '\n新干员会出现在屏幕右上方。';
  await dialog.showMessageBox(parent, { type: 'info', message: '「' + result.name + '」导入好了', detail });
  const pets = readPackPets(petDir, result.id);
  return { ok: true, id: result.id, replaced: result.replaced, pets };
}

/** 包里显示在桌面上的实例（导入后由主进程逐个开窗）。 */
function readPackPets(petDir, id) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(petDir, id + '-config.json'), 'utf8'));
    return (Array.isArray(config.pets) ? config.pets : [])
      .filter((p) => p && (p.display === 'desktop' || p.display === 'both'))
      .map((p) => ({ id: p.id, size: p.size }));
  } catch {
    return [];
  }
}

module.exports = { runImport, importPetInteractive, geometryFor };
