"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Graph as G6Graph, NodeData } from "@antv/g6";
import type { ElkExtendedEdge, ElkNode } from "elkjs";
import type {
  DiscoveredRelationshipConfidence,
  DiscoveredRelationshipStatus,
  SchemaColumn,
  SchemaCanvasLayoutPlan,
  SchemaModel,
  SchemaTable,
} from "@/lib/schema-types";

const CARD_WIDTH = 340;
const CARD_ROW_HEIGHT = 42;
const COLLAPSED_CARD_ROWS = 6;
const PORT_SIZE = 8;
const ROUTE_LANE_GAP = 12;
const VIEW_PADDING = [76, 54, 54, 54];

function truncateText(value: string, maxLength: number): string {
  const characters = Array.from(value);
  return characters.length > maxLength ? `${characters.slice(0, maxLength - 1).join("")}…` : value;
}

function columnMeta(column: SchemaColumn): string {
  const items = [
    !column.nullable ? "非空" : "",
    column.unique ? "唯一" : "",
    column.autoIncrement ? "自动递增" : "",
    column.defaultValue !== undefined ? `默认值：${column.defaultValue}` : "",
  ];
  return items.filter(Boolean).join(" · ");
}

export type GraphViewMode = "all" | "related";

export type RelationshipEndpoint = {
  column: string;
  tableId: string;
};

export type SchemaGraphHandle = {
  fit: () => void;
  organize: (plan: SchemaCanvasLayoutPlan) => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  focus: (tableId: string) => void;
};

type Props = {
  schema: SchemaModel;
  selectedTableId?: string;
  selectedRelationshipId?: string;
  viewMode: GraphViewMode;
  onCreateRelationship: (
    source: RelationshipEndpoint,
    target: RelationshipEndpoint,
  ) => void;
  onSelectTable: (tableId: string) => void;
  onSelectRelationship: (relationshipId: string) => void;
};

type SchemaPointerEvent = {
  client?: { x?: number; y?: number };
  originalTarget?: {
    className?: string;
    getAttribute?: (name: string) => unknown;
  };
  target?: { id?: string };
  targetType?: string;
};

type RelationshipDraft = {
  current: { x: number; y: number };
  source: RelationshipEndpoint;
  start: { x: number; y: number };
};

function portColumn(event: SchemaPointerEvent): string | undefined {
  const originalTarget = event.originalTarget;
  const className = String(
    originalTarget?.className ||
      originalTarget?.getAttribute?.("className") ||
      "",
  );
  if (!className.startsWith("port-")) return undefined;
  const separator = className.indexOf(":");
  return separator >= 0 ? className.slice(separator + 1) : undefined;
}

function isCollapseToggle(event: SchemaPointerEvent): boolean {
  const originalTarget = event.originalTarget;
  return String(
    originalTarget?.className ||
      originalTarget?.getAttribute?.("className") ||
      "",
  ).includes("collapse-toggle");
}

