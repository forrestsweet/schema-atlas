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

export type RelationshipCardinality =
  | "one-to-one"
  | "one-to-many"
  | "many-to-one"
  | "many-to-many";

export type SchemaManualRelationship = {
  id: string;
  sourceTableId: string;
  sourceColumns: string[];
  targetTableId: string;
  targetColumns: string[];
  cardinality: RelationshipCardinality;
  optional: boolean;
  createdAt: string;
};

export type SchemaCanvasState = {
  positions: Record<string, { x: number; y: number }>;
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
};

export type SchemaModel = {
  tables: SchemaTable[];
  relationships: SchemaRelationship[];
  manualRelationships?: SchemaManualRelationship[];
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
