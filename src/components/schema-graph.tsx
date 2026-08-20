"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Graph as G6Graph } from "@antv/g6";
import type { SchemaColumn, SchemaModel } from "@/lib/schema-types";

const CARD_WIDTH = 340;
const CARD_HEIGHT = 320;
const CARD_ROW_HEIGHT = 42;
const VISIBLE_CARD_ROWS = 6;
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

export type SchemaGraphHandle = {
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  focus: (tableId: string) => void;
};

type Props = {
  schema: SchemaModel;
  selectedTableId?: string;
  viewMode: GraphViewMode;
  onSelectTable: (tableId: string) => void;
};

type SchemaWheelEvent = {
  ctrlKey?: boolean;
  deltaY?: number;
  metaKey?: boolean;
  target?: { id?: string };
  targetType?: string;
};

function canScrollTableCard(graph: G6Graph, event: SchemaWheelEvent): boolean {
  if (event.targetType !== "node" || event.ctrlKey || event.metaKey) return false;
  const id = String(event.target?.id || "");
  if (!id) return false;

  const node = graph.getNodeData(id);
  const rows = Array.isArray(node.data?.rows) ? node.data.rows : [];
  const maxOffset = Math.max(0, rows.length - VISIBLE_CARD_ROWS);
  const direction = Math.sign(event.deltaY || 0);
  if (!maxOffset || !direction) return false;

  const current = Math.min(Math.max(Number(node.data?.scrollOffset || 0), 0), maxOffset);
  return direction < 0 ? current > 0 : current < maxOffset;
}

function relatedIds(schema: SchemaModel, rootId?: string): Set<string> {
  if (!rootId) return new Set(schema.tables.map((table) => table.id));
  const ids = new Set([rootId]);
  schema.relationships.forEach((relationship) => {
    if (relationship.sourceTableId === rootId) ids.add(relationship.targetTableId);
    if (relationship.targetTableId === rootId) ids.add(relationship.sourceTableId);
  });
  return ids;
}

