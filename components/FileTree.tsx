'use client';

import React, { useState } from 'react';
import { Folder, FolderOpen, File, FileCode, FileText, ChevronRight, ChevronDown } from 'lucide-react';

export interface FileNode {
  path: string;
  name: string;
  type: 'blob' | 'tree';
  url: string;
  children?: FileNode[];
}

interface FileTreeProps {
  nodes: FileNode[];
  onSelectFile: (node: FileNode) => void;
  selectedPath?: string;
  level?: number;
}

export function FileTree({ nodes, onSelectFile, selectedPath, level = 0 }: FileTreeProps) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          onSelectFile={onSelectFile}
          selectedPath={selectedPath}
          level={level}
        />
      ))}
    </ul>
  );
}

function FileTreeNode({
  node,
  onSelectFile,
  selectedPath,
  level,
}: {
  node: FileNode;
  onSelectFile: (node: FileNode) => void;
  selectedPath?: string;
  level: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isSelected = selectedPath === node.path;
  const isDir = node.type === 'tree';

  const handleClick = () => {
    if (isDir) {
      setIsOpen(!isOpen);
    } else {
      onSelectFile(node);
    }
  };

  const getFileIcon = (name: string) => {
    if (name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.js') || name.endsWith('.jsx')) {
      return <FileCode className="w-4 h-4 text-blue-500" />;
    }
    if (name.endsWith('.md') || name.endsWith('.txt')) {
      return <FileText className="w-4 h-4 text-slate-500" />;
    }
    return <File className="w-4 h-4 text-slate-400" />;
  };

  return (
    <li>
      <div
        className={`flex items-center py-1 px-2 cursor-pointer rounded-md hover:bg-slate-100 transition-colors ${
          isSelected ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
      >
        <div className="w-4 h-4 mr-1 flex items-center justify-center">
          {isDir && (
            isOpen ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />
          )}
        </div>
        <div className="mr-2">
          {isDir ? (
            isOpen ? <FolderOpen className="w-4 h-4 text-indigo-400" /> : <Folder className="w-4 h-4 text-indigo-400" />
          ) : (
            getFileIcon(node.name)
          )}
        </div>
        <span className="text-sm truncate select-none">{node.name}</span>
      </div>
      {isDir && isOpen && node.children && (
        <FileTree
          nodes={node.children}
          onSelectFile={onSelectFile}
          selectedPath={selectedPath}
          level={level + 1}
        />
      )}
    </li>
  );
}
