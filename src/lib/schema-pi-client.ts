"use client";

import {
  Agent,
  convertToLlm,
  estimateContextTokens,
  type AgentEvent,
  type AgentMessage,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import { streamSimple as streamOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  PiAssistantMessageDelta,
  PiClient,
  PiClientEvent,
  PiClientEventBody,
  PiModelInfo,
  PiRuntimeReadiness,
  PiSendMessageInput,
  PiThinkingLevel,
  PiThreadMetadata,
  PiThreadSnapshot,
  PiTranscriptMessage,
} from "@assistant-ui/react-pi";

import {
  buildSchemaSystemPrompt,
  createSchemaTools,
  type SchemaAgentContext,
} from "@/lib/schema-agent";
import {
  getPiBuiltinModel,
  getPiBuiltinProvider,
  isPiBuiltinModel,
  piBuiltinProviders,
} from "@/lib/pi-models";
import {
  deleteAiThread,
  listAiThreads,
  saveAiThread,
  type StoredAiThread,
} from "@/lib/schema-store";

const CONNECTION_KEY = "schema-atlas-ai-connection";
const CONTEXT_WINDOW = 128_000;

export type SchemaAiConnection = {
  apiKey: string;
  baseUrl: string;
  custom: boolean;
  modelId: string;
  provider: string;
  supportsThinking: boolean;
};

type LiveThread = StoredAiThread<PiTranscriptMessage> & {
  agent?: Agent;
  followUp: string[];
  lastError?: string;
  listeners: Set<(event: PiClientEvent) => void>;
  runAcceptance?: {
    reject: (reason: unknown) => void;
    resolve: () => void;
  };
  runId?: string;
  seq: number;
  status: "failed" | "idle" | "running";
  steering: string[];
  turnIndex: number;
};

const emptyConnection = (): SchemaAiConnection => {
  const provider =
    piBuiltinProviders.find((candidate) => candidate.id === "openai") ??
    piBuiltinProviders[0];
  const model = provider?.models[0];
  return {
    apiKey: "",
    baseUrl: provider?.baseUrl ?? "https://api.openai.com/v1",
    custom: false,
    modelId: model?.id ?? "",
    provider: provider?.id ?? "openai",
    supportsThinking: model?.supportsThinking ?? false,
  };
};

const readConnection = (): SchemaAiConnection => {
  const raw = window.localStorage.getItem(CONNECTION_KEY);
  if (!raw) return emptyConnection();
  const parsed = JSON.parse(raw) as Partial<SchemaAiConnection>;
  const providerId =
    typeof parsed.provider === "string" && parsed.provider
      ? parsed.provider
      : "openai";
  const builtin = piBuiltinProviders.find(
    (provider) => provider.id === providerId,
  );
  const baseUrl =
    typeof parsed.baseUrl === "string" && parsed.baseUrl
      ? parsed.baseUrl
      : builtin?.baseUrl ?? "https://api.openai.com/v1";
  const modelId =
    typeof parsed.modelId === "string" && parsed.modelId
      ? parsed.modelId
      : builtin?.models[0]?.id ?? "";
  const custom =
    typeof parsed.custom === "boolean"
      ? parsed.custom
      : !builtin || baseUrl !== builtin.baseUrl;
  return {
    apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    baseUrl,
    custom,
    modelId,
    provider: providerId,
    supportsThinking: custom
      ? parsed.supportsThinking === true
      : builtin?.models.find((model) => model.id === modelId)
          ?.supportsThinking ?? false,
  };
};

const connectionReady = (connection: SchemaAiConnection) =>
  Boolean(
    connection.apiKey.trim() &&
      connection.baseUrl.trim() &&
      connection.modelId.trim() &&
      connection.provider.trim(),
  );

const createModel = (connection: SchemaAiConnection): Model<Api> => {
  const builtin = !connection.custom
    ? getPiBuiltinModel(connection.provider, connection.modelId)
    : undefined;
  if (builtin) return builtin;
  return {
    api: "openai-completions",
    baseUrl: connection.baseUrl.replace(/\/$/, ""),
    contextWindow: CONTEXT_WINDOW,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: connection.modelId || "unconfigured",
    input: ["text"],
    maxTokens: 16_384,
    name: connection.modelId || "未配置模型",
    provider: connection.provider || "openai",
    reasoning: connection.supportsThinking,
  };
};

const streamModel: StreamFn = (model, context, options) => {
  const provider = getPiBuiltinProvider(model.provider);
  if (provider && isPiBuiltinModel(model)) {
    return (provider.streamSimple as StreamFn)(model, context, {
      ...options,
      maxRetries: 2,
    });
  }
  return streamOpenAICompletions(
    model as Model<"openai-completions">,
    context,
    { ...options, maxRetries: 2 },
  );
};

const toStoredThread = (
  thread: LiveThread,
): StoredAiThread<PiTranscriptMessage> => ({
  archived: thread.archived,
  createdAt: thread.createdAt,
  id: thread.id,
  messages: thread.messages,
  modelId: thread.modelId,
  provider: thread.provider,
  thinkingLevel: thread.thinkingLevel,
  ...(thread.title ? { title: thread.title } : {}),
  updatedAt: thread.updatedAt,
  workspacePath: thread.workspacePath,
});

const toUserMessage = (input: PiSendMessageInput): AgentMessage => ({
  content: input.attachments?.length
    ? [{ text: input.content, type: "text" }, ...input.attachments]
    : input.content,
  role: "user",
  timestamp: Date.now(),
});

const firstUserText = (messages: readonly PiTranscriptMessage[]) => {
  const message = messages.find((candidate) => candidate.role === "user");
  if (!message || !("content" in message)) return undefined;
  if (typeof message.content === "string") {
    return message.content.trim().slice(0, 48);
  }
  if (!Array.isArray(message.content)) return undefined;
  return message.content
    .flatMap((part) =>
      typeof part === "object" && part !== null && "text" in part
        ? [String(part.text)]
        : [],
    )
    .join(" ")
    .trim()
    .slice(0, 48);
};

export class SchemaPiClient implements PiClient {
  private connection = readConnection();
  private readonly context: SchemaAgentContext;
  private readonly ready: Promise<void>;
  private readonly threads = new Map<string, LiveThread>();

  constructor(context: SchemaAgentContext) {
    this.context = context;
    this.ready = this.restore();
  }

  getConnection(): SchemaAiConnection {
    return { ...this.connection };
  }

  isConfigured(): boolean {
    return connectionReady(this.connection);
  }

  configure(connection: SchemaAiConnection): void {
    this.connection = { ...connection };
    window.localStorage.setItem(CONNECTION_KEY, JSON.stringify(this.connection));
    for (const thread of this.threads.values()) {
      thread.modelId = connection.modelId;
      thread.provider = connection.provider;
      if (thread.agent) {
        thread.agent.state.model = createModel(connection);
        thread.agent.state.systemPrompt = buildSchemaSystemPrompt(this.context);
        thread.agent.state.tools = createSchemaTools(this.context);
      }
      void saveAiThread(toStoredThread(thread));
      this.emit(thread, { snapshot: this.snapshotOf(thread), type: "snapshot" });
    }
  }

  private async restore(): Promise<void> {
    const storedThreads = await listAiThreads<PiTranscriptMessage>();
    for (const stored of storedThreads) {
      this.threads.set(stored.id, {
        ...stored,
        followUp: [],
        listeners: new Set(),
        seq: 0,
        status: "idle",
        steering: [],
        thinkingLevel: stored.thinkingLevel as PiThinkingLevel,
        turnIndex: 0,
        workspacePath: stored.workspacePath || "schema-atlas",
      });
    }
  }

  private requireThread(threadId: string): LiveThread {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`找不到 AI 会话：${threadId}`);
    return thread;
  }

  private readinessOf(thread: LiveThread): PiRuntimeReadiness {
    if (!thread.modelId || !this.connection.baseUrl) {
      return { message: "请先配置模型", state: "missing-model" };
    }
    if (!this.connection.apiKey) {
      return {
        message: "请先配置 API Key",
        provider: thread.provider,
        state: "missing-credentials",
      };
    }
    return {
      selection: { modelId: thread.modelId, provider: thread.provider },
      source: "session",
      state: "ready",
    };
  }

  private metadataOf(thread: LiveThread): PiThreadMetadata {
    const queuedMessages = [
      ...thread.steering.map((content, index) => ({
        content,
        id: `steer-${index}`,
        mode: "steer" as const,
      })),
      ...thread.followUp.map((content, index) => ({
        content,
        id: `follow-up-${index}`,
        mode: "followUp" as const,
      })),
    ];
    const tokens = estimateContextTokens(thread.messages as AgentMessage[]).tokens;
    return {
      archived: thread.archived,
      config: {
        modelId: thread.modelId,
        provider: thread.provider,
        thinkingLevel: thread.thinkingLevel as PiThinkingLevel,
      },
      contextUsage: {
        contextWindow: CONTEXT_WINDOW,
        percent: Math.min(100, (tokens / CONTEXT_WINDOW) * 100),
        tokens,
      },
      createdAt: thread.createdAt,
      id: thread.id,
      messageCount: thread.messages.length,
      ...(queuedMessages.length ? { queuedMessages } : {}),
      ...(thread.runId ? { runningRunId: thread.runId } : {}),
      status: thread.status,
      ...(thread.title ? { title: thread.title } : {}),
      updatedAt: thread.updatedAt,
      workspacePath: thread.workspacePath,
    };
  }

  private snapshotOf(thread: LiveThread): PiThreadSnapshot {
    return {
      ...(thread.lastError ? { lastError: thread.lastError } : {}),
      messages: [...thread.messages],
      metadata: this.metadataOf(thread),
      readiness: this.readinessOf(thread),
    };
  }

  private emit(thread: LiveThread, body: PiClientEventBody): void {
    const event = {
      ...body,
      seq: ++thread.seq,
      threadId: thread.id,
    } as PiClientEvent;
    for (const listener of thread.listeners) listener(event);
  }

  private emitQueue(thread: LiveThread): void {
    this.emit(thread, {
      followUp: [...thread.followUp],
      steering: [...thread.steering],
      type: "queue_update",
    });
  }

  private createAgent(thread: LiveThread): Agent {
    const agent = new Agent({
      convertToLlm,
      getApiKey: () => this.connection.apiKey,
      initialState: {
        messages: thread.messages as AgentMessage[],
        model: createModel(this.connection),
        systemPrompt: buildSchemaSystemPrompt(this.context),
        thinkingLevel: thread.thinkingLevel as PiThinkingLevel,
        tools: createSchemaTools(this.context),
      },
      sessionId: thread.id,
      streamFn: streamModel,
    });
    agent.subscribe((event) => this.onAgentEvent(thread, event));
    return agent;
  }

  private onAgentEvent(thread: LiveThread, event: AgentEvent): void {
    if (event.type === "agent_start") {
      thread.status = "running";
      thread.lastError = undefined;
      this.emit(thread, { type: "agent_start" });
      return;
    }
    if (event.type === "agent_end") {
      const error = thread.agent?.state.errorMessage;
      thread.status = error ? "failed" : "idle";
      thread.lastError = error;
      thread.runId = undefined;
      this.emit(thread, {
        type: "agent_end",
        willRetry: "willRetry" in event ? Boolean(event.willRetry) : false,
      });
      if (error) this.emit(thread, { error, type: "error" });
      void saveAiThread(toStoredThread(thread));
      return;
    }
    if (event.type === "turn_start") {
      thread.turnIndex += 1;
      this.emit(thread, { turnIndex: thread.turnIndex, type: "turn_start" });
      return;
    }
    if (event.type === "turn_end") {
      this.emit(thread, { turnIndex: thread.turnIndex, type: "turn_end" });
      return;
    }
    if (event.type === "message_start") {
      if (event.message.role === "user") {
        const content =
          typeof event.message.content === "string" ? event.message.content : "";
        const steeringIndex = thread.steering.indexOf(content);
        const followUpIndex = thread.followUp.indexOf(content);
        if (steeringIndex >= 0) thread.steering.splice(steeringIndex, 1);
        if (followUpIndex >= 0) thread.followUp.splice(followUpIndex, 1);
        if (steeringIndex >= 0 || followUpIndex >= 0) this.emitQueue(thread);
      }
      this.emit(thread, {
        message: event.message as PiTranscriptMessage,
        type: "message_start",
      });
      return;
    }
    if (event.type === "message_update") {
      this.emit(thread, {
        assistantMessageEvent:
          event.assistantMessageEvent as unknown as PiAssistantMessageDelta,
        message: event.message as PiTranscriptMessage,
        type: "message_update",
      });
      return;
    }
    if (event.type === "message_end") {
      thread.messages = [
        ...(thread.agent?.state.messages ?? []),
      ] as PiTranscriptMessage[];
      thread.title ??= firstUserText(thread.messages);
      thread.updatedAt = new Date().toISOString();
      this.emit(thread, {
        message: event.message as PiTranscriptMessage,
        type: "message_end",
      });
      if (event.message.role === "user" && thread.runAcceptance) {
        const acceptance = thread.runAcceptance;
        thread.runAcceptance = undefined;
        acceptance.resolve();
      }
      void saveAiThread(toStoredThread(thread));
      return;
    }
    if (event.type === "tool_execution_start") {
      this.emit(thread, {
        args: event.args,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        type: "tool_execution_start",
      });
      return;
    }
    if (event.type === "tool_execution_update") {
      this.emit(thread, {
        partialResult: event.partialResult,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        type: "tool_execution_update",
      });
      return;
    }
    if (event.type === "tool_execution_end") {
      this.emit(thread, {
        isError: event.isError,
        result: event.result,
        toolCallId: event.toolCallId,
        type: "tool_execution_end",
      });
    }
  }

  private startRun(thread: LiveThread, input: PiSendMessageInput): Promise<void> {
    if (!connectionReady(this.connection)) {
      throw new Error("请先完成模型配置");
    }
    thread.modelId = this.connection.modelId;
    thread.provider = this.connection.provider;
    if (thread.agent) {
      thread.agent.state.model = createModel(this.connection);
      thread.agent.state.systemPrompt = buildSchemaSystemPrompt(this.context);
      thread.agent.state.tools = createSchemaTools(this.context);
    } else {
      thread.agent = this.createAgent(thread);
    }
    thread.runId = crypto.randomUUID();
    thread.status = "running";
    thread.lastError = undefined;
    thread.updatedAt = new Date().toISOString();
    const accepted = new Promise<void>((resolve, reject) => {
      thread.runAcceptance = { reject, resolve };
    });
    void saveAiThread(toStoredThread(thread));
    void thread.agent
      .prompt(input.content, input.attachments)
      .catch((reason: unknown) => {
        thread.status = "failed";
        thread.runId = undefined;
        thread.lastError = reason instanceof Error ? reason.message : String(reason);
        thread.runAcceptance?.reject(reason);
        thread.runAcceptance = undefined;
        this.emit(thread, { error: thread.lastError, type: "error" });
        void saveAiThread(toStoredThread(thread));
      })
      .finally(() => this.emit(thread, { type: "agent_settled" }));
    return accepted;
  }

  async listThreads(input?: {
    workspacePath?: string;
    includeArchived?: boolean;
  }): Promise<PiThreadMetadata[]> {
    await this.ready;
    return [...this.threads.values()]
      .filter(
        (thread) =>
          !input?.workspacePath || thread.workspacePath === input.workspacePath,
      )
      .filter((thread) => input?.includeArchived || !thread.archived)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((thread) => this.metadataOf(thread));
  }

  async createThread(input?: {
    workspacePath?: string;
    title?: string;
    initialMessage?: PiSendMessageInput;
  }): Promise<PiThreadSnapshot> {
    await this.ready;
    const now = new Date().toISOString();
    const thread: LiveThread = {
      archived: false,
      createdAt: now,
      followUp: [],
      id: crypto.randomUUID(),
      listeners: new Set(),
      messages: [],
      modelId: this.connection.modelId,
      provider: this.connection.provider,
      seq: 0,
      status: "idle",
      steering: [],
      thinkingLevel: "off",
      ...(input?.title ? { title: input.title } : {}),
      turnIndex: 0,
      updatedAt: now,
      workspacePath: input?.workspacePath ?? "schema-atlas",
    };
    this.threads.set(thread.id, thread);
    await saveAiThread(toStoredThread(thread));
    if (input?.initialMessage) await this.startRun(thread, input.initialMessage);
    return this.snapshotOf(thread);
  }

  async getThread(threadId: string): Promise<PiThreadSnapshot> {
    await this.ready;
    return this.snapshotOf(this.requireThread(threadId));
  }

  async sendMessage(threadId: string, input: PiSendMessageInput): Promise<void> {
    await this.ready;
    const thread = this.requireThread(threadId);
    if (thread.status === "running" && thread.agent) {
      const message = toUserMessage(input);
      if (input.streamingBehavior === "steer") {
        thread.steering.push(input.content);
        thread.agent.steer(message);
      } else {
        thread.followUp.push(input.content);
        thread.agent.followUp(message);
      }
      this.emitQueue(thread);
      return;
    }
    await this.startRun(thread, input);
  }

  async cancelRun(threadId: string): Promise<void> {
    await this.ready;
    this.requireThread(threadId).agent?.abort();
  }

  async clearQueue(
    threadId: string,
  ): Promise<{ steering: string[]; followUp: string[] }> {
    await this.ready;
    const thread = this.requireThread(threadId);
    const cleared = {
      followUp: [...thread.followUp],
      steering: [...thread.steering],
    };
    thread.followUp = [];
    thread.steering = [];
    thread.agent?.clearAllQueues();
    this.emitQueue(thread);
    return cleared;
  }

  async getAvailableModels(): Promise<PiModelInfo[]> {
    if (!this.connection.modelId) return [];
    if (!this.connection.custom) {
      const provider = getPiBuiltinProvider(this.connection.provider);
      return (
        provider?.getModels().map((model) => {
          const configured = piBuiltinProviders
            .find((candidate) => candidate.id === provider.id)
            ?.models.find((candidate) => candidate.id === model.id);
          return {
            availableThinkingLevels: configured?.supportsThinking
              ? (["off", "minimal", "low", "medium", "high"] as PiThinkingLevel[])
              : (["off"] as PiThinkingLevel[]),
            modelId: model.id,
            name: model.name,
            provider: model.provider,
            supportsThinking: configured?.supportsThinking ?? false,
          };
        }) ?? []
      );
    }
    return [
      {
        availableThinkingLevels: this.connection.supportsThinking
          ? ["off", "minimal", "low", "medium", "high"]
          : ["off"],
        modelId: this.connection.modelId,
        name: this.connection.modelId,
        provider: this.connection.provider,
        supportsThinking: this.connection.supportsThinking,
      },
    ];
  }

  async setModel(
    threadId: string,
    input: { provider: string; modelId: string },
  ): Promise<void> {
    await this.ready;
    const builtin = !this.connection.custom
      ? getPiBuiltinModel(input.provider, input.modelId)
      : undefined;
    if (
      input.provider !== this.connection.provider ||
      (this.connection.custom && input.modelId !== this.connection.modelId) ||
      (!this.connection.custom && !builtin)
    ) {
      throw new Error("该模型尚未配置");
    }
    if (builtin) {
      this.connection = {
        ...this.connection,
        modelId: builtin.id,
        supportsThinking:
          piBuiltinProviders
            .find((provider) => provider.id === input.provider)
            ?.models.find((model) => model.id === input.modelId)
            ?.supportsThinking ?? false,
      };
      window.localStorage.setItem(CONNECTION_KEY, JSON.stringify(this.connection));
    }
    const thread = this.requireThread(threadId);
    thread.provider = input.provider;
    thread.modelId = input.modelId;
    await saveAiThread(toStoredThread(thread));
    this.emit(thread, { snapshot: this.snapshotOf(thread), type: "snapshot" });
  }

  async setThinkingLevel(
    threadId: string,
    level: PiThinkingLevel,
  ): Promise<void> {
    await this.ready;
    const thread = this.requireThread(threadId);
    thread.thinkingLevel = level;
    if (thread.agent) thread.agent.state.thinkingLevel = level;
    await saveAiThread(toStoredThread(thread));
    this.emit(thread, { level, type: "thinking_level_changed" });
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    await this.ready;
    const thread = this.requireThread(threadId);
    thread.title = title;
    thread.updatedAt = new Date().toISOString();
    await saveAiThread(toStoredThread(thread));
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.ready;
    const thread = this.requireThread(threadId);
    thread.archived = true;
    await saveAiThread(toStoredThread(thread));
  }

  async unarchiveThread(threadId: string): Promise<void> {
    await this.ready;
    const thread = this.requireThread(threadId);
    thread.archived = false;
    await saveAiThread(toStoredThread(thread));
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.ready;
    this.requireThread(threadId).agent?.abort();
    this.threads.delete(threadId);
    await deleteAiThread(threadId);
  }

  async respondToHostUiRequest(): Promise<void> {
    throw new Error("当前数据库工具不需要额外授权");
  }

  subscribe(
    threadId: string,
    listener: (event: PiClientEvent) => void,
    options?: { includeSnapshot?: boolean },
  ): () => void {
    const thread = this.requireThread(threadId);
    thread.listeners.add(listener);
    if (options?.includeSnapshot !== false) {
      listener({
        seq: ++thread.seq,
        snapshot: this.snapshotOf(thread),
        threadId,
        type: "snapshot",
      });
    }
    return () => thread.listeners.delete(listener);
  }
}
