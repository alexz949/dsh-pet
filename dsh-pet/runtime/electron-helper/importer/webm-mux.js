/**
 * 最小 WebM 封装：单条 VP9 视频轨，透明通道走 BlockAdditional（AlphaMode = 1）。
 *
 * Chromium 的 WebCodecs 还不能直接编码带透明的 VP9（alpha: 'keep' 报不支持），但 WebM 的透明本来就是
 * 「彩色一路 + 透明一路」两条独立的 VP9 码流：透明那一路把 alpha 当亮度编码，按帧挂在 BlockAdditional
 * （BlockAddID = 1）里。导入器用两个编码器分别编出两路，再在这里拼成一个文件，Chromium / ffmpeg 都按
 * 标准透明 webm 解码。
 *
 * 纯函数、不依赖 DOM 与 Node：渲染端以全局 DshWebmMux 使用，测试里 require。
 * @module dsh-pet/runtime/electron-helper/importer/webm-mux
 */
'use strict';

(function (root) {
  const utf8 = new TextEncoder();

  /** 元素 ID 的原始字节（ID 自带长度标记，按大端原样写出）。 */
  function idBytes(id) {
    const out = [];
    while (id > 0) {
      out.unshift(id & 0xff);
      id = Math.floor(id / 256);
    }
    return out;
  }

  /** 尺寸统一写成 8 字节 vint（0x01 + 7 字节大端），实现最简单、任何长度都放得下。 */
  function sizeBytes(n) {
    const b = new Uint8Array(8);
    b[0] = 0x01;
    let v = n;
    for (let i = 7; i >= 1; i--) {
      b[i] = v & 0xff;
      v = Math.floor(v / 256);
    }
    return b;
  }

  function concat(parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  function el(id, ...children) {
    const body = concat(children);
    return concat([new Uint8Array(idBytes(id)), sizeBytes(body.length), body]);
  }

  function uint(id, value) {
    const b = [];
    let v = value;
    do {
      b.unshift(v & 0xff);
      v = Math.floor(v / 256);
    } while (v > 0);
    return el(id, new Uint8Array(b));
  }

  function int16(id, value) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setInt16(0, value);
    return el(id, b);
  }

  function str(id, s) {
    return el(id, utf8.encode(s));
  }

  function float64(id, value) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, value);
    return el(id, b);
  }

  /** 每个 Cluster 内的相对时间码是 int16 毫秒：最长 32 秒，留余量按 30 秒切。 */
  const CLUSTER_MAX_MS = 30000;

  /**
   * 拼出完整 WebM 文件。
   *
   * @param {object} o
   * @param {number} o.width - 画面宽。
   * @param {number} o.height - 画面高。
   * @param {number} o.durationMs - 总时长（毫秒）。
   * @param {{ ts: number, key: boolean, data: Uint8Array, alpha?: Uint8Array }[]} o.frames -
   *   按时间顺序的帧：ts 为毫秒整数，data 为彩色 VP9 帧，alpha 为同一时刻的透明 VP9 帧。
   *   第一帧必须是关键帧；透明一路的关键帧位置必须与彩色一路一致（解码器按彩色帧的类型解透明帧）。
   * @returns {Uint8Array} 文件字节。
   */
  function muxWebm({ width, height, durationMs, frames }) {
    if (!frames.length || !frames[0].key) throw new Error('第一帧必须是关键帧');
    const header = el(
      0x1a45dfa3,
      uint(0x4286, 1), // EBMLVersion
      uint(0x42f7, 1), // EBMLReadVersion
      uint(0x42f2, 4), // EBMLMaxIDLength
      uint(0x42f3, 8), // EBMLMaxSizeLength
      str(0x4282, 'webm'), // DocType
      uint(0x4287, 4), // DocTypeVersion（BlockAdditions 需要 ≥ 4）
      uint(0x4285, 2), // DocTypeReadVersion
    );
    const info = el(
      0x1549a966,
      uint(0x2ad7b1, 1000000), // TimecodeScale：1 ms
      float64(0x4489, durationMs),
      str(0x4d80, 'dsh-pet'), // MuxingApp
      str(0x5741, 'dsh-pet'), // WritingApp
    );
    const video = el(0xe0, uint(0xb0, width), uint(0xba, height), uint(0x53c0, 1)); // AlphaMode = 1
    const track = el(0xae, uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 1), str(0x86, 'V_VP9'), video);
    const tracks = el(0x1654ae6b, track);

    const clusters = [];
    let blocks = null;
    let base = 0;
    let prevTs = 0;
    const flush = () => {
      if (blocks) clusters.push(el(0x1f43b675, uint(0xe7, base), ...blocks));
    };
    for (const f of frames) {
      if (!blocks || f.key || f.ts - base > CLUSTER_MAX_MS) {
        flush();
        blocks = [];
        base = f.ts;
      }
      const head = new Uint8Array(4);
      head[0] = 0x81; // 轨道号 1（vint）
      new DataView(head.buffer).setInt16(1, f.ts - base);
      head[3] = 0; // flags：BlockGroup 里的 Block 不带关键帧位，靠有没有 ReferenceBlock 区分
      const parts = [el(0xa1, head, f.data)];
      if (!f.key) parts.push(int16(0xfb, -(f.ts - prevTs))); // ReferenceBlock：引用上一帧
      if (f.alpha) parts.push(el(0x75a1, el(0xa6, uint(0xee, 1), el(0xa5, f.alpha))));
      blocks.push(el(0xa0, ...parts));
      prevTs = f.ts;
    }
    flush();
    return concat([header, el(0x18538067, info, tracks, ...clusters)]);
  }

  const api = { muxWebm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DshWebmMux = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
