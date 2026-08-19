/// <reference lib="webworker" />

import { Parser } from "node-sql-parser";
import type {
  SchemaColumn,
  SchemaIndex,
  SchemaModel,
  SchemaRelationship,
  SchemaTable,
  WorkerParseRequest,
  WorkerParseResponse,
} from "@/lib/schema-types";

type AstNode = Record<string, unknown>;

const parser = new Parser();

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function object(value: unknown): AstNode {
  return value && typeof value === "object" ? (value as AstNode) : {};
}

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

function identifier(value: unknown): string {
  const node = object(value);
  return text(node.column || node.table || node.value || value).replaceAll("`", "");
}

function tableRef(value: unknown): { database?: string; name: string } {
  const first = object(asArray(value)[0]);
  const database = text(first.db).replaceAll("`", "");
  const name = text(first.table).replaceAll("`", "");
  return { database: database || undefined, name };
}

function tableId(database: string | undefined, name: string): string {
  return database ? `${database}.${name}` : name;
}

function columnType(definitionValue: unknown): string {
  const definition = object(definitionValue);
  const base = text(definition.dataType).toUpperCase() || "UNKNOWN";
  const length = definition.length;
  const scale = definition.scale;
  const expr = object(definition.expr);
  const values = asArray(expr.value)
    .map((entry) => text(object(entry).value))
    .filter(Boolean);

  if (values.length) return `${base}(${values.map((v) => `'${v}'`).join(", ")})`;
  if (length != null && scale != null) return `${base}(${length},${scale})`;
  if (length != null) return `${base}(${length})`;
  return base;
}

function expressionText(value: unknown): string | undefined {
  const node = object(value);
  const type = text(node.type);
  if (!type) return undefined;
  if (type === "null") return "NULL";
  if (type === "function") {
    const nameNode = object(node.name);
    const names = asArray(nameNode.name);
    const name = names.map((item) => text(object(item).value)).filter(Boolean).join(".");
    return name ? `${name}${node.args ? "(...)" : ""}` : undefined;
  }
  const valueText = text(node.value);
  if (!valueText) return undefined;
  if (type.includes("string")) return `'${valueText}'`;
  return valueText;
}

function columnNames(value: unknown): string[] {
  return asArray(value).map(identifier).filter(Boolean);
}

function actionValue(referenceValue: unknown, actionName: string): string | undefined {
  const reference = object(referenceValue);
  const action = asArray(reference.on_action)
    .map(object)
    .find((item) => text(item.type).toLowerCase() === actionName);
  const value = text(object(action?.value).value);
  return value ? value.toUpperCase() : undefined;
}

