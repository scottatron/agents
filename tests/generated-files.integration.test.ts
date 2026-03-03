import os from 'node:os'
import path from 'node:path'
import { lstat, mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { getProjectPaths } from '../src/core/paths.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch {
    return false
  }
}

describe('generated integration files', () => {
  it('keeps generated files only for enabled integrations and removes stale ones', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-generated-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const paths = getProjectPaths(projectRoot)

    const initialConfig = await loadAgentsConfig(projectRoot)
    initialConfig.integrations.enabled = ['codex', 'gemini']
    await saveAgentsConfig(projectRoot, initialConfig)

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    expect(await exists(paths.generatedCodex)).toBe(true)
    expect(await exists(paths.generatedGemini)).toBe(true)
    expect(await exists(paths.generatedCursor)).toBe(false)

    const updatedConfig = await loadAgentsConfig(projectRoot)
    updatedConfig.integrations.enabled = ['codex']
    await saveAgentsConfig(projectRoot, updatedConfig)

    const changed = await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    expect(changed.changed).toContain('.agents/generated/gemini.settings.json')
    expect(await exists(paths.generatedCodex)).toBe(true)
    expect(await exists(paths.generatedGemini)).toBe(false)

    const check = await performSync({
      projectRoot,
      check: true,
      verbose: false
    })
    expect(check.changed).toHaveLength(0)
  }, 15000)
})
