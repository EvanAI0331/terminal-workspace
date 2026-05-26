import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import {
  Bell,
  ChevronDown,
  ChevronsRight,
  Copy,
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

type RuntimeStatus = 'idle' | 'running' | 'exited' | 'failed' | 'unavailable'

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
  busy?: boolean
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
  status: (id: string) => Promise<{ exists: boolean; active: boolean; pid: number | null }>
  kill: (id: string) => Promise<{ ok: boolean }>
  cwd: (id: string) => Promise<{ ok: boolean; cwd: string | null }>
  workspace: () => Promise<{ cwd: string; shell: string }>
  stateMeta?: () => Promise<{ userData: string; statePath: string }>
  loadState: () => Promise<{ state: PersistedWorkspaceState | null; path: string }>
  saveState: (state: PersistedWorkspaceState) => Promise<{ ok: boolean; path: string }>
  saveStateSync?: (state: PersistedWorkspaceState) => { ok: boolean; path: string }
  inspectProject: (request: { cwd: string }) => Promise<ProjectInspection>
  readClipboardText: () => string
  writeClipboardText?: (text: string) => void
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
  idle: 'Idle',
  running: 'Running',
  exited: 'Exited',
  failed: 'Failed',
  unavailable: 'Unavailable',
}

const terminalIndicatorStatus = (terminal: TerminalModel): RuntimeStatus =>
  terminal.status === 'running' ? (terminal.busy ? 'running' : 'exited') : terminal.status

const terminalStatusLabel = (terminal: TerminalModel) =>
  terminal.status === 'running' && !terminal.busy ? 'Idle' : statusText[terminal.status]

const maxTranscriptLength = 40000

const appendTranscript = (value: string | undefined, data: string) =>
  `${value ?? ''}${data}`.slice(-maxTranscriptLength)

const pastedCommandPrefix = '\u001b]1337;TerminalWorkspaceLastCommand='
const pastedCommandSuffix = '\u0007'
const isRememberCommandEvent = (data: string) =>
  data.startsWith(pastedCommandPrefix) && data.endsWith(pastedCommandSuffix)

const normalizeStoredCommand = (value: string | undefined) =>
  (value ?? '')
    .replaceAll('\u001b[200~', '')
    .replaceAll('\u001b[201~', '')
    .replaceAll('[200~', '')
    .replaceAll('[201~', '')
    .replace(/\r\n|\r/g, '\n')
    .trim()

const commandLinesFromInput = (data: string) =>
  normalizeStoredCommand(data)
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)

const normalizePathForCompare = (value: string | undefined) =>
  (value ?? '').trim().replace(/\/+$/, '')

const isPathWithinRoot = (candidate: string, root: string) => {
  const normalizedCandidate = normalizePathForCompare(candidate)
  const normalizedRoot = normalizePathForCompare(root)
  return Boolean(
    normalizedCandidate &&
      normalizedRoot &&
      (normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)),
  )
}

const firstCdPath = (command: string) => {
  const line = commandLinesFromInput(command).find((entry) => entry.startsWith('cd '))
  if (!line) return null
  const match = line.match(/^cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/)
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null
}

const commandBelongsToTerminal = (
  terminal: Pick<TerminalModel, 'cwd'>,
  command: string | undefined,
  projectPath: string | undefined,
) => {
  const normalizedCommand = normalizeStoredCommand(command)
  if (!normalizedCommand) return true
  const targetPath = firstCdPath(normalizedCommand)
  if (!targetPath || !targetPath.startsWith('/')) return true
  const root = normalizePathForCompare(projectPath) || normalizePathForCompare(terminal.cwd)
  return isPathWithinRoot(targetPath, root)
}

const visibleLaunchCommand = (
  terminal: TerminalModel,
  projectPath: string | undefined,
) => {
  const command = normalizeStoredCommand(terminal.lastCommand || terminal.command)
  return commandBelongsToTerminal(terminal, command, projectPath) ? command : ''
}

