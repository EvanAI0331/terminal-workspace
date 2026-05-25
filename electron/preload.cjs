const { clipboard, contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("terminalHost", {
  create: (request) => ipcRenderer.invoke("terminal:create", request),
  write: (request) => ipcRenderer.invoke("terminal:write", request),
  resize: (request) => ipcRenderer.invoke("terminal:resize", request),
  kill: (id) => ipcRenderer.invoke("terminal:kill", id),
  cwd: (id) => ipcRenderer.invoke("terminal:cwd", id),
  list: () => ipcRenderer.invoke("terminal:list"),
  workspace: () => ipcRenderer.invoke("app:workspace"),
  stateMeta: () => ipcRenderer.invoke("app:state-meta"),
  loadState: () => ipcRenderer.invoke("app:state-load"),
  saveState: (state) => ipcRenderer.invoke("app:state-save", state),
  saveStateSync: (state) => ipcRenderer.sendSync("app:state-save-sync", state),
  inspectProject: (request) => ipcRenderer.invoke("project:inspect", request),
  readClipboardText: () => clipboard.readText(),
  onData: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:data", listener);
    return () => ipcRenderer.removeListener("terminal:data", listener);
  },
  onExit: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:exit", listener);
    return () => ipcRenderer.removeListener("terminal:exit", listener);
  },
});
