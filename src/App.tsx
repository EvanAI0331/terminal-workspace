import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import {
  Bell,
  ChevronDown,
  ChevronsRight,
  Filter,
  Folder,
  FolderOpen,
  Grid3X3,
  List,
  PanelRight,
  Play,
  Plus,
  Search,
  Server,
  Settings,
  Square,
  TerminalSquare,
  X,
} from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import './App.css'

type RuntimeStatus = 'idle' | 'running' | 'exited' | 'unavailable'

type Project = {
  id: string
  name: string
  path: string
  terminalIds: string[]
}

type RuntimeEvent = {
  time: number
  message: string
}

type TerminalModel = {
  id: string
  projectId: string
  name: string
  role: string
  cwd: string
  command: string
  status: RuntimeStatus
  pid?: number
  shell?: string
  createdAt?: number
  exitCode?: number | null
  eventLog: RuntimeEvent[]
  transcript?: string
  inputBuffer?: string
  lastCommand?: string
  restoreOnSelect?: boolean
  height?: number
}

type TerminalCreateResult = {
  id: string
  pid: number
  shell: string
  cwd: string
  createdAt: number
}

type ProjectInspection = {
  cwd: string
  scannedAt: number
  scan?: {
    mode: string
    fileCount: number
    projectRoots: string[]
    maxDepth: number
  }
  services: Array<{ source: string; root?: string; confidence?: string; reason?: string; name: string; command: string }>
  environment: Array<{ source: string; root?: string; confidence?: string; reason?: string; key: string; value: string; masked: boolean }>
  tasks: Array<{ source: string; root?: string; confidence?: string; reason?: string; name: string; kind: string }>
  notes: Array<{ source: string; root?: string; confidence?: string; reason?: string; title: string }>
  warnings?: string[]
}

type PersistedWorkspaceState = {
  version: 1
  projects: Project[]
  terminals: Record<string, TerminalModel>
  activeProjectId: string
  activeTerminalId: string | null
  expandedProjectIds: string[]
  expandedProbeProjectIds: string[]
  sidebarPanel: string
  detailTab: 'details' | 'settings'
  viewMode: 'grid' | 'list' | 'split'
  savedAt: number
}

type TerminalHost = {
  create: (request: {
    id: string
    cwd: string
    cols?: number
    rows?: number
  }) => Promise<TerminalCreateResult>
  write: (request: { id: string; data: string }) => Promise<{ ok: boolean }>
  resize: (request: { id: string; cols: number; rows: number }) => Promise<{ ok: boolean }>
  kill: (id: string) => Promise<{ ok: boolean }>
  cwd: (id: string) => Promise<{ ok: boolean; cwd: string | null }>
  workspace: () => Promise<{ cwd: string; shell: string }>
  stateMeta?: () => Promise<{ userData: string; statePath: string }>
  loadState: () => Promise<{ state: PersistedWorkspaceState | null; path: string }>
  saveState: (state: PersistedWorkspaceState) => Promise<{ ok: boolean; path: string }>
  saveStateSync?: (state: PersistedWorkspaceState) => { ok: boolean; path: string }
  inspectProject: (request: { cwd: string }) => Promise<ProjectInspection>
  readClipboardText: () => string
  onData: (callback: (payload: { id: string; data: string }) => void) => () => void
  onExit: (
    callback: (payload: { id: string; exitCode: number; signal?: number }) => void,
  ) => () => void
}

declare global {
  interface Window {
    terminalHost?: TerminalHost
  }
}

const makeId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const defaultPath = ''
const event = (message: string): RuntimeEvent => ({ time: Date.now(), message })
const statusText: Record<RuntimeStatus, string> = {
  idle: '未启动',
  running: '运行中',
  exited: '已退出',
  unavailable: '不可用',
}

const maxTranscriptLength = 40000

const appendTranscript = (value: string | undefined, data: string) =>
  `${value ?? ''}${data}`.slice(-maxTranscriptLength)

const pastedCommandPrefix = '\u001b]1337;TerminalWorkspaceLastCommand='
const pastedCommandSuffix = '\u0007'
const isRememberCommandEvent = (data: string) =>
  data.startsWith(pastedCommandPrefix) && data.endsWith(pastedCommandSuffix)

const commandLinesFromInput = (data: string) =>
  data
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)

const updateInputState = (terminal: TerminalModel, data: string): TerminalModel => {
  const commandLines = commandLinesFromInput(data)
  const isCommandBlockInput = commandLines.length > 1
  let buffer = terminal.inputBuffer ?? ''
  let lastCommand = terminal.lastCommand
  let command = terminal.command

  if (isRememberCommandEvent(data)) {
    const encoded = data.slice(pastedCommandPrefix.length, -pastedCommandSuffix.length)
    const pastedCommand = decodeURIComponent(encoded)
    return {
      ...terminal,
      inputBuffer: pastedCommand,
      lastCommand: pastedCommand,
      command: pastedCommand,
    }
  }

  if (isCommandBlockInput) {
    const commandBlock = commandLines.join('\n')
    return {
      ...terminal,
      inputBuffer: '',
      lastCommand: commandBlock,
      command: commandBlock,
    }
  }

  for (const char of data) {
    if (char === '\r' || char === '\n') {
      const trimmed = buffer.trim()
      if (trimmed) {
        lastCommand = trimmed
        command = trimmed
      }
      buffer = ''
    } else if (char === '\u0003' || char === '\u0015') {
      buffer = ''
    } else if (char === '\u007f') {
      buffer = buffer.slice(0, -1)
    } else if (char >= ' ') {
      buffer += char
    }
  }

  return {
    ...terminal,
    inputBuffer: buffer,
    lastCommand,
    command,
  }
}