function tableComment(statement: AstNode): string | undefined {
  const option = asArray(statement.table_options)
    .map(object)
    .find((item) => text(item.keyword).toLowerCase() === "comment");
  const value = text(option?.value).replace(/^['"]|['"]$/g, "");
  return value || undefined;
}

function collectForeignKey(
  definitionValue: unknown,
  source: { database?: string; name: string },
  ordinal: number,
): Omit<SchemaRelationship, "targetTableId"> & { targetRef: { database?: string; name: string } } | null {
  const definition = object(definitionValue);
  if (text(definition.constraint_type).toLowerCase() !== "foreign key") return null;

  const reference = object(definition.reference_definition);
  const targetRef = tableRef(reference.table);
  const sourceColumns = columnNames(definition.definition);
  const targetColumns = columnNames(reference.definition);
  if (!source.name || !targetRef.name || !sourceColumns.length) return null;

  const sourceTableId = tableId(source.database, source.name);
  const name = text(definition.constraint) || `fk_${source.name}_${ordinal + 1}`;
  return {
    id: `${sourceTableId}:${name}:${sourceColumns.join(",")}`,
    name,
    sourceTableId,
    sourceColumns,
    targetColumns,
    targetRef,
    onDelete: actionValue(reference, "on delete"),
    onUpdate: actionValue(reference, "on update"),
  };
}

function parseSchema(sql: string): SchemaModel {
  const startedAt = performance.now();
  const rawAst = parser.astify(sql, { database: "MySQL" }) as unknown;
  const statements = asArray(rawAst).map(object);
  const tables: SchemaTable[] = [];
  const tableMap = new Map<string, SchemaTable>();
  const pendingRelationships: Array<
    Omit<SchemaRelationship, "targetTableId"> & { targetRef: { database?: string; name: string } }
  > = [];
  const warnings: string[] = [];

  for (const statement of statements) {
    if (text(statement.type) !== "create" || text(statement.keyword) !== "table") continue;
    const ref = tableRef(statement.table);
    if (!ref.name) continue;

    const id = tableId(ref.database, ref.name);
    const columns: SchemaColumn[] = [];
    const indexes: SchemaIndex[] = [];
    const definitions = asArray(statement.create_definitions).map(object);

    for (const definition of definitions) {
      if (text(definition.resource) !== "column") continue;
      const name = identifier(definition.column);
      if (!name) continue;
      const defaultValue = expressionText(object(definition.default_val).value);
      columns.push({
        id: `${id}.${name}`,
        name,
        dataType: columnType(definition.definition),
        nullable: text(object(definition.nullable).type).toLowerCase() !== "not null",
        primaryKey: Boolean(definition.primary_key),
        unique: Boolean(definition.unique),
        autoIncrement: Boolean(definition.auto_increment),
        defaultValue,
        comment: text(object(object(definition.comment).value).value) || undefined,
      });
    }

    for (const [ordinal, definition] of definitions.entries()) {
      const resource = text(definition.resource).toLowerCase();
      const constraintType = text(definition.constraint_type).toLowerCase();

      if (resource === "constraint" && constraintType === "primary key") {
        const primaryNames = new Set(columnNames(definition.definition));
        columns.forEach((column) => {
          if (primaryNames.has(column.name)) column.primaryKey = true;
        });
      }

      if (resource === "index" || (resource === "constraint" && constraintType === "unique")) {
        const names = columnNames(definition.definition);
        if (names.length) {
          const name = text(definition.index || definition.constraint) || `idx_${ref.name}_${ordinal + 1}`;
          indexes.push({
            id: `${id}:${name}`,
            name,
            columns: names,
            unique: constraintType === "unique" || text(definition.keyword).toLowerCase().includes("unique"),
          });
        }
      }

      const relationship = collectForeignKey(definition, ref, ordinal);
      if (relationship) pendingRelationships.push(relationship);
    }

    const table: SchemaTable = {
      id,
      database: ref.database,
      name: ref.name,
      displayName: id,
      comment: tableComment(statement),
      columns,
      indexes,
    };
    tables.push(table);
    tableMap.set(id, table);
    if (!ref.database) tableMap.set(ref.name, table);
  }

  for (const statement of statements) {
    if (text(statement.type) !== "alter") continue;
    const source = tableRef(statement.table);
    for (const [ordinal, expressionValue] of asArray(statement.expr).entries()) {
      const expression = object(expressionValue);
      const definition = expression.create_definitions || expression;
      const relationship = collectForeignKey(definition, source, ordinal);
      if (relationship) pendingRelationships.push(relationship);
    }
  }

  const relationshipIds = new Set<string>();
  const relationships: SchemaRelationship[] = [];
  for (const pending of pendingRelationships) {
    const directTargetId = tableId(pending.targetRef.database, pending.targetRef.name);
    const target = tableMap.get(directTargetId) || tableMap.get(pending.targetRef.name);
    const source = tableMap.get(pending.sourceTableId) || tableMap.get(pending.sourceTableId.split(".").at(-1) || "");
    if (!source || !target) {
      warnings.push(`未找到外键 ${pending.name} 的目标表 ${directTargetId}`);
      continue;
    }
    if (relationshipIds.has(pending.id)) continue;
    relationshipIds.add(pending.id);
    const { targetRef: _targetRef, ...relationship } = pending;
    void _targetRef;
    relationships.push({ ...relationship, sourceTableId: source.id, targetTableId: target.id });
  }

  const parseMs = Math.round((performance.now() - startedAt) * 10) / 10;
  return {
    tables,
    relationships,
    warnings,
    stats: {
      tableCount: tables.length,
      columnCount: tables.reduce((sum, table) => sum + table.columns.length, 0),
      relationshipCount: relationships.length,
      parseMs,
    },
  };
}

self.onmessage = (event: MessageEvent<WorkerParseRequest>) => {
  const { id, sql } = event.data;
  let response: WorkerParseResponse;
  try {
    response = { id, ok: true, schema: parseSchema(sql) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法解析 SQL";
    response = { id, ok: false, error: message };
  }
  self.postMessage(response);
};

export {};
