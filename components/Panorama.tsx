import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  Node,
  Edge
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Search, HelpCircle, XCircle } from 'lucide-react';

const CustomNode = ({ data }: any) => {
  return (
    <div className="bg-white border-2 border-slate-800 rounded-xl shadow-sm min-w-[200px] max-w-[250px] overflow-hidden">
      <Handle type="target" position={Position.Left} className="w-2 h-2 !bg-slate-800" />
      <div className="px-3 py-1.5 border-b-2 border-slate-800 bg-slate-50 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700 truncate mr-2">
          {data.file}
        </span>
        {data.drillDown !== undefined && (
          <div className="shrink-0" title={
            data.drillDown === 1 ? 'Needs drill-down analysis' :
            data.drillDown === 0 ? 'Unsure if drill-down needed' :
            'No drill-down needed'
          }>
            {data.drillDown === 1 && <Search className="w-3.5 h-3.5 text-indigo-500" />}
            {data.drillDown === 0 && <HelpCircle className="w-3.5 h-3.5 text-amber-500" />}
            {data.drillDown === -1 && <XCircle className="w-3.5 h-3.5 text-slate-400" />}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="font-bold text-sm text-slate-900 mb-1 truncate">{data.name}</div>
        <div className="text-xs text-slate-600 line-clamp-3">{data.description}</div>
      </div>
      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-slate-800" />
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

export function Panorama({ entryFile, subFunctions, lang }: { entryFile: string | null, subFunctions: any[], lang: 'en' | 'zh' }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    if (!entryFile) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // Root node
    newNodes.push({
      id: 'root',
      type: 'custom',
      position: { x: 50, y: Math.max(50, (subFunctions.length * 160) / 2) },
      data: {
        name: lang === 'en' ? 'Main Entry' : '主入口函数',
        file: entryFile,
        description: lang === 'en' ? 'The main entry point of the project.' : '项目的主入口函数。',
      },
    });

    // Sub-function nodes
    const startX = 450;
    const startY = 50;
    const ySpacing = 160;

    subFunctions.forEach((sf, index) => {
      const nodeId = `sf-${index}`;
      newNodes.push({
        id: nodeId,
        type: 'custom',
        position: { x: startX, y: startY + index * ySpacing },
        data: {
          name: sf.name,
          file: sf.file,
          description: lang === 'en' ? sf.description_en : sf.description_zh,
          drillDown: sf.drillDown,
        },
      });

      newEdges.push({
        id: `e-root-${nodeId}`,
        source: 'root',
        target: nodeId,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#1e293b', strokeWidth: 2, strokeDasharray: '5,5' },
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [entryFile, subFunctions, lang, setNodes, setEdges]);

  return (
    <div className="w-full h-full bg-slate-50/50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-right"
      >
        <Background color="#cbd5e1" gap={16} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
