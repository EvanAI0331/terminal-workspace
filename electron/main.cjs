const { app, BrowserWindow, ipcMain, nativeImage } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const pty = require("node-pty");
const yaml = require("yaml");
const toml = require("smol-toml");

const isDev = !app.isPackaged;
const sessions = new Map();
const sensitiveEnvPattern = /(key|token|secret|password|passwd|pwd|credential|auth|private)/i;
const appIconPath = path.join(__dirname, "../assets/TerminalTopology.icns");
const dockIconPath = path.join(__dirname, "../assets/TerminalTopology.png");
const stableUserDataDirName = "Terminal Workspace";
const legacyUserDataDirNames = ["terminal", "terminal-workspace"];

function loadIcon(iconPath) {
  if (!fs.existsSync(iconPath)) {
    throw new Error(`Application icon is missing: ${iconPath}`);
  }
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    throw new Error(`Application icon could not be loaded: ${iconPath}`);
  }
  return image;
}

function workspaceStatePath() {
  return path.join(app.getPath("userData"), "terminal-workspace-state.json");
}

function stateScore(state) {
  if (!state || state.version !== 1) return 0;
  return (state.projects?.length || 0) * 10 + Object.keys(state.terminals || {}).length;
}

function readStateFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function legacyWorkspaceStatePaths() {
  const appData = app.getPath("appData");
  return legacyUserDataDirNames
    .map((dirName) => path.join(appData, dirName, "terminal-workspace-state.json"))
    .filter((filePath) => filePath !== workspaceStatePath());
}

function readWorkspaceState() {
  const filePath = workspaceStatePath();
  const currentState = readStateFile(filePath);
  const legacyStates = legacyWorkspaceStatePaths()
    .map((legacyPath) => ({ path: legacyPath, state: readStateFile(legacyPath) }))
    .filter((entry) => entry.state);
  const bestLegacy = legacyStates.sort((a, b) => stateScore(b.state) - stateScore(a.state))[0];

  if (bestLegacy && stateScore(bestLegacy.state) > stateScore(currentState)) {
    writeWorkspaceState(bestLegacy.state);
    return bestLegacy.state;
  }

  return currentState;
}

function writeWorkspaceState(state) {
  const filePath = workspaceStatePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2));
  fs.renameSync(tempPath, filePath);
  return filePath;
}

function readProcessCwd(pid) {
  return new Promise((resolve, reject) => {
    execFile("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      const cwdLine = stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("n/"));
      if (!cwdLine) {
        reject(new Error(`Unable to read cwd for pid ${pid}`));
        return;
      }
      resolve(cwdLine.slice(1));
    });
  });
}

function sendToWindow(windowId, channel, payload) {
  const win = BrowserWindow.fromId(windowId);
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "Terminal Workspace",
    icon: appIconPath,
    backgroundColor: "#0c0d0f",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL("http://127.0.0.1:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  app.setName("Terminal Workspace");
  app.setPath("userData", path.join(app.getPath("appData"), stableUserDataDirName));
  if (process.platform === "darwin") {
    app.dock.setIcon(loadIcon(dockIconPath));
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  for (const session of sessions.values()) {
    session.terminal.kill();
  }
  sessions.clear();
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("terminal:create", (event, request) => {
  const id = request.id;
  if (!id || sessions.has(id)) {
    throw new Error(`Invalid or duplicate terminal id: ${id}`);
  }

  const cwd = request.cwd;
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`Terminal cwd does not exist: ${cwd || "(empty)"}`);
  }
  const shell = request.shell || process.env.SHELL || "/bin/zsh";
  const cols = request.cols || 96;
  const rows = request.rows || 28;
  const createdAt = Date.now();
  const env = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };

  const terminal = pty.spawn(shell, [], {
    name: "xterm-256color",
    cwd,
    env,
    cols,
    rows,
  });

  const ownerWindowId = event.sender.id;
  const session = {
    id,
    ownerWindowId,
    terminal,
    shell,
    cwd,
    createdAt,
    exitCode: null,
  };
  sessions.set(id, session);

  terminal.onData((data) => {
    sendToWindow(ownerWindowId, "terminal:data", { id, data });
  });

  terminal.onExit(({ exitCode, signal }) => {
    session.exitCode = exitCode;
    sendToWindow(ownerWindowId, "terminal:exit", { id, exitCode, signal });
    sessions.delete(id);
  });

  return {
    id,
    pid: terminal.pid,
    shell,
    cwd,
    createdAt,
  };
});