const normalizeLoadedTerminals = (loaded: Record<string, TerminalModel>) =>
  Object.fromEntries(
    Object.entries(loaded).map(([id, terminal]) => {
      const shouldRestore =
        terminal.status === 'running' ||
        (terminal.eventLog ?? []).some((entry) => entry.message.includes('上次运行已随应用退出'))
      return [
        id,
        {
        ...terminal,
        status: shouldRestore ? 'idle' : terminal.status,
        pid: undefined,
        exitCode: shouldRestore ? null : terminal.exitCode,
        restoreOnSelect: shouldRestore || terminal.restoreOnSelect,
        eventLog:
          shouldRestore
            ? [event('上次运行已随应用退出，需启动真实 PTY 后继续输入。'), ...(terminal.eventLog ?? [])].slice(0, 12)
            : terminal.eventLog ?? [],
      },
      ]
    }),
  ) as Record<string, TerminalModel>

const compactTerminalsForSave = (current: Record<string, TerminalModel>) =>
  Object.fromEntries(
    Object.entries(current).map(([id, terminal]) => [
      id,
      {
        ...terminal,
        eventLog: terminal.eventLog.slice(0, 12),
        transcript: terminal.transcript?.slice(-maxTranscriptLength),
        inputBuffer: '',
      },
    ]),
  ) as Record<string, TerminalModel>

