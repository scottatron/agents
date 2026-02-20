import { validateServerName } from '../core/mcpValidation.js'
import { removeMcpServer } from '../core/mcpCrud.js'
import { performSync } from '../core/sync.js'
import { formatWarnings } from '../core/warnings.js'
import * as ui from '../core/ui.js'

export interface McpRemoveOptions {
  projectRoot: string
  name: string
  ignoreMissing: boolean
  noSync: boolean
  global: boolean
}

export async function runMcpRemove(options: McpRemoveOptions): Promise<void> {
  validateServerName(options.name)

  const spin = ui.spinner()
  spin.start(`Removing MCP server "${options.name}"...`)

  const removed = await removeMcpServer({
    projectRoot: options.global ? undefined : options.projectRoot,
    name: options.name,
    ignoreMissing: options.ignoreMissing,
    global: options.global
  })

  if (!removed) {
    spin.stop('Done')
    ui.info(`MCP server "${options.name}" not found (ignored)`)
    return
  }

  const warnings: string[] = []
  if (!options.noSync && !options.global) {
    const sync = await performSync({
      projectRoot: options.projectRoot,
      check: false,
      verbose: false
    })
    warnings.push(...sync.warnings)
  }

  spin.stop('Done')

  ui.success(`Removed MCP server: ${options.name}`)

  if (options.global) {
    ui.dim('Global server — sync skipped (takes effect on next per-project sync)')
  } else if (options.noSync) {
    ui.dim('Skipped sync (--no-sync)')
  }

  const warningBlock = formatWarnings(warnings, 4)
  if (warningBlock) {
    ui.blank()
    for (const line of warningBlock.split('\n').filter(Boolean)) {
      if (line.startsWith('- ')) {
        ui.warning(line.slice(2))
      }
    }
  }
}
