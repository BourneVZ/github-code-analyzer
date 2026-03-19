import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  Node,
  Edge,
  NodeMouseHandler,
  getNodesBounds,
  getViewportForBounds,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Search, HelpCircle, XCircle, ChevronDown, ChevronUp, Loader2, Download } from 'lucide-react';
import { toPng } from 'html-to-image';

const rootId = 'root';

const CustomNode = ({ data }: any) => {
  const isDimmed = Boolean(data.dimmed);
  const headerBg = data.headerColor || '#f8fafc';
  const headerText = data.headerTextColor || '#334155';
  const borderColor = data.borderColor || '#1e293b';
  const lang = data.lang === 'en' ? 'en' : 'zh';
  const canToggle = Boolean(data.hasChildren);
  const showContinueDrill = Boolean(data.showContinueDrill);
  const isDrillingDown = Boolean(data.isDrillingDown);

  return (
    <div
      className="bg-white border-2 rounded-xl shadow-sm min-w-[200px] max-w-[250px] overflow-visible transition-all"
      style={{
        borderColor,
        opacity: isDimmed ? 0.35 : 1,
        filter: isDimmed ? 'grayscale(0.7)' : 'none',
      }}
    >
      <Handle type="target" position={Position.Left} className="w-2 h-2 !bg-slate-800" />
      <div
        className="px-3 py-1.5 border-b-2 flex items-center justify-between"
        style={{ backgroundColor: headerBg, borderColor, color: headerText }}
      >
        <span className="text-xs font-semibold truncate mr-2">{data.file}</span>
        {data.drillDown !== undefined && (
          <div
            className="shrink-0"
            title={
              data.drillDown === 1
                ? 'Needs drill-down analysis'
                : data.drillDown === 0
                  ? 'Unsure if drill-down needed'
                  : 'No drill-down needed'
            }
          >
            {data.drillDown === 1 && <Search className="w-3.5 h-3.5 text-indigo-500" />}
            {data.drillDown === 0 && <HelpCircle className="w-3.5 h-3.5 text-amber-500" />}
            {data.drillDown === -1 && <XCircle className="w-3.5 h-3.5 text-slate-400" />}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="font-bold text-sm text-slate-900 mb-1 truncate">{data.name}</div>
        <div className="text-xs text-slate-600 line-clamp-3">{data.description}</div>
        {data.routePath ? (
          <div className="text-[11px] text-indigo-700 mt-1 truncate" title={data.routePath}>
            {data.routeLabel || 'URL'}: {data.routePath}
          </div>
        ) : null}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-slate-800" />
      {(showContinueDrill || canToggle) && (
        <div className="absolute left-1/2 -bottom-6 -translate-x-1/2 z-10">
          {showContinueDrill ? (
            <button
              type="button"
              disabled={isDrillingDown}
              onClick={(event) => {
                event.stopPropagation();
                data.onContinueDrillDown?.();
              }}
              className="h-8 px-3 rounded-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-xs font-medium shadow-sm border border-indigo-500 flex items-center gap-1"
              title={lang === 'en' ? 'Continue drill-down for this node' : '继续下钻该节点'}
            >
              {isDrillingDown ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {lang === 'en' ? 'Drill Down' : '继续下钻'}
            </button>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onToggleExpand?.();
              }}
              className="w-8 h-8 rounded-full bg-white border border-slate-400 text-slate-700 hover:bg-slate-100 shadow-sm flex items-center justify-center"
              title={
                data.isExpanded
                  ? (lang === 'en' ? 'Collapse child nodes' : '收起子节点')
                  : (lang === 'en' ? 'Expand child nodes' : '展开子节点')
              }
            >
              {data.isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

type PanoramaNode = {
  id: string;
  parentId?: string;
  name: string;
  file: string;
  lineStart?: number;
  lineEnd?: number;
  routePath?: string;
  description_en?: string;
  description_zh?: string;
  drillDown?: number;
};

export function Panorama({
  entryFile,
  subFunctions,
  lang,
  activeModuleId,
  onOpenSource,
  onManualDrillDown,
  manualDrilldownNodeId,
}: {
  entryFile: string | null;
  subFunctions: PanoramaNode[];
  lang: 'en' | 'zh';
  activeModuleId?: string | null;
  onOpenSource?: (node: PanoramaNode) => void;
  onManualDrillDown?: (node: PanoramaNode) => void | Promise<void>;
  manualDrilldownNodeId?: string | null;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const flowWrapperRef = useRef<HTMLDivElement | null>(null);

  const childrenMap = useMemo(() => {
    const map = new Map<string, PanoramaNode[]>();
    for (const sf of subFunctions) {
      const parentId = sf.parentId || rootId;
      if (!map.has(parentId)) map.set(parentId, []);
      map.get(parentId)!.push(sf);
    }
    return map;
  }, [subFunctions]);

  const parentNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [parentId, children] of childrenMap) {
      if (children.length > 0) ids.add(parentId);
    }
    return ids;
  }, [childrenMap]);

  const handleNodeClick: NodeMouseHandler<Node> = (_, node) => {
    if (!onOpenSource) return;
    if (node.id === rootId) return;
    onOpenSource(node.data as PanoramaNode);
  };

  const effectiveCollapsedNodeIds = useMemo(() => {
    const next = new Set<string>();
    for (const id of collapsedNodeIds) {
      if (parentNodeIds.has(id)) next.add(id);
    }
    return next;
  }, [collapsedNodeIds, parentNodeIds]);

  useEffect(() => {
    if (!entryFile) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    const roots = [...(childrenMap.get(rootId) || [])];

    const sortByDisplay = (a: PanoramaNode, b: PanoramaNode) => {
      const fileA = (a.file || '').toLowerCase();
      const fileB = (b.file || '').toLowerCase();
      if (fileA !== fileB) return fileA.localeCompare(fileB);
      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
    };

    roots.sort(sortByDisplay);
    for (const [, list] of childrenMap) list.sort(sortByDisplay);

    const indentGap = 260;
    const verticalGap = 200;
    const topPadding = 40;
    const leftPadding = 80;

    const positionMap = new Map<string, { x: number; y: number }>();
    positionMap.set(rootId, { x: leftPadding, y: topPadding });

    const visibleIds = new Set<string>([rootId]);
    const collectVisible = (parentId: string) => {
      const children = childrenMap.get(parentId) || [];
      if (!children.length) return;
      if (effectiveCollapsedNodeIds.has(parentId)) return;
      for (const child of children) {
        visibleIds.add(child.id);
        collectVisible(child.id);
      }
    };
    collectVisible(rootId);

    const depthMap = new Map<string, number>();
    depthMap.set(rootId, 0);
    const orderedVisibleNodeIds: string[] = [];
    const collectOrdered = (parentId: string, depth: number) => {
      const children = childrenMap.get(parentId) || [];
      for (const child of children) {
        if (!visibleIds.has(child.id)) continue;
        depthMap.set(child.id, depth);
        orderedVisibleNodeIds.push(child.id);
        collectOrdered(child.id, depth + 1);
      }
    };
    collectOrdered(rootId, 1);

    orderedVisibleNodeIds.forEach((nodeId, index) => {
      positionMap.set(nodeId, {
        x: leftPadding + (depthMap.get(nodeId) || 1) * indentGap,
        y: topPadding + (index + 1) * verticalGap,
      });
    });

    newNodes.push({
      id: rootId,
      type: 'custom',
      position: positionMap.get(rootId)!,
      data: {
        name: lang === 'en' ? 'Main Entry' : '主入口函数',
        file: entryFile,
        description: lang === 'en' ? 'The main entry point of the project.' : '项目的主入口函数。',
        headerColor: '#f1f5f9',
        headerTextColor: '#334155',
        borderColor: '#334155',
        dimmed: Boolean(activeModuleId),
        lang,
        hasChildren: (childrenMap.get(rootId) || []).length > 0,
        isExpanded: !effectiveCollapsedNodeIds.has(rootId),
        onToggleExpand: () => {
          setCollapsedNodeIds((prev) => {
            const next = new Set(prev);
            if (next.has(rootId)) next.delete(rootId);
            else next.add(rootId);
            return next;
          });
        },
      },
    });

    for (const sf of subFunctions) {
      const nodeId = sf.id;
      const parentId = sf.parentId || rootId;
      if (!visibleIds.has(nodeId)) continue;
      const pos = positionMap.get(nodeId);
      if (!pos) continue;
      const hasChildren = (childrenMap.get(nodeId) || []).length > 0;
      const showContinueDrill = !hasChildren && (sf.drillDown === 0 || sf.drillDown === 1) && Boolean(onManualDrillDown);

      newNodes.push({
        id: nodeId,
        type: 'custom',
        position: pos,
        data: {
          name: sf.name,
          file: sf.file,
          lineStart: sf.lineStart,
          lineEnd: sf.lineEnd,
          routePath: sf.routePath,
          routeLabel: lang === 'en' ? 'URL' : '路由',
          description: lang === 'en' ? sf.description_en : sf.description_zh,
          drillDown: sf.drillDown,
          headerColor: (sf as any).moduleColor || '#f8fafc',
          headerTextColor: '#0f172a',
          borderColor: (sf as any).moduleColor || '#1e293b',
          dimmed: Boolean(activeModuleId && (sf as any).moduleId !== activeModuleId),
          lang,
          hasChildren,
          isExpanded: !effectiveCollapsedNodeIds.has(nodeId),
          showContinueDrill,
          isDrillingDown: manualDrilldownNodeId === nodeId,
          onToggleExpand: hasChildren
            ? () => {
                setCollapsedNodeIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(nodeId)) next.delete(nodeId);
                  else next.add(nodeId);
                  return next;
                });
              }
            : undefined,
          onContinueDrillDown: showContinueDrill
            ? () => {
                onManualDrillDown?.(sf);
              }
            : undefined,
        },
      });

      if (!visibleIds.has(parentId)) continue;
      newEdges.push({
        id: `e-${parentId}-${nodeId}`,
        source: parentId,
        target: nodeId,
        type: 'step',
        animated: true,
        style: { stroke: '#1e293b', strokeWidth: 2, strokeDasharray: '5,5' },
      });
    }

    setNodes(newNodes);
    setEdges(newEdges);
  }, [
    entryFile,
    subFunctions,
    lang,
    activeModuleId,
    setNodes,
    setEdges,
    childrenMap,
    collapsedNodeIds,
    effectiveCollapsedNodeIds,
    onManualDrillDown,
    manualDrilldownNodeId,
  ]);

  return (
    <div className="w-full h-full bg-slate-50/50 relative" ref={flowWrapperRef}>
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            if (isExporting) return;
            if (!flowWrapperRef.current) return;
            const target = flowWrapperRef.current.querySelector('.react-flow__viewport') as HTMLElement | null;
            if (!target) return;

            try {
              setIsExporting(true);
              // Export all currently visible (not collapsed) nodes by fitting bounds,
              // instead of exporting the current camera viewport.
              const measurableNodes = nodes.map((node) => ({
                ...node,
                width: node.width ?? 250,
                height: node.height ?? 140,
              }));
              const bounds = getNodesBounds(measurableNodes);
              const padding = 120;
              const rawWidth = Math.max(Math.ceil(bounds.width + padding * 2), 1200);
              const rawHeight = Math.max(Math.ceil(bounds.height + padding * 2), 900);
              const imageWidth = Math.min(rawWidth, 6000);
              const imageHeight = Math.min(rawHeight, 6000);
              const exportBounds = {
                x: bounds.x - padding,
                y: bounds.y - padding,
                width: bounds.width + padding * 2,
                height: bounds.height + padding * 2,
              };

              const viewport = getViewportForBounds(
                exportBounds,
                imageWidth,
                imageHeight,
                0.01,
                2,
                0
              );

              // Dynamic clarity strategy:
              // - fewer nodes => higher ratio
              // - many nodes => slightly lower ratio to avoid huge memory spikes
              const basePixelRatio =
                nodes.length <= 30 ? 3.5 :
                nodes.length <= 80 ? 3 :
                nodes.length <= 160 ? 2.4 : 2;
              const maxPixels = 42_000_000;
              const maxRatioByPixels = Math.sqrt(maxPixels / Math.max(1, imageWidth * imageHeight));
              const pixelRatio = Math.max(1, Math.min(4, Math.min(basePixelRatio, maxRatioByPixels)));

              const dataUrl = await toPng(target, {
                cacheBust: true,
                pixelRatio,
                width: imageWidth,
                height: imageHeight,
                backgroundColor: '#f8fafc',
                style: {
                  width: `${imageWidth}px`,
                  height: `${imageHeight}px`,
                  transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
                  transformOrigin: '0 0',
                },
              });
              const link = document.createElement('a');
              link.download = `function-panorama-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
              link.href = dataUrl;
              link.click();
            } catch (err) {
              console.error('Failed to export panorama image:', err);
            } finally {
              setIsExporting(false);
            }
          }}
          disabled={isExporting || nodes.length === 0}
          className="h-8 px-3 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 text-xs font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center"
        >
          {isExporting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
          {lang === 'en' ? 'Export PNG' : '导出 PNG'}
        </button>
        <button
          type="button"
          onClick={() => setCollapsedNodeIds(new Set())}
          className="h-8 px-3 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 text-xs font-medium shadow-sm"
        >
          {lang === 'en' ? 'Expand All' : '全部展开'}
        </button>
        <button
          type="button"
          onClick={() => setCollapsedNodeIds(new Set(parentNodeIds))}
          className="h-8 px-3 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 text-xs font-medium shadow-sm"
        >
          {lang === 'en' ? 'Collapse All' : '全部收起'}
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.05}
        maxZoom={2}
        attributionPosition="bottom-right"
      >
        <Background color="#cbd5e1" gap={16} />
        <MiniMap
          pannable
          zoomable
          nodeStrokeWidth={2}
          maskColor="rgba(15, 23, 42, 0.08)"
          style={{ backgroundColor: '#f8fafc', border: '1px solid #cbd5e1' }}
        />
        <Controls />
      </ReactFlow>
    </div>
  );
}



