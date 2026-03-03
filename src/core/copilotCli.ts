export interface CopilotCliMcpPayload {
  mcpServers?: Record<string, unknown>
  [key: string]: unknown
}

export function normalizeCopilotCliMcpPayload(payload: CopilotCliMcpPayload): CopilotCliMcpPayload {
  return {
    ...payload,
    mcpServers: isRecord(payload.mcpServers) ? payload.mcpServers : {}
  }
}

export function renderCopilotCliWrapperScript(): string {
  return [
    '#!/bin/sh',
    'set -eu',
    '',
    'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"',
    'PROJECT_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)"',
    'PROJECT_MCP_CONFIG="${PROJECT_ROOT}/.copilot/mcp-config.json"',
    '',
    'PATH_WITHOUT_WRAPPER=""',
    'OLD_IFS="$IFS"',
    "IFS=':'",
    'for ENTRY in ${PATH:-}; do',
    '  ENTRY_CANON="${ENTRY}"',
    '  if [ -d "$ENTRY" ]; then',
    '    ENTRY_CANON="$(CDPATH= cd -- "$ENTRY" 2>/dev/null && pwd -P || printf \'%s\' "$ENTRY")"',
    '  fi',
    '  if [ "$ENTRY_CANON" = "$SCRIPT_DIR" ] || [ "${ENTRY%/}" = "$SCRIPT_DIR" ]; then',
    '    continue',
    '  fi',
    '  if [ -z "$PATH_WITHOUT_WRAPPER" ]; then',
    '    PATH_WITHOUT_WRAPPER="$ENTRY"',
    '  else',
    '    PATH_WITHOUT_WRAPPER="${PATH_WITHOUT_WRAPPER}:$ENTRY"',
    '  fi',
    'done',
    'IFS="$OLD_IFS"',
    '',
    'if [ -z "$PATH_WITHOUT_WRAPPER" ]; then',
    '  echo "agents: failed to locate copilot outside ${SCRIPT_DIR}" >&2',
    '  exit 127',
    'fi',
    '',
    'HAS_ADDITIONAL_MCP_CONFIG=0',
    'for ARG in "$@"; do',
    '  case "$ARG" in',
    '    --additional-mcp-config|--additional-mcp-config=*)',
    '      HAS_ADDITIONAL_MCP_CONFIG=1',
    '      break',
    '      ;;',
    '  esac',
    'done',
    '',
    'if [ -f "$PROJECT_MCP_CONFIG" ] && [ "$HAS_ADDITIONAL_MCP_CONFIG" -eq 0 ]; then',
    '  PATH="$PATH_WITHOUT_WRAPPER" exec copilot --additional-mcp-config="@${PROJECT_MCP_CONFIG}" "$@"',
    'fi',
    '',
    'PATH="$PATH_WITHOUT_WRAPPER" exec copilot "$@"',
    ''
  ].join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