ipcMain.handle("app:workspace", () => ({
  cwd: process.cwd(),
  shell: process.env.SHELL || "/bin/zsh",
}));

ipcMain.handle("app:state-load", () => ({
  state: readWorkspaceState(),
  path: workspaceStatePath(),
}));

ipcMain.handle("app:state-save", (_event, state) => ({
  ok: true,
  path: writeWorkspaceState(state),
}));

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeRelative(root, filePath) {
  const relativePath = path.relative(root, filePath).replaceAll(path.sep, "/");
  return relativePath || ".";
}

const ignoredProbeDirs = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "target",
  ".turbo",
  ".cache",
]);
const projectMarkerNames = new Set([
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "compose.yml",
  "compose.yaml",
  "docker-compose.yml",
  "docker-compose.yaml",
]);
const maxProbeDepth = 5;
const maxProbeFiles = 5000;
const maxProbeFileSize = 1024 * 1024;

function resolveProjectRoot(cwd) {
  let current = fs.realpathSync(cwd);
  let markerRoot = current;

  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    for (const markerName of projectMarkerNames) {
      if (fs.existsSync(path.join(current, markerName))) {
        markerRoot = current;
        break;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) return markerRoot;
    current = parent;
  }
}

function readTextFile(filePath, index) {
  const stat = fs.statSync(filePath);
  if (stat.size > maxProbeFileSize) {
    index.warnings.push(`${safeRelative(index.root, filePath)} skipped: file exceeds 1MB`);
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseJsonFile(filePath, index) {
  try {
    return readJsonFile(filePath);
  } catch (error) {
    index.warnings.push(`${safeRelative(index.root, filePath)}: JSON parse failed: ${error.message}`);
    return null;
  }
}

function parseYamlFile(filePath, index) {
  try {
    const text = readTextFile(filePath, index);
    return text ? yaml.parse(text) : null;
  } catch (error) {
    index.warnings.push(`${safeRelative(index.root, filePath)}: YAML parse failed: ${error.message}`);
    return null;
  }
}

function parseTomlFile(filePath, index) {
  try {
    const text = readTextFile(filePath, index);
    return text ? toml.parse(text) : null;
  } catch (error) {
    index.warnings.push(`${safeRelative(index.root, filePath)}: TOML parse failed: ${error.message}`);
    return null;
  }
}

function createProjectIndex(root) {
  const index = {
    root,
    files: [],
    projectRoots: new Set([root]),
    warnings: [],
  };
  const stack = [{ dir: root, depth: 0 }];

  while (stack.length && index.files.length < maxProbeFiles) {
    const { dir, depth } = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      index.warnings.push(`${safeRelative(root, dir)} skipped: ${error.message}`);
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth < maxProbeDepth && !ignoredProbeDirs.has(entry.name)) {
          stack.push({ dir: fullPath, depth: depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      index.files.push(fullPath);
      if (projectMarkerNames.has(entry.name)) index.projectRoots.add(dir);
      if (index.files.length >= maxProbeFiles) break;
    }
  }

  if (index.files.length >= maxProbeFiles) {
    index.warnings.push(`scan stopped after ${maxProbeFiles} files`);
  }

  return index;
}

function sourceMeta(index, filePath, confidence, reason) {
  return {
    source: safeRelative(index.root, filePath),
    root: safeRelative(index.root, path.dirname(filePath)),
    confidence,
    reason,
  };
}

function detectPackageScripts(index) {
  return index.files
    .filter((filePath) => path.basename(filePath) === "package.json")
    .flatMap((filePath) => {
      const pkg = parseJsonFile(filePath, index);
      if (!pkg || typeof pkg.scripts !== "object" || !pkg.scripts) return [];
      return Object.entries(pkg.scripts).map(([name, command]) => ({
        ...sourceMeta(index, filePath, "high", "package.json scripts entry"),
        name,
        command: String(command),
      }));
    });
}

function detectPythonScripts(index) {
  return index.files
    .filter((filePath) => path.basename(filePath) === "pyproject.toml")
    .flatMap((filePath) => {
      const parsed = parseTomlFile(filePath, index);
      const scripts = {
        ...(parsed?.project?.scripts ?? {}),
        ...(parsed?.tool?.poetry?.scripts ?? {}),
      };
      return Object.entries(scripts).map(([name, command]) => ({
        ...sourceMeta(index, filePath, "high", "pyproject script entry"),
        name,
        command: String(command),
      }));
    });
}

function detectComposeServices(index) {
  return index.files
    .filter((filePath) => /^(compose|docker-compose)\.ya?ml$/.test(path.basename(filePath)))
    .flatMap((filePath) => {
      const parsed = parseYamlFile(filePath, index);
      if (!parsed || typeof parsed.services !== "object" || !parsed.services) return [];
      return Object.keys(parsed.services).map((name) => ({
        ...sourceMeta(index, filePath, "high", "docker compose services entry"),
        name,
        command: "docker compose service",
      }));
    });
}

function detectServices(index) {
  return [...detectPackageScripts(index), ...detectPythonScripts(index), ...detectComposeServices(index)].slice(0, 120);
}

function detectEnvFiles(index) {
  return index.files
    .filter((filePath) => /^\.env(\.|$)/.test(path.basename(filePath)))
    .flatMap((filePath) => {
      const text = readTextFile(filePath, index);
      if (!text) return [];
      return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const key = line.slice(0, line.indexOf("=")).trim();
          const rawValue = line.slice(line.indexOf("=") + 1).trim();
          return {
            ...sourceMeta(index, filePath, "high", "env assignment"),
            key,
            value: sensitiveEnvPattern.test(key) ? "••••••" : rawValue,
            masked: sensitiveEnvPattern.test(key),
          };
        });
    })
    .slice(0, 160);
}

function detectWorkflowTasks(index) {
  return index.files
    .filter((filePath) => /\.github\/workflows\/[^/]+\.ya?ml$/.test(safeRelative(index.root, filePath)))
    .map((filePath) => {
      const workflow = parseYamlFile(filePath, index);
      return {
        ...sourceMeta(index, filePath, workflow?.jobs ? "high" : "medium", workflow?.jobs ? "GitHub workflow jobs parsed" : "GitHub workflow file"),
        name: workflow?.name || path.basename(filePath),
        kind: "workflow",
      };
    });
}

function detectTaskfileTasks(index) {
  return index.files
    .filter((filePath) => /^Taskfile\.ya?ml$/.test(path.basename(filePath)))
    .flatMap((filePath) => {
      const parsed = parseYamlFile(filePath, index);
      const taskNames = parsed?.tasks && typeof parsed.tasks === "object" ? Object.keys(parsed.tasks) : ["Taskfile"];
      return taskNames.map((name) => ({
        ...sourceMeta(index, filePath, parsed?.tasks ? "high" : "medium", parsed?.tasks ? "Taskfile tasks parsed" : "Taskfile found"),
        name,
        kind: "taskfile",
      }));
    });
}

function detectMakeTasks(index) {
  return index.files
    .filter((filePath) => path.basename(filePath) === "Makefile")
    .flatMap((filePath) => {
      const text = readTextFile(filePath, index);
      if (!text) return [];
      return [...text.matchAll(/^([A-Za-z0-9_.-]+):(?!=)/gm)].map((match) => ({
        ...sourceMeta(index, filePath, "medium", "Makefile target matched"),
        name: match[1],
        kind: "make",
      }));
    });
}

function detectJustTasks(index) {
  return index.files
    .filter((filePath) => path.basename(filePath) === "justfile")
    .flatMap((filePath) => {
      const text = readTextFile(filePath, index);
      if (!text) return [];
      return [...text.matchAll(/^([A-Za-z0-9_.-]+)(?:\s+[^:=]+)*:/gm)].map((match) => ({
        ...sourceMeta(index, filePath, "medium", "justfile recipe matched"),
        name: match[1],
        kind: "just",
      }));
    });
}

function detectProjectBuildTasks(index) {
  const kindByFile = {
    "Cargo.toml": "cargo",
    "go.mod": "go",
    "pom.xml": "maven",
    "build.gradle": "gradle",
    "build.gradle.kts": "gradle",
  };
  return index.files
    .filter((filePath) => Object.hasOwn(kindByFile, path.basename(filePath)))
    .map((filePath) => {
      const fileName = path.basename(filePath);
      return {
        ...sourceMeta(index, filePath, "medium", `${fileName} project marker`),
        name: fileName,
        kind: kindByFile[fileName],
      };
    });
}

function detectTasks(index) {
  return [
    ...detectWorkflowTasks(index),
    ...detectTaskfileTasks(index),
    ...detectMakeTasks(index),
    ...detectJustTasks(index),
    ...detectProjectBuildTasks(index),
  ].slice(0, 160);
}

function detectNotes(index) {
  return index.files
    .filter((filePath) => {
      const name = path.basename(filePath);
      return /\.mdx?$/i.test(name);
    })
    .slice(0, 80)
    .map((filePath) => {
      const text = readTextFile(filePath, index);
      const firstHeading =
        text
          ?.split(/\r?\n/)
          .find((line) => /^#\s+/.test(line))
          ?.replace(/^#\s+/, "")
          .trim() || path.basename(filePath);
      return {
        ...sourceMeta(index, filePath, "high", "project documentation file"),
        title: firstHeading,
      };
    });
}

ipcMain.handle("project:inspect", (_event, request) => {
  const cwd = request.cwd;
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`Project path does not exist: ${cwd || "(empty)"}`);
  }
  const projectRoot = resolveProjectRoot(cwd);
  const index = createProjectIndex(projectRoot);
  return {
    cwd,
    scannedAt: Date.now(),
    scan: {
      mode: "deep",
      fileCount: index.files.length,
      root: projectRoot,
      projectRoots: [...index.projectRoots].sort((a, b) => a.localeCompare(b)).map((root) => safeRelative(projectRoot, root)),
      maxDepth: maxProbeDepth,
    },
    services: detectServices(index),
    environment: detectEnvFiles(index),
    tasks: detectTasks(index),
    notes: detectNotes(index),
    warnings: index.warnings.slice(0, 20),
  };
});

ipcMain.handle("terminal:write", (_event, request) => {
  const session = sessions.get(request.id);
  if (!session) return { ok: false };
  session.terminal.write(request.data);
  return { ok: true };
});

ipcMain.handle("terminal:resize", (_event, request) => {
  const session = sessions.get(request.id);
  if (!session) return { ok: false };
  session.terminal.resize(request.cols, request.rows);
  return { ok: true };
});

ipcMain.handle("terminal:kill", (_event, id) => {
  const session = sessions.get(id);
  if (!session) return { ok: false };
  session.terminal.kill();
  sessions.delete(id);
  return { ok: true };
});

ipcMain.handle("terminal:cwd", async (_event, id) => {
  const session = sessions.get(id);
  if (!session) return { ok: false, cwd: null };
  const cwd = await readProcessCwd(session.terminal.pid);
  session.cwd = cwd;
  return { ok: true, cwd };
});

ipcMain.handle("terminal:list", () => {
  return Array.from(sessions.values()).map((session) => ({
    id: session.id,
    pid: session.terminal.pid,
    shell: session.shell,
    cwd: session.cwd,
    createdAt: session.createdAt,
    exitCode: session.exitCode,
  }));
});
