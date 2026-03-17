'use client';

import React, { useEffect, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeViewerProps {
  code: string;
  language: string;
  filename: string;
  highlightLine?: number | null;
}

export function CodeViewer({ code, language, filename, highlightLine }: CodeViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!highlightLine || !containerRef.current) return;
    const lineEl = containerRef.current.querySelector(`[data-line-number="${highlightLine}"]`) as HTMLElement | null;
    if (lineEl) {
      lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [code, highlightLine]);

  return (
    <div className="flex flex-col h-full bg-white rounded-xl overflow-hidden border border-slate-200 shadow-sm">
      <div className="flex items-center px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex space-x-2 mr-4">
          <div className="w-3 h-3 rounded-full bg-red-400"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
          <div className="w-3 h-3 rounded-full bg-green-400"></div>
        </div>
        <span className="text-sm font-mono text-slate-600">{filename}</span>
      </div>
      <div className="flex-1 overflow-auto" ref={containerRef}>
        <SyntaxHighlighter
          language={language}
          style={oneLight}
          customStyle={{
            margin: 0,
            padding: '1.5rem',
            background: 'transparent',
            fontSize: '14px',
            lineHeight: '1.5',
          }}
          showLineNumbers={true}
          wrapLines={true}
          lineProps={(lineNumber) => ({
            'data-line-number': lineNumber,
            style: highlightLine === lineNumber ? { backgroundColor: '#fef3c7', display: 'block' } : { display: 'block' },
          })}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
