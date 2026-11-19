/**
 * Agent-selection persistence owned by the Console itself.
 *
 * This module must not depend on an optional plugin backend: uninstalling a
 * voice/theme plugin cannot disable the host's agent-selection behaviour.
 */
const LAST_USED_AGENT_KEY = "qwenpaw-last-used-agent";

/** Restore the locally persisted agent, if the store is ready to accept it. */
export async function loadClientConfig(): Promise<void> {
  try {
    const agentId = localStorage.getItem(LAST_USED_AGENT_KEY);
    if (agentId) {
      const { useAgentStore } = await import("../stores/agentStore");
      useAgentStore.getState().setSelectedAgent(agentId);
    }
  } catch {
    /* Storage or store is not ready; the normal selection flow still works. */
  }
}

/** Persist one Console-owned key locally; no plugin service is required. */
export async function saveClientConfig(
  key: string,
  value: string,
): Promise<void> {
  if (key !== LAST_USED_AGENT_KEY) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage can be unavailable in hardened webviews; selection is in-memory. */
  }
}
