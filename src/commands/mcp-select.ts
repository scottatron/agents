import * as clack from '@clack/prompts'
import color from 'picocolors'
import { loadAgentsConfig, saveAgentsConfig } from '../core/config.js'
import { loadMcpState, listMcpEntries } from '../core/mcpCrud.js'
import { performSync } from '../core/sync.js'
import type { McpServerDefinition } from '../types.js'

export interface McpSelectOptions {
  projectRoot: string
  noSync: boolean
}

export async function runMcpSelect(options: McpSelectOptions): Promise<void> {
  const state = await loadMcpState(options.projectRoot)
  const allEntries = listMcpEntries(state)
  const globalEntries = allEntries.filter((e) => e.origin === 'global')

  if (globalEntries.length === 0) {
    process.stdout.write('No global MCP servers configured. Add one with: agents mcp add --global <name>\n')
    return
  }

  clack.intro(color.cyan('agents mcp select'))

  const value = await clack.multiselect({
    message: 'Choose global MCP servers to enable for this project',
    required: false,
    options: globalEntries.map((entry) => {
      const transport = entry.server.transport ?? 'stdio'
      const detail = transport === 'stdio' ? entry.server.command ?? '' : entry.server.url ?? ''
      return {
        value: entry.name,
        label: entry.server.label ?? entry.name,
        hint: detail ? `${transport} · ${detail}` : transport
      }
    }),
    initialValues: globalEntries
      .filter((entry) => entry.server.enabled !== false)
      .map((entry) => entry.name)
  })

  if (clack.isCancel(value)) {
    clack.cancel('Selection canceled.')
    process.exit(1)
  }

  const selectedNames = (value as string[]) ?? []

  // Build overrides: only write when selection differs from what global provides
  const overrides: Record<string, Partial<McpServerDefinition>> = {}
  for (const entry of globalEntries) {
    const selected = selectedNames.includes(entry.name)
    const globallyEnabled = entry.globalServer?.enabled !== false
    if (selected && !globallyEnabled) {
      overrides[entry.name] = { enabled: true }
    } else if (!selected && globallyEnabled) {
      overrides[entry.name] = { enabled: false }
    }
  }

  // Load fresh config and reconcile: apply new overrides, remove stale ones
  const config = await loadAgentsConfig(options.projectRoot)
  let changed = false

  for (const entry of globalEntries) {
    const override = overrides[entry.name]
    if (override) {
      config.mcp.servers[entry.name] = { ...config.mcp.servers[entry.name], ...override }
      changed = true
    } else if (config.mcp.servers[entry.name]) {
      // Selection matches global default — remove any stale project override
      delete config.mcp.servers[entry.name]
      changed = true
    }
  }

  if (changed) {
    await saveAgentsConfig(options.projectRoot, config)
  }

  if (!options.noSync) {
    await performSync({ projectRoot: options.projectRoot, check: false, verbose: false })
  }

  const enabledCount = selectedNames.length
  const disabledCount = globalEntries.length - enabledCount

  clack.outro(
    `Global MCP servers: ${String(enabledCount)} enabled, ${String(disabledCount)} disabled`
  )
}
