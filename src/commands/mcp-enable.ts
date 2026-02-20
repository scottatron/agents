import { validateServerName } from '../core/mcpValidation.js'
import { setMcpServerEnabled } from '../core/mcpCrud.js'
import { performSync } from '../core/sync.js'
import { formatWarnings } from '../core/warnings.js'
import * as ui from '../core/ui.js'

export interface McpEnableOptions {
  projectRoot: string
  name: string
  enabled: boolean
  noSync: boolean
  global: boolean
}

export async function runMcpEnable(options: McpEnableOptions): Promise<void> {
  validateServerName(options.name)

  const verb = options.enabled ? 'Enabling' : 'Disabling'
  const past = options.enabled ? 'Enabled' : 'Disabled'

  const spin = ui.spinner()
  spin.start(`${verb} MCP server "${options.name}"...`)

  await setMcpServerEnabled({
    projectRoot: options.global ? undefined : options.projectRoot,
    name: options.name,
    enabled: options.enabled,
    global: options.global
  })

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

  ui.success(`${past} MCP server: ${options.name}`)

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