function App() {
  const [projects, setProjects] = useState<Project[]>(() => [
    {
      id: 'project_current',
      name: '当前工作区',
      path: defaultPath,
      terminalIds: [],
    },
  ])
  const [terminals, setTerminals] = useState<Record<string, TerminalModel>>({})
  const [activeProjectId, setActiveProjectId] = useState('project_current')
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(['project_current'])
  const [expandedProbeProjectIds, setExpandedProbeProjectIds] = useState<string[]>([])
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [, setClock] = useState(0)
  const [projectDraft, setProjectDraft] = useState({ name: '', path: defaultPath })
  const [sidebarPanel, setSidebarPanel] = useState('terminals')
  const [detailTab, setDetailTab] = useState<'details' | 'settings'>('details')
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'split'>('list')
  const [notice, setNotice] = useState('请新建项目或添加终端。')
  const [inspection, setInspection] = useState<ProjectInspection | null>(null)
  const [inspectionError, setInspectionError] = useState<string | null>(null)
  const [isInspecting, setIsInspecting] = useState(false)
  const [isStateLoaded, setIsStateLoaded] = useState(false)
  const [hasPersistedState, setHasPersistedState] = useState(false)
  const persistedStateRef = useRef<PersistedWorkspaceState | null>(null)

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0]
  const activeTerminals = useMemo(
    () =>
      activeProject.terminalIds
        .map((id) => terminals[id])
        .filter((terminal): terminal is TerminalModel => Boolean(terminal)),
    [activeProject.terminalIds, terminals],
  )
  const activeTerminal =
    (activeTerminalId ? terminals[activeTerminalId] : undefined) ?? activeTerminals[0]
  const recentTerminals = Object.values(terminals)
    .filter((terminal) => terminal.projectId === activeProject.id)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 8)
  const persistedState = useMemo<PersistedWorkspaceState>(
    () => ({
      version: 1,
      projects,
      terminals: compactTerminalsForSave(terminals),
      activeProjectId,
      activeTerminalId,
      expandedProjectIds,
      expandedProbeProjectIds,
      sidebarPanel,
      detailTab,
      viewMode,
      savedAt: 0,
    }),
    [
      activeProjectId,
      activeTerminalId,
      detailTab,
      expandedProbeProjectIds,
      expandedProjectIds,
      projects,
      sidebarPanel,
      terminals,
      viewMode,
    ],
  )

  useEffect(() => {
    persistedStateRef.current = persistedState
  }, [persistedState])

  const saveStateImmediately = useCallback((overrides: Partial<PersistedWorkspaceState>) => {
    const state = persistedStateRef.current
    if (!state || !window.terminalHost?.saveStateSync) return
    window.terminalHost.saveStateSync({ ...state, ...overrides, savedAt: Date.now() })
  }, [])

  useEffect(() => {
    if (!window.terminalHost) {
      Promise.resolve().then(() => setIsStateLoaded(true))
      return
    }
    let cancelled = false
    window.terminalHost
      .loadState()
      .then(({ state, path }) => {
        if (cancelled) return
        if (!state || state.version !== 1 || !state.projects?.length) {
          setIsStateLoaded(true)
          setNotice(`未找到已保存工作区，将创建新工作区：${path}`)
          return
        }
        const loadedTerminals = normalizeLoadedTerminals(state.terminals ?? {})
        setProjects(state.projects)
        setTerminals(loadedTerminals)
        setActiveProjectId(state.activeProjectId)
        setActiveTerminalId(state.activeTerminalId)
        setExpandedProjectIds(state.expandedProjectIds?.length ? state.expandedProjectIds : [state.activeProjectId])
        setExpandedProbeProjectIds(state.expandedProbeProjectIds ?? [])
        setSidebarPanel(state.sidebarPanel || 'terminals')
        setDetailTab(state.detailTab || 'details')
        setViewMode(state.viewMode || 'list')
        setHasPersistedState(true)
        setIsStateLoaded(true)
        setNotice(`已恢复已保存工作区：${path}`)
      })
      .catch((error) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        setIsStateLoaded(true)
        setNotice(`读取保存状态失败：${message}`)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isStateLoaded) return
    if (!window.terminalHost) {
      Promise.resolve().then(() => {
        setNotice('当前是浏览器预览，真实终端需要用 npm run dev 启动 Electron。')
      })
      return
    }
    if (hasPersistedState) return
    window.terminalHost.workspace().then((workspace) => {
      setProjects((current) =>
        current.map((project) =>
          project.id === 'project_current'
            ? { ...project, name: workspace.cwd.split('/').filter(Boolean).at(-1) || '当前工作区', path: workspace.cwd }
            : project,
        ),
      )
      setProjectDraft({ name: '', path: workspace.cwd })
      setNotice(`已连接本地终端运行时：${workspace.shell}`)
    })
  }, [hasPersistedState, isStateLoaded])

  useEffect(() => {
    if (!window.terminalHost) return
    const offData = window.terminalHost.onData(({ id, data }) => {
      setTerminals((current) => {
        const terminal = current[id]
        if (!terminal) return current
        return {
          ...current,
          [id]: {
            ...terminal,
            transcript: appendTranscript(terminal.transcript, data),
          },
        }
      })
      window.dispatchEvent(new CustomEvent(`terminal-data:${id}`, { detail: data }))
    })
    const offExit = window.terminalHost.onExit(({ id, exitCode, signal }) => {
      setTerminals((current) => ({
        ...current,
        [id]: {
          ...current[id],
          status: 'exited',
          exitCode,
          eventLog: [
            event(`进程退出：code ${exitCode}${signal ? ` signal ${signal}` : ''}`),
            ...(current[id]?.eventLog ?? []),
          ].slice(0, 12),
        },
      }))
    })
    return () => {
      offData()
      offExit()
    }
  }, [])

  useEffect(() => {
    if (!isStateLoaded || !window.terminalHost) return
    const timer = window.setTimeout(() => {
      window.terminalHost?.saveState({ ...persistedState, savedAt: Date.now() }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setNotice(`保存工作区失败：${message}`)
      })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [isStateLoaded, persistedState])

  useEffect(() => {
    const flushState = () => {
      const state = persistedStateRef.current
      if (!state || !window.terminalHost?.saveStateSync) return
      window.terminalHost.saveStateSync({ ...state, savedAt: Date.now() })
    }
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushState()
    }
    window.addEventListener('beforeunload', flushState)
    window.addEventListener('pagehide', flushState)
    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      window.removeEventListener('beforeunload', flushState)
      window.removeEventListener('pagehide', flushState)
      document.removeEventListener('visibilitychange', flushWhenHidden)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!window.terminalHost) return
    const timer = window.setInterval(() => {
      const runningTerminals = Object.values(terminals).filter(
        (terminal) => terminal.status === 'running',
      )
      for (const terminal of runningTerminals) {
        window.terminalHost
          ?.cwd(terminal.id)
          .then((result) => {
            if (!result.ok || !result.cwd) return
            const cwd = result.cwd
            setTerminals((current) => {
              const currentTerminal = current[terminal.id]
              if (!currentTerminal || currentTerminal.cwd === cwd) return current
              return {
                ...current,
                [terminal.id]: {
                  ...currentTerminal,
                  cwd,
                },
              }
            })
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            setNotice(`终端目录同步失败：${message}`)
          })
      }
    }, 2500)
    return () => window.clearInterval(timer)
  }, [activeTerminalId, terminals])

  useEffect(() => {
    const scanPath = activeProject.path
    if (!window.terminalHost || !scanPath) {
      Promise.resolve().then(() => {
        setInspection(null)
        setInspectionError(null)
        setIsInspecting(false)
      })
      return
    }
    let cancelled = false
    Promise.resolve()
      .then(() => {
        if (cancelled) return null
        setIsInspecting(true)
        setInspection(null)
        setInspectionError(null)
        return window.terminalHost?.inspectProject({ cwd: scanPath }) ?? null
      })
      .then((result) => {
        if (cancelled || !result || result.cwd !== scanPath) return
        setInspection(result)
        setNotice(
          `已深度扫描 ${result.scan?.fileCount ?? 0} 个文件，识别 ${result.scan?.projectRoots.length ?? 1} 个项目根${result.warnings?.length ? `，${result.warnings.length} 条警告` : ''}。`,
        )
      })
      .catch((error) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        setInspection(null)
        setInspectionError(message)
        setNotice(`项目扫描失败：${message}`)
      })
      .finally(() => {
        if (!cancelled) setIsInspecting(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeProject.path])

  const createProject = () => {
    const name = projectDraft.name.trim() || `项目 ${projects.length + 1}`
    const id = makeId('project')
    const projectPath = projectDraft.path.trim() || activeProject.path || defaultPath
    const project: Project = {
      id,
      name,
      path: projectPath,
      terminalIds: [],
    }
    setProjects((current) => [...current, project])
    setActiveProjectId(id)
    setExpandedProjectIds((current) => [...new Set([...current, id])])
    setActiveTerminalId(null)
    setProjectDraft({ name: '', path: project.path })
    setNotice(`已创建项目：${name}`)
  }

  const addTerminal = async () => {
    const id = makeId('terminal')
    let cwd = activeProject.path
    const name = `终端 ${activeProject.terminalIds.length + 1}`

    if (!cwd && window.terminalHost) {
      try {
        const workspace = await window.terminalHost.workspace()
        cwd = workspace.cwd
        setProjects((current) =>
          current.map((project) =>
            project.id === activeProject.id ? { ...project, path: workspace.cwd } : project,
          ),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setNotice(`读取工作区目录失败：${message}`)
      }
    }

    const terminal: TerminalModel = {
      id,
      projectId: activeProject.id,
      name,
      role: 'shell',
      cwd,
      command: '',
      status: window.terminalHost ? 'idle' : 'unavailable',
      eventLog: [],
    }

    const attachTerminal = (nextTerminal: TerminalModel) => {
      setTerminals((current) => ({ ...current, [id]: nextTerminal }))
      setProjects((current) =>
        current.map((project) =>
          project.id === activeProject.id
            ? { ...project, terminalIds: [...project.terminalIds, id] }
            : project,
        ),
      )
      setActiveTerminalId(id)
      setSidebarPanel('terminals')
      setExpandedProjectIds((current) => [...new Set([...current, activeProject.id])])
    }

    if (!window.terminalHost) {
      attachTerminal({
        ...terminal,
        eventLog: [event('Electron preload 不可用；请使用 npm run dev 启动桌面端。')],
      })
      setNotice('未连接 Electron 运行时，无法创建真实终端。')
      return
    }

    try {
      const runtime = await window.terminalHost.create({ id, cwd, cols: 110, rows: 30 })
      attachTerminal({
        ...terminal,
        status: 'running',
        pid: runtime.pid,
        shell: runtime.shell,
        cwd: runtime.cwd,
        createdAt: runtime.createdAt,
        eventLog: [event(`已启动真实 PTY，PID ${runtime.pid}`)],
      })
      setNotice(`已添加终端：${name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      attachTerminal({
        ...terminal,
        status: 'exited',
        eventLog: [event(`启动失败：${message}`)],
      })
      setNotice(`终端启动失败：${message}`)
    }
  }

  const stopTerminal = async (id: string) => {
    await window.terminalHost?.kill(id)
    setTerminals((current) => ({
      ...current,
      [id]: {
        ...current[id],
        status: 'exited',
        eventLog: [event('已请求停止进程'), ...(current[id]?.eventLog ?? [])].slice(0, 12),
      },
    }))
    setNotice('已发送停止请求。')
  }

  const startTerminal = useCallback(async (terminal: TerminalModel) => {
    if (!window.terminalHost) {
      setNotice('未连接 Electron 运行时，无法启动终端。')
      return false
    }
    if (terminal.status === 'running') {
      setActiveTerminalId(terminal.id)
      setSidebarPanel('terminals')
      return true
    }

    try {
      const runtime = await window.terminalHost.create({
        id: terminal.id,
        cwd: terminal.cwd,
        cols: 110,
        rows: 30,
      })
      setTerminals((current) => ({
        ...current,
        [terminal.id]: {
          ...current[terminal.id],
          status: 'running',
          pid: runtime.pid,
          shell: runtime.shell,
          cwd: runtime.cwd,
          createdAt: runtime.createdAt,
          exitCode: null,
          restoreOnSelect: false,
          eventLog: [
            event(`已启动真实 PTY，PID ${runtime.pid}`),
            ...(current[terminal.id]?.eventLog ?? []),
          ].slice(0, 12),
        },
      }))
      setActiveTerminalId(terminal.id)
      setSidebarPanel('terminals')
      setNotice(`已启动终端：${terminal.name}`)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTerminals((current) => ({
        ...current,
        [terminal.id]: {
          ...current[terminal.id],
          status: 'exited',
          eventLog: [event(`启动失败：${message}`), ...(current[terminal.id]?.eventLog ?? [])].slice(0, 12),
        },
      }))
      setNotice(`终端启动失败：${message}`)
      return false
    }
  }, [])

  useEffect(() => {
    if (!isStateLoaded || sidebarPanel !== 'terminals' || !activeTerminal?.restoreOnSelect) return
    const timer = window.setTimeout(() => {
      startTerminal(activeTerminal)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activeTerminal, isStateLoaded, sidebarPanel, startTerminal])

  const rerunTerminal = async (terminal: TerminalModel) => {
    if (!window.terminalHost) {
      setNotice('未连接 Electron 运行时，无法重新执行。')
      return
    }
    const command = terminal.lastCommand?.trim()
    if (!command) {
      setNotice('该终端没有可重新执行的历史命令。')
      return
    }

    try {
      if (terminal.status === 'running') {
        await window.terminalHost.write({ id: terminal.id, data: `${command}\r` })
        setTerminals((current) => ({
          ...current,
          [terminal.id]: {
            ...updateInputState(current[terminal.id], `${command}\r`),
            eventLog: [event(`重新执行：${command}`), ...(current[terminal.id]?.eventLog ?? [])].slice(0, 12),
          },
        }))
        setNotice(`已重新执行：${command}`)
        return
      }

      const started = await startTerminal(terminal)
      if (!started) return
      await window.terminalHost.write({ id: terminal.id, data: `${command}\r` })
      setTerminals((current) => ({
        ...current,
        [terminal.id]: {
          ...current[terminal.id],
          eventLog: [
            event(`重新执行：${command}`),
            ...(current[terminal.id]?.eventLog ?? []),
          ].slice(0, 12),
        },
      }))
      setActiveTerminalId(terminal.id)
      setSidebarPanel('terminals')
      setNotice(`已恢复并重新执行：${command}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTerminals((current) => ({
        ...current,
        [terminal.id]: {
          ...current[terminal.id],
          status: 'exited',
          eventLog: [event(`重新执行失败：${message}`), ...(current[terminal.id]?.eventLog ?? [])].slice(0, 12),
        },
      }))
      setNotice(`重新执行失败：${message}`)
    }
  }

  const closeTerminal = async (id: string) => {
    await window.terminalHost?.kill(id)
    setTerminals((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    setProjects((current) =>
      current.map((project) =>
        project.id === activeProject.id
          ? { ...project, terminalIds: project.terminalIds.filter((terminalId) => terminalId !== id) }
          : project,
      ),
    )
    if (activeTerminalId === id) {
      const nextId = activeProject.terminalIds.find((terminalId) => terminalId !== id) ?? null
      setActiveTerminalId(nextId)
    }
    setNotice('已关闭终端。')
  }

  const renameProject = (id: string, name: string) => {
    const nextProjects = projects.map((project) => (project.id === id ? { ...project, name } : project))
    setProjects(nextProjects)
    saveStateImmediately({ projects: nextProjects })
  }

  const renameProjectPath = (id: string, nextPath: string) => {
    const nextProjects = projects.map((project) =>
      project.id === id ? { ...project, path: nextPath } : project,
    )
    setProjects(nextProjects)
    saveStateImmediately({ projects: nextProjects })
  }

  const renameTerminal = (id: string, name: string) => {
    setTerminals((current) => ({
      ...current,
      [id]: {
        ...current[id],
        name,
      },
    }))
  }

  const resizeTerminalHeight = (id: string, height: number) => {
    setTerminals((current) => ({
      ...current,
      [id]: {
        ...current[id],
        height,
      },
    }))
  }

  const deleteProject = async (project: Project) => {
    await Promise.all(project.terminalIds.map((terminalId) => window.terminalHost?.kill(terminalId)))

    const fallbackProject: Project = {
      id: 'project_current',
      name: '当前工作区',
      path: projectDraft.path || defaultPath,
      terminalIds: [],
    }
    const remainingProjects = projects.filter((item) => item.id !== project.id)
    const nextProjects = remainingProjects.length ? remainingProjects : [fallbackProject]
    const nextActiveProject =
      project.id === activeProject.id
        ? nextProjects[0]
        : projects.find((item) => item.id === activeProject.id) ?? nextProjects[0]

    const nextTerminals = { ...terminals }
    for (const terminalId of project.terminalIds) {
      delete nextTerminals[terminalId]
    }
    setTerminals(nextTerminals)
    setProjects(nextProjects)
    setExpandedProjectIds((current) =>
      current.filter((projectId) => projectId !== project.id && nextProjects.some((item) => item.id === projectId)),
    )
    setExpandedProbeProjectIds((current) => current.filter((projectId) => projectId !== project.id))
    setActiveProjectId(nextActiveProject.id)
    setActiveTerminalId(nextActiveProject.terminalIds[0] ?? null)
    setSidebarPanel('terminals')
    saveStateImmediately({
      projects: nextProjects,
      terminals: compactTerminalsForSave(nextTerminals),
      activeProjectId: nextActiveProject.id,
      activeTerminalId: nextActiveProject.terminalIds[0] ?? null,
      expandedProjectIds: expandedProjectIds.filter((projectId) =>
        projectId !== project.id && nextProjects.some((item) => item.id === projectId),
      ),
      expandedProbeProjectIds: expandedProbeProjectIds.filter((projectId) => projectId !== project.id),
      sidebarPanel: 'terminals',
    })
    setNotice(`已删除项目：${project.name}`)
  }

  const selectProject = (project: Project) => {
    setActiveProjectId(project.id)
    setExpandedProjectIds((current) => [...new Set([...current, project.id])])
    setActiveTerminalId(project.terminalIds[0] ?? null)
    setNotice(`已切换项目：${project.name}`)
  }

  const toggleProject = (id: string) => {
    setExpandedProjectIds((current) =>
      current.includes(id) ? current.filter((projectId) => projectId !== id) : [...current, id],
    )
  }

  const toggleProjectProbe = (id: string) => {
    setExpandedProbeProjectIds((current) =>
      current.includes(id) ? current.filter((projectId) => projectId !== id) : [...current, id],
    )
  }

  const selectRecentTerminal = (terminal: TerminalModel) => {
    setActiveProjectId(terminal.projectId)
    setExpandedProjectIds((current) => [...new Set([...current, terminal.projectId])])
    setSidebarPanel('terminals')
    setActiveTerminalId(terminal.id)
    setNotice(`已切换到终端：${terminal.name}`)
  }

  const renderProjectPanel = () => {
    const activeInspection = inspection?.cwd === activeProject.path ? inspection : null

    if (sidebarPanel === 'terminals') {
      if (!activeTerminals.length) {
        return <PanelEmpty title={activeProject.name} text="点击“添加终端”创建真实交互 shell。" />
      }
      return activeTerminals.map((terminal) => (
        <TerminalCard
          key={terminal.id}
          terminal={terminal}
          active={terminal.id === activeTerminal?.id}
          onSelect={() => setActiveTerminalId(terminal.id)}
          onStop={() => stopTerminal(terminal.id)}
          onResizeHeight={(height) => resizeTerminalHeight(terminal.id, height)}
        >
          <TerminalPane
            terminal={terminal}
            onResize={(cols, rows) => window.terminalHost?.resize({ id: terminal.id, cols, rows })}
            onInput={(data) => {
              const shouldWriteToPty = !isRememberCommandEvent(data)
              setTerminals((current) => {
                const currentTerminal = current[terminal.id]
                if (!currentTerminal) return current
                return {
                  ...current,
                  [terminal.id]: updateInputState(currentTerminal, data),
                }
              })
              if (shouldWriteToPty) window.terminalHost?.write({ id: terminal.id, data })
            }}
          />
        </TerminalCard>
      ))
    }

    if (!activeProject.path) return <PanelEmpty title="未设置目录" text="请先为当前项目设置真实目录。" />
    if (isInspecting) return <PanelEmpty title="正在扫描" text={activeProject.path} />
    if (inspectionError) return <PanelEmpty title="扫描失败" text={inspectionError} />
    if (!activeInspection) return <PanelEmpty title="未扫描" text="没有当前项目的扫描结果。" />

    if (sidebarPanel === 'services') {
      return activeInspection.services.length ? (
        <div className="resourceGrid">
          {activeInspection.services.map((service) => (
            <ResourceItem
              key={`${service.source}-${service.name}`}
              title={service.name}
              meta={formatResourceMeta(service)}
              value={service.command}
            />
          ))}
        </div>
      ) : <PanelEmpty title="未发现服务" text="深度扫描内未发现 package.json、pyproject 或 Docker Compose 服务入口。" />
    }

    if (sidebarPanel === 'env') {
      return activeInspection.environment.length ? (
        <div className="resourceGrid">
          {activeInspection.environment.map((entry) => (
            <ResourceItem
              key={`${entry.source}-${entry.key}`}
              title={entry.key}
              meta={formatResourceMeta(entry)}
              value={entry.masked ? '敏感值已隐藏' : entry.value}
            />
          ))}
        </div>
      ) : <PanelEmpty title="未发现环境配置" text="深度扫描内未发现 .env、.env.local 或其他 .env.* 文件。" />
    }

    if (sidebarPanel === 'tasks') {
      return activeInspection.tasks.length ? (
        <div className="resourceGrid">
          {activeInspection.tasks.map((task) => (
            <ResourceItem
              key={`${task.source}-${task.kind}-${task.name}`}
              title={task.name}
              meta={formatResourceMeta(task, task.kind)}
              value={task.source}
            />
          ))}
        </div>
      ) : <PanelEmpty title="未发现任务" text="深度扫描内未发现 workflows、Taskfile、justfile、Makefile 或构建系统入口。" />
    }

    if (sidebarPanel === 'notes') {
      return activeInspection.notes.length ? (
        <div className="resourceGrid">
          {activeInspection.notes.map((note) => (
            <ResourceItem
              key={note.source}
              title={note.title}
              meta={formatResourceMeta(note, 'markdown')}
              value={note.source}
            />
          ))}
        </div>
      ) : <PanelEmpty title="未发现笔记" text="深度扫描内未发现 markdown 文件。" />
    }

    return null
  }

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <Folder size={20} />
          <div>
            <input
              className="brandNameInput"
              value={activeProject.name}
              aria-label="项目名"
              onChange={(change) => renameProject(activeProject.id, change.target.value)}
            />
            <input
              className="brandPathInput"
              value={activeProject.path}
              aria-label="项目目录"
              placeholder="目录未连接"
              onChange={(change) => renameProjectPath(activeProject.id, change.target.value)}
            />
          </div>
        </div>

        <div className="sidebarScroll">
          <div className="sidebarSection">项目</div>
          <nav className="projectList" aria-label="Projects">
            {projects.map((project) => {
              const isActiveProject = project.id === activeProject.id
              const isExpanded = expandedProjectIds.includes(project.id)
              const isProbeExpanded = expandedProbeProjectIds.includes(project.id)
              const projectTerminals = project.terminalIds
                .map((id) => terminals[id])
                .filter((terminal): terminal is TerminalModel => Boolean(terminal))
              return (
                <div key={project.id} className="projectGroup">
                  <button
                    type="button"
                    className={`projectRoot ${isActiveProject ? 'selected' : ''}`}
                    onClick={() => selectProject(project)}
                  >
                    <span
                      className="projectDisclosure"
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleProject(project.id)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          event.stopPropagation()
                          toggleProject(project.id)
                        }
                      }}
                    >
                      {isExpanded ? <ChevronDown size={15} /> : <ChevronsRight size={15} />}
                    </span>
                    <FolderOpen size={19} />
                    <span>{project.name}</span>
                    <span
                      className="projectDelete"
                      role="button"
                      tabIndex={0}
                      aria-label={`删除项目 ${project.name}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        deleteProject(project)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          event.stopPropagation()
                          deleteProject(project)
                        }
                      }}
                    >
                      <X size={15} />
                    </span>
                  </button>
                  {isExpanded ? (
                    <>
                      <button
                        type="button"
                        className={`treeItem ${isActiveProject && sidebarPanel === 'terminals' ? 'selected' : ''}`}
                        onClick={() => {
                          selectProject(project)
                          setSidebarPanel('terminals')
                          setNotice('已切换到终端列表。')
                        }}
                      >
                        <TerminalSquare size={17} />
                        <span>终端</span>
                      </button>
                      {projectTerminals.map((terminal, index) => (
                        <button
                          key={terminal.id}
                          type="button"
                          className={`terminalTreeItem ${terminal.id === activeTerminal?.id ? 'selected' : ''}`}
                          onClick={() => selectRecentTerminal(terminal)}
                        >
                          <TerminalSquare size={15} />
                          <span>{terminal.name || `终端 ${index + 1}`}</span>
                          <i className={`dot ${terminal.status}`} />
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`treeItem probeRoot ${isProbeExpanded ? 'expanded' : ''}`}
                        onClick={() => {
                          selectProject(project)
                          toggleProjectProbe(project.id)
                          setNotice(isProbeExpanded ? '已折叠项目探测。' : '已展开项目探测。')
                        }}
                      >
                        {isProbeExpanded ? <ChevronDown size={17} /> : <ChevronsRight size={17} />}
                        <span>项目探测</span>
                      </button>
                      {isProbeExpanded ? (
                        <>
                          <button type="button" className={`probeItem ${isActiveProject && sidebarPanel === 'services' ? 'selected' : ''}`} onClick={() => { selectProject(project); setSidebarPanel('services'); setNotice('已显示项目服务探测结果。') }}>
                            <Server size={16} />
                            <span>服务</span>
                          </button>
                          <button type="button" className={`probeItem ${isActiveProject && sidebarPanel === 'env' ? 'selected' : ''}`} onClick={() => { selectProject(project); setSidebarPanel('env'); setNotice('已显示项目环境探测结果。') }}>
                            <Settings size={16} />
                            <span>环境</span>
                          </button>
                          <button type="button" className={`probeItem ${isActiveProject && sidebarPanel === 'tasks' ? 'selected' : ''}`} onClick={() => { selectProject(project); setSidebarPanel('tasks'); setNotice('已显示项目任务探测结果。') }}>
                            <ChevronsRight size={16} />
                            <span>任务</span>
                          </button>
                          <button type="button" className={`probeItem ${isActiveProject && sidebarPanel === 'notes' ? 'selected' : ''}`} onClick={() => { selectProject(project); setSidebarPanel('notes'); setNotice('已显示项目笔记探测结果。') }}>
                            <List size={16} />
                            <span>笔记</span>
                          </button>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
              )
            })}
          </nav>
          <div className="sidebarSection">最近终端</div>
          <div className="quickList" aria-label="Recent terminals">
            {recentTerminals.length ? recentTerminals.map((terminal) => (
              <button
                key={terminal.id}
                type="button"
                className={terminal.id === activeTerminal?.id ? 'selected' : ''}
                onClick={() => selectRecentTerminal(terminal)}
              >
                <TerminalSquare size={15} />
                <span>{terminal.name}</span>
                <i className={`dot ${terminal.status}`} />
              </button>
            )) : <p className="sidebarHint">还没有真实终端。</p>}
          </div>
        </div>
        <div className="sidebarFooter">
          <button type="button" aria-label="New project" onClick={createProject}><Plus size={18} /></button>
          <button type="button" aria-label="Filter" onClick={() => setNotice('筛选只会作用于真实终端列表。')}><Filter size={18} /></button>
        </div>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <button type="button" className="toolbarButton" onClick={createProject}>
            <Plus size={17} />
            新建项目
            <ChevronDown size={14} />
          </button>
          <button type="button" className="toolbarButton" onClick={addTerminal}>
            <Plus size={17} />
            添加终端
            <ChevronDown size={14} />
          </button>
          <div className="viewSwitcher" aria-label="View switcher">
            <button type="button" className={viewMode === 'grid' ? 'selected' : ''} onClick={() => { setViewMode('grid'); setNotice('已切换网格视图。') }}><Grid3X3 size={16} /></button>
            <button type="button" className={viewMode === 'list' ? 'selected' : ''} onClick={() => { setViewMode('list'); setNotice('已切换列表视图。') }}><List size={16} /></button>
            <button type="button" className={viewMode === 'split' ? 'selected' : ''} onClick={() => { setViewMode('split'); setNotice('已切换分屏视图。') }}><Grid3X3 size={16} /></button>
          </div>
          <button type="button" className="searchBox" onClick={() => setNotice('搜索将基于真实终端名称、目录和 PID。')}>
            <Search size={16} />
            <span>搜索终端...</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="toolbarIcons">
            <button type="button" aria-label="通知" onClick={() => setNotice('暂无运行时通知。')}><Bell size={18} /></button>
            <button type="button" aria-label="设置" onClick={() => setDetailTab('settings')}><Settings size={18} /></button>
          </div>
        </header>

        <div className="terminalTabs" role="tablist" aria-label="Terminals">
          {activeTerminals.map((terminal) => (
            <button
              key={terminal.id}
              type="button"
              role="tab"
              className={terminal.id === activeTerminal?.id ? 'active' : ''}
              onClick={() => setActiveTerminalId(terminal.id)}
            >
              <span className={`dot ${terminal.status}`} />
              {terminal.name}
              <span
                className="tabClose"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation()
                  closeTerminal(terminal.id)
                }}
              >
                <X size={14} />
              </span>
            </button>
          ))}
          <button type="button" className="addTab" onClick={addTerminal}><Plus size={18} /></button>
        </div>

        <div className={`terminalStage ${viewMode}`}>
          {renderProjectPanel()}
        </div>
        <div className="noticeBar">{notice}</div>
      </section>

      <aside className="details">
        <div className="detailsTitle">
          <PanelRight size={16} />
        </div>
        {activeTerminal ? (
          <>
            <div className="runtimeHeader">
              <span className={`dot ${activeTerminal.status}`} />
              <div>
                <strong>{activeTerminal.name}</strong>
                <span>{activeTerminal.role}</span>
              </div>
              <button type="button" className="detailIcon" onClick={() => setNotice('右侧详情已保持展开。')}><ChevronsRight size={17} /></button>
              <button type="button" className="detailIcon" onClick={() => setActiveTerminalId(null)}><X size={17} /></button>
            </div>
            <div className="detailTabs">
              <button type="button" className={detailTab === 'details' ? 'selected' : ''} onClick={() => setDetailTab('details')}>详情</button>
              <button type="button" className={detailTab === 'settings' ? 'selected' : ''} onClick={() => setDetailTab('settings')}>设置</button>
            </div>
            {detailTab === 'details' ? (
            <>
            <section className="detailSection">
              <h2>状态</h2>
              <dl className="detailTable">
                <div><dt>状态</dt><dd className={activeTerminal.status === 'running' ? 'greenText' : ''}>{statusText[activeTerminal.status]}</dd></div>
                <div><dt>PID</dt><dd>{activeTerminal.pid ?? '-'}</dd></div>
                <div><dt>运行时间</dt><dd>{formatUptime(activeTerminal.createdAt, activeTerminal.status)}</dd></div>
                <div><dt>启动时间</dt><dd>{formatDateTime(activeTerminal.createdAt)}</dd></div>
                <div><dt>退出码</dt><dd>{activeTerminal.exitCode ?? '-'}</dd></div>
              </dl>
            </section>
            <section className="detailSection">
              <h2>进程</h2>
              <dl className="detailTable">
                <div><dt>命令</dt><dd>{activeTerminal.command || activeTerminal.shell || 'interactive shell'}</dd></div>
                <div><dt>上次命令</dt><dd>{activeTerminal.lastCommand || '-'}</dd></div>
                <div><dt>Shell</dt><dd>{activeTerminal.shell || '-'}</dd></div>
                <div><dt>目录</dt><dd>{activeTerminal.cwd}</dd></div>
              </dl>
              <button
                type="button"
                className="showAll"
                disabled={!activeTerminal.lastCommand}
                onClick={() => rerunTerminal(activeTerminal)}
              >
                重新执行上次命令
              </button>
            </section>
            <section className="detailSection">
              <h2>最近事件</h2>
              <div className="eventTimeline">
                {activeTerminal.eventLog.map((event, index) => (
                  <div key={`${event.message}-${index}`}>
                    <time>{formatTime(event.time)}</time>
                    <i className={activeTerminal.status === 'running' ? '' : 'yellow'} />
                    <span>{event.message}</span>
                  </div>
                ))}
              </div>
              <button type="button" className="historyLink" onClick={() => setNotice('完整历史需要接入持久化事件库。')}>查看完整历史 <ChevronsRight size={14} /></button>
            </section>
            </>
            ) : (
              <section className="detailSection">
                <h2>终端设置</h2>
                <dl className="detailTable">
                  <div>
                    <dt>名称</dt>
                    <dd>
                      <input
                        className="detailInput"
                        value={activeTerminal.name}
                        aria-label="终端名"
                        onChange={(change) => renameTerminal(activeTerminal.id, change.target.value)}
                      />
                    </dd>
                  </div>
                  <div><dt>Shell</dt><dd>{activeTerminal.shell || '未启动'}</dd></div>
                  <div><dt>目录</dt><dd>{activeTerminal.cwd || '-'}</dd></div>
                </dl>
                <button type="button" className="showAll" onClick={() => stopTerminal(activeTerminal.id)} disabled={activeTerminal.status !== 'running'}>停止进程</button>
              </section>
            )}
          </>
        ) : (
          <div className="detailsEmpty">
            <Play size={28} />
            <p>选择或创建一个终端后显示进程、目录、状态和事件。</p>
          </div>
        )}
      </aside>
    </main>
  )
}

function TerminalCard({
  terminal,
  active,
  children,
  onSelect,
  onStop,
  onResizeHeight,
}: {
  terminal: TerminalModel
  active: boolean
  children: ReactNode
  onSelect: () => void
  onStop: () => void
  onResizeHeight: (height: number) => void
}) {
  const cardRef = useRef<HTMLElement | null>(null)

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const card = cardRef.current
    if (!card) return

    const startY = event.clientY
    const startHeight = card.getBoundingClientRect().height
    const minHeight = 180
    const maxHeight = Math.max(minHeight, window.innerHeight - 150)

    const move = (moveEvent: PointerEvent) => {
      const nextHeight = Math.min(maxHeight, Math.max(minHeight, startHeight + moveEvent.clientY - startY))
      onResizeHeight(Math.round(nextHeight))
    }

    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.classList.remove('resizingTerminal')
    }

    document.body.classList.add('resizingTerminal')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  return (
    <article
      ref={cardRef}
      className={`terminalCard ${active ? 'active' : ''}`}
      style={terminal.height ? { height: terminal.height } : undefined}
      onClick={onSelect}
    >
      <header className="terminalCardHeader">
        <span className={`dot ${terminal.status}`} />
        <strong>{terminal.name}</strong>
        <code>{terminal.role || terminal.shell || 'shell'}</code>
        <span className="terminalPath">{terminal.cwd}</span>
        <button
          type="button"
          className="iconButton"
          disabled={terminal.status !== 'running'}
          onClick={(event) => {
            event.stopPropagation()
            onStop()
          }}
          aria-label={`Stop ${terminal.name}`}
        >
          <Square size={13} />
        </button>
      </header>
      <div className="terminalCardBody">{children}</div>
      <button
        type="button"
        className="terminalResizeHandle"
        aria-label={`调整 ${terminal.name} 高度`}
        onPointerDown={startResize}
      />
    </article>
  )
}

function TerminalPane({
  terminal,
  onInput,
  onResize,
}: {
  terminal: TerminalModel
  onInput: (data: string) => void
  onResize: (cols: number, rows: number) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const onInputRef = useRef(onInput)
  const onResizeRef = useRef(onResize)
  const initialTranscriptRef = useRef(terminal.transcript)

  useEffect(() => {
    onInputRef.current = onInput
    onResizeRef.current = onResize
  }, [onInput, onResize])

  useEffect(() => {
    initialTranscriptRef.current = terminal.transcript
  }, [terminal.id, terminal.transcript])

  useEffect(() => {
    if (!containerRef.current || termRef.current) return
    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily:
        'JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.35,
      theme: {
        background: '#0b0c0f',
        foreground: '#d8dee9',
        cursor: '#00e5ff',
        selectionBackground: '#3d4658',
        black: '#121417',
        red: '#f07178',
        green: '#8bd17c',
        yellow: '#f0b35a',
        blue: '#7aa2f7',
        magenta: '#c792ea',
        cyan: '#89ddff',
        white: '#d8dee9',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    if (initialTranscriptRef.current) {
      term.write(initialTranscriptRef.current)
    }
    term.onData((data) => onInputRef.current(data))
    termRef.current = term
    fitRef.current = fit
    fit.fit()
    term.focus()
    onResizeRef.current(term.cols, term.rows)
    let lastSize = `${term.cols}x${term.rows}`
    let resizeFrame = 0

    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame) return
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0
        fit.fit()
        const nextSize = `${term.cols}x${term.rows}`
        if (nextSize !== lastSize) {
          lastSize = nextSize
          onResizeRef.current(term.cols, term.rows)
        }
      })
    })
    resizeObserver.observe(containerRef.current)

    const dataListener = (event: Event) => {
      term.write((event as CustomEvent<string>).detail)
    }
    window.addEventListener(`terminal-data:${terminal.id}`, dataListener)

    return () => {
      window.removeEventListener(`terminal-data:${terminal.id}`, dataListener)
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame)
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [terminal.id, terminal.status])

  useEffect(() => {
    if (terminal.status === 'unavailable') {
      termRef.current?.writeln('Electron runtime is unavailable. Start the desktop app with npm run dev.')
    }
  }, [terminal.status])

  if (terminal.status !== 'running') {
    return (
      <div className="terminalRestorePane">
        {terminal.transcript ? (
          <pre className="terminalTranscript terminalRestoreHistory">{terminal.transcript}</pre>
        ) : (
          <div className="terminalRestoreEmpty">
            <TerminalSquare size={24} />
            <span>{statusText[terminal.status]}</span>
          </div>
        )}
      </div>
    )
  }

  return <div ref={containerRef} className="xtermHost" onMouseDown={() => termRef.current?.focus()} />
}

function PanelEmpty({ title, text }: { title: string; text: string }) {
  return (
    <div className="emptyState">
      <TerminalSquare size={40} />
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  )
}

function formatResourceMeta(
  item: { source: string; root?: string; confidence?: string; reason?: string },
  kind?: string,
) {
  const parts = [
    kind,
    item.root && item.root !== '.' ? item.root : undefined,
    item.source,
    item.confidence ? `${item.confidence} confidence` : undefined,
    item.reason,
  ].filter(Boolean)
  return parts.join(' · ')
}

function ResourceItem({
  title,
  meta,
  value,
}: {
  title: string
  meta: string
  value: string
}) {
  return (
    <article className="resourceItem">
      <div>
        <strong>{title}</strong>
        <span>{meta}</span>
      </div>
      <code>{value}</code>
    </article>
  )
}

function formatUptime(createdAt: number | undefined, status: RuntimeStatus) {
  if (!createdAt) return '-'
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  const value = minutes ? `${minutes}m ${remainder}s` : `${remainder}s`
  return status === 'running' ? value : `${value} before exit`
}

function formatDateTime(value: number | undefined) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default App
