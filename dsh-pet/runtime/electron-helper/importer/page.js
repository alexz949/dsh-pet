/**
 * 导入干员的渲染端（隐藏窗口）：解码素材 → 对齐到宠物画布 → 编码成透明 webm。
 *
 * 不需要 ffmpeg：解码用 <video>（Chromium 自带 VP9 透明解码），对齐用 canvas，编码用 WebCodecs。
 * WebCodecs 不能直接编带透明的 VP9，所以彩色与透明各编一路（透明一路把 alpha 当亮度），再由
 * DshWebmMux 拼成标准的透明 webm（见 webm-mux.js）。
 *
 * 与主进程的往来全走 preload 暴露的 window.dshImporter：
 *   probe  → 每个素材的帧数与第一帧的不透明区域（主进程据此算对齐参数与片段清单）
 *   encode → 按片段清单逐个编码，返回文件字节；走路片段顺带返回脚底带用来测速度
 * @module dsh-pet/runtime/electron-helper/importer/page
 */
'use strict';

const FPS = 30;
const W = 640;
const H = 360;
/** 宠物画布里的脚底线与水平中心（与内置素材一致） */
const FEET_Y = 330;
const CENTER_X = 320;
/** 关键帧间隔（帧） */
const GOP = 60;
/** 第一帧不透明区域的阈值（0-255） */
const ALPHA_ON = 40;

const videos = new Map();

function loadVideo(key, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  return new Promise((resolve, reject) => {
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error(key + ' 解码失败（不是有效的 webm？）'));
  }).then((video) => {
    videos.set(key, video);
    return video;
  });
}

/** 跳到第 i 帧（按 FPS 取样，取帧的中点避免落在两帧交界）并等画面真的换好。 */
function seekFrame(v, i) {
  return new Promise((resolve) => {
    const t = Math.min((i + 0.5) / FPS, Math.max(0, v.duration - 0.001));
    const done = () => {
      v.removeEventListener('seeked', done);
      resolve();
    };
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

function frameCount(v) {
  return Math.max(0, Math.floor(v.duration * FPS + 1e-6));
}

/** 第一帧的不透明包围盒（源素材像素）；整帧透明返回 null。 */
async function firstFrameBox(v) {
  await seekFrame(v, 0);
  const w = v.videoWidth;
  const h = v.videoHeight;
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(v, 0, 0);
  const d = g.getImageData(0, 0, w, h).data;
  let top = h;
  let bottom = -1;
  let left = w;
  let right = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > ALPHA_ON) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  return bottom < 0 ? null : { top, bottom, left, right };
}

async function probe(sources) {
  const out = {};
  for (const s of sources) {
    const v = await loadVideo(s.key, s.bytes);
    out[s.key] = { frames: frameCount(v), width: v.videoWidth, height: v.videoHeight, box: await firstFrameBox(v) };
  }
  return out;
}

/**
 * 把源素材的一帧画到宠物画布上：水平翻转（基建小人朝右，插件默认朝左）、按站立身高缩放、
 * 脚底对到 FEET_Y、素材画面中心对到 CENTER_X。超出画布的部分（特效）直接裁掉。
 */
function place(g, v, geom) {
  g.clearRect(0, 0, W, H);
  g.save();
  g.translate(CENTER_X, FEET_Y);
  g.scale(-geom.scale, geom.scale);
  g.drawImage(v, -geom.cx, -geom.ground);
  g.restore();
}

function sequence(clip, n) {
  const from = clip.rng ? clip.rng[0] : 0;
  const to = clip.rng ? Math.min(clip.rng[1], n) : n;
  const base = [];
  for (let i = from; i < to; i++) base.push(i);
  const once = clip.pingpong ? base.concat(base.slice(0, -1).reverse()) : base;
  const out = [];
  for (let r = 0; r < clip.repeat; r++) out.push(...once);
  return out;
}

function makeEncoder(into, errors, bitrate) {
  const enc = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      into.push({ ts: Math.round(chunk.timestamp / 1000), key: chunk.type === 'key', data });
    },
    error: (e) => errors.push(e.message),
  });
  enc.configure({
    codec: 'vp09.00.10.08',
    width: W,
    height: H,
    framerate: FPS,
    bitrate,
    bitrateMode: 'variable',
    latencyMode: 'quality',
  });
  return enc;
}

