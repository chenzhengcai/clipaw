/**
 * REPRO: user-reported conversation loss.
 *
 * Scenario (exact user flow):
 *   1. Chat with agent A in a NEW conversation; send a task.
 *      (POST succeeds -> backend creates the chat; reply still generating)
 *   2. While waiting for A's reply, switch to agent B.
 *   3. Create a new conversation in B.
 *   4. Switch back to A.
 *   Expected: A's conversation (with the pending task) is restored / at
 *   least visible in the session list.
 *   Reported: A's conversation is GONE - not even in the history list.
 *
 * This test drives the REAL sessionApi singleton, wiring the same
 * callbacks the Chat page installs, to reproduce the state machine the
 * UI depends on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChatSpec, ChatHistory } from "../../../api";
import api from "../../../api";
import sessionApi from "../sessionApi";
import { useAgentStore } from "../../../stores/agentStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await new Promise((res) => setTimeout(res, 0));
}

function makeChatSpec(id: string, sessionId: string, name = "chat"): ChatSpec {
  return {
    id,
    name,
    session_id: sessionId,
    user_id: "default",
    channel: "console",
    created_at: "2026-07-27T10:00:00.000000+00:00",
    updated_at: "2026-07-27T11:00:00.000000+00:00",
    meta: {},
    status: "running",
    pinned: false,
    archived: false,
    archived_at: null,
  } as unknown as ChatSpec;
}

function makeHistory(status: string): ChatHistory {
  return { messages: [], status } as unknown as ChatHistory;
}

const A_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Chat-page-like URL state per agent. */
const urlByAgent: Record<string, string> = {};
let currentAgent = "a";

function navigate(path: string) {
  urlByAgent[currentAgent] = path;
}

beforeEach(() => {
  sessionApi.resetForTests();
  useAgentStore.setState({ lastChatIdByAgent: {} });
  vi.spyOn(api, "getChat").mockResolvedValue(makeHistory("running"));
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionApi.resetForTests();
});

describe("REPRO: switch agents mid-generation loses A's conversation", () => {
  it("new chat in A + in-flight task, switch to B, new chat in B, switch back to A", async () => {
    const listSpy = vi.spyOn(api, "listChats");

    // ---- Chat page callback wiring (mirrors Chat/index.tsx) ----
    sessionApi.onSessionCreated = (sessionId) => {
      sessionApi.lastActiveChatId = sessionId;
      if (/^\d+-[a-z0-9]+$/.test(sessionId)) {
        useAgentStore.getState().removeLastChatId(currentAgent);
      } else {
        useAgentStore.getState().setLastChatId(currentAgent, sessionId);
      }
      navigate("/chat");
    };
    sessionApi.onSessionIdResolved = (_tempId, realId) => {
      useAgentStore.getState().setLastChatId(currentAgent, realId);
      navigate(`/chat/${realId}`);
    };
    sessionApi.onSessionSelected = (sessionId, realId) => {
      const targetId = realId || sessionId;
      if (!targetId) return;
      if (/^\d+-[a-z0-9]+$/.test(targetId)) return;
      useAgentStore.getState().setLastChatId(currentAgent, targetId);
      sessionApi.lastActiveChatId = targetId;
      navigate(`/chat/${targetId}`);
    };

    // ================= Step 1: agent A, new conversation =================
    sessionApi.setActiveAgent("a");
    currentAgent = "a";
    urlByAgent.a = "/chat";

    const spec: { id?: string } = {};
    await sessionApi.createSession(spec);
    const tempId = spec.id!;
    expect(tempId).toMatch(/^\d+-[a-z0-9]+$/);

    // User sends the task: POST /console/chat succeeds -> backend creates
    // chat A_UUID with session_id = tempId. customFetch fires
    // triggerResolve(tempId); the list request stays pending (generation
    // still running).
    const dFirst = deferred<ChatSpec[]>();
    listSpy.mockReturnValueOnce(dFirst.promise);
    sessionApi.triggerResolve(tempId);

    // ================= Step 2: switch to agent B =================
    sessionApi.setActiveAgent("b");
    currentAgent = "b";
    urlByAgent.b = "/chat";

    // The stale list request from A's epoch resolves late - must be
    // dropped (the designed behavior, "Test B" upstream).
    dFirst.resolve([makeChatSpec(A_UUID, tempId)]);
    await flush();
    // onSessionIdResolved was dropped -> A's chat id NOT persisted:
    expect(useAgentStore.getState().getLastChatId("a")).toBeUndefined();

    // ================= Step 3: new conversation in B =================
    sessionApi.userInitiatedCreate = true;
    const specB: { id?: string } = {};
    await sessionApi.createSession(specB);
    const tempIdB = specB.id!;
    expect(tempIdB).toMatch(/^\d+-[a-z0-9]+$/);
    // User sends a message in B too: backend creates B_UUID.
    const dSecond = deferred<ChatSpec[]>();
    listSpy.mockReturnValueOnce(dSecond.promise);
    sessionApi.triggerResolve(tempIdB);

    // ================= Step 4: switch back to agent A =================
    sessionApi.setActiveAgent("a");
    currentAgent = "a";

    // Agent-switch effect: restore A's last chat id.
    const restored = useAgentStore.getState().getLastChatId("a");
    if (restored) {
      navigate(`/chat/${restored}`);
      sessionApi.preferredChatId = restored;
      sessionApi.lastActiveChatId = restored;
    } else {
      navigate("/chat");
      sessionApi.lastActiveChatId = null;
    }
    expect(urlByAgent.a).toBe("/chat"); // nothing to restore - repro condition

    // ================= Step 5: SDK remount (refreshKey++) =================
    // Library useMount: getSessionList -> setSessions -> setCurrentSessionId(list[0].id)
    listSpy.mockResolvedValueOnce([makeChatSpec(A_UUID, tempId)]);
    const list = await sessionApi.getSessionList();

    // KEY ASSERTION 1: is A's conversation (the one with the pending
    // task) present in the freshly fetched session list?
    const found = list.find(
      (s) => s.id === A_UUID || (s as any).sessionId === tempId,
    );
    expect(found).toBeDefined(); // <- if this fails: conversation is LOST from history

    // Library auto-selects sessions[0]:
    const selectedId = list[0]!.id;
    expect(selectedId).toBe(A_UUID);

    // getSession -> onSessionSelected -> persist + navigate:
    await sessionApi.getSession(selectedId);
    expect(useAgentStore.getState().getLastChatId("a")).toBe(A_UUID);
    expect(urlByAgent.a).toBe(`/chat/${A_UUID}`);
  });
});
