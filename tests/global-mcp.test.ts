import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDefaultAgentsConfig, loadGlobalConfig, saveAgentsConfig, saveGlobalConfig } from '../src/core/config.js'
import { listMcpEntries, loadMcpState, removeMcpServer, upsertMcpServers } from '../src/core/mcpCrud.js'
import { resolveFromConfigAndLocal } from '../src/core/mcp.js'
import { pathExists } from '../src/core/fs.js'
import { getGlobalConfigPath } from '../src/core/paths.js'
import type { GlobalMcpConfig, McpServerDefinition } from '../src/types.js'

const tempDirs: string[] = []
let originalGlobalConfig: string | undefined

beforeEach(() => {
  originalGlobalConfig = process.env.AGENTS_GLOBAL_CONFIG
})

afterEach(async () => {
  if (originalGlobalConfig === undefined) {
    delete process.env.AGENTS_GLOBAL_CONFIG
  } else {
    process.env.AGENTS_GLOBAL_CONFIG = originalGlobalConfig
  }
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'agents-global-'))
}

async function setupProject(): Promise<string> {
  const projectRoot = await makeTempDir()
  tempDirs.push(projectRoot)
  process.env.AGENTS_GLOBAL_CONFIG = path.join(projectRoot, '.agents', 'global.json')
  await saveAgentsConfig(projectRoot, createDefaultAgentsConfig({ mcpServers: {} }))
  await writeFile(path.join(projectRoot, '.agents', 'local.json'), JSON.stringify({ mcpServers: {} }, null, 2))
  return projectRoot
}

describe('loadGlobalConfig', () => {
  it('returns empty mcpServers when file does not exist', async () => {
    const tmpDir = await makeTempDir()
    tempDirs.push(tmpDir)
    process.env.AGENTS_GLOBAL_CONFIG = path.join(tmpDir, 'nonexistent', 'global.json')
    const config = await loadGlobalConfig()
    expect(config).toEqual({ mcpServers: {} })
  })

  it('loads servers from existing file', async () => {
    const tmpDir = await makeTempDir()
    tempDirs.push(tmpDir)
    const globalPath = path.join(tmpDir, 'global.json')
    process.env.AGENTS_GLOBAL_CONFIG = globalPath
    const data: GlobalMcpConfig = {
      mcpServers: {
        myserver: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'my-mcp-server']
        }
      }
    }
    await writeFile(globalPath, JSON.stringify(data, null, 2))
    const config = await loadGlobalConfig()
    expect(config.mcpServers.myserver).toBeDefined()
    expect(config.mcpServers.myserver.command).toBe('npx')
  })
})

describe('saveGlobalConfig', () => {
  it('creates file and parent directory', async () => {
    const tmpDir = await makeTempDir()
    tempDirs.push(tmpDir)
    const globalPath = path.join(tmpDir, 'nested', 'dir', 'global.json')
    process.env.AGENTS_GLOBAL_CONFIG = globalPath

    await saveGlobalConfig({
      mcpServers: {
        test: { transport: 'stdio', command: 'echo' }
      }
    })

    expect(await pathExists(globalPath)).toBe(true)
    const loaded = await loadGlobalConfig()
    expect(loaded.mcpServers.test.command).toBe('echo')
  })
})

describe('getGlobalConfigPath', () => {
  it('uses AGENTS_GLOBAL_CONFIG env var when set', () => {
    process.env.AGENTS_GLOBAL_CONFIG = '/custom/path/global.json'
    expect(getGlobalConfigPath()).toBe('/custom/path/global.json')
  })

  it('defaults to ~/.agents/global.json', () => {
    delete process.env.AGENTS_GLOBAL_CONFIG
    expect(getGlobalConfigPath()).toBe(path.join(os.homedir(), '.agents', 'global.json'))
  })
})

