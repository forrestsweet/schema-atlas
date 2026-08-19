export type SchemaColumn = {
  id: string;
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  autoIncrement: boolean;
  defaultValue?: string;
  comment?: string;
};

export type SchemaIndex = {
  id: string;
  name: string;
  columns: string[];
  unique: boolean;
};

export type SchemaTable = {
  id: string;
  database?: string;
  name: string;
  displayName: string;
  comment?: string;
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
};

export type SchemaRelationship = {
  id: string;
  name: string;
  sourceTableId: string;
  targetTableId: string;
  sourceColumns: string[];
  targetColumns: string[];
  onDelete?: string;
  onUpdate?: string;
};

export type SchemaModel = {
  tables: SchemaTable[];
  relationships: SchemaRelationship[];
  warnings: string[];
  stats: {
    tableCount: number;
    columnCount: number;
    relationshipCount: number;
    parseMs: number;
  };
};

export type WorkerParseRequest = {
  id: number;
  sql: string;
};

export type WorkerParseResponse =
  | { id: number; ok: true; schema: SchemaModel }
  | { id: number; ok: false; error: string };
