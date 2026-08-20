import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import type {
  SchemaCanvasLayoutPlan,
  SchemaDiscoveredRelationship,
  SchemaModel,
  SchemaRelationship,
  SchemaTable,
} from "@/lib/schema-types";

export type SchemaAgentContext = {
  focusTable: (tableId: string) => void;
  getDocumentName: () => string | undefined;
  getSchema: () => SchemaModel | undefined;
  getSelectedTableId: () => string | undefined;
  organizeCanvas: (plan: SchemaCanvasLayoutPlan) => Promise<void>;
  applyRelationships: (
    relationships: SchemaDiscoveredRelationship[],
  ) => Promise<void>;
};

const result = (value: unknown) => ({
  content: [
    {
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      type: "text" as const,
    },
  ],
  details: value,
});

const requireSchema = (context: SchemaAgentContext): SchemaModel => {
  const schema = context.getSchema();
  if (!schema) throw new Error("当前没有已导入的数据库结构。");
  return schema;
};

const findTable = (schema: SchemaModel, value: string): SchemaTable => {
  const normalized = value.trim().toLowerCase();
  const table = schema.tables.find(
    (candidate) =>
      candidate.id.toLowerCase() === normalized ||
      candidate.name.toLowerCase() === normalized ||
      candidate.displayName.toLowerCase() === normalized,
  );
  if (!table) throw new Error(`没有找到数据表：${value}`);
  return table;
};

const relationshipView = (
  relationship: SchemaRelationship,
  tables: ReadonlyMap<string, SchemaTable>,
) => ({
  name: relationship.name,
  sourceTable: tables.get(relationship.sourceTableId)?.displayName,
  sourceColumns: relationship.sourceColumns,
  targetTable: tables.get(relationship.targetTableId)?.displayName,
  targetColumns: relationship.targetColumns,
  onDelete: relationship.onDelete,
  onUpdate: relationship.onUpdate,
});

const discoveredRelationshipView = (
  relationship: SchemaDiscoveredRelationship,
  tables: ReadonlyMap<string, SchemaTable>,
) => ({
  id: relationship.id,
  sourceTable: tables.get(relationship.sourceTableId)?.displayName,
  sourceColumns: relationship.sourceColumns,
  targetTable: tables.get(relationship.targetTableId)?.displayName,
  targetColumns: relationship.targetColumns,
  cardinality: relationship.cardinality,
  optional: relationship.optional,
  confidence: relationship.confidence,
  explanation: relationship.explanation,
  origin: relationship.origin,
  status: relationship.status,
});

const tableView = (schema: SchemaModel, table: SchemaTable) => {
  const tables = new Map(schema.tables.map((candidate) => [candidate.id, candidate]));
  const relationships = schema.relationships.filter(
    (relationship) =>
      relationship.sourceTableId === table.id ||
      relationship.targetTableId === table.id,
  );
  const discoveredRelationships = (
    schema.discoveredRelationships ?? []
  ).filter(
    (relationship) =>
      relationship.status !== "rejected" &&
      (relationship.sourceTableId === table.id ||
        relationship.targetTableId === table.id),
  );
  return {
    name: table.displayName,
    comment: table.comment,
    columns: table.columns.map((column) => ({
      name: column.name,
      type: column.dataType,
      nullable: column.nullable,
      primaryKey: column.primaryKey,
      unique: column.unique,
      autoIncrement: column.autoIncrement,
      default: column.defaultValue,
      comment: column.comment,
    })),
    indexes: table.indexes,
    relationships: relationships.map((relationship) =>
      relationshipView(relationship, tables),
    ),
    discoveredRelationships: discoveredRelationships.map((relationship) =>
      discoveredRelationshipView(relationship, tables),
    ),
  };
};

