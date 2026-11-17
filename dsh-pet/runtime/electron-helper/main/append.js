'use strict';
/**
 * 右键「追加动作…」：给已有的宠物包加战斗小人的攻击 / 技能 / 出场动作（文件识别见 importer/skills.js）。
 *
 * 解码 / 对齐 / 编码复用导入干员的隐藏窗口（不需要 ffmpeg）。对齐：缩放沿用导入时记下的站立身高
 * （importMeta.standHeightSrc；老的宠物包没有就用这批文件第一帧身高的中位数——战斗小人与基建小人同比例），
 * 脚底统一用这批文件第一帧最低点的中位数，起手跳起来的那一帧不会把整段带歪。
 * 写盘：每个文件先写临时名再改名，最后改配置；中途失败不会留下引用了不存在动画的配置。
 * @module dsh-pet/runtime/electron-helper/main/append
 */
const fs = require('node:fs');
const path = require('node:path');
const skills = require('../importer/skills.js');
const { openWorker, openProgress, withTimeout, readPackPets, STAND_HEIGHT } = require('./import.js');

const TIMEOUT_MS = 10 * 60 * 1000;

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

/** 对齐参数（同一套缩放与脚底线）。 */
function skillGeometry(probe, standHeightSrc) {
  const boxes = Object.values(probe)
    .map((p) => p.box)
    .filter(Boolean);
  if (!boxes.length) return null;
  const stand = Number(standHeightSrc) > 0 ? Number(standHeightSrc) : median(boxes.map((b) => b.bottom - b.top));
  const scale = STAND_HEIGHT / Math.max(1, stand);
  const ground = median(boxes.map((b) => b.bottom));
  const out = {};
  for (const [key, info] of Object.entries(probe)) out[key] = { scale, ground, cx: info.width / 2 };
  return out;
}

function writeJson(file, value) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/**
 * @returns {Promise<{ ok: boolean, pets?: { id: string, size: number }[] }>} ok 时调用方重开这个包的窗口。
 */
async function appendSkillsInteractive({ dialog, BrowserWindow, ipcMain, petDir, parent, pack, name }) {
  const fail = async (detail) => {
    await dialog.showMessageBox(parent, { type: 'warning', message: '没法追加动作', detail });
    return { ok: false };
  };
  if (typeof pack !== 'string' || !pack) return fail('这只宠物不在宠物包里。');
  const configPath = path.join(petDir, pack + '-config.json');
  const animDir = path.join(petDir, pack + '-animation');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return fail('读不到宠物包配置（只支持 .json）：' + configPath);
  }
  if (!fs.existsSync(animDir)) return fail('宠物包没有动画目录：' + animDir);

  const pick = await dialog.showOpenDialog(parent, {
    title: '追加动作：选战斗小人的 webm（Attack / Skill_x / Skill_x_Begin·Loop·Idle·End / Start…）',
    buttonLabel: '追加',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '透明 webm', extensions: ['webm'] }],
  });
  if (pick.canceled || !pick.filePaths.length) return { ok: false };
  const taken = new Set(
    fs
      .readdirSync(animDir)
      .filter((f) => /\.(webm|mov)$/i.test(f))
      .map((f) => f.replace(/\.(webm|mov)$/i, '')),
  );
  // 重新追加同一批文件：它们之前生成的名字不算「已占用」，直接覆盖
  const prior = new Set(
    [
      ...((config.animations?.categories || []).find((c) => c.id === skills.SKILL_CATEGORY)?.actions || []),
      ...(config.animations?.states || []).flatMap((s) => [...s.enter, ...s.loop, ...s.exit]),
      ...(config.animations?.start || []),
    ].filter(Boolean),
  );
  for (const n of prior) taken.delete(n);
  const parsed = skills.parseSkillFiles(pick.filePaths, taken);
  if (!parsed.ok) return fail(parsed.error);
  const { sources, clips } = skills.skillSourcesAndClips(parsed);

  const label = name || pack;
  const progress = openProgress(BrowserWindow, label, '正在给「' + label + '」追加动作');
  const worker = openWorker({ BrowserWindow, ipcMain, onProgress: (p) => progress.update(p) });
  let result;
  try {
    result = await withTimeout(
      (async () => {
        const withBytes = sources.map((s) => ({ key: s.key, bytes: new Uint8Array(fs.readFileSync(s.file)) }));
        const probed = await worker.ask({ type: 'probe', sources: withBytes });
        if (!probed.ok) return { ok: false, error: probed.error };
        const geometry = skillGeometry(probed.probe, config.importMeta?.standHeightSrc);
        if (!geometry) return { ok: false, error: '这些文件的第一帧都是空白的。' };
        const encoded = await worker.ask({ type: 'encode', clips, geometry });
        if (!encoded.ok) return { ok: false, error: encoded.error };
        const built = new Set();
        const durations = {};
        for (const r of encoded.results) {
          for (const n of r.names) durations[n] = r.frames / 30;
          for (const n of r.names) {
            const tmp = path.join(animDir, '.' + n + '.webm.tmp');
            fs.writeFileSync(tmp, r.bytes);
            fs.renameSync(tmp, path.join(animDir, n + '.webm'));
            built.add(n);
          }
        }
        const next = skills.mergeSkillConfig(config, parsed, built, durations);
        if (!next.importMeta) {
          next.importMeta = {
            standHeightSrc: Math.round(STAND_HEIGHT / Object.values(geometry)[0].scale),
          };
        }
        writeJson(configPath, next);
        return { ok: true, built };
      })(),
      TIMEOUT_MS,
    );
  } catch (e) {
    result = { ok: false, error: e && e.message ? e.message : String(e) };
  } finally {
    worker.close();
    progress.close();
  }
  if (!result.ok) {
    await dialog.showMessageBox(parent, { type: 'error', message: '追加动作失败', detail: result.error });
    return { ok: false };
  }
  const lines = [];
  if (parsed.singles.length) lines.push('动作：' + parsed.singles.map((s) => s.name).join('、'));
  if (parsed.states.length)
    lines.push('技能：' + parsed.states.map((s) => s.name).join('、') + '（起手 → 循环 → 收招）');
  if (parsed.start) lines.push('出场动作：' + parsed.start.name + '（出现在桌面上时先播一次）');
  if (parsed.ignored.length) lines.push('没用上的文件：' + parsed.ignored.join('、'));
  lines.push('右键「动作」菜单里可以点播；随机出现的概率很低（「技能」分类）。');
  await dialog.showMessageBox(parent, { type: 'info', message: '「' + label + '」追加好了', detail: lines.join('\n') });
  return { ok: true, pets: readPackPets(petDir, pack) };
}

module.exports = { appendSkillsInteractive, skillGeometry };