export const SchemaGraph = forwardRef<SchemaGraphHandle, Props>(function SchemaGraph(
  { schema, selectedTableId, viewMode, onSelectTable },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<G6Graph | null>(null);
  const selectedTableRef = useRef(selectedTableId);
  const previousSelectedRef = useRef<string | undefined>(undefined);
  const [rendering, setRendering] = useState(true);
  const scopeRoot = viewMode === "related" ? selectedTableId : undefined;

  selectedTableRef.current = selectedTableId;

  const visibleData = useMemo(() => {
    const ids = viewMode === "related" ? relatedIds(schema, scopeRoot) : new Set(schema.tables.map((table) => table.id));
    return {
      tables: schema.tables.filter((table) => ids.has(table.id)),
      relationships: schema.relationships.filter(
        (relationship) => ids.has(relationship.sourceTableId) && ids.has(relationship.targetTableId),
      ),
    };
  }, [schema, scopeRoot, viewMode]);

  useImperativeHandle(forwardedRef, () => ({
    fit: () => void graphRef.current?.fitView({ when: "always" }, { duration: 280 }),
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
    if (!containerRef.current || visibleData.tables.length === 0) return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    setRendering(true);

    void Promise.all([import("@antv/g6"), import("@antv/g")]).then(async ([g6, antvG]) => {
      if (cancelled || !containerRef.current) return;

      const { CommonEvent, ExtensionCategory, getExtension, Graph, NodeEvent, Rect, register } = g6;
      const { Line, Rect: GRect, Text } = antvG;
      const tableNodeType = "schema-table-card";

      if (!getExtension(ExtensionCategory.NODE, tableNodeType)) {
        class SchemaTableNode extends Rect {
          private renderedRowCount = 0;

          render(
            attributes: Parameters<InstanceType<typeof Rect>["render"]>[0] = this.parsedAttributes,
            container: Parameters<InstanceType<typeof Rect>["render"]>[1] = this,
          ) {
            super.render(attributes, container);
            const custom = attributes as typeof attributes & {
              cardHeaderHeight?: number;
              columnRowsJson?: string;
              scrollOffset?: number;
              tableCommentText?: string;
              totalRows?: number;
            };
            const [width, height] = this.getSize(attributes);
            const top = -height / 2;
            const left = -width / 2 + 14;
            const right = width / 2 - 14;
            const headerHeight = Number(custom.cardHeaderHeight || 46);
            const tableComment = String(custom.tableCommentText || "");

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
            const rowSlots = Math.max(rows.length, this.renderedRowCount);
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
            this.renderedRowCount = rows.length;

            const totalRows = Number(custom.totalRows || 0);
            const scrollOffset = Number(custom.scrollOffset || 0);
            const trackHeight = Math.max(0, height - headerHeight - 12);
            const maxOffset = Math.max(0, totalRows - VISIBLE_CARD_ROWS);
            const thumbHeight = totalRows > VISIBLE_CARD_ROWS
              ? Math.max(24, trackHeight * (VISIBLE_CARD_ROWS / totalRows))
              : trackHeight;
            const thumbY = top + headerHeight + 6 + (
              maxOffset ? (trackHeight - thumbHeight) * (scrollOffset / maxOffset) : 0
            );
            this.upsert(
              "scroll-track",
              GRect,
              totalRows > VISIBLE_CARD_ROWS
                ? {
                    x: width / 2 - 5,
                    y: top + headerHeight + 6,
                    width: 2,
                    height: trackHeight,
                    radius: 1,
                    fill: "#e5e5e5",
                    pointerEvents: "none",
                  }
                : false,
              container,
            );
            this.upsert(
              "scroll-thumb",
              GRect,
              totalRows > VISIBLE_CARD_ROWS
                ? {
                    x: width / 2 - 6,
                    y: thumbY,
                    width: 4,
                    height: thumbHeight,
                    radius: 2,
                    fill: "#a3a3a3",
                    pointerEvents: "none",
                  }
                : false,
              container,
            );
          }
        }

        register(ExtensionCategory.NODE, tableNodeType, SchemaTableNode);
      }

      const columns = Math.max(1, Math.ceil(Math.sqrt(visibleData.tables.length * 1.55)));
      const relationshipCounts = new Map<string, number>();
      const foreignKeyColumns = new Map<string, Set<string>>();
      schema.relationships.forEach((relationship) => {
        relationshipCounts.set(
          relationship.sourceTableId,
          (relationshipCounts.get(relationship.sourceTableId) || 0) + 1,
        );
        relationshipCounts.set(
          relationship.targetTableId,
          (relationshipCounts.get(relationship.targetTableId) || 0) + 1,
        );
        const names = foreignKeyColumns.get(relationship.sourceTableId) || new Set<string>();
        relationship.sourceColumns.forEach((name) => names.add(name));
        foreignKeyColumns.set(relationship.sourceTableId, names);
      });

      const graphNodes = visibleData.tables.map((table) => {
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
            name: truncateText(name, 22),
            type: truncateText(column.dataType, 16),
          };
        });

        const headerHeight = table.comment ? 56 : 42;
        return {
          id: table.id,
          data: {
            name: table.displayName,
            comment: table.comment,
            cardHeaderHeight: headerHeight,
            columns: table.columns.length,
            rows,
            relationships: relationshipCounts.get(table.id) || 0,
          },
        };
      });

      const graph = new Graph({
        container: containerRef.current,
        animation: false,
        autoFit: { type: "view", options: { when: "always" } },
        padding: VIEW_PADDING,
        zoomRange: [0.025, 4],
        data: {
          nodes: graphNodes,
          edges: visibleData.relationships.map((relationship) => ({
            id: relationship.id,
            source: relationship.sourceTableId,
            target: relationship.targetTableId,
            data: { name: relationship.name },
          })),
        },
        layout: {
          type: "grid",
          cols: columns,
          condense: true,
          preventOverlap: true,
          nodeSize: [CARD_WIDTH + 18, CARD_HEIGHT + 18],
          sortBy: "degree",
        },
        node: {
          type: tableNodeType,
          style: (datum) => {
            const rows = Array.isArray(datum.data?.rows)
              ? (datum.data.rows as Array<{ detail: string; name: string; type: string }>)
              : [];
            const scrollOffset = Math.min(
              Math.max(Number(datum.data?.scrollOffset || 0), 0),
              Math.max(0, rows.length - VISIBLE_CARD_ROWS),
            );
            return {
              size: [CARD_WIDTH, CARD_HEIGHT],
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
              labelMaxWidth: CARD_WIDTH - 28,
              labelWordWrap: true,
              labelTextOverflow: "ellipsis",
              labelPlacement: "center",
              labelOffsetX: -(CARD_WIDTH / 2) + 14,
              labelOffsetY: -(CARD_HEIGHT / 2) + 18,
              labelTextAlign: "left",
              tableCommentText: String(datum.data?.comment || ""),
              cardHeaderHeight: Number(datum.data?.cardHeaderHeight || 42),
              columnRowsJson: JSON.stringify(
                rows.slice(scrollOffset, scrollOffset + VISIBLE_CARD_ROWS),
              ),
              scrollOffset,
              totalRows: rows.length,
            };
          },
          state: {
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
          type: "line",
          style: {
            stroke: "#a3a3a3",
            strokeOpacity: 0.72,
            lineWidth: 1.15,
            endArrow: true,
          },
          state: {
            selected: { stroke: "#171717", strokeOpacity: 1, lineWidth: 2 },
          },
        },
        behaviors: [
          "drag-canvas",
          {
            type: "zoom-canvas",
            enable: (event: SchemaWheelEvent) => !canScrollTableCard(graph, event),
          },
          "drag-element",
          "click-select",
        ],
      });

      graph.on(NodeEvent.CLICK, (event) => {
        const id = String((event as unknown as { target?: { id?: string } }).target?.id || "");
        if (id) onSelectTable(id);
      });

      graph.on(CommonEvent.WHEEL, (event) => {
        const wheelEvent = event as unknown as SchemaWheelEvent;
        if (!canScrollTableCard(graph, wheelEvent)) return;
        const id = String(wheelEvent.target?.id || "");
        const node = graph.getNodeData(id);
        const rows = Array.isArray(node.data?.rows) ? node.data.rows : [];
        const maxOffset = Math.max(0, rows.length - VISIBLE_CARD_ROWS);
        const current = Math.min(Math.max(Number(node.data?.scrollOffset || 0), 0), maxOffset);
        const next = Math.min(Math.max(current + Math.sign(wheelEvent.deltaY || 0), 0), maxOffset);
        graph.updateNodeData([{ id, data: { scrollOffset: next } }]);
        void graph.draw();
      });

      graphRef.current = graph;
      await graph.render();
      graph.updateNodeData(
        graph.getNodeData().map((node) => ({
          id: node.id,
          data: { scrollOffset: 0 },
        })),
      );
      await graph.draw();
      if (cancelled) return;

      const currentSelectedTableId = selectedTableRef.current;
      if (currentSelectedTableId && graph.getElementData(currentSelectedTableId)) {
        await graph.setElementState(currentSelectedTableId, ["selected"]);
      }
      previousSelectedRef.current = currentSelectedTableId;
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
  }, [onSelectTable, schema.relationships, visibleData]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const previous = previousSelectedRef.current;
    previousSelectedRef.current = selectedTableId;
    if (previous && graph.getElementData(previous)) {
      void graph.setElementState(previous, []);
    }
    if (selectedTableId && graph.getElementData(selectedTableId)) {
      void graph.setElementState(selectedTableId, ["selected"]);
    }
  }, [selectedTableId]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {rendering ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/70 text-xs text-muted-foreground backdrop-blur-sm">
          <span className="size-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
          正在生成关系图…
        </div>
      ) : null}
    </div>
  );
});
