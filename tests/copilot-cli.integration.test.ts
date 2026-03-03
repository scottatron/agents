import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []
let previousPathEnv: string | undefined

beforeEach(() => {
  previousPathEnv = process.env.PATH
})

afterEach(async () => {
  if (previousPathEnv === undefined) {
    delete process.env.PATH
  } else {
    process.env.PATH = previousPathEnv
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('copilot CLI sync wrapper', () => {
  it('materializes project config and injects --additional-mcp-config when project config exists', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-copilot-cli-'))
    const binDir = await mkdtemp(path.join(os.tmpdir(), 'agents-copilot-cli-bin-'))
    const callLogPath = path.join(binDir, 'copilot-calls.log')
    tempDirs.push(projectRoot, binDir)

    await runInit({ projectRoot, force: true })

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['copilot_cli']
    await saveAgentsConfig(projectRoot, config)

    await writeCopilotBinary(path.join(binDir, 'copilot'), callLogPath)
    process.env.PATH = `${path.join(projectRoot, '.agents', 'bin')}:${binDir}:${previousPathEnv ?? ''}`

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    const copilotProjectConfig = path.join(projectRoot, '.copilot', 'mcp-config.json')
    const parsedConfig = JSON.parse(await readFile(copilotProjectConfig, 'utf8')) as { mcpServers?: Record<string, unknown> }
    expect(Object.keys(parsedConfig.mcpServers ?? {})).toContain('filesystem')

    const wrapperPath = path.join(projectRoot, '.agents', 'bin', 'copilot')
    const wrapperInfo = await lstat(wrapperPath)
    expect(wrapperInfo.isFile()).toBe(true)
    expect(wrapperInfo.mode & 0o111).toBeGreaterThan(0)

    const firstRun = spawnSync('copilot', ['chat', '--mode', 'default'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: process.env
    })
    expect(firstRun.status).toBe(0)

    const callsAfterFirstRun = (await readFile(callLogPath, 'utf8'))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const firstCall = callsAfterFirstRun.at(-1) ?? ''
    expect(firstCall).toContain('--additional-mcp-config=@')
    expect(firstCall).toContain(`${path.basename(projectRoot)}/.copilot/mcp-config.json`)
    expect(firstCall).toContain('chat --mode default')

    await rm(copilotProjectConfig, { force: true })

    const secondRun = spawnSync('copilot', ['status'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: process.env
    })
    expect(secondRun.status).toBe(0)

    const callsAfterSecondRun = (await readFile(callLogPath, 'utf8'))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const secondCall = callsAfterSecondRun.at(-1) ?? ''
    expect(secondCall).toBe('status')
    expect(secondCall).not.toContain('--additional-mcp-config')
  }, 15000)
})

async function writeCopilotBinary(filePath: string, callLogPath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const script = [
    '#!/bin/sh',
    `echo "$@" >> "${callLogPath}"`,
    'exit 0'
  ].join('\n')
  await writeFile(filePath, `${script}\n`, 'utf8')
  await chmod(filePath, 0o755)
}
