'use strict';
/**
 * 导入窗口的 preload：只暴露收任务 / 回结果 / 报进度三个口子，频道名与 main/import.js 逐字一致。
 * @module dsh-pet/runtime/electron-helper/importer/preload
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshImporter', {
  onJob(cb) {
    ipcRenderer.on('importer:job', (_event, job) => cb(job));
  },
  reply(result) {
    ipcRenderer.send('importer:reply', result);
  },
  progress(p) {
    ipcRenderer.send('importer:progress', p);
  },
  ready() {
    ipcRenderer.send('importer:ready');
  },
});