/** 编码一个片段：返回 webm 字节；wantBands 时顺带返回每帧脚底带（测走路速度用）。 */
async function encodeClip(clip, geom, wantBands) {
  const v = videos.get(clip.src);
  const seq = sequence(clip, frameCount(v));
  if (!seq.length) throw new Error(clip.src + ' 没有可用的帧');
  const canvas = new OffscreenCanvas(W, H);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const color = [];
  const alpha = [];
  const errors = [];
  // 码率：彩色 600 kbps、透明 300 kbps（透明一路只有轮廓，信息量小）
  const ec = makeEncoder(color, errors, 600_000);
  const ea = makeEncoder(alpha, errors, 300_000);
  const bands = [];
  const yuv = new Uint8Array((W * H * 3) / 2);
  yuv.fill(128, W * H);
  for (let k = 0; k < seq.length; k++) {
    await seekFrame(v, seq[k]);
    place(g, v, geom);
    const px = g.getImageData(0, 0, W, H).data;
    for (let p = 0, q = 3; p < W * H; p++, q += 4) yuv[p] = px[q];
    if (wantBands && k < frameCount(v)) {
      const row = new Array(W).fill(false);
      for (let y = FEET_Y - 10; y < FEET_Y + 2; y++) {
        for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 128) row[x] = true;
      }
      bands.push(row);
    }
    const timestamp = Math.round((k * 1e6) / FPS);
    const keyFrame = k % GOP === 0;
    const fc = new VideoFrame(canvas, { timestamp, alpha: 'discard' });
    ec.encode(fc, { keyFrame });
    fc.close();
    const fa = new VideoFrame(yuv, { format: 'I420', codedWidth: W, codedHeight: H, timestamp });
    ea.encode(fa, { keyFrame });
    fa.close();
    // 别让编码队列无限堆积
    while (ec.encodeQueueSize > 8 || ea.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
  }
  await ec.flush();
  await ea.flush();
  ec.close();
  ea.close();
  if (errors.length) throw new Error('编码失败：' + errors[0]);
  if (color.length !== alpha.length) throw new Error('编码帧数对不上');
  const frames = color.map((f, i) => {
    if (f.key !== alpha[i].key) throw new Error('关键帧位置对不上');
    return { ...f, alpha: alpha[i].data };
  });
  const bytes = DshWebmMux.muxWebm({ width: W, height: H, durationMs: (seq.length * 1000) / FPS, frames });
  return { bytes, frames: seq.length, bands: wantBands ? bands : null };
}

window.dshImporter.onJob(async (job) => {
  try {
    if (job.type === 'probe') {
      window.dshImporter.reply({ ok: true, probe: await probe(job.sources) });
      return;
    }
    if (job.type === 'encode') {
      const results = [];
      let bandsTaken = false;
      for (let i = 0; i < job.clips.length; i++) {
        const clip = job.clips[i];
        window.dshImporter.progress({ done: i, total: job.clips.length, name: clip.names[0] });
        const wantBands = Boolean(clip.walk) && !bandsTaken;
        const r = await encodeClip(clip, job.geometry[clip.src], wantBands);
        if (wantBands) bandsTaken = true;
        results.push({ names: clip.names, bytes: r.bytes, frames: r.frames, bands: r.bands });
      }
      window.dshImporter.reply({ ok: true, results });
    }
  } catch (e) {
    window.dshImporter.reply({ ok: false, error: e && e.message ? e.message : String(e) });
  }
});
window.dshImporter.ready();
