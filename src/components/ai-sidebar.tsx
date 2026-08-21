"use client";

import {
  AssistantRuntimeProvider,
  AuiConfig,
  Suggestions,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  usePiRuntime,
  usePiRuntimeExtras,
  usePiSession,
  type PiModelInfo as AssistantUiPiModelInfo,
  type PiThinkingLevel as AssistantUiPiThinkingLevel,
} from "@assistant-ui/react-pi";
import { ArrowLeft, History, Settings2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { SchemaThreadList } from "@/components/assistant-ui/schema-thread-list";
import { Thread } from "@/components/assistant-ui/thread";
import {
  ModelSelector,
  type ModelOption,
} from "@/components/assistant-ui/model-selector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SchemaAgentContext } from "@/lib/schema-agent";
import { piBuiltinProviders } from "@/lib/pi-models";
import {
  SchemaPiClient,
  type SchemaAiConnection,
} from "@/lib/schema-pi-client";

type Props = {
  context: SchemaAgentContext;
  onClose: () => void;
  selectedTableName?: string;
  workspaceId: string;
};

type PiThinkingLevel = AssistantUiPiThinkingLevel | "max";
type PiModelInfo = Omit<
  AssistantUiPiModelInfo,
  "availableThinkingLevels"
> & {
  availableThinkingLevels?: readonly PiThinkingLevel[];
};

const THINKING_LEVEL_LABELS: Record<PiThinkingLevel, string> = {
  high: "高",
  low: "低",
  max: "最高",
  medium: "中",
  minimal: "最少",
  off: "关闭",
  xhigh: "极高",
};

const modelSelectionId = (
  model: Pick<PiModelInfo, "provider" | "modelId">,
) => `${model.provider}/${model.modelId}`;

function SchemaWelcome({ selectedTableName }: { selectedTableName?: string }) {
  return (
    <div className="mb-5 px-4 text-center">
      <h1 className="text-lg font-medium tracking-tight">从数据库结构开始</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {selectedTableName ? `当前已选择 ${selectedTableName}` : "查找表、梳理关系、生成 SQL"}
      </p>
    </div>
  );
}

function ThreadTitleSync() {
  const aui = useAui();
  const session = usePiSession();

  useEffect(() => {
    const title = session?.title?.trim();
    if (!title || aui.threadListItem.source == null) return;
    if (aui.threadListItem.getState().title === title) return;
    aui.threadListItem.rename(title);
  }, [aui, session?.title]);

  return null;
}

function ThreadBootstrap() {
  const aui = useAui();
  const isThreadListLoading = useAuiState((state) => state.threads.isLoading);
  const threadId = useAuiState((state) => state.threadListItem.id);
  const threadStatus = useAuiState((state) => state.threadListItem.status);
  const initializingThreadRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (isThreadListLoading || threadStatus !== "new") return;
    if (initializingThreadRef.current === threadId) return;
    initializingThreadRef.current = threadId;
    void aui.threadListItem.initialize().catch((error: unknown) => {
      initializingThreadRef.current = undefined;
      console.error("无法初始化 AI 会话", error);
    });
  }, [aui, isThreadListLoading, threadId, threadStatus]);

  return null;
}

