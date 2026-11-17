'use strict';
/**
 * 右键「复制一只」「删除」：改宠物包配置（$DSH_HOME/dsh-pet/pet/<包>-config.json 的 pets 数组）。
 *
 * - 复制：在同一个包里加一条 pets，共用同一套动画（素材按包名取，不按 id），新的一只摆在旁边。
 * - 删除：包里还有别的实例就只删这一条；这是最后一只就把配置与动画目录移到废纸篓（可找回）。
 * - 显示位置（隐藏 / 托盘叫回）：直接改包配置里这只的 display，由主进程单开 / 单关它的窗口。
 *   以前走宿主的 /pet-display，宿主会重启整个桌面进程，所有宠物一起闪一下。
 *
 * 纯逻辑（nextCopyId / addCopy / removeInstance）不碰文件，测试直接 require；写盘与弹窗在下面的交互函数里。
 * @module dsh-pet/runtime/electron-helper/main/manage
 */
const fs = require('node:fs');
const path = require('node:path');

/** 新实例往左挪多少（px），免得和原来那只叠在同一个角落 */
const COPY_SHIFT_X = 140;

/** 下一个不重复的实例 id：<原 id>-2、-3…（原 id 已经带 -n 的从它的基名接着数；id 末尾的长数字哈希不算）。 */
function nextCopyId(baseId, taken) {
  const root = baseId.replace(/-\d{1,3}$/, '');
  for (let n = 2; ; n++) {
    const id = root + '-' + n;
    if (!taken.has(id)) return id;
  }
}

/** 在配置里复制实例 id → newId（加在最后）。找不到原实例返回 null。 */
function addCopy(config, id, newId) {
  const pets = Array.isArray(config.pets) ? config.pets : [];
  const i = pets.findIndex((p) => p && p.id === id);
  if (i < 0) return null;
  const src = pets[i];
  const pos = src.position && typeof src.position === 'object' ? src.position : {};
  const copy = {
    ...JSON.parse(JSON.stringify(src)),
    id: newId,
    display: 'desktop',
    // 每多一只就再往旁边挪一格：第 2 只挪 1 格、第 3 只挪 2 格…，不会叠在一起
    position: { ...pos, marginX: (Number(pos.marginX) || 0) + COPY_SHIFT_X * pets.length },
  };
  const next = pets.concat([copy]);
  return { ...config, pets: next };
}

/** 从配置里删掉实例 id。返回 { config, last }：last = 删的是包里最后一只（整个包该删）。找不到返回 null。 */
function removeInstance(config, id) {
  const pets = Array.isArray(config.pets) ? config.pets : [];
  if (!pets.some((p) => p && p.id === id)) return null;
  const rest = pets.filter((p) => !(p && p.id === id));
  return { config: { ...config, pets: rest }, last: rest.length === 0 };
}

/** 全部已用的实例 id（所有包 + 主配置里能认出来的），复制时避开。 */
function allPetIds(petDir, mainConfigPath) {
  const ids = new Set();
  const grab = (text) => {
    for (const m of text.matchAll(/"id"\s*:\s*"([^"]+)"/g)) ids.add(m[1]);
  };
  try {
    for (const f of fs.readdirSync(petDir)) {
      if (/-config\.jsonc?$/.test(f)) grab(fs.readFileSync(path.join(petDir, f), 'utf8'));
    }
  } catch {
    // 目录不在就没有包
  }
  try {
    grab(fs.readFileSync(mainConfigPath, 'utf8'));
  } catch {
    // 没有主配置
  }
  return ids;
}