export const buildSchemaSystemPrompt = (context: SchemaAgentContext) => {
  const schema = context.getSchema();
  const selected = schema?.tables.find(
    (table) => table.id === context.getSelectedTableId(),
  );
  const activeContext = schema
    ? [
        `当前结构：${context.getDocumentName() ?? "未命名结构"}`,
        `共 ${schema.tables.length} 张表、${schema.relationships.length} 条外键关系。`,
        selected ? `画布当前选中表：${selected.displayName}` : "画布当前没有选中表。",
      ].join("\n")
    : "当前尚未导入数据库结构。";

  return `你是 Schema Atlas 内的数据库结构智能体，底层运行于 Pi Agent Loop。

你的工作是帮助用户理解当前导入的 MySQL DDL、分析表关系并编写可靠的 MySQL SQL。

规则：
- 当前应用只保存和分析 DDL，不连接数据库，也不能执行 SQL。不要声称已经查询或修改了真实数据。
- 生成 SQL 前，必须使用 schema_search、schema_get_table 或 schema_get_neighbors 核对真实表名、字段和关系。
- 不得编造不存在的表、字段、索引或外键。信息不足时明确指出缺少什么。
- 默认生成 MySQL 8 兼容 SQL。SQL 放在带 mysql 标识的代码块中，并简要说明关键连接条件。
- 面对 2300 张表时按需调用工具，不要要求把完整结构放进上下文。
- 当用户要求“关系发现”时，由你自主理解 Schema，不使用固定命名规则或程序评分。先连续调用 schema_list_catalog 阅读完整目录；需要核对时再调用 schema_get_table，最后用 schema_apply_relationships 直接应用逻辑关系。
- AI 发现的关系会直接显示在画布中，但不能声称它们是数据库显式外键。每条关系必须给出简洁的业务解释和可核对证据，并且只能引用真实存在的表与字段。
- 用户要求整理、重排或优化画布时，先调用 schema_relationship_map 理解完整关系图，再按需分页调用 schema_list_catalog 理解业务语义，最后调用 canvas_organize 提交由你设计的布局方案。
- 设计画布布局时不要输出像素坐标。把全部表恰好放入一个布局泳道：上游主数据靠左、核心业务过程居中、明细/日志/结果靠右；高度过高时增加泳道数量，并让强关联表在相邻泳道的相近位置。通常使用 4 至 10 个泳道，避免少数泳道无限向下延伸。
- 用户要求查找或查看某张表时，可以调用 canvas_focus_table 在画布中定位。
- 回答保持简洁，优先给出可直接使用的结果。

${activeContext}`;
};