function SchemaComposerModelSelector({
  client,
  configurationRevision,
}: {
  client: SchemaPiClient;
  configurationRevision: number;
}) {
  const session = usePiSession();
  const { setModel, setThinkingLevel, status } = usePiRuntimeExtras();
  const [models, setModels] = useState<PiModelInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void client.getAvailableModels().then(
      (availableModels) => {
        if (!active) return;
        setModels(availableModels as PiModelInfo[]);
        setLoading(false);
      },
      (error: unknown) => {
        if (!active) return;
        console.error("无法读取 Pi 模型列表", error);
        setModels([]);
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [client, configurationRevision]);

  const selection =
    session?.config?.provider && session.config.modelId
      ? {
          modelId: session.config.modelId,
          provider: session.config.provider,
        }
      : undefined;
  const selectedModel = selection
    ? models.find(
        (model) =>
          model.provider === selection.provider &&
          model.modelId === selection.modelId,
      )
    : undefined;
  const availableThinkingLevels = selectedModel?.availableThinkingLevels;
  const sessionThinking = session?.config?.thinkingLevel as
    | PiThinkingLevel
    | undefined;
  const thinking =
    sessionThinking && availableThinkingLevels?.includes(sessionThinking)
      ? sessionThinking
      : undefined;
  const modelOptions: ModelOption[] = models.map((model) => ({
    description: model.provider,
    id: modelSelectionId(model),
    keywords: [model.modelId, model.provider],
    name: model.name ?? model.modelId,
    ...(model.availableThinkingLevels &&
    model.availableThinkingLevels.length > 1
      ? {
          efforts: model.availableThinkingLevels.map((level) => ({
            id: level,
            name: THINKING_LEVEL_LABELS[level],
          })),
        }
      : undefined),
  }));
  const providerGroups = models.reduce<
    { models: PiModelInfo[]; provider: string }[]
  >((groups, model) => {
    const current = groups.find((group) => group.provider === model.provider);
    if (current) current.models.push(model);
    else groups.push({ models: [model], provider: model.provider });
    return groups;
  }, []);
  const searchable = models.length > 8;

  return (
    <ModelSelector.Root
      effort={thinking}
      models={modelOptions}
      onEffortChange={(value) => {
        if (
          status === "running" ||
          !availableThinkingLevels?.includes(value as PiThinkingLevel)
        ) {
          return;
        }
        void setThinkingLevel(value as AssistantUiPiThinkingLevel).catch(
          (error: unknown) => console.error("无法切换 Pi 思考级别", error),
        );
      }}
      onValueChange={(value) => {
        const model = models.find(
          (candidate) => modelSelectionId(candidate) === value,
        );
        if (!model || status === "running") return;
        void setModel({
          modelId: model.modelId,
          provider: model.provider,
        }).catch((error: unknown) => console.error("无法切换 Pi 模型", error));
      }}
      value={selectedModel ? modelSelectionId(selectedModel) : undefined}
    >
      <ModelSelector.Trigger
        aria-label={
          selection ? `已选择模型：${selection.modelId}` : "选择模型"
        }
        className="h-7 max-w-40 px-2 text-sm"
        disabled={loading || status === "running"}
        size="sm"
        variant="ghost"
      >
        <ModelSelector.Value
          placeholder={loading ? "正在加载模型…" : "选择模型"}
          showEffort={false}
        />
      </ModelSelector.Trigger>
      <ModelSelector.Content
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)]"
        searchable={searchable}
        side="top"
      >
        {searchable ? <ModelSelector.Search placeholder="搜索模型…" /> : null}
        <ModelSelector.List className="max-h-64 overflow-y-auto">
          <ModelSelector.Empty>没有匹配的模型</ModelSelector.Empty>
          {providerGroups.map((group) => (
            <ModelSelector.Group heading={group.provider} key={group.provider}>
              {group.models.map((model) => (
                <ModelSelector.Item
                  className="h-8 items-center gap-2 rounded-md py-0 ps-2.5"
                  key={modelSelectionId(model)}
                  model={{
                    description: model.provider,
                    id: modelSelectionId(model),
                    keywords: [model.modelId, model.provider],
                    name: model.name ?? model.modelId,
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {model.name ?? model.modelId}
                  </span>
                </ModelSelector.Item>
              ))}
            </ModelSelector.Group>
          ))}
        </ModelSelector.List>
        <ModelSelector.Effort label="思考级别" />
      </ModelSelector.Content>
    </ModelSelector.Root>
  );
}

function ModelDialog({
  client,
  open,
  onOpenChange,
  onSaved,
}: {
  client: SchemaPiClient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [connection, setConnection] = useState<SchemaAiConnection>(() =>
    client.getConnection(),
  );

  const update = <Key extends keyof SchemaAiConnection>(
    field: Key,
    value: SchemaAiConnection[Key],
  ) => {
    setConnection((current) => ({ ...current, [field]: value }));
  };

  const selectProvider = (providerId: string) => {
    if (providerId === "custom") {
      setConnection({
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        custom: true,
        modelId: "",
        provider: "openai",
        supportsThinking: false,
      });
      return;
    }
    const provider = piBuiltinProviders.find(
      (candidate) => candidate.id === providerId,
    );
    if (!provider) return;
    const model = provider.models[0];
    setConnection({
      apiKey: "",
      baseUrl: provider.baseUrl,
      custom: false,
      modelId: model?.id ?? "",
      provider: provider.id,
      supportsThinking: model?.supportsThinking ?? false,
    });
  };

  const selectModel = (modelId: string) => {
    const provider = piBuiltinProviders.find(
      (candidate) => candidate.id === connection.provider,
    );
    const model = provider?.models.find((candidate) => candidate.id === modelId);
    setConnection((current) => ({
      ...current,
      modelId,
      supportsThinking: model?.supportsThinking ?? false,
    }));
  };

  const selectedProvider = !connection.custom
    ? piBuiltinProviders.find(
        (provider) => provider.id === connection.provider,
      )
    : undefined;

  const save = () => {
    client.configure(connection);
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>模型配置</DialogTitle>
          <DialogDescription className="sr-only">配置 OpenAI 兼容模型</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm">
            <span>提供商</span>
            <Select
              value={connection.custom ? "custom" : connection.provider}
              onValueChange={(value) => {
                if (value) selectProvider(value);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择提供商" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                align="start"
                side="bottom"
                sideOffset={4}
              >
                {piBuiltinProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
                <SelectItem value="custom">自定义 OpenAI 兼容</SelectItem>
              </SelectContent>
            </Select>
          </label>

          {connection.custom ? (
            <>
              <label className="grid gap-1.5 text-sm">
                <span>提供商 ID</span>
                <Input
                  value={connection.provider}
                  onChange={(event) => update("provider", event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span>API 地址</span>
                <Input
                  value={connection.baseUrl}
                  onChange={(event) => update("baseUrl", event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span>模型名称</span>
                <Input
                  value={connection.modelId}
                  onChange={(event) => update("modelId", event.target.value)}
                />
              </label>
            </>
          ) : (
            <label className="grid gap-1.5 text-sm">
              <span>模型</span>
              <Select
                value={connection.modelId}
                onValueChange={(value) => {
                  if (value) selectModel(value);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  align="start"
                  side="bottom"
                  sideOffset={4}
                >
                  {selectedProvider?.models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          <label className="grid gap-1.5 text-sm">
            <span>API Key</span>
            <Input
              type="password"
              value={connection.apiKey}
              onChange={(event) => update("apiKey", event.target.value)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button
            disabled={
              !connection.provider.trim() ||
              !connection.baseUrl.trim() ||
              !connection.modelId.trim() ||
              !connection.apiKey.trim()
            }
            onClick={save}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AiSidebar({
  context,
  onClose,
  selectedTableName,
  workspaceId,
}: Props) {
  const client = useMemo(() => new SchemaPiClient(context), [context]);
  const runtime = usePiRuntime({
    client,
    includeArchived: false,
    workspacePath: workspaceId,
  });
  const assistantConfig = useMemo(() => {
    const table = selectedTableName?.trim();
    const generalSuggestions = [
      {
        title: "查看结构概览",
        label: "快速了解当前数据库",
        prompt: "帮我看看当前数据库结构。",
      },
      {
        title: "查找业务表",
        label: "用业务关键词定位数据",
        prompt: "帮我查找业务相关的数据表。",
      },
      {
        title: "分析表关系",
        label: "理解已有外键和手动连接",
        prompt: "帮我分析当前结构中已有的表关系。",
      },
    ];
    const tableSuggestions = table
      ? [
          {
            title: "理解当前表",
            label: "了解它保存了什么",
            prompt: `帮我分析一下 ${table}。`,
          },
          {
            title: "梳理关联链路",
            label: "看看它和哪些表有关",
            prompt: `看看 ${table} 和哪些表有关。`,
          },
          {
            title: "生成常用查询",
            label: "从当前表开始查询",
            prompt: `基于 ${table} 写一条常用查询。`,
          },
        ]
      : [];
    return AuiConfig({
      suggestions: Suggestions([...generalSuggestions, ...tableSuggestions]),
    });
  }, [selectedTableName]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [configurationRevision, setConfigurationRevision] = useState(0);
  const configured = client.isConfigured();

  return (
    <AssistantRuntimeProvider runtime={runtime} config={assistantConfig}>
      <ThreadBootstrap />
      <ThreadTitleSync />
      <aside className="flex h-full min-h-0 flex-col bg-background">
        <header className="flex h-12 shrink-0 items-center border-b px-3">
          {historyOpen ? (
            <div className="flex flex-1 items-center gap-2 text-sm font-medium">
              <Button
                variant="ghost"
                size="icon"
                className="-ml-2 size-8"
                aria-label="返回对话"
                onClick={() => setHistoryOpen(false)}
              >
                <ArrowLeft />
              </Button>
              历史会话
            </div>
          ) : (
            <div className="flex-1" />
          )}
          {!historyOpen ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="历史会话"
              onClick={() => setHistoryOpen(true)}
            >
              <History />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="模型配置"
            title="模型配置"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="关闭 Schema Copilot"
            onClick={onClose}
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1">
          {historyOpen ? (
            <SchemaThreadList onSelect={() => setHistoryOpen(false)} />
          ) : configured ? (
            <Thread
              components={{
                ComposerModelSelector: (
                  <SchemaComposerModelSelector
                    client={client}
                    configurationRevision={configurationRevision}
                  />
                ),
                Welcome: () => (
                  <SchemaWelcome selectedTableName={selectedTableName} />
                ),
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Button onClick={() => setSettingsOpen(true)}>配置模型</Button>
            </div>
          )}
        </div>
      </aside>

      <ModelDialog
        client={client}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={() => setConfigurationRevision((value) => value + 1)}
      />
    </AssistantRuntimeProvider>
  );
}