/** 读包配置；只认 .json（导入器与内置包都是 .json；手写的 .jsonc 带注释，不自动改）。 */
function readPack(petDir, pack) {
  const file = path.join(petDir, pack + '-config.json');
  if (!fs.existsSync(file)) return { error: '这只宠物不在宠物包里（或配置是 .jsonc），请在设置页或配置文件里改。' };
  try {
    return { file, config: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { error: '宠物包配置解析失败：' + file };
  }
}

function writeJson(file, value) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/** 右键「复制一只」：不弹确认，失败才弹窗。@returns {{ ok: boolean, id?: string, size?: number }} ok 时调用方给新实例开窗。 */
async function copyPetInteractive({ dialog, parent, petDir, mainConfigPath, pack, id }) {
  const r = typeof pack === 'string' && pack ? readPack(petDir, pack) : { error: '这只宠物不在宠物包里。' };
  const newId = r.config ? nextCopyId(id, allPetIds(petDir, mainConfigPath)) : null;
  const config = r.config ? addCopy(r.config, id, newId) : null;
  if (!config) {
    await dialog.showMessageBox(parent, {
      type: 'warning',
      message: '没法复制',
      detail: r.error || '配置里找不到它。',
    });
    return { ok: false };
  }
  writeJson(r.file, config);
  const created = config.pets.find((p) => p.id === newId);
  return { ok: true, id: newId, size: created.size };
}

/** 右键「删除」：先确认；最后一只连同动画移到废纸篓。@returns {{ ok: boolean }} ok 时调用方关掉这只的窗口。 */
async function deletePetInteractive({ dialog, shell, parent, petDir, pack, id, name }) {
  const r = typeof pack === 'string' && pack ? readPack(petDir, pack) : { error: '这只宠物不在宠物包里。' };
  const removed = r.config ? removeInstance(r.config, id) : null;
  if (!removed) {
    await dialog.showMessageBox(parent, {
      type: 'warning',
      message: '没法删除',
      detail: r.error || '配置里找不到它。',
    });
    return { ok: false };
  }
  const label = '「' + (name || id) + '」';
  const ask = await dialog.showMessageBox(parent, {
    type: 'warning',
    message: removed.last ? '删除' + label + '？' : '删除这一只' + label + '？',
    detail: removed.last
      ? '这是这个干员的最后一只：它的配置和动画会移到废纸篓，需要的话可以从废纸篓找回，或者重新导入。'
      : '同一个干员还有别的分身，只删掉这一只，动画保留。',
    buttons: ['删除', '取消'],
    defaultId: 1,
    cancelId: 1,
  });
  if (ask.response !== 0) return { ok: false };
  if (!removed.last) {
    writeJson(r.file, removed.config);
    return { ok: true };
  }
  try {
    await shell.trashItem(r.file);
    const animDir = path.join(petDir, pack + '-animation');
    if (fs.existsSync(animDir)) await shell.trashItem(animDir);
  } catch (e) {
    await dialog.showMessageBox(parent, {
      type: 'error',
      message: '删除失败',
      detail: e && e.message ? e.message : String(e),
    });
    return { ok: false };
  }
  return { ok: true };
}

/**
 * 改某只宠物的 display（只认宠物包 .json 里的实例；主配置里的宠物返回 null，调用方回落到宿主接口）。
 * @returns {{ id: string, size: number } | null}
 */
function setPackPetDisplay(petDir, id, display) {
  let files = [];
  try {
    files = fs.readdirSync(petDir).filter((f) => /-config\.json$/.test(f));
  } catch {
    return null;
  }
  for (const f of files) {
    const file = path.join(petDir, f);
    let config;
    try {
      config = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const pets = Array.isArray(config.pets) ? config.pets : [];
    const pet = pets.find((p) => p && p.id === id);
    if (!pet) continue;
    pet.display = display;
    writeJson(file, config);
    return { id, size: pet.size };
  }
  return null;
}

/** 各宠物包在桌面上显示的只数：{ 包名（= 素材根）: 只数 }。 */
function desktopCopyCounts(petDir) {
  const out = {};
  let files = [];
  try {
    files = fs.readdirSync(petDir).filter((f) => /-config\.json$/.test(f));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const config = JSON.parse(fs.readFileSync(path.join(petDir, f), 'utf8'));
      const pets = Array.isArray(config.pets) ? config.pets : [];
      out[f.replace(/-config\.json$/, '')] = pets.filter(
        (p) => p && (p.display === 'desktop' || p.display === 'both'),
      ).length;
    } catch {
      // 坏配置跳过
    }
  }
  return out;
}

module.exports = {
  desktopCopyCounts,
  setPackPetDisplay,
  nextCopyId,
  addCopy,
  removeInstance,
  copyPetInteractive,
  deletePetInteractive,
};