function pointerPosition(
  event: SchemaPointerEvent,
  container: HTMLElement,
): { x: number; y: number } | undefined {
  const x = Number(event.client?.x);
  const y = Number(event.client?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const bounds = container.getBoundingClientRect();
  return { x: x - bounds.left, y: y - bounds.top };
}

export type GraphRelationship = {
  id: string;
  name: string;
  sourceTableId: string;
  targetTableId: string;
  sourceColumns: string[];
  targetColumns: string[];
  kind: "constraint" | "logical";
  origin: "database" | "ai" | "manual";
  status: "confirmed" | Exclude<DiscoveredRelationshipStatus, "rejected">;
  confidence?: DiscoveredRelationshipConfidence;
  cardinality?: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
};

function graphRelationships(schema: SchemaModel): GraphRelationship[] {
  const constraints: GraphRelationship[] = schema.relationships.map(
    (relationship) => ({
      ...relationship,
      kind: "constraint",
      origin: "database",
      status: "confirmed",
    }),
  );
  const discovered: GraphRelationship[] = (
    schema.discoveredRelationships ?? []
  )
    .filter((relationship) => relationship.status !== "rejected")
    .map((relationship) => ({
      id: relationship.id,
      name: relationship.explanation,
      sourceTableId: relationship.sourceTableId,
      targetTableId: relationship.targetTableId,
      sourceColumns: relationship.sourceColumns,
      targetColumns: relationship.targetColumns,
      kind: "logical",
      origin: relationship.origin,
      status: relationship.status as "candidate" | "confirmed",
      confidence: relationship.confidence,
      cardinality: relationship.cardinality,
    }));
  return [...constraints, ...discovered];
}

type TableGeometry = {
  collapsedHeight: number;
  headerHeight: number;
  height: number;
};

type RoutedRelationship = {
  controlPoints: Array<[number, number]>;
  sourcePort: string;
  targetPort: string;
};

type SchemaGraphRow = {
  detail: string;
  key: string;
  linkedLeft: boolean;
  linkedRight: boolean;
  name: string;
  type: string;
};

type SchemaLayout = {
  positions: Map<string, { x: number; y: number }>;
  relationships: Map<string, RoutedRelationship>;
};

function relationshipLabel(relationship: GraphRelationship): string {
  if (relationship.cardinality === "one-to-one") return "1 : 1";
  if (relationship.cardinality === "one-to-many") return "1 : N";
  if (relationship.cardinality === "many-to-one") return "N : 1";
  if (relationship.cardinality === "many-to-many") return "N : N";
  return "FK";
}

function relationshipEdgeData(
  relationship: GraphRelationship,
  route: RoutedRelationship,
) {
  return {
    id: relationship.id,
    source: relationship.sourceTableId,
    target: relationship.targetTableId,
    data: {
      name: relationship.name,
      relationshipKind: relationship.kind,
      relationshipOrigin: relationship.origin,
      relationshipStatus: relationship.status,
      confidence: relationship.confidence,
      controlPoints: route.controlPoints,
      endpointLabel: relationshipLabel(relationship),
      sourceColumn: relationship.sourceColumns[0] || "",
      sourcePort: route.sourcePort,
      targetColumn: relationship.targetColumns[0] || "",
      targetPort: route.targetPort,
    },
  };
}

function syncConnectedPorts(graph: G6Graph): void {
  const connectedPorts = new Set<string>();
  graph.getEdgeData().forEach((edge) => {
    const sourcePort = String(edge.data?.sourcePort || "");
    const targetPort = String(edge.data?.targetPort || "");
    if (sourcePort) connectedPorts.add(`${edge.source}:${sourcePort}`);
    if (targetPort) connectedPorts.add(`${edge.target}:${targetPort}`);
  });

  const updates = graph.getNodeData().flatMap((node) => {
    if (!Array.isArray(node.data?.rows)) return [];
    let changed = false;
    const rows = (node.data.rows as SchemaGraphRow[]).map((row) => {
      const linkedLeft = connectedPorts.has(`${node.id}:left:${row.key}`);
      const linkedRight = connectedPorts.has(`${node.id}:right:${row.key}`);
      if (
        linkedLeft !== row.linkedLeft ||
        linkedRight !== row.linkedRight
      ) {
        changed = true;
      }
      return { ...row, linkedLeft, linkedRight };
    });
    return changed ? [{ id: node.id, data: { rows } }] : [];
  });
  if (updates.length > 0) graph.updateNodeData(updates);
}

function incrementalRoute(
  graph: G6Graph,
  relationship: GraphRelationship,
): RoutedRelationship | undefined {
  if (
    !graph.hasNode(relationship.sourceTableId) ||
    !graph.hasNode(relationship.targetTableId)
  ) {
    return undefined;
  }
  const source = graph.getNodeData(relationship.sourceTableId);
  const target = graph.getNodeData(relationship.targetTableId);
  const sourceX = Number(source.style?.x || 0);
  const targetX = Number(target.style?.x || 0);
  const sourceOnLeft = sourceX <= targetX;
  const sourceSide = sourceOnLeft ? "right" : "left";
  const targetSide = sourceOnLeft ? "left" : "right";

  const endpoint = (
    node: NodeData,
    column: string,
    side: "left" | "right",
  ): { point: [number, number]; port: string } => {
    const x = Number(node.style?.x || 0);
    const y = Number(node.style?.y || 0);
    const rows = Array.isArray(node.data?.rows)
      ? (node.data.rows as Array<{ key: string }>)
      : [];
    const index = Math.max(0, rows.findIndex((row) => row.key === column));
    const collapsed = Boolean(node.data?.collapsed);
    const hasVisiblePort =
      rows.length > 0 && (!collapsed || index < COLLAPSED_CARD_ROWS);
    const height = collapsed
      ? Number(node.data?.collapsedCardHeight || 42)
      : Number(node.data?.cardHeight || 42);
    const pointY = hasVisiblePort
      ? y - height / 2 +
        Number(node.data?.cardHeaderHeight || 42) +
        index * CARD_ROW_HEIGHT +
        CARD_ROW_HEIGHT / 2
      : y;
    return {
      point: [x + (side === "right" ? CARD_WIDTH / 2 : -CARD_WIDTH / 2), pointY],
      port: hasVisiblePort ? `${side}:${column}` : "",
    };
  };

  const sourceEndpoint = endpoint(
    source,
    relationship.sourceColumns[0] || "",
    sourceSide,
  );
  const targetEndpoint = endpoint(
    target,
    relationship.targetColumns[0] || "",
    targetSide,
  );
  if (relationship.sourceTableId === relationship.targetTableId) {
    return {
      controlPoints: [],
      sourcePort: sourceEndpoint.port,
      targetPort: targetEndpoint.port,
    };
  }

  const [sourcePointX, sourcePointY] = sourceEndpoint.point;
  const [targetPointX, targetPointY] = targetEndpoint.point;
  const parallelRelationshipIds = Array.from(
    new Set([
      relationship.id,
      ...graph
        .getEdgeData()
        .filter(
          (edge) =>
            (edge.source === relationship.sourceTableId &&
              edge.target === relationship.targetTableId) ||
            (edge.source === relationship.targetTableId &&
              edge.target === relationship.sourceTableId),
        )
        .map((edge) => String(edge.id || ""))
        .filter(Boolean),
    ]),
  ).sort();
  const laneIndex = parallelRelationshipIds.indexOf(relationship.id);
  const laneOffset =
    (laneIndex - (parallelRelationshipIds.length - 1) / 2) * ROUTE_LANE_GAP;
  const middleX = (sourcePointX + targetPointX) / 2 + laneOffset;
  const sharedTargetIds = Array.from(
    new Set([
      relationship.id,
      ...graph
        .getEdgeData()
        .filter(
          (edge) =>
            edge.target === relationship.targetTableId &&
            String(edge.data?.targetColumn || "") ===
              (relationship.targetColumns[0] || ""),
        )
        .map((edge) => String(edge.id || ""))
        .filter(Boolean),
    ]),
  ).sort();
  const targetLaneIndex = sharedTargetIds.indexOf(relationship.id);
  const targetLaneOffset =
    (targetLaneIndex - (sharedTargetIds.length - 1) / 2) * ROUTE_LANE_GAP;
  const targetApproachX = targetPointX + (sourceOnLeft ? -20 : 20);
  const controlPoints: Array<[number, number]> = [
    [middleX, sourcePointY],
    [middleX, targetPointY + targetLaneOffset],
  ];
  if (sharedTargetIds.length > 1) {
    controlPoints.push(
      [targetApproachX, targetPointY + targetLaneOffset],
      [targetApproachX, targetPointY],
    );
  }
  return {
    controlPoints,
    sourcePort: sourceEndpoint.port,
    targetPort: targetEndpoint.port,
  };
}

function tableGeometry(table: SchemaTable): TableGeometry {
  const headerHeight = table.comment ? 56 : 42;
  return {
    collapsedHeight:
      headerHeight +
      Math.min(table.columns.length, COLLAPSED_CARD_ROWS) * CARD_ROW_HEIGHT,
    headerHeight,
    height: headerHeight + table.columns.length * CARD_ROW_HEIGHT,
  };
}

function elkPortId(
  tableId: string,
  side: "left" | "right",
  columnIndex: number,
): string {
  return `${tableId}::${side}::${columnIndex}`;
}

function columnIndex(table: SchemaTable, columnName?: string): number {
  const index = table.columns.findIndex((column) => column.name === columnName);
  return index >= 0 ? index : 0;
}

async function calculateSchemaLayout(
  ElkConstructor: (typeof import("elkjs"))["default"],
  tables: SchemaTable[],
  relationships: GraphRelationship[],
  collapsedTableIds: ReadonlySet<string>,
): Promise<SchemaLayout> {
  const tablesById = new Map(tables.map((table) => [table.id, table]));
  const geometries = new Map(
    tables.map((table) => [table.id, tableGeometry(table)]),
  );
  const children: ElkNode[] = tables.map((table) => {
    const geometry = geometries.get(table.id)!;
    const collapsed = collapsedTableIds.has(table.id);
    const visibleColumnCount = collapsed
      ? Math.min(table.columns.length, COLLAPSED_CARD_ROWS)
      : table.columns.length;
    return {
      id: table.id,
      width: CARD_WIDTH,
      height: collapsed ? geometry.collapsedHeight : geometry.height,
      layoutOptions: {
        "org.eclipse.elk.portConstraints": "FIXED_POS",
      },
      ports: table.columns.slice(0, visibleColumnCount).flatMap((_, index) => {
        const y =
          geometry.headerHeight +
          index * CARD_ROW_HEIGHT +
          CARD_ROW_HEIGHT / 2 -
          PORT_SIZE / 2;
        return [
          {
            id: elkPortId(table.id, "left", index),
            x: -PORT_SIZE / 2,
            y,
            width: PORT_SIZE,
            height: PORT_SIZE,
            layoutOptions: { "org.eclipse.elk.port.side": "WEST" },
          },
          {
            id: elkPortId(table.id, "right", index),
            x: CARD_WIDTH - PORT_SIZE / 2,
            y,
            width: PORT_SIZE,
            height: PORT_SIZE,
            layoutOptions: { "org.eclipse.elk.port.side": "EAST" },
          },
        ];
      }),
    };
  });

  const relationshipPorts = new Map<
    string,
    { source: string; sourcePort: string; target: string; targetPort: string }
  >();
  const edges: ElkExtendedEdge[] = [];
  for (const relationship of relationships) {
    const sourceTable = tablesById.get(relationship.sourceTableId);
    const targetTable = tablesById.get(relationship.targetTableId);
    if (!sourceTable || !targetTable) continue;

    const sourceColumnIndex = columnIndex(
      sourceTable,
      relationship.sourceColumns[0],
    );
    const targetColumnIndex = columnIndex(
      targetTable,
      relationship.targetColumns[0],
    );
    const hasSourcePort =
      sourceTable.columns.length > 0 &&
      (!collapsedTableIds.has(sourceTable.id) ||
        sourceColumnIndex < COLLAPSED_CARD_ROWS);
    const hasTargetPort =
      targetTable.columns.length > 0 &&
      (!collapsedTableIds.has(targetTable.id) ||
        targetColumnIndex < COLLAPSED_CARD_ROWS);
    const source = hasSourcePort
      ? elkPortId(sourceTable.id, "right", sourceColumnIndex)
      : sourceTable.id;
    const target = hasTargetPort
      ? elkPortId(targetTable.id, "left", targetColumnIndex)
      : targetTable.id;
    relationshipPorts.set(relationship.id, {
      source,
      sourcePort: hasSourcePort
        ? `right:${sourceTable.columns[sourceColumnIndex].name}`
        : "",
      target,
      targetPort: hasTargetPort
        ? `left:${targetTable.columns[targetColumnIndex].name}`
        : "",
    });
    edges.push({ id: relationship.id, sources: [source], targets: [target] });
  }

  const elk = new ElkConstructor();
  const result = await elk.layout({
    id: "schema-root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.separateConnectedComponents": "true",
      "elk.spacing.componentComponent": "160",
      "elk.spacing.edgeEdge": "18",
      "elk.spacing.edgeNode": "32",
      "elk.spacing.nodeNode": "72",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.spacing.edgeNodeBetweenLayers": "46",
      "elk.layered.spacing.nodeNodeBetweenLayers": "150",
    },
    children,
    edges,
  });

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of result.children ?? []) {
    positions.set(node.id, {
      x: Number(node.x || 0) + Number(node.width || CARD_WIDTH) / 2,
      y: Number(node.y || 0) + Number(node.height || 0) / 2,
    });
  }

  const routedRelationships = new Map<string, RoutedRelationship>();
  const pendingRoutes: Array<{
    bendPoints: Array<{ x: number; y: number }>;
    endPoint?: { x: number; y: number };
    id: string;
    startPoint?: { x: number; y: number };
    sourcePort: string;
    targetKey: string;
    targetPort: string;
  }> = [];
  const verticalSegments: Array<{
    bendPoints: Array<{ x: number; y: number }>;
    endIndex: number;
    id: string;
    startIndex: number;
    x: number;
    yMax: number;
    yMin: number;
  }> = [];
  for (const edge of result.edges ?? []) {
    const ports = edge.id ? relationshipPorts.get(edge.id) : undefined;
    if (!edge.id || !ports) continue;
    const section = edge.sections?.[0];
    const bendPoints = (section?.bendPoints ?? []).map(({ x, y }) => ({ x, y }));
    pendingRoutes.push({
      bendPoints,
      endPoint: section?.endPoint,
      id: edge.id,
      startPoint: section?.startPoint,
      sourcePort: ports.sourcePort,
      targetKey: ports.target,
      targetPort: ports.targetPort,
    });
    if (!section?.startPoint || !section.endPoint) continue;
    const path = [section.startPoint, ...bendPoints, section.endPoint];
    const candidates = path.flatMap((point, index) => {
      const next = path[index + 1];
      if (
        !next ||
        index === 0 ||
        index + 1 === path.length - 1 ||
        Math.abs(point.x - next.x) > 0.5
      ) {
        return [];
      }
      return [{
        bendPoints,
        endIndex: index,
        id: edge.id,
        startIndex: index - 1,
        x: point.x,
        yMax: Math.max(point.y, next.y),
        yMin: Math.min(point.y, next.y),
      }];
    });
    const longest = candidates.sort(
      (a, b) => b.yMax - b.yMin - (a.yMax - a.yMin),
    )[0];
    if (longest) verticalSegments.push(longest);
  }

  const segmentsByChannel = new Map<number, typeof verticalSegments>();
  verticalSegments.forEach((segment) => {
    const channel = Math.round(segment.x);
    const channelSegments = segmentsByChannel.get(channel) ?? [];
    channelSegments.push(segment);
    segmentsByChannel.set(channel, channelSegments);
  });
  segmentsByChannel.forEach((channelSegments) => {
    const sorted = [...channelSegments].sort(
      (a, b) => a.yMin - b.yMin || a.yMax - b.yMax || a.id.localeCompare(b.id),
    );
    let cluster: typeof sorted = [];
    let clusterEnd = Number.NEGATIVE_INFINITY;
    const separateCluster = () => {
      if (cluster.length < 2) return;
      cluster
        .sort((a, b) => a.id.localeCompare(b.id))
        .forEach((segment, index) => {
          const offset =
            (index - (cluster.length - 1) / 2) * ROUTE_LANE_GAP;
          segment.bendPoints[segment.startIndex].x += offset;
          segment.bendPoints[segment.endIndex].x += offset;
        });
    };
    sorted.forEach((segment) => {
      if (cluster.length > 0 && segment.yMin > clusterEnd) {
        separateCluster();
        cluster = [];
        clusterEnd = Number.NEGATIVE_INFINITY;
      }
      cluster.push(segment);
      clusterEnd = Math.max(clusterEnd, segment.yMax);
    });
    separateCluster();
  });

  const routesByTarget = new Map<string, typeof pendingRoutes>();
  pendingRoutes.forEach((route) => {
    if (!route.targetPort) return;
    const targetRoutes = routesByTarget.get(route.targetKey) ?? [];
    targetRoutes.push(route);
    routesByTarget.set(route.targetKey, targetRoutes);
  });
  routesByTarget.forEach((targetRoutes) => {
    if (targetRoutes.length < 2) return;
    targetRoutes
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((route, index) => {
        const start = route.startPoint;
        const end = route.endPoint;
        if (!start || !end) return;
        const offset =
          (index - (targetRoutes.length - 1) / 2) * ROUTE_LANE_GAP;
        const last = route.bendPoints.at(-1);
        const direction = end.x >= (last?.x ?? start.x) ? 1 : -1;
        const approachX = end.x - direction * 20;
        if (last && Math.abs(end.x - last.x) > 0.5) {
          last.y += offset;
        } else if (!last) {
          const middleX = (start.x + end.x) / 2;
          route.bendPoints.push(
            { x: middleX, y: start.y },
            { x: middleX, y: end.y + offset },
          );
        } else {
          last.x = approachX;
          last.y = end.y + offset;
        }
        route.bendPoints.push(
          { x: approachX, y: end.y + offset },
          { x: approachX, y: end.y },
        );
      });
  });

  pendingRoutes.forEach((route) => {
    routedRelationships.set(route.id, {
      controlPoints: route.bendPoints.map(({ x, y }) => [x, y]),
      sourcePort: route.sourcePort,
      targetPort: route.targetPort,
    });
  });

  return { positions, relationships: routedRelationships };
}

