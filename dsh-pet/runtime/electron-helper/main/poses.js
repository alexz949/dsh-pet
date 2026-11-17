'use strict';
/**
 * 宠物位置的短期记录：让「重载」（导入干员、改显示位置、重载配置都会重启整个桌面进程）之后，
 * 宠物接着站在原处，而不是全部跳回配置里的角落。
 *
 * 渲染端每隔几秒报一次会话内位置（比例坐标 + 朝向），这里同步写进一个小 JSON 文件
 * （localStorage 在进程被重启时可能还没落盘）。建窗时只认 FRESH_MS 内的记录：重载从关窗到重建
 * 只要一两秒；正常开机记录早已过期，宠物照旧按配置出现在角落。
 * @module dsh-pet/runtime/electron-helper/main/poses
 */
const fs = require('node:fs');
const path = require('node:path');
const { dshHomeDir } = require('./user-data.js');

const FRESH_MS = 15000;

function posesFile() {
  return path.join(dshHomeDir(), 'dsh-pet', 'desktop-poses.json');
}

function readAll() {
  try {
    const v = JSON.parse(fs.readFileSync(posesFile(), 'utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** 记下（pose 为 null = 回到了角落，删掉记录）。坏数据静默丢弃。 */
function savePose(id, pose) {
  if (typeof id !== 'string' || !id) return;
  const all = readAll();
  if (pose === null) delete all[id];
  else {
    const rx = Number(pose?.rx);
    const ry = Number(pose?.ry);
    if (!Number.isFinite(rx) || !Number.isFinite(ry)) return;
    const facing = pose.facing === 'right' ? 'right' : 'left';
    all[id] = { rx, ry, facing, t: Date.now() };
  }
  try {
    fs.mkdirSync(path.dirname(posesFile()), { recursive: true });
    fs.writeFileSync(posesFile(), JSON.stringify(all));
  } catch {
    // 写不了就算了：最多重载后回角落
  }
}

/** 刚记下的位置（FRESH_MS 内），没有返回 null。 */
function freshPose(id, now = Date.now()) {
  const p = readAll()[id];
  if (!p || !Number.isFinite(p.t) || now - p.t > FRESH_MS) return null;
  return { rx: p.rx, ry: p.ry, facing: p.facing };
}

module.exports = { savePose, freshPose, FRESH_MS };
