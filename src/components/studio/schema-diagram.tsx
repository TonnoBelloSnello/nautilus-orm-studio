"use client";

import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";

import type { TableDefinition } from "@/lib/nautilus/types";

type TableNodeData = { table: TableDefinition };
type TableNodeType = Node<TableNodeData, "tableNode">;

const NODE_WIDTH = 250;

function TableNode({ data }: { data: TableNodeData }) {
  const { table } = data;

  return (
    <div className="relative min-w-56 rounded-xl border border-(--line) bg-(--panel) text-sm text-white shadow-sm">
      <Handle type="target" position={Position.Top} className="bg-zinc-700 -mt-1" />
      <div className="border-b border-(--line) px-4 py-3 font-semibold tracking-tight">
        {table.displayName || table.tableName}
      </div>
      <div className="space-y-1 px-4 py-3">
        {table.columns.map((column) => {
          const isPrimaryKey = table.primaryKey === column.name;
          return (
            <div key={column.name} className="group flex items-center justify-between text-xs">
              <span className={`${isPrimaryKey ? "font-medium" : "text-(--muted)"} flex items-center gap-1`}>
                {column.name} {isPrimaryKey ? 
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" className="rotate-45 text-white/40" viewBox="0 0 16 16">
                  <path d="M3.5 11.5a3.5 3.5 0 1 1 3.163-5H14L15.5 8 14 9.5l-1-1-1 1-1-1-1 1-1-1-1 1H6.663a3.5 3.5 0 0 1-3.163 2M2.5 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2"/>
                </svg> : ""}
              </span>
              <span className="ml-6 font-mono text-[10px] uppercase text-zinc-600">{column.kind}</span>
            </div>
          );
        })}
      </div>
      <Handle type="source" position={Position.Bottom} className="bg-zinc-700! -mb-1" />
    </div>
  );
}

const nodeTypes = { tableNode: TableNode };

function getLayoutedElements(nodes: TableNodeType[], edges: Edge[], direction = "TB") {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, nodesep: 100, ranksep: 200 });

  for (const node of nodes) {
    dagreGraph.setNode(node.id, {
      width: NODE_WIDTH,
      height: 60 + node.data.table.columns.length * 22,
    });
  }

  for (const edge of edges) {
    dagreGraph.setEdge(edge.source, edge.target);
  }

  dagre.layout(dagreGraph);

  return {
    nodes: nodes.map((node) => {
      const position = dagreGraph.node(node.id);
      return {
        ...node,
        targetPosition: Position.Top,
        sourcePosition: Position.Bottom,
        position: {
          x: position.x - NODE_WIDTH / 2,
          y: position.y - position.height / 2,
        },
      };
    }),
    edges,
  };
}

export function SchemaDiagram({ tables }: { tables: TableDefinition[] }) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: TableNodeType[] = tables.map((table) => ({
      id: table.slug,
      type: "tableNode",
      position: { x: 0, y: 0 },
      data: { table },
    }));
    const edges: Edge[] = tables.flatMap((table) =>
      table.columns.flatMap((column) =>
        column.relation
          ? [{
              id: `${table.slug}-${column.name}-${column.relation.targetTableSlug}`,
              source: table.slug,
              target: column.relation.targetTableSlug,
              label: column.name,
              animated: true,
              style: { stroke: "#fff", opacity: 0.5, strokeWidth: 1.5 },
              labelStyle: { fill: "#a1a1aa", fontSize: 11, fontWeight: 500 },
              labelBgStyle: { fill: "#18181b", fillOpacity: 0.8 },
              labelBgPadding: [4, 4] as [number, number],
              labelBgBorderRadius: 4,
            }]
          : [],
      ),
    );

    const { nodes: initialNodes, edges: initialEdges } = getLayoutedElements(nodes, edges);
    return { initialNodes, initialEdges };
  }, [tables]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialEdges, initialNodes, setEdges, setNodes]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        colorMode="dark"
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        className="bg-black/20"
      >
        <Background gap={16} size={1} color="#3f3f46" />
        <Controls className="bg-(--panel)! border-(--line) text-white" />
      </ReactFlow>
    </div>
  );
}