function relatedIds(schema: SchemaModel, rootId?: string): Set<string> {
  if (!rootId) return new Set(schema.tables.map((table) => table.id));
  const ids = new Set([rootId]);
  graphRelationships(schema).forEach((relationship) => {
    if (relationship.sourceTableId === rootId) ids.add(relationship.targetTableId);
    if (relationship.targetTableId === rootId) ids.add(relationship.sourceTableId);
  });
  return ids;
}

export const SchemaGraph = forwardRef<SchemaGraphHandle, Props>(function SchemaGraph(
  {
    schema,
    selectedTableId,
    selectedRelationshipId,
    viewMode,
    onCreateRelationship,
    onSelectTable,
    onSelectRelationship,
  },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<G6Graph | null>(null);
  const selectedTableRef = useRef(selectedTableId);
  const previousSelectedRef = useRef<string | undefined>(undefined);
  const selectedRelationshipRef = useRef(selectedRelationshipId);
  const previousSelectedRelationshipRef = useRef<string | undefined>(
    undefined,
  );
  const relationshipDraftRef = useRef<RelationshipDraft | undefined>(
    undefined,
  );
  const collapsedTableIdsRef = useRef(new Set<string>());
  const collapseStructureKeyRef = useRef<string | undefined>(undefined);
  const [relationshipDraft, setRelationshipDraft] =
    useState<RelationshipDraft>();
  const [rendering, setRendering] = useState(true);
  const scopeRoot = viewMode === "related" ? selectedTableId : undefined;

  selectedTableRef.current = selectedTableId;
  selectedRelationshipRef.current = selectedRelationshipId;

  const visibleData = useMemo(() => {
    const ids = viewMode === "related" ? relatedIds(schema, scopeRoot) : new Set(schema.tables.map((table) => table.id));
    const relationships = graphRelationships(schema).filter(
      (relationship) =>
        ids.has(relationship.sourceTableId) &&
        ids.has(relationship.targetTableId),
    );
    return {
      tables: schema.tables.filter((table) => ids.has(table.id)),
      relationships,
    };
  }, [schema, scopeRoot, viewMode]);
  const visibleDataRef = useRef(visibleData);
  visibleDataRef.current = visibleData;
  const tableStructureKey = useMemo(
    () => JSON.stringify(visibleData.tables),
    [visibleData.tables],
  );
  const relationshipSignature = useMemo(
    () => JSON.stringify(visibleData.relationships),
    [visibleData.relationships],
  );
  if (collapseStructureKeyRef.current !== tableStructureKey) {
    collapseStructureKeyRef.current = tableStructureKey;
    collapsedTableIdsRef.current = new Set(
      visibleData.tables
        .filter((table) => table.columns.length > COLLAPSED_CARD_ROWS)
        .map((table) => table.id),
    );
  }

  useImperativeHandle(forwardedRef, () => ({
    fit: () => void graphRef.current?.fitView({ when: "always" }, { duration: 280 }),
    organize: async (plan) => {
      const graph = graphRef.current;
      const data = visibleDataRef.current;
      if (!graph || data.tables.length === 0) return;
      const tablesById = new Map(data.tables.map((table) => [table.id, table]));
      const assigned = new Set<string>();
      const lanes = plan.lanes
        .map((lane) => ({
          ...lane,
          tableIds: lane.tableIds.filter((tableId) => {
            if (!tablesById.has(tableId) || assigned.has(tableId)) return false;
            assigned.add(tableId);
            return true;
          }),
        }))
        .filter((lane) => lane.tableIds.length > 0);
      const unassigned = data.tables
        .map((table) => table.id)
        .filter((tableId) => !assigned.has(tableId));
      if (unassigned.length > 0) {
        if (lanes.length === 0) lanes.push({ name: "其他", tableIds: [] });
        unassigned.forEach((tableId) => {
          const shortest = lanes.reduce((left, right) =>
            left.tableIds.length <= right.tableIds.length ? left : right,
          );
          shortest.tableIds.push(tableId);
        });
      }
      if (lanes.length === 0) return;

      const columnGap = 190;
      const rowGap = 78;
      const positions = new Map<string, { x: number; y: number }>();
      const laneHeights = lanes.map((lane) =>
        lane.tableIds.reduce((total, tableId, index) => {
          const table = tablesById.get(tableId)!;
          const geometry = tableGeometry(table);
          const height = collapsedTableIdsRef.current.has(tableId)
            ? geometry.collapsedHeight
            : geometry.height;
          return total + height + (index > 0 ? rowGap : 0);
        }, 0),
      );
      const maxHeight = Math.max(...laneHeights);
      lanes.forEach((lane, column) => {
        let cursorY = (maxHeight - laneHeights[column]) / 2;
        lane.tableIds.forEach((tableId) => {
          const table = tablesById.get(tableId)!;
          const geometry = tableGeometry(table);
          const height = collapsedTableIdsRef.current.has(tableId)
            ? geometry.collapsedHeight
            : geometry.height;
          positions.set(tableId, {
            x: column * (CARD_WIDTH + columnGap) + CARD_WIDTH / 2,
            y: cursorY + height / 2,
          });
          cursorY += height + rowGap;
        });
      });
      graph.updateNodeData(
        data.tables.flatMap((table) => {
          const position = positions.get(table.id);
          return position ? [{ id: table.id, style: position }] : [];
        }),
      );
      graph.updateEdgeData(
        data.relationships.flatMap((relationship) => {
          const route = incrementalRoute(graph, relationship);
          return route ? [relationshipEdgeData(relationship, route)] : [];
        }),
      );
      syncConnectedPorts(graph);
      await graph.draw();
      if (graphRef.current === graph) {
        await graph.fitView({ when: "always" }, { duration: 320 });
      }
    },
    zoomIn: () => void graphRef.current?.zoomBy(1.28, { duration: 180 }),
    zoomOut: () => void graphRef.current?.zoomBy(0.78, { duration: 180 }),
    focus: (tableId: string) => {
      const graph = graphRef.current;
      if (!graph) return;
      void graph.focusElement(tableId, { duration: 260 }).then(() => {
        if (graph.getZoom() < 0.75) return graph.zoomTo(0.9, { duration: 220 });
      });
    },
  }));

  useEffect(() => {
    const initialData = visibleDataRef.current;
    if (!containerRef.current || initialData.tables.length === 0) return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    setRendering(true);

    void Promise.all([
      import("@antv/g6"),
      import("@antv/g"),
      import("elkjs/lib/elk.bundled.js"),
    ]).then(async ([g6, antvG, elkModule]) => {
      if (cancelled || !containerRef.current) return;

      const {
        CommonEvent,
        EdgeEvent,
        ExtensionCategory,
        getExtension,
        Graph,
        NodeEvent,
        Rect,
        register,
      } = g6;
      const { Line, Rect: GRect, Text } = antvG;
      const tableNodeType = "schema-table-card";

      if (!getExtension(ExtensionCategory.NODE, tableNodeType)) {
        const renderedRowCounts = new WeakMap<object, number>();
        class SchemaTableNode extends Rect {
          render(
            attributes: Parameters<InstanceType<typeof Rect>["render"]>[0] = this.parsedAttributes,
            container: Parameters<InstanceType<typeof Rect>["render"]>[1] = this,
          ) {
            super.render(attributes, container);
            const custom = attributes as typeof attributes & {
              canCollapse?: boolean;
              cardHeaderHeight?: number;
              collapseControlVisible?: boolean;
              columnRowsJson?: string;
              collapsed?: boolean;
              tableCommentText?: string;
            };
            if (!custom.columnRowsJson) return;
            const [width, height] = this.getSize(attributes);
            const top = -height / 2;
            const left = -width / 2 + 14;
            const right = width / 2 - 14;
            const headerHeight = Number(custom.cardHeaderHeight || 46);
            const tableComment = String(custom.tableCommentText || "");
            const collapsed = Boolean(custom.collapsed);
            const canCollapse = Boolean(custom.canCollapse);
            const showCollapseControl =
              canCollapse && Boolean(custom.collapseControlVisible);

            this.upsert(
              "collapse-toggle-hit",
              GRect,
              showCollapseControl ? {
                x: -27,
                y: height / 2 - 1,
                width: 54,
                height: 24,
                radius: 12,
                fill: "#ffffff",
                stroke: "#d4d4d4",
                lineWidth: 1,
                shadowColor: "rgba(0,0,0,.12)",
                shadowBlur: 8,
                shadowOffsetY: 2,
                cursor: "pointer",
                pointerEvents: "all",
              } : false,
              container,
            );
            this.upsert(
              "collapse-toggle",
              Text,
              showCollapseControl ? {
                text: collapsed ? "展开" : "收起",
                x: 0,
                y: height / 2 + 11,
                fill: "#525252",
                fontFamily: "var(--font-geist-sans)",
                fontSize: 10,
                fontWeight: 600,
                textAlign: "center",
                textBaseline: "middle",
                cursor: "pointer",
                pointerEvents: "none",
              } : false,
              container,
            );

            this.upsert(
              "table-comment",
              Text,
              tableComment
                ? {
                    text: tableComment,
                    x: left,
                    y: top + 39,
                    fill: "#737373",
                    fontFamily: "var(--font-geist-sans)",
                    fontSize: 10,
                    fontWeight: 400,
                    textAlign: "left",
                    textBaseline: "middle",
                    wordWrap: true,
                    wordWrapWidth: width - 28,
                    maxLines: 1,
                    textOverflow: "ellipsis",
                    pointerEvents: "none",
                  }
                : false,
              container,
            );

            this.upsert(
              "header-separator",
              Line,
              custom.columnRowsJson && custom.columnRowsJson !== "[]"
                ? {
                    x1: -width / 2,
                    y1: top + headerHeight,
                    x2: width / 2,
                    y2: top + headerHeight,
                    stroke: "#e5e5e5",
                    lineWidth: 1,
                    pointerEvents: "none",
                  }
                : false,
              container,
            );

            let rows: Array<{ detail: string; name: string; type: string }> = [];
            try {
              const parsed = JSON.parse(String(custom.columnRowsJson || "[]"));
              if (Array.isArray(parsed)) rows = parsed;
            } catch {
              rows = [];
            }
            const rowSlots = Math.max(
              rows.length,
              renderedRowCounts.get(this) || 0,
            );
            for (let index = 0; index < rowSlots; index += 1) {
              const row = rows[index];
              const rowTop = top + headerHeight + index * CARD_ROW_HEIGHT;
              this.upsert(
                `column-name-${index}`,
                Text,
                row
                  ? {
                      text: row.name,
                      x: left,
                      y: rowTop + 13,
                      fill: "#171717",
                      fontFamily: "var(--font-geist-sans)",
                      fontSize: 12,
                      fontWeight: 550,
                      maxLines: 1,
                      textAlign: "left",
                      textBaseline: "middle",
                      textOverflow: "ellipsis",
                      wordWrap: true,
                      wordWrapWidth: width - 132,
                      pointerEvents: "none",
                    }
                  : false,
                container,
              );
              this.upsert(
                `column-type-${index}`,
                Text,
                row
                  ? {
                      text: row.type,
                      x: right,
                      y: rowTop + 13,
                      fill: "#737373",
                      fontFamily: "var(--font-geist-mono)",
                      fontSize: 10,
                      fontWeight: 400,
                      textAlign: "right",
                      textBaseline: "middle",
                      pointerEvents: "none",
                    }
                  : false,
                container,
              );
              this.upsert(
                `column-detail-${index}`,
                Text,
                row
                  ? {
                      text: row.detail,
                      x: left,
                      y: rowTop + 29,
                      fill: "#737373",
                      fontFamily: "var(--font-geist-sans)",
                      fontSize: 10,
                      fontWeight: 400,
                      maxLines: 1,
                      textAlign: "left",
                      textBaseline: "middle",
                      textOverflow: "ellipsis",
                      wordWrap: true,
                      wordWrapWidth: width - 32,
                      pointerEvents: "none",
                    }
                  : false,
                container,
              );
            }
            renderedRowCounts.set(this, rows.length);
          }
        }

        register(ExtensionCategory.NODE, tableNodeType, SchemaTableNode);
      }

      const schemaLayout = await calculateSchemaLayout(
        elkModule.default,
        initialData.tables,
        initialData.relationships,
        collapsedTableIdsRef.current,
      );
      if (cancelled || !containerRef.current) return;
      const relationshipCounts = new Map<string, number>();
      const foreignKeyColumns = new Map<string, Set<string>>();
      const connectedPorts = new Set<string>();
      initialData.relationships.forEach((relationship) => {
        relationshipCounts.set(
          relationship.sourceTableId,
          (relationshipCounts.get(relationship.sourceTableId) || 0) + 1,
        );
        const route = schemaLayout.relationships.get(relationship.id);
        if (route?.sourcePort) {
          connectedPorts.add(
            `${relationship.sourceTableId}:${route.sourcePort}`,
          );
        }
        if (route?.targetPort) {
          connectedPorts.add(
            `${relationship.targetTableId}:${route.targetPort}`,
          );
        }
        relationshipCounts.set(
          relationship.targetTableId,
          (relationshipCounts.get(relationship.targetTableId) || 0) + 1,
        );
        if (relationship.kind === "constraint") {
          const names =
            foreignKeyColumns.get(relationship.sourceTableId) ||
            new Set<string>();
          relationship.sourceColumns.forEach((name) => names.add(name));
          foreignKeyColumns.set(relationship.sourceTableId, names);
        }
      });

      const graphNodes = initialData.tables.map((table) => {
        const foreignKeys = foreignKeyColumns.get(table.id) || new Set<string>();
        const rows = table.columns.map((column) => {
          const constraints = [
            column.primaryKey ? "主键" : "",
            foreignKeys.has(column.name) ? "外键" : "",
          ].filter(Boolean);
          const detail = [column.comment, columnMeta(column)].filter(Boolean).join(" · ") || " ";
          const name = `${column.name}${constraints.length ? ` · ${constraints.join(" · ")}` : ""}`;
          return {
            detail: truncateText(detail, 42),
            key: column.name,
            linkedLeft: connectedPorts.has(
              `${table.id}:left:${column.name}`,
            ),
            linkedRight: connectedPorts.has(
              `${table.id}:right:${column.name}`,
            ),
            name: truncateText(name, 22),
            type: truncateText(column.dataType, 16),
          };
        });

        const geometry = tableGeometry(table);
        const canCollapse = table.columns.length > COLLAPSED_CARD_ROWS;
        return {
          id: table.id,
          style: schemaLayout.positions.get(table.id),
          data: {
            name: table.displayName,
            comment: table.comment,
            cardHeaderHeight: geometry.headerHeight,
            cardHeight: geometry.height,
            collapsedCardHeight: geometry.collapsedHeight,
            canCollapse,
            collapseControlVisible: false,
            collapsed: canCollapse && collapsedTableIdsRef.current.has(table.id),
            columns: table.columns.length,
            rows,
            relationships: relationshipCounts.get(table.id) || 0,
          },
        };
      });

      const canDragTable = (event: unknown) =>
        !relationshipDraftRef.current &&
        !portColumn(event as SchemaPointerEvent) &&
        !isCollapseToggle(event as SchemaPointerEvent);

      const graph: G6Graph = new Graph({
        container: containerRef.current,
        animation: false,
        autoFit: { type: "view", options: { when: "always" } },
        padding: VIEW_PADDING,
        plugins: [
          {
            type: "grid-line",
            key: "canvas-dot-grid",
            border: false,
            follow: { translate: true, zoom: true },
            lineWidth: 1,
            size: 28,
            stroke: "rgba(100, 116, 139, 0.1)",
          },
        ],
        zoomRange: [0.025, 4],
        data: {
          nodes: graphNodes,
          edges: initialData.relationships.map((relationship) => {
            const route = schemaLayout.relationships.get(relationship.id) ?? {
              controlPoints: [],
              sourcePort: "",
              targetPort: "",
            };
            return relationshipEdgeData(relationship, route);
          }),
        },
        node: {
          type: tableNodeType,
          style: (datum) => {
            const rows = Array.isArray(datum.data?.rows)
              ? (datum.data.rows as SchemaGraphRow[])
              : [];
            const canCollapse = Boolean(datum.data?.canCollapse);
            const collapsed = canCollapse && Boolean(datum.data?.collapsed);
            const visibleRows = collapsed
              ? rows.slice(0, COLLAPSED_CARD_ROWS)
              : rows;
            const cardHeight = collapsed
              ? Number(datum.data?.collapsedCardHeight || 42)
              : Number(datum.data?.cardHeight || 42);
            return {
              size: [CARD_WIDTH, cardHeight],
              radius: 8,
              fill: "#ffffff",
              fillOpacity: 1,
              stroke: "#e5e5e5",
              lineWidth: 1,
              shadowColor: "rgba(0,0,0,.06)",
              shadowBlur: 4,
              shadowOffsetY: 1,
              labelText: String(datum.data?.name || datum.id),
              labelFill: "#171717",
              labelFontFamily: "var(--font-geist-sans)",
              labelFontSize: 13,
              labelFontWeight: 650,
              labelMaxWidth: CARD_WIDTH - 82,
              labelWordWrap: true,
              labelTextOverflow: "ellipsis",
              labelPlacement: "center",
              labelOffsetX: -(CARD_WIDTH / 2) + 14,
              labelOffsetY: -(cardHeight / 2) + 18,
              labelTextAlign: "left",
              tableCommentText: String(datum.data?.comment || ""),
              canCollapse,
              cardHeaderHeight: Number(datum.data?.cardHeaderHeight || 42),
              collapseControlVisible: Boolean(
                datum.data?.collapseControlVisible,
              ),
              collapsed,
              columnRowsJson: JSON.stringify(visibleRows),
              port: true,
              ports: visibleRows.flatMap((row, index) => {
                const placementY =
                  (Number(datum.data?.cardHeaderHeight || 42) +
                    index * CARD_ROW_HEIGHT +
                    CARD_ROW_HEIGHT / 2) /
                  cardHeight;
                return [
                  {
                    key: `left:${row.key}`,
                    placement: [0, placementY] as [number, number],
                    r: row.linkedLeft ? 4 : 3.5,
                    fill: "#ffffff",
                    stroke: row.linkedLeft ? "#6366f1" : "#a3a3a3",
                    lineWidth: row.linkedLeft ? 1.8 : 1.2,
                    opacity: row.linkedLeft ? 1 : 0.72,
                    cursor: "crosshair",
                    pointerEvents: "all",
                  },
                  {
                    key: `right:${row.key}`,
                    placement: [1, placementY] as [number, number],
                    r: row.linkedRight ? 4 : 3.5,
                    fill: "#ffffff",
                    stroke: row.linkedRight ? "#6366f1" : "#a3a3a3",
                    lineWidth: row.linkedRight ? 1.8 : 1.2,
                    opacity: row.linkedRight ? 1 : 0.72,
                    cursor: "crosshair",
                    pointerEvents: "all",
                  },
                ];
              }),
            };
          },
          state: {
            inactive: {
              opacity: 0.24,
            },
            selected: {
              fill: "#fafafa",
              stroke: "#171717",
              lineWidth: 2,
              shadowColor: "rgba(0,0,0,.16)",
              shadowBlur: 12,
              zIndex: 10,
            },
          },
        },
        edge: {
          type: "polyline",
          style: (datum) => {
            const kind = String(datum.data?.relationshipKind || "constraint");
            const origin = String(
              datum.data?.relationshipOrigin || "database",
            );
            const controlPoints = Array.isArray(datum.data?.controlPoints)
              ? (datum.data.controlPoints as Array<[number, number]>)
              : [];
            if (kind === "logical") {
              const manual = origin === "manual";
              return {
                stroke: manual ? "#059669" : "#4f46e5",
                strokeOpacity: manual ? 0.9 : 0.76,
                lineWidth: manual ? 2.8 : 2.2,
                lineDash: manual ? 0 : [7, 5],
                endArrow: true,
                radius: 10,
                router: false,
                controlPoints,
                increasedLineWidthForHitTesting: 14,
                sourcePort: String(datum.data?.sourcePort || ""),
                targetPort: String(datum.data?.targetPort || ""),
                labelText: String(datum.data?.endpointLabel || ""),
                labelFill: manual ? "#047857" : "#4338ca",
                labelFontSize: 11,
                labelFontWeight: 600,
                labelAutoRotate: false,
                labelOpacity: 0,
                labelBackground: true,
                labelBackgroundFill: "#ffffff",
                labelBackgroundOpacity: 0.96,
                labelBackgroundPadding: [4, 7, 4, 7],
                zIndex: 2,
              };
            }
            return {
              stroke: "#64748b",
              strokeOpacity: 0.64,
              lineWidth: 1.5,
              endArrow: true,
              radius: 10,
              router: false,
              controlPoints,
              increasedLineWidthForHitTesting: 12,
              sourcePort: String(datum.data?.sourcePort || ""),
              targetPort: String(datum.data?.targetPort || ""),
            };
          },
          state: {
            active: {
              halo: true,
              haloLineWidth: 6,
              haloStrokeOpacity: 0.12,
              labelOpacity: 1,
              lineWidth: 2.8,
              strokeOpacity: 1,
            },
            selected: {
              halo: true,
              haloLineWidth: 7,
              haloStrokeOpacity: 0.14,
              labelOpacity: 1,
              lineWidth: 3.2,
              strokeOpacity: 1,
              zIndex: 10,
            },
          },
        },
        behaviors: [
          "drag-canvas",
          "zoom-canvas",
          {
            type: "drag-element",
            key: "drag-table",
            enable: canDragTable,
          },
          "click-select",
        ],
      });

      graph.on(NodeEvent.POINTER_ENTER, (event) => {
        const id = String(
          (event as unknown as SchemaPointerEvent).target?.id || "",
        );
        if (!id) return;
        const node = graph.getNodeData(id);
        if (!node.data?.canCollapse || node.data.collapseControlVisible) return;
        graph.updateNodeData([
          { id, data: { collapseControlVisible: true } },
        ]);
        void graph.draw();
      });

      graph.on(NodeEvent.POINTER_LEAVE, (event) => {
        const id = String(
          (event as unknown as SchemaPointerEvent).target?.id || "",
        );
        if (!id) return;
        const node = graph.getNodeData(id);
        if (!node.data?.collapseControlVisible) return;
        graph.updateNodeData([
          { id, data: { collapseControlVisible: false } },
        ]);
        void graph.draw();
      });

      graph.on(NodeEvent.POINTER_DOWN, (event) => {
        if (!containerRef.current) return;
        const pointerEvent = event as unknown as SchemaPointerEvent;
        const column = portColumn(pointerEvent);
        const tableId = String(pointerEvent.target?.id || "");
        const position = pointerPosition(pointerEvent, containerRef.current);
        if (!column || !tableId || !position) return;
        const draft: RelationshipDraft = {
          current: position,
          source: { column, tableId },
          start: position,
        };
        relationshipDraftRef.current = draft;
        setRelationshipDraft(draft);
        graph.updateBehavior({ key: "drag-table", enable: false });
      });

      graph.on(CommonEvent.POINTER_MOVE, (event) => {
        if (!relationshipDraftRef.current || !containerRef.current) return;
        const position = pointerPosition(
          event as unknown as SchemaPointerEvent,
          containerRef.current,
        );
        if (!position) return;
        const next = {
          ...relationshipDraftRef.current,
          current: position,
        };
        relationshipDraftRef.current = next;
        setRelationshipDraft(next);
      });

      graph.on(CommonEvent.POINTER_UP, (event) => {
        const draft = relationshipDraftRef.current;
        if (!draft) return;
        const pointerEvent = event as unknown as SchemaPointerEvent;
        const targetColumn = portColumn(pointerEvent);
        const targetTableId = String(pointerEvent.target?.id || "");
        relationshipDraftRef.current = undefined;
        setRelationshipDraft(undefined);
        graph.updateBehavior({ key: "drag-table", enable: canDragTable });
        if (
          pointerEvent.targetType !== "node" ||
          !targetColumn ||
          !targetTableId ||
          (draft.source.tableId === targetTableId &&
            draft.source.column === targetColumn)
        ) {
          return;
        }
        onCreateRelationship(draft.source, {
          column: targetColumn,
          tableId: targetTableId,
        });
      });

      graph.on(NodeEvent.CLICK, (event) => {
        const pointerEvent = event as unknown as SchemaPointerEvent;
        const id = String(pointerEvent.target?.id || "");
        if (id && isCollapseToggle(pointerEvent)) {
          const node = graph.getNodeData(id);
          if (!node.data?.canCollapse) return;
          const collapsed = !collapsedTableIdsRef.current.has(id);
          if (collapsed) collapsedTableIdsRef.current.add(id);
          else collapsedTableIdsRef.current.delete(id);
          graph.updateNodeData([{ id, data: { collapsed } }]);
          const relationshipsById = new Map(
            visibleDataRef.current.relationships.map((relationship) => [
              relationship.id,
              relationship,
            ]),
          );
          const connectedEdges = graph
            .getEdgeData()
            .filter((edge) => edge.source === id || edge.target === id)
            .flatMap((edge) => {
              const relationship = relationshipsById.get(String(edge.id || ""));
              if (!relationship) return [];
              const route = incrementalRoute(graph, relationship);
              return route ? [relationshipEdgeData(relationship, route)] : [];
            });
          if (connectedEdges.length > 0) graph.updateEdgeData(connectedEdges);
          syncConnectedPorts(graph);
          void graph.draw();
          return;
        }
        if (id) onSelectTable(id);
      });

      graph.on(EdgeEvent.CLICK, (event) => {
        const id = String(
          (event as unknown as { target?: { id?: string } }).target?.id || "",
        );
        if (id) onSelectRelationship(id);
      });

      graph.on(EdgeEvent.POINTER_ENTER, (event) => {
        const id = String(
          (event as unknown as { target?: { id?: string } }).target?.id || "",
        );
        if (id && id !== selectedRelationshipRef.current) {
          void graph.setElementState(id, ["active"]);
        }
      });

      graph.on(EdgeEvent.POINTER_LEAVE, (event) => {
        const id = String(
          (event as unknown as { target?: { id?: string } }).target?.id || "",
        );
        if (id && id !== selectedRelationshipRef.current) {
          void graph.setElementState(id, []);
        }
      });

      graphRef.current = graph;
      await graph.render();
      if (cancelled) return;

      const currentSelectedTableId = selectedTableRef.current;
      const nodeIds = new Set(graph.getNodeData().map((node) => node.id));
      const edgeIds = new Set(graph.getEdgeData().map((edge) => edge.id));
      if (currentSelectedTableId && nodeIds.has(currentSelectedTableId)) {
        await graph.setElementState(currentSelectedTableId, ["selected"]);
      }
      previousSelectedRef.current = currentSelectedTableId;
      const currentSelectedRelationshipId = selectedRelationshipRef.current;
      if (
        currentSelectedRelationshipId &&
        edgeIds.has(currentSelectedRelationshipId)
      ) {
        await graph.setElementState(currentSelectedRelationshipId, [
          "selected",
        ]);
      }
      previousSelectedRelationshipRef.current = currentSelectedRelationshipId;
      if (!cancelled) setRendering(false);

      resizeObserver = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) graph.setSize(width, height);
      });
      resizeObserver.observe(containerRef.current);
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, [
    onSelectRelationship,
    onSelectTable,
    onCreateRelationship,
    tableStructureKey,
  ]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    let cancelled = false;
    const relationships = visibleDataRef.current.relationships;
    const desiredIds = new Set(relationships.map((relationship) => relationship.id));
    const existingEdges = graph.getEdgeData();
    const existingById = new Map(
      existingEdges.map((edge) => [String(edge.id || ""), edge]),
    );
    const removedIds = existingEdges
      .flatMap((edge) =>
        edge.id && !desiredIds.has(edge.id) ? [edge.id] : [],
      );
    if (removedIds.length > 0) graph.removeEdgeData(removedIds);

    const addedEdges = relationships
      .filter((relationship) => !existingById.has(relationship.id))
      .map((relationship) => {
        const route = incrementalRoute(graph, relationship) ?? {
          controlPoints: [],
          sourcePort: "",
          targetPort: "",
        };
        return relationshipEdgeData(relationship, route);
      });
    if (addedEdges.length > 0) graph.addEdgeData(addedEdges);

    const updatedEdges = relationships.map((relationship) => {
      const route = incrementalRoute(graph, relationship) ?? {
        controlPoints: [],
        sourcePort: "",
        targetPort: "",
      };
      return relationshipEdgeData(relationship, route);
    });
    if (updatedEdges.length > 0) graph.updateEdgeData(updatedEdges);
    syncConnectedPorts(graph);

    void graph.draw().then(async () => {
      if (cancelled) return;
      const selectedId = selectedRelationshipRef.current;
      if (selectedId && graph.hasEdge(selectedId)) {
        await graph.setElementState(selectedId, ["selected"]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [relationshipSignature, tableStructureKey]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const previous = previousSelectedRef.current;
    previousSelectedRef.current = selectedTableId;
    const nodeIds = new Set(graph.getNodeData().map((node) => node.id));
    if (previous && nodeIds.has(previous)) {
      void graph.setElementState(previous, []);
    }
    if (selectedTableId && nodeIds.has(selectedTableId)) {
      void graph.setElementState(selectedTableId, ["selected"]);
    }
  }, [selectedTableId]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const previous = previousSelectedRelationshipRef.current;
    previousSelectedRelationshipRef.current = selectedRelationshipId;
    const edgeIds = new Set(graph.getEdgeData().map((edge) => edge.id));
    if (previous && edgeIds.has(previous)) {
      void graph.setElementState(previous, []);
    }
    if (
      selectedRelationshipId &&
      edgeIds.has(selectedRelationshipId)
    ) {
      void graph.setElementState(selectedRelationshipId, ["selected"]);
    }
  }, [selectedRelationshipId]);

  return (
    <div className="schema-graph-surface relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {relationshipDraft ? (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible"
        >
          <defs>
            <marker
              id="relationship-draft-arrow"
              markerHeight="8"
              markerWidth="8"
              orient="auto"
              refX="7"
              refY="4"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill="#059669" />
            </marker>
          </defs>
          <path
            d={`M ${relationshipDraft.start.x} ${relationshipDraft.start.y} C ${relationshipDraft.start.x + 60} ${relationshipDraft.start.y}, ${relationshipDraft.current.x - 60} ${relationshipDraft.current.y}, ${relationshipDraft.current.x} ${relationshipDraft.current.y}`}
            fill="none"
            markerEnd="url(#relationship-draft-arrow)"
            stroke="#059669"
            strokeDasharray="7 5"
            strokeLinecap="round"
            strokeWidth="2.5"
          />
        </svg>
      ) : null}
      {rendering ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/70 text-xs text-muted-foreground backdrop-blur-sm">
          <span className="size-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
          正在生成关系图…
        </div>
      ) : null}
    </div>
  );
});