const updateInputState = (
  terminal: TerminalModel,
  data: string,
  projectPath?: string,
): TerminalModel => {
  const stateData = normalizeStoredCommand(data)
  const commandLines = commandLinesFromInput(stateData)
  const isCommandBlockInput = commandLines.length > 1
  let buffer = terminal.inputBuffer ?? ''
  let lastCommand = terminal.lastCommand
  let command = terminal.command

  if (isRememberCommandEvent(stateData)) {
    const encoded = stateData.slice(pastedCommandPrefix.length, -pastedCommandSuffix.length)
    const pastedCommand = normalizeStoredCommand(decodeURIComponent(encoded))
    if (!commandBelongsToTerminal(terminal, pastedCommand, projectPath)) {
      return {
        ...terminal,
        inputBuffer: '',
      }
    }
    return {
      ...terminal,
      inputBuffer: pastedCommand,
      lastCommand: pastedCommand,
      command: pastedCommand,
    }
  }

  if (isCommandBlockInput) {
    const commandBlock = commandLines.join('\n')
    if (!commandBelongsToTerminal(terminal, commandBlock, projectPath)) {
      return {
        ...terminal,
        inputBuffer: '',
      }
    }
    return {
      ...terminal,
      inputBuffer: '',
      lastCommand: commandBlock,
      command: commandBlock,
    }
  }

  for (const char of stateData) {
    if (char === '\r' || char === '\n') {
      const trimmed = buffer.trim()
      if (trimmed) {
        if (commandBelongsToTerminal(terminal, trimmed, projectPath)) {
          lastCommand = trimmed
          command = trimmed
        }
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

const normalizeLoadedTerminals = (loaded: Record<string, TerminalModel>, projects: Project[]) => {
  const projectPaths = new Map(projects.map((project) => [project.id, project.path]))
  return Object.fromEntries(
    Object.entries(loaded).map(([id, terminal]) => {
      const shouldRestore =
        terminal.status === 'running' ||
        (terminal.eventLog ?? []).some((entry) => entry.message.includes('Previous process ended when the app quit'))
      const projectPath = projectPaths.get(terminal.projectId)
      const commandIsValid = commandBelongsToTerminal(
        terminal,
        terminal.lastCommand || terminal.command,
        projectPath,
      )
      return [
        id,
        {
          ...terminal,
          command: commandIsValid ? terminal.command : '',
          lastCommand: commandIsValid ? terminal.lastCommand : undefined,
          status: shouldRestore ? 'idle' : terminal.status,
          busy: false,
          pid: undefined,
          exitCode: shouldRestore ? null : terminal.exitCode,
          restoreOnSelect: shouldRestore || terminal.restoreOnSelect,
          eventLog:
            shouldRestore
              ? [event('Previous process ended when the app quit. Start a real PTY to continue input.'), ...(terminal.eventLog ?? [])].slice(0, 12)
              : terminal.eventLog ?? [],
        },
      ]
    }),
  ) as Record<string, TerminalModel>
}

const sanitizeTerminalCommands = (
  current: Record<string, TerminalModel>,
  projects: Project[],
) => {
  const projectPaths = new Map(projects.map((project) => [project.id, project.path]))
  let changed = false
  const next = Object.fromEntries(
    Object.entries(current).map(([id, terminal]) => {
      const projectPath = projectPaths.get(terminal.projectId)
      if (commandBelongsToTerminal(terminal, terminal.lastCommand || terminal.command, projectPath)) {
        return [id, terminal]
      }
      changed = true
      return [
        id,
        {
          ...terminal,
          command: '',
          lastCommand: undefined,
          inputBuffer: '',
        },
      ]
    }),
  ) as Record<string, TerminalModel>
  return changed ? next : current
}

const compactTerminalsForSave = (current: Record<string, TerminalModel>, projects: Project[]) =>
  Object.fromEntries(
    Object.entries(sanitizeTerminalCommands(current, projects))
      .filter(([, terminal]) => Boolean(terminal.projectId))
      .map(([id, terminal]) => [
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
      name: 'Current Workspace',
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
  const [notice, setNotice] = useState('Create a project or add a terminal.')
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
  const runningTerminalIds = useMemo(
    () => Object.values(terminals)
      .filter((terminal) => terminal.status === 'running')
      .map((terminal) => terminal.id)
      .sort()
      .join('|'),
    [terminals],
  )
  const persistedState = useMemo<PersistedWorkspaceState>(
    () => ({
      version: 1,
      projects,
      terminals: compactTerminalsForSave(terminals, projects),
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
          setNotice(`No saved workspace found. Creating a new workspace at ${path}`)
          return
        }
        const loadedTerminals = normalizeLoadedTerminals(state.terminals ?? {}, state.projects)
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
        setNotice(`Restored saved workspace from ${path}`)
      })
      .catch((error) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        setIsStateLoaded(true)
        setNotice(`Failed to load saved state: ${message}`)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isStateLoaded) return
    if (!window.terminalHost) {
      Promise.resolve().then(() => {
        setNotice('This is a browser preview. Start Electron with npm run dev for real terminals.')
      })
      return
    }
    if (hasPersistedState) return
    window.terminalHost.workspace().then((workspace) => {
      setProjects((current) =>
        current.map((project) =>
          project.id === 'project_current'
            ? { ...project, name: workspace.cwd.split('/').filter(Boolean).at(-1) || 'Current Workspace', path: workspace.cwd }
            : project,
        ),
      )
      setProjectDraft({ name: '', path: workspace.cwd })
      setNotice(`Connected to local terminal runtime: ${workspace.shell}`)
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
      setTerminals((current) => {
        const terminal = current[id]
        if (!terminal) return current
        const wasStopRequested = terminal.eventLog?.[0]?.message === 'Stop requested'
        const nextStatus: RuntimeStatus = exitCode === 0 || wasStopRequested ? 'exited' : 'failed'
        return {
          ...current,
          [id]: {
            ...terminal,
            status: nextStatus,
            busy: false,
            exitCode,
            eventLog: [
              event(`Process exited: code ${exitCode}${signal ? ` signal ${signal}` : ''}`),
              ...(terminal.eventLog ?? []),
            ].slice(0, 12),
          },
        }
      })
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
        setNotice(`Failed to save workspace: ${message}`)
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
            setNotice(`Failed to sync terminal directory: ${message}`)
          })
      }
    }, 2500)
    return () => window.clearInterval(timer)
  }, [activeTerminalId, terminals])

  useEffect(() => {
    if (!window.terminalHost?.status || !runningTerminalIds) return
    let cancelled = false
    const refreshActivity = async () => {
      const ids = runningTerminalIds.split('|').filter(Boolean)
      await Promise.all(ids.map(async (id) => {
        try {
          const runtime = await window.terminalHost?.status(id)
          if (!runtime || cancelled) return
          setTerminals((current) => {
            const terminal = current[id]
            if (!terminal || terminal.status !== 'running') return current
            return {
              ...current,
              [id]: {
                ...terminal,
                busy: runtime.active,
                pid: runtime.pid ?? terminal.pid,
              },
            }
          })
        } catch {
          if (cancelled) return
          setTerminals((current) => {
            const terminal = current[id]
            if (!terminal || terminal.status !== 'running') return current
            return {
              ...current,
              [id]: {
                ...terminal,
                busy: false,
              },
            }
          })
        }
      }))
    }
    refreshActivity()
    const timer = window.setInterval(refreshActivity, 1500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [runningTerminalIds])

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
          `Deep scan complete: ${result.scan?.fileCount ?? 0} files, ${result.scan?.projectRoots.length ?? 1} project root${result.warnings?.length ? `, ${result.warnings.length} warning(s)` : ''}.`,
        )
      })
      .catch((error) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        setInspection(null)
        setInspectionError(message)
        setNotice(`Project scan failed: ${message}`)
      })
      .finally(() => {
        if (!cancelled) setIsInspecting(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeProject.path])

  const createProject = () => {
    const name = projectDraft.name.trim() || `Project ${projects.length + 1}`
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
    setNotice(`Created project: ${name}`)
  }

  const addTerminal = async () => {
    const id = makeId('terminal')
    let cwd = activeProject.path
    const name = `Terminal ${activeProject.terminalIds.length + 1}`

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
        setNotice(`Failed to read workspace directory: ${message}`)
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
      busy: false,
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
        eventLog: [event('Electron preload is unavailable. Start the desktop app with npm run dev.')],
      })
      setNotice('Electron runtime is not connected. Cannot create a real terminal.')
      return
    }

    try {
      const runtime = await window.terminalHost.create({ id, cwd, cols: 110, rows: 30 })
      attachTerminal({
        ...terminal,
        status: 'running',
        busy: false,
        pid: runtime.pid,
        shell: runtime.shell,
        cwd: runtime.cwd,
        createdAt: runtime.createdAt,
        eventLog: [event(`Started real PTY, PID ${runtime.pid}`)],
      })
      setNotice(`Added terminal: ${name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      attachTerminal({
        ...terminal,
        status: 'failed',
        busy: false,
        eventLog: [event(`Start failed: ${message}`)],
      })
      setNotice(`Terminal start failed: ${message}`)
    }
  }

  const stopTerminal = async (id: string) => {
    await window.terminalHost?.kill(id)
    setTerminals((current) => ({
      ...current,
      [id]: {
        ...current[id],
        status: 'exited',
        busy: false,
        eventLog: [event('Stop requested'), ...(current[id]?.eventLog ?? [])].slice(0, 12),
      },
    }))
    setNotice('Stop request sent.')
  }

  const startTerminal = useCallback(async (terminal: TerminalModel) => {
    if (!window.terminalHost) {
      setNotice('Electron runtime is not connected. Cannot start terminal.')
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
          busy: false,
          pid: runtime.pid,
          shell: runtime.shell,
          cwd: runtime.cwd,
          createdAt: runtime.createdAt,
          exitCode: null,
          restoreOnSelect: false,
          eventLog: [
            event(`Started real PTY, PID ${runtime.pid}`),
            ...(current[terminal.id]?.eventLog ?? []),
          ].slice(0, 12),
        },
      }))
      setActiveTerminalId(terminal.id)
      setSidebarPanel('terminals')
      setNotice(`Started terminal: ${terminal.name}`)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTerminals((current) => ({
        ...current,
        [terminal.id]: {
          ...current[terminal.id],
          status: 'failed',
          busy: false,
          eventLog: [event(`Start failed: ${message}`), ...(current[terminal.id]?.eventLog ?? [])].slice(0, 12),
        },
      }))
      setNotice(`Terminal start failed: ${message}`)
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
      setNotice('Electron runtime is not connected. Cannot rerun command.')
      return
    }
    const projectPath = projects.find((project) => project.id === terminal.projectId)?.path
    const command = visibleLaunchCommand(terminal, projectPath)
    if (!command) {
      setNotice('This terminal has no previous command to rerun.')
      return
    }

    try {
      if (terminal.status === 'running') {
        await window.terminalHost.write({ id: terminal.id, data: `${command}\r` })
        setTerminals((current) => ({
          ...current,
          [terminal.id]: {
            ...updateInputState(current[terminal.id], `${command}\r`, activeProject.path),
            eventLog: [event(`Rerun: ${command}`), ...(current[terminal.id]?.eventLog ?? [])].slice(0, 12),
          },
        }))
        setNotice(`Rerun: ${command}`)
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
            event(`Rerun: ${command}`),
            ...(current[terminal.id]?.eventLog ?? []),
          ].slice(0, 12),
        },
      }))
      setActiveTerminalId(terminal.id)
      setSidebarPanel('terminals')
      setNotice(`Restored and reran: ${command}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTerminals((current) => ({
        ...current,
        [terminal.id]: {
          ...current[terminal.id],
          status: 'failed',
          busy: false,
          eventLog: [event(`Rerun failed: ${message}`), ...(current[terminal.id]?.eventLog ?? [])].slice(0, 12),
        },
      }))
      setNotice(`Rerun failed: ${message}`)
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
    setNotice('Terminal closed.')
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
      name: 'Current Workspace',
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
      terminals: compactTerminalsForSave(nextTerminals, nextProjects),
      activeProjectId: nextActiveProject.id,
      activeTerminalId: nextActiveProject.terminalIds[0] ?? null,
      expandedProjectIds: expandedProjectIds.filter((projectId) =>
        projectId !== project.id && nextProjects.some((item) => item.id === projectId),
      ),
      expandedProbeProjectIds: expandedProbeProjectIds.filter((projectId) => projectId !== project.id),
      sidebarPanel: 'terminals',
    })
    setNotice(`Deleted project: ${project.name}`)
  }

  const selectProject = (project: Project) => {
    setActiveProjectId(project.id)
    setExpandedProjectIds((current) => [...new Set([...current, project.id])])
    setActiveTerminalId(project.terminalIds[0] ?? null)
    setNotice(`Switched project: ${project.name}`)
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
    setNotice(`Switched to terminal: ${terminal.name}`)
  }

  const copyLaunchCommand = async (terminal: TerminalModel) => {
    const projectPath = projects.find((project) => project.id === terminal.projectId)?.path
    const command = visibleLaunchCommand(terminal, projectPath)
    if (!command) {
      setNotice('No launch command is available for this terminal.')
      return
    }
    try {
      if (window.terminalHost?.writeClipboardText) {
        window.terminalHost.writeClipboardText(command)
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command)
      } else {
        throw new Error('Clipboard write API is unavailable.')
      }
      setNotice(`Launch command copied from ${terminal.name}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setNotice(`Failed to copy launch command: ${message}`)
    }
  }

  const renderProjectPanel = () => {
    const activeInspection = inspection?.cwd === activeProject.path ? inspection : null

    if (sidebarPanel === 'terminals') {
      if (!activeTerminals.length) {
        return <PanelEmpty title={activeProject.name} text="Click Add Terminal to create a real interactive shell." />
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
            onFocus={() => setActiveTerminalId(terminal.id)}
            onResize={(cols, rows) => window.terminalHost?.resize({ id: terminal.id, cols, rows })}
            onInput={(data) => {
              const shouldWriteToPty = !isRememberCommandEvent(data)
              setTerminals((current) => {
                const currentTerminal = current[terminal.id]
                if (!currentTerminal) return current
                return {
                  ...current,
                  [terminal.id]: updateInputState(currentTerminal, data, activeProject.path),
                }
              })
              if (shouldWriteToPty) window.terminalHost?.write({ id: terminal.id, data })
            }}
          />
        </TerminalCard>
      ))
    }

    if (!activeProject.path) return <PanelEmpty title="No Project Path" text="Set a real project path for the current project first." />
    if (isInspecting) return <PanelEmpty title="Scanning" text={activeProject.path} />
    if (inspectionError) return <PanelEmpty title="Scan Failed" text={inspectionError} />
    if (!activeInspection) return <PanelEmpty title="Not Scanned" text="No scan result is available for the current project." />

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
      ) : <PanelEmpty title="No Services Found" text="No package.json, pyproject, or Docker Compose service entry was found." />
    }

    if (sidebarPanel === 'env') {
      return activeInspection.environment.length ? (
        <div className="resourceGrid">
          {activeInspection.environment.map((entry) => (
            <ResourceItem
              key={`${entry.source}-${entry.key}`}
              title={entry.key}
              meta={formatResourceMeta(entry)}
              value={entry.masked ? 'Sensitive value hidden' : entry.value}
            />
          ))}
        </div>
      ) : <PanelEmpty title="No Environment Files" text="No .env, .env.local, or .env.* files were found." />
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
      ) : <PanelEmpty title="No Tasks Found" text="No workflows, Taskfile, justfile, Makefile, or build-system entry was found." />
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
      ) : <PanelEmpty title="No Notes Found" text="No markdown files were found." />
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
              aria-label="Project name"
              onChange={(change) => renameProject(activeProject.id, change.target.value)}
            />
            <input
              className="brandPathInput"
              value={activeProject.path}
              aria-label="Project path"
              placeholder="No path connected"
              onChange={(change) => renameProjectPath(activeProject.id, change.target.value)}
            />
          </div>
        </div>

        <div className="sidebarScroll">
          <div className="sidebarSection">Projects</div>
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
                      aria-label={`Delete project ${project.name}`}
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
                          setNotice('Showing terminal list.')
                        }}
                      >
                        <TerminalSquare size={17} />
                        <span>Terminals</span>
                      </button>
                      {projectTerminals.map((terminal, index) => (
                        <button
                          key={terminal.id}
                          type="button"
                          className={`terminalTreeItem ${terminal.id === activeTerminal?.id ? 'selected' : ''}`}
                          onClick={() => selectRecentTerminal(terminal)}
                        >
                          <TerminalSquare size={15} />
                          <span>{terminal.name || `Terminal ${index + 1}`}</span>
                          <i className={`dot ${terminalIndicatorStatus(terminal)}`} />
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`treeItem probeRoot ${isProbeExpanded ? 'expanded' : ''}`}
                        onClick={() => {
                          selectProject(project)
                          toggleProjectProbe(project.id)
                          setNotice(isProbeExpanded ? 'Collapsed project inspection.' : 'Expanded project inspection.')
                        }}
                      >
                        {isProbeExpanded ? <ChevronDown size={17} /> : <ChevronsRight size={17} />}
                        <span>Project Inspector</span>
                      </button>
                      {isProbeExpanded ? (
                        <>
                          <button type="button" className={`probeItem ${isActiveProject && sidebarPanel === 'services' ? 'selected' : ''}`} onClick={() => { selectProject(project); setSidebarPanel('services'); setNotice('Showing service inspection results.') }}>
                            <Server size={16} />
                            <span>Services</span>
                          </button>
                          <button type="button" className={`probeItem ${isActiveProject && sidebarPanel === 'env' ? 'selected' : ''}`} onClick={() => { selectProject(project); setSidebarPanel('env'); setNotice('Showing environment inspection results.') }}>
                            <Settings size={16} />
                            <span>Environment</span>
                          </button>
                          <button type="button" className={`probeItem ${isActiveProject && sidebarPanel === 'tasks' ? 'selected' : ''}`} onClick={() => { selectProject(project); setSidebarPanel('tasks'); setNotice('Showing task inspection results.') }}>
                            <ChevronsRight size={16} />
                            <span>Tasks</span>
                          </button>
                          <button type="button" className={`probeItem ${isActiveProject && sidebarPanel === 'notes' ? 'selected' : ''}`} onClick={() => { selectProject(project); setSidebarPanel('notes'); setNotice('Showing note inspection results.') }}>
                            <List size={16} />
                            <span>Notes</span>
                          </button>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
              )
            })}
          </nav>
          <div className="sidebarSection">Recent Terminals</div>
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
                <i className={`dot ${terminalIndicatorStatus(terminal)}`} />
              </button>
            )) : <p className="sidebarHint">No real terminals yet.</p>}
          </div>
        </div>
        <div className="sidebarFooter">
          <button type="button" aria-label="New project" onClick={createProject}><Plus size={18} /></button>
          <button type="button" aria-label="Filter" onClick={() => setNotice('Filters apply only to the real terminal list.')}><Filter size={18} /></button>
        </div>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <button type="button" className="toolbarButton" onClick={createProject}>
            <Plus size={17} />
            New Project
            <ChevronDown size={14} />
          </button>
          <button type="button" className="toolbarButton" onClick={addTerminal}>
            <Plus size={17} />
            Add Terminal
            <ChevronDown size={14} />
          </button>
          <div className="viewSwitcher" aria-label="View switcher">
            <button type="button" className={viewMode === 'grid' ? 'selected' : ''} onClick={() => { setViewMode('grid'); setNotice('Switched to grid view.') }}><Grid3X3 size={16} /></button>
            <button type="button" className={viewMode === 'list' ? 'selected' : ''} onClick={() => { setViewMode('list'); setNotice('Switched to list view.') }}><List size={16} /></button>
            <button type="button" className={viewMode === 'split' ? 'selected' : ''} onClick={() => { setViewMode('split'); setNotice('Switched to split view.') }}><Grid3X3 size={16} /></button>
          </div>
          <button type="button" className="searchBox" onClick={() => setNotice('Search will use real terminal names, directories, and PIDs.')}>
            <Search size={16} />
            <span>Search terminals...</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="toolbarIcons">
            <button type="button" aria-label="Notifications" onClick={() => setNotice('No runtime notifications.')}><Bell size={18} /></button>
            <button type="button" aria-label="Settings" onClick={() => setDetailTab('settings')}><Settings size={18} /></button>
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
              <span className={`dot ${terminalIndicatorStatus(terminal)}`} />
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
              <span className={`dot ${terminalIndicatorStatus(activeTerminal)}`} />
              <div>
                <strong>{activeTerminal.name}</strong>
                <span>{activeTerminal.role}</span>
              </div>
              <button type="button" className="detailIcon" onClick={() => setNotice('Details panel remains expanded.')}><ChevronsRight size={17} /></button>
              <button type="button" className="detailIcon" onClick={() => setActiveTerminalId(null)}><X size={17} /></button>
            </div>
            <div className="detailTabs">
              <button type="button" className={detailTab === 'details' ? 'selected' : ''} onClick={() => setDetailTab('details')}>Details</button>
              <button type="button" className={detailTab === 'settings' ? 'selected' : ''} onClick={() => setDetailTab('settings')}>Settings</button>
            </div>
            {detailTab === 'details' ? (
            <>
            <section className="detailSection">
              <h2>Status</h2>
              <dl className="detailTable">
                <div>
                  <dt>Status</dt>
                  <dd className={terminalIndicatorStatus(activeTerminal) === 'running' ? 'greenText' : activeTerminal.status === 'failed' ? 'redText' : ''}>
                    {terminalStatusLabel(activeTerminal)}
                  </dd>
                </div>
                <div><dt>PID</dt><dd>{activeTerminal.pid ?? '-'}</dd></div>
                <div><dt>Uptime</dt><dd>{formatUptime(activeTerminal.createdAt, activeTerminal.status)}</dd></div>
                <div><dt>Started</dt><dd>{formatDateTime(activeTerminal.createdAt)}</dd></div>
                <div><dt>Exit Code</dt><dd>{activeTerminal.exitCode ?? '-'}</dd></div>
              </dl>
            </section>
            <section className="detailSection">
              <h2>Process</h2>
              <dl className="detailTable">
                <div>
                  <dt>Launch Command</dt>
                  <dd className="detailValueWithAction">
                    <span>{visibleLaunchCommand(activeTerminal, activeProject.path) || '-'}</span>
                    <button
                      type="button"
                      className="inlineCopyButton"
                      aria-label="Copy launch command"
                      disabled={!visibleLaunchCommand(activeTerminal, activeProject.path)}
                      onClick={() => copyLaunchCommand(activeTerminal)}
                    >
                      <Copy size={13} />
                    </button>
                  </dd>
                </div>
                <div><dt>Shell</dt><dd>{activeTerminal.shell || '-'}</dd></div>
                <div><dt>Directory</dt><dd>{activeTerminal.cwd}</dd></div>
              </dl>
              <button
                type="button"
                className="showAll"
                disabled={!visibleLaunchCommand(activeTerminal, activeProject.path)}
                onClick={() => rerunTerminal(activeTerminal)}
              >
                Rerun Last Command
              </button>
            </section>
            <section className="detailSection">
              <h2>Recent Events</h2>
              <div className="eventTimeline">
                {activeTerminal.eventLog.map((event, index) => (
                  <div key={`${event.message}-${index}`}>
                    <time>{formatTime(event.time)}</time>
                    <i className={activeTerminal.status === 'failed' ? 'red' : terminalIndicatorStatus(activeTerminal) === 'running' ? '' : 'yellow'} />
                    <span>{event.message}</span>
                  </div>
                ))}
              </div>
              <button type="button" className="historyLink" onClick={() => setNotice('Full history requires a persistent event store.')}>View Full History <ChevronsRight size={14} /></button>
            </section>
            </>
            ) : (
              <section className="detailSection">
                <h2>Terminal Settings</h2>
                <dl className="detailTable">
                  <div>
                    <dt>Name</dt>
                    <dd>
                      <input
                        className="detailInput"
                        value={activeTerminal.name}
                        aria-label="Terminal name"
                        onChange={(change) => renameTerminal(activeTerminal.id, change.target.value)}
                      />
                    </dd>
                  </div>
                  <div><dt>Shell</dt><dd>{activeTerminal.shell || 'Not started'}</dd></div>
                  <div><dt>Directory</dt><dd>{activeTerminal.cwd || '-'}</dd></div>
                </dl>
                <button type="button" className="showAll" onClick={() => stopTerminal(activeTerminal.id)} disabled={activeTerminal.status !== 'running'}>Stop Process</button>
              </section>
            )}
          </>
        ) : (
          <div className="detailsEmpty">
            <Play size={28} />
            <p>Select or create a terminal to view process, directory, status, and events.</p>
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
        <span className={`dot ${terminalIndicatorStatus(terminal)}`} />
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
        aria-label={`Resize ${terminal.name} height`}
        onPointerDown={startResize}
      />
    </article>
  )
}

function TerminalPane({
  terminal,
  onFocus,
  onInput,
  onResize,
}: {
  terminal: TerminalModel
  onFocus: () => void
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

  return (
    <div
      ref={containerRef}
      className="xtermHost"
      onMouseDown={() => {
        onFocus()
        termRef.current?.focus()
      }}
    />
  )
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
