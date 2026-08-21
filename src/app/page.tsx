"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  Check,
  ChevronDown,
  ClipboardPaste,
  Focus,
  GitFork,
  Maximize2,
  Pencil,
  Search,
  Sparkles,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import dynamic from "next/dynamic";
import {
  SchemaGraph,
  type GraphViewMode,
  type RelationshipEndpoint,
  type SchemaGraphHandle,
} from "@/components/schema-graph";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { SchemaAgentContext } from "@/lib/schema-agent";
import {
  deleteSchemaDocument,
  getCurrentDocumentId,
  listSchemaDocuments,
  saveSchemaDocument,
  setCurrentDocumentId,
  type SchemaDocument,
} from "@/lib/schema-store";
import { cn } from "@/lib/utils";
import type {
  SchemaCanvasLayoutPlan,
  SchemaDiscoveredRelationship,
  SchemaModel,
  WorkerParseResponse,
} from "@/lib/schema-types";

const AiSidebar = dynamic(
  () => import("@/components/ai-sidebar").then((module) => module.AiSidebar),
  { ssr: false },
);

type PendingImport = {
  createdAt: string;
  id: string;
  name: string;
  sql: string;
};

function IconControl({
  children,
  disabled = false,
  label,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function ImportSqlMenu({
  align = "end",
  onPaste,
  onSelectFile,
}: {
  align?: "center" | "end" | "start";
  onPaste: () => void;
  onSelectFile: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="shrink-0">
          <Upload />导入 SQL<ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-40">
        <DropdownMenuItem onSelect={onPaste}>
          <ClipboardPaste />粘贴 SQL
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSelectFile}>
          <Upload />选择文件
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const confidenceLabels = {
  high: "高可信度",
  medium: "中可信度",
  low: "低可信度",
} as const;

const cardinalityLabels = {
  "one-to-one": "一对一",
  "one-to-many": "一对多",
  "many-to-one": "多对一",
  "many-to-many": "多对多",
} as const;

export default function Home() {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const graphRef = useRef<SchemaGraphHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingImportRef = useRef<PendingImport | undefined>(undefined);
  const schemaRef = useRef<SchemaModel | undefined>(undefined);
  const selectedTableIdRef = useRef<string | undefined>(undefined);
  const currentDocumentRef = useRef<SchemaDocument | undefined>(undefined);
  const focusTableRef = useRef<(tableId: string) => void>(() => undefined);
  const [schema, setSchema] = useState<SchemaModel>();
  const [documents, setDocuments] = useState<SchemaDocument[]>([]);
  const [currentDocument, setCurrentDocument] = useState<SchemaDocument>();
  const [selectedTableId, setSelectedTableId] = useState<string>();
  const [viewMode, setViewMode] = useState<GraphViewMode>("all");
  const [search, setSearch] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastedSql, setPastedSql] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string>();
  const [documentName, setDocumentName] = useState("");

  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);

  useEffect(() => {
    selectedTableIdRef.current = selectedTableId;
  }, [selectedTableId]);

  useEffect(() => {
    currentDocumentRef.current = currentDocument;
  }, [currentDocument]);

  const parseSql = useCallback((sql: string, name: string) => {
    const worker = workerRef.current;
    if (!worker) return;
    const id = ++requestIdRef.current;
    pendingImportRef.current = {
      createdAt: new Date().toISOString(),
      id: crypto.randomUUID(),
      name,
      sql,
    };
    setIsParsing(true);
    setError(undefined);
    worker.postMessage({ id, sql });
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/schema-parser.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerParseResponse>) => {
      void (async () => {
        const response = event.data;
        if (response.id !== requestIdRef.current) return;
        setIsParsing(false);
        if (!response.ok) {
          setError(response.error);
          return;
        }
        const pending = pendingImportRef.current;
        if (!pending) return;
        const document: SchemaDocument = {
          ...pending,
          schema: response.schema,
          updatedAt: new Date().toISOString(),
        };
        try {
          await saveSchemaDocument(document);
          await setCurrentDocumentId(document.id);
          const nextDocuments = await listSchemaDocuments();
          setDocuments(nextDocuments);
          setCurrentDocument(document);
          setSchema(response.schema);
          setSelectedTableId(undefined);
          setViewMode("all");
        } catch (storageError) {
          setError(
            storageError instanceof Error
              ? storageError.message
              : "无法保存数据库结构",
          );
        }
      })();
    };
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const [savedDocuments, currentId] = await Promise.all([
          listSchemaDocuments(),
          getCurrentDocumentId(),
        ]);
        if (disposed) return;
        setDocuments(savedDocuments);
        const document =
          savedDocuments.find((candidate) => candidate.id === currentId) ??
          savedDocuments[0];
        if (!document) return;
        setCurrentDocument(document);
        setSchema(document.schema);
      } catch (storageError) {
        if (!disposed) {
          setError(
            storageError instanceof Error
              ? storageError.message
              : "无法读取已保存的数据库结构",
          );
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  const selectedTable = useMemo(
    () => schema?.tables.find((table) => table.id === selectedTableId),
    [schema, selectedTableId],
  );

  const searchMatches = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword || !schema) return [];
    return schema.tables.filter((table) => table.displayName.toLowerCase().includes(keyword)).slice(0, 8);
  }, [schema, search]);

  const selectAndFocus = useCallback((tableId: string) => {
    setSelectedTableId(tableId);
    requestAnimationFrame(() => graphRef.current?.focus(tableId));
  }, []);

  const selectTableFromGraph = useCallback((tableId: string) => {
    setSelectedTableId(tableId);
    setSelectedRelationshipId(undefined);
  }, []);

  useEffect(() => {
    focusTableRef.current = selectAndFocus;
  }, [selectAndFocus]);

  const organizeCanvas = useCallback(async (plan: SchemaCanvasLayoutPlan) => {
    await graphRef.current?.organize(plan);
  }, []);

  const persistSchema = useCallback(async (nextSchema: SchemaModel) => {
    const document = currentDocumentRef.current;
    if (!document) throw new Error("当前没有可更新的数据库结构。");
    const updatedDocument: SchemaDocument = {
      ...document,
      schema: nextSchema,
      updatedAt: new Date().toISOString(),
    };
    await saveSchemaDocument(updatedDocument);
    schemaRef.current = nextSchema;
    currentDocumentRef.current = updatedDocument;
    setSchema(nextSchema);
    setCurrentDocument(updatedDocument);
    setDocuments((current) =>
      current.map((item) =>
        item.id === updatedDocument.id ? updatedDocument : item,
      ),
    );
  }, []);

  const applyRelationships = useCallback(
    async (relationships: SchemaDiscoveredRelationship[]) => {
      const currentSchema = schemaRef.current;
      if (!currentSchema) throw new Error("当前没有已导入的数据库结构。");
      const byId = new Map(
        (currentSchema.discoveredRelationships ?? []).map((relationship) => [
          relationship.id,
          relationship,
        ]),
      );
      for (const relationship of relationships) {
        byId.set(relationship.id, {
          ...relationship,
          status: "confirmed",
        });
      }
      await persistSchema({
        ...currentSchema,
        discoveredRelationships: [...byId.values()],
      });
    },
    [persistSchema],
  );

  const schemaAgentContext = useMemo<SchemaAgentContext>(
    () => ({
      focusTable: (tableId) => focusTableRef.current(tableId),
      getDocumentName: () => currentDocumentRef.current?.name,
      getSchema: () => schemaRef.current,
      getSelectedTableId: () => selectedTableIdRef.current,
      organizeCanvas,
      applyRelationships,
    }),
    [applyRelationships, organizeCanvas],
  );

  const openDocument = (document: SchemaDocument) => {
    setCurrentDocument(document);
    setSchema(document.schema);
    setSelectedTableId(undefined);
    setViewMode("all");
    setSearch("");
    setSelectedRelationshipId(undefined);
    void setCurrentDocumentId(document.id);
  };

  const openRenameDocument = () => {
    if (!currentDocument) return;
    setDocumentName(currentDocument.name);
    setRenameOpen(true);
  };

  const renameDocument = async () => {
    const name = documentName.trim();
    if (!currentDocument || !name) return;
    const renamedDocument = {
      ...currentDocument,
      name,
      updatedAt: new Date().toISOString(),
    };
    try {
      await saveSchemaDocument(renamedDocument);
      setCurrentDocument(renamedDocument);
      setDocuments((current) =>
        current.map((document) =>
          document.id === renamedDocument.id ? renamedDocument : document,
        ),
      );
      setRenameOpen(false);
    } catch (storageError) {
      setError(
        storageError instanceof Error ? storageError.message : "无法重命名结构",
      );
    }
  };

  const deleteDocument = async () => {
    if (!currentDocument) return;
    try {
      await deleteSchemaDocument(currentDocument.id);
      const nextDocuments = await listSchemaDocuments();
      const nextDocument = nextDocuments[0];
      setDocuments(nextDocuments);
      setCurrentDocument(nextDocument);
      setSchema(nextDocument?.schema);
      setSelectedTableId(undefined);
      setViewMode("all");
      setSearch("");
      setAiOpen(false);
      if (nextDocument) await setCurrentDocumentId(nextDocument.id);
      setDeleteOpen(false);
    } catch (storageError) {
      setError(
        storageError instanceof Error ? storageError.message : "无法删除结构",
      );
    }
  };

  const runSearch = () => {
    const match = searchMatches[0];
    if (!match) return;
    selectAndFocus(match.id);
    setSearch(match.displayName);
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const sql = await file.text();
      if (!sql.trim()) throw new Error("文件内容为空");
      parseSql(sql, file.name.replace(/\.(sql|txt)$/i, "") || file.name);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "无法读取文件");
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    void importFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    void importFile(event.dataTransfer.files?.[0]);
  };

  const importPastedSql = () => {
    const sql = pastedSql.trim();
    if (!sql) return;
    const existingNames = new Set(documents.map((document) => document.name));
    let suffix = 1;
    let name = "未命名结构";
    while (existingNames.has(name)) {
      suffix += 1;
      name = `未命名结构 ${suffix}`;
    }
    parseSql(sql, name);
    setPasteOpen(false);
    setPastedSql("");
  };

  const logicalRelationships = (schema?.discoveredRelationships ?? []).filter(
    (relationship) => relationship.status !== "rejected",
  );
  const tableNames = new Map(
    (schema?.tables ?? []).map((table) => [table.id, table.displayName]),
  );
  const allRelationships = [
    ...(schema?.relationships ?? []).map((relationship) => ({
      ...relationship,
      kind: "constraint" as const,
      origin: "database" as const,
      explanation: "数据库 DDL 中显式声明的外键约束。",
      evidence: [] as string[],
      cardinality: undefined,
      confidence: undefined,
    })),
    ...logicalRelationships.map((relationship) => ({
      ...relationship,
      kind: "logical" as const,
    })),
  ];
  const selectedRelationship = allRelationships.find(
    (relationship) => relationship.id === selectedRelationshipId,
  );
  const createManualRelationship = useCallback(async (
    sourceEndpoint: RelationshipEndpoint,
    targetEndpoint: RelationshipEndpoint,
  ) => {
    const currentSchema = schemaRef.current;
    if (!currentSchema) return;
    const source = currentSchema.tables.find(
      (table) => table.id === sourceEndpoint.tableId,
    );
    const sourceColumn = source?.columns.find(
      (column) => column.name === sourceEndpoint.column,
    );
    const target = currentSchema.tables.find(
      (table) => table.id === targetEndpoint.tableId,
    );
    if (
      !sourceColumn ||
      !target?.columns.some((column) => column.name === targetEndpoint.column)
    ) {
      throw new Error("连接的字段不存在，请重新选择。");
    }
    const duplicate = [
      ...currentSchema.relationships,
      ...(currentSchema.discoveredRelationships ?? []).filter(
        (relationship) => relationship.status !== "rejected",
      ),
    ].some(
      (relationship) =>
        relationship.sourceTableId === sourceEndpoint.tableId &&
        relationship.targetTableId === targetEndpoint.tableId &&
        relationship.sourceColumns.join("\u0000") === sourceEndpoint.column &&
        relationship.targetColumns.join("\u0000") === targetEndpoint.column,
    );
    if (duplicate) throw new Error("这条关系已经存在。");
    const relationship: SchemaDiscoveredRelationship = {
      id: `manual:${crypto.randomUUID()}`,
      sourceTableId: sourceEndpoint.tableId,
      sourceColumns: [sourceEndpoint.column],
      targetTableId: targetEndpoint.tableId,
      targetColumns: [targetEndpoint.column],
      cardinality: "many-to-one",
      optional: sourceColumn?.nullable ?? true,
      confidence: "high",
      explanation: "用户在画布中直接创建的逻辑关系。",
      evidence: [],
      origin: "manual",
      status: "confirmed",
      createdAt: new Date().toISOString(),
    };
    await persistSchema({
      ...currentSchema,
      discoveredRelationships: [
        ...(currentSchema.discoveredRelationships ?? []),
        relationship,
      ],
    });
    setSelectedTableId(relationship.sourceTableId);
    setSelectedRelationshipId(relationship.id);
  }, [persistSchema]);

  const createRelationshipFromCanvas = useCallback(
    (source: RelationshipEndpoint, target: RelationshipEndpoint) => {
      void createManualRelationship(source, target).catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : "无法创建关系",
        ),
      );
    },
    [createManualRelationship],
  );

  const deleteLogicalRelationship = async (id: string) => {
    const currentSchema = schemaRef.current;
    if (!currentSchema) return;
    await persistSchema({
      ...currentSchema,
      discoveredRelationships: (
        currentSchema.discoveredRelationships ?? []
      ).filter((relationship) => relationship.id !== id),
    });
    setSelectedRelationshipId(undefined);
  };

  return (
    <TooltipProvider delayDuration={250}>
      <main
        className="flex h-screen min-w-[960px] flex-col bg-background text-foreground"
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
        onDrop={handleDrop}
      >
        <header className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
          <div className="flex min-w-[180px] items-center">
            {currentDocument && documents.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="max-w-[180px] px-2 font-normal">
                    <span className="truncate">{currentDocument.name}</span>
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {documents.map((document) => (
                    <DropdownMenuItem
                      key={document.id}
                      onSelect={() => openDocument(document)}
                    >
                      <span className="truncate">{document.name}</span>
                      {document.id === currentDocument.id ? <Check className="ml-auto" /> : null}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={openRenameDocument}>
                    <Pencil />
                    重命名当前结构
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDeleteOpen(true)}
                  >
                    <Trash2 />
                    删除当前结构
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>

          {schema ? (
            <div className="relative mx-auto w-full max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && runSearch()}
                placeholder="搜索表名"
                className="pl-9"
              />
              {searchMatches.length && search.trim() ? (
                <Card className="absolute left-0 right-0 top-11 z-30 overflow-hidden p-1 shadow-xl">
                  {searchMatches.map((table) => (
                    <Button
                      key={table.id}
                      variant="ghost"
                      className="h-9 w-full justify-between px-2.5 text-xs font-normal"
                      onClick={() => { setSearch(table.displayName); selectAndFocus(table.id); }}
                    >
                      <span className="truncate">{table.displayName}</span>
                      <span className="text-[10px] text-muted-foreground">{table.columns.length} 字段</span>
                    </Button>
                  ))}
                </Card>
              ) : null}
            </div>
          ) : <div className="flex-1" />}

          {schema ? (
            <Button
              variant={aiOpen ? "secondary" : "outline"}
              className="shrink-0"
              onClick={() => setAiOpen((open) => !open)}
            >
              <Sparkles />Copilot
            </Button>
          ) : null}

          {schema ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" className="shrink-0">
                  <GitFork />
                  {viewMode === "all" ? "全部表" : "关联子图"}
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem onSelect={() => setViewMode("all")}>
                  全部表
                  {viewMode === "all" ? <Check className="ml-auto" /> : null}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!selectedTableId}
                  onSelect={() => setViewMode("related")}
                >
                  关联子图
                  {viewMode === "related" ? <Check className="ml-auto" /> : null}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <input ref={fileInputRef} hidden type="file" onChange={handleFileInput} />
          <ImportSqlMenu
            onPaste={() => setPasteOpen(true)}
            onSelectFile={() => fileInputRef.current?.click()}
          />
        </header>

        <section className="min-h-0 flex-1">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel id="schema-workspace" minSize="45">
            <div className="relative h-full min-w-0 overflow-hidden bg-muted/20">
              {schema && schema.tables.length ? (
                <SchemaGraph
                  ref={graphRef}
                  schema={schema}
                  selectedTableId={selectedTableId}
                  selectedRelationshipId={selectedRelationshipId}
                  viewMode={viewMode}
                  onCreateRelationship={createRelationshipFromCanvas}
                  onSelectTable={selectTableFromGraph}
                  onSelectRelationship={setSelectedRelationshipId}
                />
              ) : !isParsing ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <h2 className="text-base font-semibold">导入 SQL</h2>
                  <div className="mt-5">
                    <ImportSqlMenu
                      align="center"
                      onPaste={() => setPasteOpen(true)}
                      onSelectFile={() => fileInputRef.current?.click()}
                    />
                  </div>
                </div>
              ) : null}

              <Card className="absolute right-3 top-3 z-10 flex gap-0.5 p-1 shadow-md">
                <IconControl label="放大" onClick={() => graphRef.current?.zoomIn()}><ZoomIn /></IconControl>
                <IconControl label="缩小" onClick={() => graphRef.current?.zoomOut()}><ZoomOut /></IconControl>
                <IconControl label="适应画布" onClick={() => graphRef.current?.fit()}><Maximize2 /></IconControl>
                {selectedTableId ? <IconControl label="定位选中表" onClick={() => graphRef.current?.focus(selectedTableId)}><Focus /></IconControl> : null}
              </Card>

              {selectedRelationship ? (
                <Card className="absolute bottom-3 right-3 z-20 w-[360px] p-4 shadow-xl">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm">关系详情</strong>
                    <Badge variant={selectedRelationship.origin === "database" ? "outline" : "secondary"}>
                      {selectedRelationship.origin === "database"
                        ? "数据库外键"
                        : selectedRelationship.origin === "ai"
                          ? "AI 关系"
                          : "手动关系"}
                    </Badge>
                    <Button
                      className="ml-auto h-7 px-2"
                      onClick={() => setSelectedRelationshipId(undefined)}
                      size="sm"
                      variant="ghost"
                    >
                      关闭
                    </Button>
                  </div>
                  <div className="mt-4 text-sm font-medium">
                    {tableNames.get(selectedRelationship.sourceTableId)}.
                    {selectedRelationship.sourceColumns.join(", ")}
                    <span className="mx-2 text-muted-foreground">→</span>
                    {tableNames.get(selectedRelationship.targetTableId)}.
                    {selectedRelationship.targetColumns.join(", ")}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedRelationship.cardinality ? (
                      <Badge variant="outline">
                        {cardinalityLabels[selectedRelationship.cardinality]}
                      </Badge>
                    ) : null}
                    {selectedRelationship.origin === "ai" && selectedRelationship.confidence ? (
                      <Badge variant="outline">
                        {confidenceLabels[selectedRelationship.confidence]}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm">{selectedRelationship.explanation}</p>
                  {selectedRelationship.evidence.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {selectedRelationship.evidence.map((evidence) => (
                        <li key={evidence}>• {evidence}</li>
                      ))}
                    </ul>
                  ) : null}
                  {selectedRelationship.origin === "database" ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      真实外键需要修改 SQL 后重新导入。
                    </p>
                  ) : (
                    <Button
                      className="mt-4"
                      onClick={() =>
                        void deleteLogicalRelationship(
                          selectedRelationship.id,
                        ).catch((reason: unknown) =>
                          setError(
                            reason instanceof Error
                              ? reason.message
                              : "无法删除关系",
                          ),
                        )
                      }
                      size="sm"
                      variant="destructive"
                    >
                      <Trash2 />删除关系
                    </Button>
                  )}
                </Card>
              ) : null}

              {isParsing ? (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/75 backdrop-blur-sm">
                  <div className="size-8 animate-spin rounded-full border-[3px] border-muted border-t-primary" />
                  <strong className="mt-4 text-sm">正在解析 SQL</strong>
                </div>
              ) : null}

              {error ? (
                <Card className="absolute left-4 right-4 top-4 z-30 border-destructive/40 bg-destructive/10 p-3 shadow-lg">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 text-xs font-semibold text-destructive">操作失败</div>
                    <pre className="max-h-20 min-w-0 flex-1 overflow-auto whitespace-pre-wrap text-[11px] text-destructive/80">{error}</pre>
                    <Button variant="ghost" size="sm" className="h-7 text-destructive" onClick={() => setError(undefined)}>关闭</Button>
                  </div>
                </Card>
              ) : null}
            </div>
            </ResizablePanel>

            {aiOpen && schema ? (
              <>
                <ResizableHandle />
                <ResizablePanel
                  id="schema-ai"
                  defaultSize={380}
                  minSize={320}
                  maxSize="45"
                >
                  <AiSidebar
                    key={currentDocument?.id}
                    context={schemaAgentContext}
                    onClose={() => setAiOpen(false)}
                    selectedTableName={selectedTable?.displayName}
                    workspaceId={currentDocument?.id ?? "schema-atlas"}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        </section>

        <div className={cn(
          "pointer-events-none fixed inset-3 z-50 flex scale-[.98] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-background/90 opacity-0 backdrop-blur-md transition-all",
          dragging && "scale-100 opacity-100",
        )}>
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg"><Upload className="size-5" /></div>
          <strong className="mt-4 text-base">松开以导入 SQL</strong>
        </div>

        <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>粘贴 SQL</DialogTitle>
              <DialogDescription className="sr-only">粘贴 SQL 内容并导入</DialogDescription>
            </DialogHeader>
            <Textarea
              autoFocus
              value={pastedSql}
              onChange={(event) => setPastedSql(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") importPastedSql();
              }}
              placeholder="粘贴 MySQL DDL"
              className="h-[360px] resize-none font-mono text-xs"
            />
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">取消</Button></DialogClose>
              <Button disabled={!pastedSql.trim()} onClick={importPastedSql}>导入</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>重命名结构</DialogTitle>
              <DialogDescription className="sr-only">修改当前数据库结构名称</DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={documentName}
              onChange={(event) => setDocumentName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void renameDocument();
              }}
              placeholder="结构名称"
            />
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">取消</Button></DialogClose>
              <Button disabled={!documentName.trim()} onClick={() => void renameDocument()}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>删除“{currentDocument?.name}”？</DialogTitle>
              <DialogDescription>
                SQL 结构和对应的 AI 历史会话将被删除，此操作无法撤销。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">取消</Button></DialogClose>
              <Button variant="destructive" onClick={() => void deleteDocument()}>删除</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </TooltipProvider>
  );
}
