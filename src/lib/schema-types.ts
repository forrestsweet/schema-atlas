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

export type DiscoveredRelationshipStatus =
  | "candidate"
  | "confirmed"
  | "rejected";

export type DiscoveredRelationshipCardinality =
  | "one-to-one"
  | "one-to-many"
  | "many-to-one"
  | "many-to-many";

export type DiscoveredRelationshipConfidence = "high" | "medium" | "low";

export type SchemaDiscoveredRelationship = {
  id: string;
  sourceTableId: string;
  sourceColumns: string[];
  targetTableId: string;
  targetColumns: string[];
  cardinality: DiscoveredRelationshipCardinality;
  optional: boolean;
  confidence: DiscoveredRelationshipConfidence;
  explanation: string;
  evidence: string[];
  origin: "ai" | "manual";
  status: DiscoveredRelationshipStatus;
  createdAt: string;
};

export type SchemaModel = {
  tables: SchemaTable[];
  relationships: SchemaRelationship[];
  discoveredRelationships?: SchemaDiscoveredRelationship[];
  warnings: string[];
  stats: {
    tableCount: number;
    columnCount: number;
    relationshipCount: number;
    parseMs: number;
  };
};

export type SchemaCanvasLayoutPlan = {
  lanes: Array<{
    name: string;
    tableIds: string[];
  }>;
  summary?: string;
};

export type WorkerParseRequest = {
  id: number;
  sql: string;
};

export type WorkerParseResponse =
  | { id: number; ok: true; schema: SchemaModel }
  | { id: number; ok: false; error: string };
