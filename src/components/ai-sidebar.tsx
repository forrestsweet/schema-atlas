"use client";

import {
  AssistantRuntimeProvider,
  AuiConfig,
  Suggestions,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { usePiRuntime, usePiSession } from "@assistant-ui/react-pi";
import { ArrowLeft, History, Settings2, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { SchemaThreadList } from "@/components/assistant-ui/schema-thread-list";
import { Thread } from "@/components/assistant-ui/thread";
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

export function AiSidebar({ context, onClose, selectedTableName, workspaceId }: Props) {
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
        label: "表、字段与关系数量",
        prompt: "读取当前数据库结构概览，并告诉我可以从哪里开始分析。",
      },
      {
        title: "查找业务表",
        label: "按名称、字段和注释搜索",
        prompt: "我想从当前结构中查找业务相关的数据表，请先询问我需要搜索的业务关键词。",
      },
    ];
    const tableSuggestions = table
      ? [
          {
            title: "理解当前表",
            label: "字段、索引与用途",
            prompt: `读取画布当前选中的表 ${table}，说明它的用途、关键字段、主键、索引和约束。`,
          },
          {
            title: "梳理关联链路",
            label: "上下游与 JOIN 条件",
            prompt: `分析画布当前选中的表 ${table} 的一至两层上下游关系，说明外键方向和可用的 JOIN 条件。`,
          },
          {
            title: "生成常用查询",
            label: "只使用真实字段",
            prompt: `根据画布当前选中的表 ${table}，生成一条常用的 MySQL 8 查询；先核对真实字段和关系，再解释 JOIN 条件。`,
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
  void configurationRevision;

  return (
    <AssistantRuntimeProvider runtime={runtime} config={assistantConfig}>
      <ThreadBootstrap />
      <ThreadTitleSync />
      <aside className="flex h-full min-h-0 flex-col bg-background">
        <header className="flex h-12 shrink-0 items-center border-b px-3">
          <div className="flex flex-1 items-center gap-2 text-sm font-medium">
            {historyOpen ? (
              <>
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
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                Schema Copilot
              </>
            )}
          </div>
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
            <Thread components={{ Welcome: () => <SchemaWelcome selectedTableName={selectedTableName} /> }} />
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
