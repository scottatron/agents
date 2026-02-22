import os from 'node:os'
import path from 'node:path'

export interface CopilotCliMcpPayload {
  mcpServers?: Record<string, unknown>
  [key: string]: unknown
}

export function getCopilotCliGlobalMcpPath(): string {
  const override = process.env.AGENTS_COPILOT_CLI_MCP_PATH
  if (override && override.trim().length > 0) {
    return path.resolve(override)
  }

  return path.join(os.homedir(), '.copilot', 'mcp-config.json')
}

export function normalizeCopilotCliMcpPayload(payload: CopilotCliMcpPayload): CopilotCliMcpPayload {
  return {
    ...payload,
    mcpServers: isRecord(payload.mcpServers) ? payload.mcpServers : {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