export const createSchemaTools = (
  context: SchemaAgentContext,
): AgentTool[] => {
  const overviewSchema = Type.Object({});
  const overview: AgentTool<typeof overviewSchema> = {
    name: "schema_overview",
    label: "数据库结构概览",
    description: "读取当前导入结构的表、字段、关系数量和当前选中表。",
    parameters: overviewSchema,
    execute: async () => {
      const schema = requireSchema(context);
      const selected = schema.tables.find(
        (table) => table.id === context.getSelectedTableId(),
      );
      return result({
        document: context.getDocumentName(),
        tableCount: schema.tables.length,
        columnCount: schema.stats.columnCount,
        relationshipCount: schema.relationships.length,
        selectedTable: selected?.displayName,
      });
    },
  };

  const catalogSchema = Type.Object({
    page: Type.Optional(
      Type.Number({ description: "页码，从 1 开始，默认 1" }),
    ),
    pageSize: Type.Optional(
      Type.Number({ description: "每页表数量，默认 40，最大 80" }),
    ),
  });
  const catalog: AgentTool<typeof catalogSchema> = {
    name: "schema_list_catalog",
    label: "读取结构目录",
    description:
      "分页读取当前 Schema 的全部表、字段、类型、键和注释。关系发现时应从第 1 页开始连续读取到最后一页，由模型自主分析，不做关系规则筛选。",
    parameters: catalogSchema,
    execute: async (_id, { page = 1, pageSize = 40 }) => {
      const schema = requireSchema(context);
      const size = Math.min(Math.max(Math.floor(Number(pageSize)), 1), 80);
      const currentPage = Math.min(
        Math.max(Math.floor(Number(page)), 1),
        Math.max(Math.ceil(schema.tables.length / size), 1),
      );
      const totalPages = Math.max(Math.ceil(schema.tables.length / size), 1);
      const start = (currentPage - 1) * size;
      return result({
        page: currentPage,
        pageSize: size,
        totalPages,
        totalTables: schema.tables.length,
        nextPage: currentPage < totalPages ? currentPage + 1 : undefined,
        tables: schema.tables.slice(start, start + size).map((table) => ({
          name: table.displayName,
          comment: table.comment,
          indexes: table.indexes,
          columns: table.columns.map((column) => ({
            name: column.name,
            type: column.dataType,
            comment: column.comment,
            nullable: column.nullable,
            primaryKey: column.primaryKey,
            unique: column.unique,
            autoIncrement: column.autoIncrement,
            defaultValue: column.defaultValue,
          })),
        })),
      });
    },
  };

  const searchSchema = Type.Object({
    query: Type.String({
      description: "表名、表注释、字段名或字段注释中的关键词",
    }),
    limit: Type.Optional(
      Type.Number({ description: "返回数量，默认 12，最大 30" }),
    ),
  });
  const search: AgentTool<typeof searchSchema> = {
    name: "schema_search",
    label: "搜索数据表",
    description:
      "按表名、注释和字段搜索当前结构。先用它找到可能相关的表，再读取表详情。",
    parameters: searchSchema,
    execute: async (_id, { query, limit = 12 }) => {
      const schema = requireSchema(context);
      const keyword = String(query).trim().toLowerCase();
      if (!keyword) return result([]);
      const matches = schema.tables
        .map((table) => {
          const name = table.displayName.toLowerCase();
          const comment = table.comment?.toLowerCase() ?? "";
          const columns = table.columns.filter((column) =>
            [column.name, column.comment ?? ""]
              .join(" ")
              .toLowerCase()
              .includes(keyword),
          );
          const score =
            (name === keyword ? 100 : name.includes(keyword) ? 60 : 0) +
            (comment.includes(keyword) ? 25 : 0) +
            Math.min(columns.length * 5, 20);
          return { table, columns, score };
        })
        .filter((match) => match.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, Math.min(Math.max(Number(limit), 1), 30))
        .map(({ table, columns }) => ({
          table: table.displayName,
          comment: table.comment,
          matchingColumns: columns.slice(0, 8).map((column) => column.name),
          columnCount: table.columns.length,
        }));
      return result(matches);
    },
  };

  const getTableSchema = Type.Object({
    table: Type.String({ description: "完整表名或搜索结果中的表名" }),
  });
  const getTable: AgentTool<typeof getTableSchema> = {
    name: "schema_get_table",
    label: "读取表结构",
    description: "读取一张表的字段、索引和直接外键关系。",
    parameters: getTableSchema,
    execute: async (_id, { table }) => {
      const schema = requireSchema(context);
      return result(tableView(schema, findTable(schema, String(table))));
    },
  };

  const neighborsSchema = Type.Object({
    table: Type.String({ description: "起点表名" }),
    depth: Type.Optional(
      Type.Number({ description: "关系深度，只支持 1 或 2，默认 1" }),
    ),
  });
  const neighbors: AgentTool<typeof neighborsSchema> = {
    name: "schema_get_neighbors",
    label: "分析表关系",
    description: "读取指定表一到两层范围内的相关表和外键连接。",
    parameters: neighborsSchema,
    execute: async (_id, { table, depth = 1 }) => {
      const schema = requireSchema(context);
      const root = findTable(schema, String(table));
      const maxDepth = Math.min(Math.max(Number(depth), 1), 2);
      const ids = new Set([root.id]);
      let frontier = new Set([root.id]);
      for (let level = 0; level < maxDepth; level += 1) {
        const next = new Set<string>();
        for (const relationship of schema.relationships) {
          if (frontier.has(relationship.sourceTableId)) {
            next.add(relationship.targetTableId);
          }
          if (frontier.has(relationship.targetTableId)) {
            next.add(relationship.sourceTableId);
          }
        }
        for (const id of next) ids.add(id);
        frontier = next;
        if (ids.size > 60) break;
      }
      const tables = new Map(schema.tables.map((candidate) => [candidate.id, candidate]));
      return result({
        root: root.displayName,
        tables: [...ids]
          .map((id) => tables.get(id)?.displayName)
          .filter(Boolean),
        relationships: schema.relationships
          .filter(
            (relationship) =>
              ids.has(relationship.sourceTableId) &&
              ids.has(relationship.targetTableId),
          )
          .map((relationship) => relationshipView(relationship, tables)),
      });
    },
  };

  const relationshipMapSchema = Type.Object({});
  const relationshipMap: AgentTool<typeof relationshipMapSchema> = {
    name: "schema_relationship_map",
    label: "读取关系地图",
    description:
      "紧凑读取当前结构的全部显式外键和已发现逻辑关系，用于规划整个画布。",
    parameters: relationshipMapSchema,
    execute: async () => {
      const schema = requireSchema(context);
      const tables = new Map(
        schema.tables.map((table) => [table.id, table.displayName]),
      );
      return result({
        tables: schema.tables.map((table) => ({
          name: table.displayName,
          comment: table.comment,
        })),
        relationships: [
          ...schema.relationships.map((relationship) => ({
            kind: "database",
            source: tables.get(relationship.sourceTableId),
            sourceColumns: relationship.sourceColumns,
            target: tables.get(relationship.targetTableId),
            targetColumns: relationship.targetColumns,
          })),
          ...(schema.discoveredRelationships ?? [])
            .filter((relationship) => relationship.status !== "rejected")
            .map((relationship) => ({
              kind: relationship.origin,
              source: tables.get(relationship.sourceTableId),
              sourceColumns: relationship.sourceColumns,
              target: tables.get(relationship.targetTableId),
              targetColumns: relationship.targetColumns,
            })),
        ],
      });
    },
  };

  const focusSchema = Type.Object({
    table: Type.String({ description: "需要在画布中定位的表名" }),
  });
  const focus: AgentTool<typeof focusSchema> = {
    name: "canvas_focus_table",
    label: "定位数据表",
    description: "在 Schema Atlas 画布中选中并定位一张表。",
    parameters: focusSchema,
    execute: async (_id, { table }) => {
      const schema = requireSchema(context);
      const target = findTable(schema, String(table));
      context.focusTable(target.id);
      return result({ focused: true, table: target.displayName });
    },
  };

  const organizeSchema = Type.Object({
    summary: Type.Optional(
      Type.String({ description: "一句话说明本次布局思路" }),
    ),
    lanes: Type.Array(
      Type.Object({
        name: Type.String({ description: "面向用户的业务泳道名称" }),
        tables: Type.Array(Type.String(), {
          description: "该泳道中的完整表名，顺序就是从上到下的卡片顺序",
        }),
      }),
      {
        description:
          "从左到右的画布泳道。尽量包含当前结构的全部表且每张表只出现一次",
        maxItems: 16,
        minItems: 1,
      },
    ),
  });
  const organize: AgentTool<typeof organizeSchema> = {
    name: "canvas_organize",
    label: "应用 AI 画布布局",
    description:
      "提交你根据业务语义和完整关系图设计的泳道布局。应用会把泳道转换成安全坐标、重新计算线道并适应视图。",
    parameters: organizeSchema,
    execute: async (_id, { lanes, summary }) => {
      const schema = requireSchema(context);
      const tablesByName = new Map(
        schema.tables.flatMap((table) => [
          [table.id.toLowerCase(), table] as const,
          [table.name.toLowerCase(), table] as const,
          [table.displayName.toLowerCase(), table] as const,
        ]),
      );
      const assigned = new Set<string>();
      const normalizedLanes = lanes.flatMap((lane) => {
        const tableIds = lane.tables.flatMap((value) => {
          const table = tablesByName.get(String(value).trim().toLowerCase());
          if (!table) throw new Error(`布局中包含未知数据表：${value}`);
          if (assigned.has(table.id)) return [];
          assigned.add(table.id);
          return [table.id];
        });
        return tableIds.length > 0
          ? [{ name: String(lane.name).trim() || "未命名泳道", tableIds }]
          : [];
      });
      const unassigned = schema.tables
        .filter((table) => !assigned.has(table.id))
        .map((table) => table.id);
      if (unassigned.length > 0) {
        normalizedLanes.push({ name: "其他", tableIds: unassigned });
      }
      const plan: SchemaCanvasLayoutPlan = {
        lanes: normalizedLanes,
        summary: summary ? String(summary) : undefined,
      };
      await context.organizeCanvas(plan);
      return result({
        organized: true,
        lanes: plan.lanes.map((lane) => ({
          name: lane.name,
          tableCount: lane.tableIds.length,
        })),
        summary: plan.summary,
      });
    },
  };

  const relationshipProposalSchema = Type.Object({
    relationships: Type.Array(
      Type.Object({
        sourceTable: Type.String({
          description: "包含引用字段的来源表完整名称",
        }),
        sourceColumns: Type.Array(Type.String(), {
          description: "来源表中的引用字段，可包含联合字段",
        }),
        targetTable: Type.String({
          description: "被引用的目标表完整名称",
        }),
        targetColumns: Type.Array(Type.String(), {
          description: "目标表中对应字段，顺序与来源字段一致",
        }),
        cardinality: Type.Union([
          Type.Literal("one-to-one"),
          Type.Literal("one-to-many"),
          Type.Literal("many-to-one"),
          Type.Literal("many-to-many"),
        ]),
        optional: Type.Boolean({
          description: "这条业务关系对来源记录是否可选",
        }),
        confidence: Type.Union([
          Type.Literal("high"),
          Type.Literal("medium"),
          Type.Literal("low"),
        ]),
        explanation: Type.String({
          description: "面向普通用户的一句话业务解释",
        }),
        evidence: Type.Array(Type.String(), {
          description: "模型在当前 Schema 中观察到的证据",
        }),
      }),
      { description: "本轮发现并直接应用的逻辑关系，最多提交 20 条" },
    ),
  });
  const applyRelationships: AgentTool<typeof relationshipProposalSchema> = {
    name: "schema_apply_relationships",
    label: "应用 AI 关系",
    description:
      "将 AI 自主发现的逻辑关系直接应用到 Schema Atlas 画布。它们会标记为 AI 关系，而不是数据库外键。",
    parameters: relationshipProposalSchema,
    execute: async (_id, { relationships }) => {
      const schema = requireSchema(context);
      const existing = new Set(
        (schema.discoveredRelationships ?? [])
          .filter((relationship) => relationship.status !== "rejected")
          .map((relationship) => relationship.id),
      );
      const proposals: SchemaDiscoveredRelationship[] = [];
      let duplicates = 0;

      for (const candidate of relationships.slice(0, 20)) {
        const source = findTable(schema, String(candidate.sourceTable));
        const target = findTable(schema, String(candidate.targetTable));
        const sourceColumns = candidate.sourceColumns.map(String);
        const targetColumns = candidate.targetColumns.map(String);
        if (
          sourceColumns.length === 0 ||
          sourceColumns.length !== targetColumns.length
        ) {
          throw new Error("候选关系的来源字段与目标字段数量必须相同且不能为空。");
        }
        for (const column of sourceColumns) {
          if (!source.columns.some((item) => item.name === column)) {
            throw new Error(`表 ${source.displayName} 中不存在字段 ${column}`);
          }
        }
        for (const column of targetColumns) {
          if (!target.columns.some((item) => item.name === column)) {
            throw new Error(`表 ${target.displayName} 中不存在字段 ${column}`);
          }
        }

        const id = [
          "ai",
          source.id,
          sourceColumns.join(","),
          target.id,
          targetColumns.join(","),
        ].join(":");
        const duplicatesExplicit = schema.relationships.some(
          (relationship) =>
            relationship.sourceTableId === source.id &&
            relationship.targetTableId === target.id &&
            relationship.sourceColumns.join("\u0000") ===
              sourceColumns.join("\u0000") &&
            relationship.targetColumns.join("\u0000") ===
              targetColumns.join("\u0000"),
        );
        if (existing.has(id) || duplicatesExplicit) {
          duplicates += 1;
          continue;
        }
        existing.add(id);
        proposals.push({
          id,
          sourceTableId: source.id,
          sourceColumns,
          targetTableId: target.id,
          targetColumns,
          cardinality: candidate.cardinality,
          optional: Boolean(candidate.optional),
          confidence: candidate.confidence,
          explanation: String(candidate.explanation).trim(),
          evidence: candidate.evidence.map(String).filter(Boolean).slice(0, 8),
          origin: "ai",
          status: "confirmed",
          createdAt: new Date().toISOString(),
        });
      }

      if (proposals.length > 0) {
        await context.applyRelationships(proposals);
      }
      return result({
        added: proposals.length,
        duplicates,
        relationships: proposals.map((relationship) =>
          discoveredRelationshipView(
            relationship,
            new Map(
              schema.tables.map((table) => [table.id, table] as const),
            ),
          ),
        ),
      });
    },
  };

  return [
    overview,
    catalog,
    search,
    getTable,
    neighbors,
    relationshipMap,
    focus,
    organize,
    applyRelationships,
  ];
};