describe('three-way merge', () => {
  it('global + project override + local override produces correct result', () => {
    const result = resolveFromConfigAndLocal({
      projectRoot: '/tmp/test',
      globalServers: {
        myserver: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'my-server'],
          targets: ['claude', 'cursor'],
          enabled: true
        }
      },
      servers: {
        myserver: {
          targets: ['claude']
        } as McpServerDefinition
      },
      local: {
        mcpServers: {
          myserver: {
            env: { API_KEY: 'secret' }
          }
        }
      }
    })

    expect(result.selectedServerNames).toContain('myserver')
    const claudeServers = result.serversByTarget.claude
    const server = claudeServers.find((s) => s.name === 'myserver')
    expect(server).toBeDefined()
    expect(server!.command).toBe('npx')
    expect(server!.env).toEqual({ API_KEY: 'secret' })

    // Project narrowed targets to only 'claude', so cursor should NOT have it
    const cursorServers = result.serversByTarget.cursor
    expect(cursorServers.find((s) => s.name === 'myserver')).toBeUndefined()
  })

  it('global-only server appears in resolved registry', () => {
    const result = resolveFromConfigAndLocal({
      projectRoot: '/tmp/test',
      globalServers: {
        globalonly: {
          transport: 'http',
          url: 'https://example.com/mcp'
        }
      },
      servers: {},
      local: { mcpServers: {} }
    })

    expect(result.selectedServerNames).toContain('globalonly')
  })

  it('project { enabled: false } disables a global server', () => {
    const result = resolveFromConfigAndLocal({
      projectRoot: '/tmp/test',
      globalServers: {
        myserver: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'my-server'],
          enabled: true
        }
      },
      servers: {
        myserver: {
          enabled: false
        } as McpServerDefinition
      },
      local: { mcpServers: {} }
    })

    expect(result.selectedServerNames).not.toContain('myserver')
  })

  it('global server with enabled: false is opt-in', () => {
    const result = resolveFromConfigAndLocal({
      projectRoot: '/tmp/test',
      globalServers: {
        optinserver: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'my-server'],
          enabled: false
        }
      },
      servers: {},
      local: { mcpServers: {} }
    })

    expect(result.selectedServerNames).not.toContain('optinserver')
  })

  it('project can opt-in a globally disabled server', () => {
    const result = resolveFromConfigAndLocal({
      projectRoot: '/tmp/test',
      globalServers: {
        optinserver: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'my-server'],
          enabled: false
        }
      },
      servers: {
        optinserver: {
          enabled: true
        } as McpServerDefinition
      },
      local: { mcpServers: {} }
    })

    expect(result.selectedServerNames).toContain('optinserver')
  })
})

describe('listMcpEntries with global', () => {
  it('shows correct origin for global-only vs project-only servers', async () => {
    const projectRoot = await setupProject()

    // Write a global config with a server
    await saveGlobalConfig({
      mcpServers: {
        globalserver: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'global-mcp']
        }
      }
    })

    // Add a project-only server
    await upsertMcpServers({
      projectRoot,
      updates: [{
        name: 'projectserver',
        server: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'project-mcp']
        }
      }],
      replace: false
    })

    const state = await loadMcpState(projectRoot)
    const entries = listMcpEntries(state)

    const globalEntry = entries.find((e) => e.name === 'globalserver')
    expect(globalEntry).toBeDefined()
    expect(globalEntry!.origin).toBe('global')

    const projectEntry = entries.find((e) => e.name === 'projectserver')
    expect(projectEntry).toBeDefined()
    expect(projectEntry!.origin).toBe('project')
  })
})

describe('upsertMcpServers with global', () => {
  it('writes to global config file when global: true', async () => {
    const tmpDir = await makeTempDir()
    tempDirs.push(tmpDir)
    process.env.AGENTS_GLOBAL_CONFIG = path.join(tmpDir, 'global.json')

    const result = await upsertMcpServers({
      updates: [{
        name: 'newglobal',
        server: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'new-global-mcp']
        }
      }],
      replace: false,
      global: true
    })

    expect(result.created).toContain('newglobal')
    const config = await loadGlobalConfig()
    expect(config.mcpServers.newglobal).toBeDefined()
    expect(config.mcpServers.newglobal.command).toBe('npx')
  })

  it('rejects duplicate in global config without replace', async () => {
    const tmpDir = await makeTempDir()
    tempDirs.push(tmpDir)
    process.env.AGENTS_GLOBAL_CONFIG = path.join(tmpDir, 'global.json')

    await upsertMcpServers({
      updates: [{
        name: 'dupserver',
        server: { transport: 'stdio', command: 'npx' }
      }],
      replace: false,
      global: true
    })

    await expect(
      upsertMcpServers({
        updates: [{
          name: 'dupserver',
          server: { transport: 'stdio', command: 'echo' }
        }],
        replace: false,
        global: true
      })
    ).rejects.toThrow(/already exists/)
  })
})

describe('removeMcpServer with global', () => {
  it('removes from global config file when global: true', async () => {
    const tmpDir = await makeTempDir()
    tempDirs.push(tmpDir)
    process.env.AGENTS_GLOBAL_CONFIG = path.join(tmpDir, 'global.json')

    await saveGlobalConfig({
      mcpServers: {
        toremove: { transport: 'stdio', command: 'npx' }
      }
    })

    const removed = await removeMcpServer({
      name: 'toremove',
      ignoreMissing: false,
      global: true
    })

    expect(removed).toBe(true)
    const config = await loadGlobalConfig()
    expect(config.mcpServers.toremove).toBeUndefined()
  })

  it('throws for missing server in global config', async () => {
    const tmpDir = await makeTempDir()
    tempDirs.push(tmpDir)
    process.env.AGENTS_GLOBAL_CONFIG = path.join(tmpDir, 'global.json')

    await expect(
      removeMcpServer({
        name: 'nonexistent',
        ignoreMissing: false,
        global: true
      })
    ).rejects.toThrow(/does not exist/)
  })

  it('returns false for missing server with ignoreMissing in global config', async () => {
    const tmpDir = await makeTempDir()
    tempDirs.push(tmpDir)
    process.env.AGENTS_GLOBAL_CONFIG = path.join(tmpDir, 'global.json')

    const removed = await removeMcpServer({
      name: 'nonexistent',
      ignoreMissing: true,
      global: true
    })

    expect(removed).toBe(false)
  })
})
