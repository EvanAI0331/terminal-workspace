const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("terminalHost", {
  openExternal: (request) => ipcRenderer.invoke("terminal:open-external", request),
  workspace: () => ipcRenderer.invoke("app:workspace"),
  stateMeta: () => ipcRenderer.invoke("app:state-meta"),
  loadState: () => ipcRenderer.invoke("app:state-load"),
  saveState: (state) => ipcRenderer.invoke("app:state-save", state),
  saveStateSync: (state) => ipcRenderer.sendSync("app:state-save-sync", state),
  inspectProject: (request) => ipcRenderer.invoke("project:inspect", request),
  readClipboardText: () => ipcRenderer.invoke("clipboard:read-text"),
  writeClipboardText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
});
