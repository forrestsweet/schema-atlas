import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import type {
  SchemaManualRelationship,
  SchemaModel,
  SchemaRelationship,
  SchemaTable,
} from "@/lib/schema-types";

export type SchemaAgentContext = {
  focusTable: (tableId: string) => void;
  getDocumentName: () => string | undefined;
  getSchema: () => SchemaModel | undefined;
  getSelectedTableId: () => string | undefined;
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

const manualRelationshipView = (
  relationship: SchemaManualRelationship,
  tables: ReadonlyMap<string, SchemaTable>,
) => ({
  id: relationship.id,
  sourceTable: tables.get(relationship.sourceTableId)?.displayName,
  sourceColumns: relationship.sourceColumns,
  targetTable: tables.get(relationship.targetTableId)?.displayName,
  targetColumns: relationship.targetColumns,
  cardinality: relationship.cardinality,
  optional: relationship.optional,
});

const tableView = (schema: SchemaModel, table: SchemaTable) => {
  const tables = new Map(schema.tables.map((candidate) => [candidate.id, candidate]));
  const relationships = schema.relationships.filter(
    (relationship) =>
      relationship.sourceTableId === table.id ||
      relationship.targetTableId === table.id,
  );
  const manualRelationships = (schema.manualRelationships ?? []).filter(
    (relationship) =>
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
    manualRelationships: manualRelationships.map((relationship) =>
      manualRelationshipView(relationship, tables),
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
        `共 ${schema.tables.length} 张表、${schema.relationships.length} 条外键关系、${schema.manualRelationships?.length ?? 0} 条手动关系。`,
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
- 关系分析只基于数据库中显式声明的外键和用户手动创建的关系。不要自动推断、创建或补全关系。
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
      "分页读取当前 Schema 的全部表、字段、类型、键和注释。",
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
    description: "读取一张表的字段、索引、直接外键和手动关系。",
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
    description: "读取指定表一到两层范围内的相关表、外键和手动连接。",
    parameters: neighborsSchema,
    execute: async (_id, { table, depth = 1 }) => {
      const schema = requireSchema(context);
      const root = findTable(schema, String(table));
      const maxDepth = Math.min(Math.max(Number(depth), 1), 2);
      const relationships = [
        ...schema.relationships.map((relationship) => ({
          ...relationship,
          kind: "database" as const,
        })),
        ...(schema.manualRelationships ?? []).map((relationship) => ({
          ...relationship,
          kind: "manual" as const,
          name: "手动关系",
        })),
      ];
      const ids = new Set([root.id]);
      let frontier = new Set([root.id]);
      for (let level = 0; level < maxDepth; level += 1) {
        const next = new Set<string>();
        for (const relationship of relationships) {
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
        relationships: relationships
          .filter(
            (relationship) =>
              ids.has(relationship.sourceTableId) &&
              ids.has(relationship.targetTableId),
          )
          .map((relationship) => ({
            ...relationshipView(relationship, tables),
            kind: relationship.kind,
          })),
      });
    },
  };

  const relationshipMapSchema = Type.Object({});
  const relationshipMap: AgentTool<typeof relationshipMapSchema> = {
    name: "schema_relationship_map",
    label: "读取关系地图",
    description:
      "紧凑读取当前结构的全部显式外键和手动关系，用于规划整个画布。",
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
          ...(schema.manualRelationships ?? []).map((relationship) => ({
            kind: "manual",
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

  return [
    overview,
    catalog,
    search,
    getTable,
    neighbors,
    relationshipMap,
    focus,
  ];
};
