// Keeps a check from taking over the screen. Required first, it makes every
// BrowserWindow NEO opens start hidden and stay hidden (show and focus do
// nothing), keeps the app out of the Dock, and lets a hidden page keep its
// timers and frames. The page still lays itself out, paints and takes the
// keys sent to it. --show puts the window on screen as usual.

'use strict';

const Module = require('module');
const electron = require('electron');

if (!process.argv.includes('--show')) {
  // named BrowserWindow: Electron's getAllWindows() knows its windows by
  // their constructor's name
  class BrowserWindow extends electron.BrowserWindow {
    constructor(opts = {}) {
      super({ ...opts, show: false, webPreferences: { ...(opts.webPreferences || {}), backgroundThrottling: false } });
    }
    show() {}
    showInactive() {}
    focus() {}
    moveTop() {}
  }
  const quiet = new Proxy(electron, { get: (target, key) => (key === 'BrowserWindow' ? BrowserWindow : target[key]) });
  const load = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'electron' ? quiet : load.call(this, request, ...rest);
  };
  if (electron.app.dock) electron.app.dock.hide();
}
