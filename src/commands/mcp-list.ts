import path from 'node:path'
import { listMcpEntries, loadMcpState } from '../core/mcpCrud.js'
import * as ui from '../core/ui.js'

export interface McpListOptions {
  projectRoot: string
  json: boolean
}

export async function runMcpList(options: McpListOptions): Promise<void> {
  ui.setContext({ json: options.json })

  const state = await loadMcpState(options.projectRoot)
  const entries = listMcpEntries(state)

  const payload = {
    projectRoot: path.resolve(options.projectRoot),
    count: entries.length,
    servers: entries.map((entry) => ({
      name: entry.name,
      transport: entry.server.transport,
      enabled: entry.server.enabled !== false,
      targets: entry.server.targets ?? [],
      hasLocalOverride: entry.hasLocalOverride,
      hasProjectOverride: entry.hasProjectOverride,
      globalEnabled: entry.globalServer ? entry.globalServer.enabled !== false : null,
      description: entry.server.description ?? null,
      origin: entry.origin
    }))
  }

  if (options.json) {
    ui.json(payload)
    return
  }

  ui.keyValue('Project', payload.projectRoot)
  ui.keyValue('MCP servers', String(payload.count))

  if (payload.count === 0) {
    ui.blank()
    ui.dim('No MCP servers configured.')
    return
  }

  ui.blank()
  for (const server of payload.servers) {
    const targets = server.targets.length > 0 ? server.targets.join(', ') : 'all'
    const parts: string[] = []

    // Transport type
    if (server.transport) parts.push(server.transport)

    // Targets
    parts.push(`targets: ${targets}`)

    // Origin + status
    if (server.origin === 'global') {
      const globalStatus = `global: ${server.globalEnabled ? 'enabled' : 'disabled'}`
      if (server.hasProjectOverride) {
        parts.push(`${globalStatus} (project: ${server.enabled ? 'enabled' : 'disabled'})`)
      } else {
        parts.push(globalStatus)
      }
    } else {
      parts.push(server.origin)
      if (!server.enabled) {
        parts.push('disabled')
      }
    }
    if (server.hasLocalOverride) {
      parts.push('local override')
    }

    const statusSymbol = server.enabled ? ui.symbols.success : ui.symbols.info
    const statusColor = server.enabled
      ? ui.color.green(statusSymbol)
      : ui.color.dim(statusSymbol)

    ui.writeln(`  ${statusColor} ${server.name}  ${ui.color.dim(parts.join(' | '))}`)
  }
}
