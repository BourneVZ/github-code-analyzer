'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Github, Search, Loader2, AlertCircle, ArrowLeft, FileCode, Sparkles, ChevronDown, ChevronRight, Terminal, CheckCircle2, Info, XCircle, Languages, Maximize2, Minimize2, PanelLeft, PanelRight, Code2 } from 'lucide-react';
import { FileTree } from '@/components/FileTree';
import type { FileNode } from '@/lib/github';
import { CodeViewer } from '@/components/CodeViewer';
import { Panorama } from '@/components/Panorama';
import { parseGithubUrl, buildFileTree, getLanguageFromFilename, getCodeFiles } from '@/lib/github';
import { GoogleGenAI, Type } from "@google/genai";
import { Group, Panel, Separator } from 'react-resizable-panels';

type LocalizedString = { en: string; zh: string };

type LogEntry = {
  id: string;
  timestamp: Date;
  type: 'info' | 'success' | 'warning' | 'error';
  message: LocalizedString;
  details?: any;
  expanded?: boolean;
};

type RepoRef = { owner: string; repo: string; branch: string };
type GithubEndpointKind = 'api' | 'raw';

class GithubRequestError extends Error {
  details: Record<string, any>;

  constructor(message: string, details: Record<string, any>) {
    super(message);
    this.name = 'GithubRequestError';
    this.details = details;
  }
}

type SubFunctionNode = {
  id: string;
  parentId: string;
  depth: number;
  name: string;
  file: string;
  description_en: string;
  description_zh: string;
  drillDown: number;
};

type LocatedFunction = {
  file: string;
  code: string;
  lineStart: number;
  lineEnd: number;
};

type FunctionNameNormalization = {
  original: string;
  normalized: string;
  candidates: string[];
};

function AnalyzeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialUrl = searchParams.get('url') || '';
  const initialLang = (searchParams.get('lang') as 'en' | 'zh') || 'zh';
  
  const [url, setUrl] = useState(initialUrl);
  const [lang, setLang] = useState<'en' | 'zh'>(initialLang);
  const [isLogsFullscreen, setIsLogsFullscreen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [contentLoading, setContentLoading] = useState(false);
  const [repoInfo, setRepoInfo] = useState<{owner: string, repo: string, branch: string} | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<{
    summary_en: string;
    summary_zh: string;
    primaryLanguage_en: string;
    primaryLanguage_zh: string;
    techStack: string[];
    entryFiles: string[];
  } | null>(null);
  const [confirmedEntryFile, setConfirmedEntryFile] = useState<{
    path: string;
    reason_en: string;
    reason_zh: string;
  } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isVerifyingEntry, setIsVerifyingEntry] = useState(false);
  const [codeFilesList, setCodeFilesList] = useState<string[]>([]);
  const [subFunctions, setSubFunctions] = useState<any[]>([]);
  const [isAnalyzingSubFunctions, setIsAnalyzingSubFunctions] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showFileTree, setShowFileTree] = useState(true);
  const [showCodeViewer, setShowCodeViewer] = useState(true);
  const [showPanorama, setShowPanorama] = useState(true);
  const lastFetchedUrl = useRef('');
  const fetchIdRef = useRef(0);
  const defaultGeminiApiVersion = "v1beta";

  const resolveGeminiEndpoint = () => {
    const rawBaseUrl =
      process.env.NEXT_PUBLIC_GEMINI_BASE_URL ||
      process.env.GEMINI_BASE_URL ||
      "https://generativelanguage.googleapis.com";

    const trimmed = rawBaseUrl.replace(/\/+$/, "");
    const match = trimmed.match(/\/(v1beta|v1)$/i);
    const apiVersion = match ? match[1].toLowerCase() : defaultGeminiApiVersion;
    const baseUrl = match ? trimmed.slice(0, -match[0].length) : trimmed;
    const requestUrl = `${baseUrl}/${apiVersion}`;
    return { rawBaseUrl, baseUrl, apiVersion, requestUrl };
  };

  const createGeminiClient = () => {
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) return null;

    const endpoint = resolveGeminiEndpoint();
    return new GoogleGenAI(
      endpoint.baseUrl
        ? {
            apiKey,
            httpOptions: {
              baseUrl: endpoint.baseUrl,
              apiVersion: endpoint.apiVersion,
            },
          }
        : {
            apiKey,
            httpOptions: {
              apiVersion: endpoint.apiVersion,
            },
          }
    );
  };

  const addLog = (message: LocalizedString, type: LogEntry['type'] = 'info', details?: any) => {
    setLogs(prev => [...prev, {
      id: Math.random().toString(36).substring(7),
      timestamp: new Date(),
      type,
      message,
      details,
      expanded: false
    }]);
  };

  const toggleLog = (id: string) => {
    setLogs(prev => prev.map(log => log.id === id ? { ...log, expanded: !log.expanded } : log));
  };

  const truncateLongStrings = (obj: any): any => {
    if (typeof obj === 'string') {
      if (obj.length > 500) {
        const remainingStr = obj.substring(500);
        const remainingBytes = new TextEncoder().encode(remainingStr).length;
        return obj.substring(0, 500) + `... (${remainingBytes} more bytes)`;
      }
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(truncateLongStrings);
    }
    if (obj !== null && typeof obj === 'object') {
      const newObj: any = {};
      for (const key in obj) {
        newObj[key] = truncateLongStrings(obj[key]);
      }
      return newObj;
    }
    return obj;
  };

  const getGithubToken = () => process.env.NEXT_PUBLIC_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';

  const getGithubTokenMeta = () => {
    const token = getGithubToken();
    if (!token) {
      return { configured: false, masked: null, length: 0 };
    }

    const head = token.slice(0, 4);
    const tail = token.slice(-4);
    return {
      configured: true,
      masked: `${head}...${tail}`,
      length: token.length,
    };
  };

  const getGithubApiHeaders = () => {
    const token = getGithubToken();
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  const toErrorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Unknown error';
  };

  const getGithubHintByStatus = (status: number, endpoint: GithubEndpointKind) => {
    if (status === 401) return 'GitHub token invalid/expired. Please regenerate token.';
    if (status === 403) return 'Possible API rate limit or token permissions issue.';
    if (status === 404) {
      if (endpoint === 'raw') return 'File/branch may not exist in raw endpoint, or repository is private.';
      return 'Repository/file not found, or token has no access to private repository.';
    }
    if (status === 429) return 'GitHub rate limit exceeded.';
    if (status >= 500) return 'GitHub service temporary issue.';
    return 'See response body snippet and request metadata for diagnosis.';
  };

  const decodeBase64Utf8 = (base64: string) => {
    const normalized = base64.replace(/\n/g, '');
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };

  const buildGithubErrorFromResponse = async (res: Response, context: {
    endpoint: GithubEndpointKind;
    operation: string;
    url: string;
    filePath?: string;
    owner?: string;
    repo?: string;
    branch?: string;
  }) => {
    const bodyText = await res.text().catch(() => '');
    const details = {
      endpoint: context.endpoint,
      operation: context.operation,
      url: context.url,
      owner: context.owner,
      repo: context.repo,
      branch: context.branch,
      filePath: context.filePath,
      status: res.status,
      statusText: res.statusText,
      rateLimit: {
        limit: res.headers.get('x-ratelimit-limit'),
        remaining: res.headers.get('x-ratelimit-remaining'),
        reset: res.headers.get('x-ratelimit-reset'),
      },
      responseSnippet: bodyText.slice(0, 500),
      token: {
        ...getGithubTokenMeta(),
        isExposedToBrowser: Boolean(process.env.NEXT_PUBLIC_GITHUB_TOKEN),
      },
      hint: getGithubHintByStatus(res.status, context.endpoint),
    };
    throw new GithubRequestError(
      `${context.operation} failed: HTTP ${res.status} ${res.statusText}`,
      details
    );
  };

  const buildGithubErrorFromException = (
    err: unknown,
    context: {
      endpoint: GithubEndpointKind;
      operation: string;
      url: string;
      filePath?: string;
      owner?: string;
      repo?: string;
      branch?: string;
    }
  ) => {
    const errObj = err as any;
    const details = {
      endpoint: context.endpoint,
      operation: context.operation,
      url: context.url,
      owner: context.owner,
      repo: context.repo,
      branch: context.branch,
      filePath: context.filePath,
      errorName: errObj?.name || 'Error',
      errorMessage: toErrorMessage(err),
      token: {
        ...getGithubTokenMeta(),
        isExposedToBrowser: Boolean(process.env.NEXT_PUBLIC_GITHUB_TOKEN),
      },
      hint:
        context.endpoint === 'raw'
          ? 'Network/CORS issue when accessing raw.githubusercontent.com from browser. Check proxy/firewall, and avoid Authorization header on raw requests.'
          : 'Network issue when accessing api.github.com. Check connectivity/proxy/firewall.',
    };

    throw new GithubRequestError(`${context.operation} failed: ${toErrorMessage(err)}`, details);
  };

  const fetchGithubApiJson = async <T,>(url: string, operation: string): Promise<T> => {
    try {
      const res = await fetch(url, { headers: getGithubApiHeaders() });
      if (!res.ok) {
        await buildGithubErrorFromResponse(res, { endpoint: 'api', operation, url });
      }
      return res.json() as Promise<T>;
    } catch (err) {
      if (err instanceof GithubRequestError) throw err;
      buildGithubErrorFromException(err, { endpoint: 'api', operation, url });
    }
  };

  const logGithubError = (scope: string, err: unknown, filePath?: string) => {
    if (err instanceof GithubRequestError) {
      const name = filePath ? `${scope} ${filePath}` : scope;
      addLog(
        {
          en: `${name} failed: ${err.message}`,
          zh: `${name} 失败: ${err.message}`,
        },
        'error',
        { githubError: err.details }
      );
      return;
    }

    const msg = toErrorMessage(err);
    const name = filePath ? `${scope} ${filePath}` : scope;
    addLog(
      {
        en: `${name} failed: ${msg}`,
        zh: `${name} 失败: ${msg}`,
      },
      'error'
    );
  };

  const getMaxDrillDownDepth = () => {
    const raw =
      process.env.NEXT_PUBLIC_GEMINI_DRILLDOWN_MAX_DEPTH ||
      process.env.GEMINI_DRILLDOWN_MAX_DEPTH ||
      '2';
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return 2;
    return Math.min(Math.max(parsed, 0), 6);
  };

  const fetchFileText = async (repo: RepoRef, filePath: string) => {
    const rawUrl = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${repo.branch}/${filePath}`;

    try {
      // Avoid Authorization on raw endpoint to reduce browser preflight/CORS failures.
      const rawRes = await fetch(rawUrl);
      if (rawRes.ok) {
        return { text: await rawRes.text(), rawUrl, source: 'raw' as const };
      }
      if (rawRes.status !== 404) {
        await buildGithubErrorFromResponse(rawRes, {
          endpoint: 'raw',
          operation: 'Fetch raw file',
          url: rawUrl,
          owner: repo.owner,
          repo: repo.repo,
          branch: repo.branch,
          filePath,
        });
      }
    } catch (rawErr) {
      const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(repo.branch)}`;
      try {
        const apiRes = await fetch(apiUrl, { headers: getGithubApiHeaders() });
        if (!apiRes.ok) {
          await buildGithubErrorFromResponse(apiRes, {
            endpoint: 'api',
            operation: 'Fetch file content via GitHub contents API',
            url: apiUrl,
            owner: repo.owner,
            repo: repo.repo,
            branch: repo.branch,
            filePath,
          });
        }
        const payload = await apiRes.json();
        if (!payload?.content || payload?.encoding !== 'base64') {
          throw new GithubRequestError('Unexpected contents API payload', {
            endpoint: 'api',
            operation: 'Decode contents API response',
            url: apiUrl,
            owner: repo.owner,
            repo: repo.repo,
            branch: repo.branch,
            filePath,
            payloadShape: {
              hasContent: Boolean(payload?.content),
              encoding: payload?.encoding,
              type: payload?.type,
            },
          });
        }
        return {
          text: decodeBase64Utf8(payload.content),
          rawUrl,
          source: 'api' as const,
        };
      } catch (apiErr) {
        if (apiErr instanceof GithubRequestError) throw apiErr;
        buildGithubErrorFromException(apiErr, {
          endpoint: 'api',
          operation: 'Fetch file content via GitHub contents API',
          url: apiUrl,
          owner: repo.owner,
          repo: repo.repo,
          branch: repo.branch,
          filePath,
        });
      }
    }

    const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(repo.branch)}`;
    const apiRes = await fetch(apiUrl, { headers: getGithubApiHeaders() });
    if (!apiRes.ok) {
      await buildGithubErrorFromResponse(apiRes, {
        endpoint: 'api',
        operation: 'Fetch file content via GitHub contents API',
        url: apiUrl,
        owner: repo.owner,
        repo: repo.repo,
        branch: repo.branch,
        filePath,
      });
    }
    const payload = await apiRes.json();
    if (!payload?.content || payload?.encoding !== 'base64') {
      throw new GithubRequestError('Unexpected contents API payload', {
        endpoint: 'api',
        operation: 'Decode contents API response',
        url: apiUrl,
        owner: repo.owner,
        repo: repo.repo,
        branch: repo.branch,
        filePath,
        payloadShape: {
          hasContent: Boolean(payload?.content),
          encoding: payload?.encoding,
          type: payload?.type,
        },
      });
    }

    return {
      text: decodeBase64Utf8(payload.content),
      rawUrl,
      source: 'api' as const,
    };
  };

  const isLikelySystemOrLibraryFunction = (name: string) => {
    const n = name.trim().toLowerCase();
    if (!n) return true;
    const deny = new Set([
      'render',
      'constructor',
      'componentdidmount',
      'componentdidupdate',
      'componentwillunmount',
      'main',
      'init',
      'setup',
      'teardown',
      'close',
      'open',
      'map',
      'filter',
      'reduce',
      'forEach',
      'then',
      'catch',
      'finally',
      'setstate',
      'useeffect',
      'usestate',
    ]);
    if (deny.has(n)) return true;
    if (/^(get|set|is)[A-Z_]/.test(name)) return false;
    return n.length <= 2;
  };

  const normalizeCalledFunctionName = (input: string): FunctionNameNormalization => {
    const original = (input || '').trim();
    if (!original) {
      return {
        original,
        normalized: '',
        candidates: [],
      };
    }

    let value = original
      .replace(/\s+/g, ' ')
      .replace(/^[*&\s]+/, '')
      .replace(/^(?:await|new)\s+/i, '')
      .replace(/\(.*$/, '')
      .replace(/[;,\s]+$/, '')
      .trim();

    if (!value) {
      return {
        original,
        normalized: '',
        candidates: [],
      };
    }

    const byArrow = value.split('->').pop() || value;
    const byDot = byArrow.split('.').pop() || byArrow;
    const byScope = byDot.split('::').pop() || byDot;
    const cleaned = byScope
      .replace(/<[^<>]*>/g, '')
      .replace(/\[.*\]$/, '')
      .replace(/^['"`]|['"`]$/g, '')
      .trim();

    const candidates = Array.from(
      new Set(
        [cleaned, byScope.trim(), byDot.trim(), byArrow.trim(), value.trim(), original]
          .filter(Boolean)
      )
    );

    return {
      original,
      normalized: cleaned || byScope || value,
      candidates,
    };
  };

  const buildFunctionDefinitionRegexes = (fnName: string) => {
    const escaped = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [
      new RegExp(`\\bfunction\\s+${escaped}\\s*\\(`, 'm'),
      new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>`, 'm'),
      new RegExp(`\\b${escaped}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>`, 'm'),
      new RegExp(`\\b(?:public|private|protected|static|async|export\\s+)*${escaped}\\s*\\([^)]*\\)\\s*\\{`, 'm'),
      new RegExp(`\\bdef\\s+${escaped}\\s*\\(`, 'm'),
      new RegExp(`\\b(?:func|fn)\\s+${escaped}\\s*\\(`, 'm'),
      new RegExp(`\\b${escaped}\\s*:\\s*function\\s*\\(`, 'm'),
      new RegExp(`\\b${escaped}\\s*\\([^)]*\\)\\s*\\{`, 'm'),
      // C/C++ free function definition with return type/qualifiers.
      new RegExp(`(?:^|[;{}]\\s*)(?:inline\\s+|constexpr\\s+|static\\s+|virtual\\s+|extern\\s+|friend\\s+|typename\\s+|template\\s*<[^>]+>\\s*)*[\\w:\\<\\>\\*&~\\s]+\\b${escaped}\\s*\\([^;{}]*\\)\\s*(?:const\\s*)?(?:noexcept\\s*)?(?:->\\s*[\\w:\\<\\>\\*&\\s]+\\s*)?\\{`, 'm'),
      // C++ class/namespace scoped definition: ClassName::method(...)
      new RegExp(`(?:^|[;{}]\\s*)(?:inline\\s+|constexpr\\s+|static\\s+|virtual\\s+|extern\\s+|friend\\s+|typename\\s+|template\\s*<[^>]+>\\s*)*[\\w:\\<\\>\\*&~\\s]+\\b[\\w:<>~]+::${escaped}\\s*\\([^;{}]*\\)\\s*(?:const\\s*)?(?:noexcept\\s*)?(?:->\\s*[\\w:\\<\\>\\*&\\s]+\\s*)?\\{`, 'm'),
    ];
  };

  const extractFunctionSnippet = (fileText: string, matchIndex: number) => {
    const lines = fileText.split('\n');
    let charCount = 0;
    let startLine = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineLen = lines[i].length + 1;
      if (charCount + lineLen > matchIndex) {
        startLine = i;
        break;
      }
      charCount += lineLen;
    }

    let endLine = Math.min(lines.length - 1, startLine + 220);
    let braceBalance = 0;
    let seenOpening = false;
    for (let i = startLine; i <= endLine; i++) {
      const line = lines[i];
      for (const ch of line) {
        if (ch === '{') {
          braceBalance++;
          seenOpening = true;
        } else if (ch === '}') {
          braceBalance--;
        }
      }
      if (seenOpening && braceBalance <= 0 && i > startLine) {
        endLine = i;
        break;
      }
    }

    const snippet = lines.slice(startLine, endLine + 1).join('\n');
    return {
      code: snippet,
      lineStart: startLine + 1,
      lineEnd: endLine + 1,
    };
  };

  const findFunctionInFile = (fileText: string, fnName: string): LocatedFunction | null => {
    const normalized = normalizeCalledFunctionName(fnName);
    for (const nameCandidate of normalized.candidates) {
      const regexes = buildFunctionDefinitionRegexes(nameCandidate);
      for (const re of regexes) {
        const match = re.exec(fileText);
        if (match?.index !== undefined) {
          const snippet = extractFunctionSnippet(fileText, match.index);
          return {
            file: '',
            code: snippet.code,
            lineStart: snippet.lineStart,
            lineEnd: snippet.lineEnd,
          };
        }
      }
    }
    return null;
  };

  const locateFunctionDefinition = async ({
    functionName,
    parentFile,
    allFiles,
    repo,
    ai,
    currentFetchId,
  }: {
    functionName: string;
    parentFile: string;
    allFiles: string[];
    repo: RepoRef;
    ai: GoogleGenAI;
    currentFetchId: number;
  }): Promise<LocatedFunction | null> => {
    if (currentFetchId !== fetchIdRef.current) return null;

    // Stage 1: same file as parent caller
    if (parentFile) {
      const parentFileContent = await fetchFileText(repo, parentFile);
      if (parentFileContent) {
        const inParent = findFunctionInFile(parentFileContent.text, functionName);
        if (inParent) {
          return { ...inParent, file: parentFile };
        }
      }
    }

    // Stage 2: let AI guess likely files from file list
    const fileList = allFiles.slice(0, 2000).join('\n');
    const guessPrompt = `Given a repository file list and a function name, return up to 8 likely file paths where the function is defined.
Function: ${normalizeCalledFunctionName(functionName).normalized || functionName}
Parent file: ${parentFile}
Files:
${fileList}`;

    try {
      const guessResp = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: guessPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              candidateFiles: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ["candidateFiles"],
          },
        },
      });

      if (guessResp.text) {
        const guessed = JSON.parse(guessResp.text)?.candidateFiles || [];
        for (const file of guessed) {
          if (currentFetchId !== fetchIdRef.current) return null;
          const content = await fetchFileText(repo, file);
          if (!content) continue;
          const found = findFunctionInFile(content.text, functionName);
          if (found) return { ...found, file };
        }
      }
    } catch {
      // Continue to stage 3 on any AI-guess failure.
    }

    // Stage 3: regex search across project files
    for (const file of allFiles) {
      if (currentFetchId !== fetchIdRef.current) return null;
      const content = await fetchFileText(repo, file);
      if (!content) continue;
      const found = findFunctionInFile(content.text, functionName);
      if (found) return { ...found, file };
    }

    return null;
  };

  const analyzeSubFunctions = async (entryFilePath: string, currentFetchId: number, repo: {owner: string, repo: string, branch: string}, targetUrl: string, projectSummary: string, allFiles: string[]) => {
    if (currentFetchId !== fetchIdRef.current) return;
    setIsAnalyzingSubFunctions(true);
    setSubFunctions([]);
    addLog({ en: 'Starting sub-function analysis...', zh: '开始分析子函数...' }, 'info');

    try {
      const ai = createGeminiClient();
      if (!ai) return;

      // Fetch entry file content
      const entryContent = await fetchFileText(repo, entryFilePath);
      if (!entryContent) {
        throw new Error('Entry file content is empty');
      }
      const text = entryContent.text;
      
      const fileList = allFiles.slice(0, 1000).join('\n');
      
      const prompt = `Analyze the following entry file from a GitHub repository to identify the key sub-functions it calls.
      
Project URL: ${targetUrl}
Project Summary: ${projectSummary}
Entry File Path: ${entryFilePath}

Available Files in Project:
${fileList}

Entry File Content:
\`\`\`
${text.substring(0, 10000)} // truncate to avoid token limits
\`\`\`

Identify up to 20 key sub-functions called within this entry file. For each sub-function, provide:
1. name: The name of the sub-function.
2. file: The likely file path where this sub-function is defined (guess based on the available files and context).
3. description_en: A brief description of what this sub-function likely does (in English).
4. description_zh: A brief description of what this sub-function likely does (in Chinese).
5. drillDown: Whether it's worth further drill-down analysis (-1 for no, 0 for unsure, 1 for yes).`;

      addLog({ en: 'Analyzing sub-functions with AI...', zh: '正在使用 AI 分析子函数...' }, 'info', {
        request: {
          model: "gemini-3-flash-preview",
          baseUrl: resolveGeminiEndpoint().baseUrl,
          apiVersion: resolveGeminiEndpoint().apiVersion,
          url: `${resolveGeminiEndpoint().requestUrl}/models/gemini-3-flash-preview:generateContent`,
          prompt: prompt
        }
      });

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              subFunctions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    file: { type: Type.STRING },
                    description_en: { type: Type.STRING },
                    description_zh: { type: Type.STRING },
                    drillDown: { type: Type.INTEGER }
                  },
                  required: ["name", "file", "description_en", "description_zh", "drillDown"]
                }
              }
            },
            required: ["subFunctions"]
          }
        }
      });

      if (currentFetchId !== fetchIdRef.current) return;

      if (response.text) {
        const result = JSON.parse(response.text);
        setSubFunctions(result.subFunctions || []);
        addLog(
          { en: `Found ${result.subFunctions?.length || 0} sub-functions.`, zh: `找到 ${result.subFunctions?.length || 0} 个子函数。` },
          'success',
          { result }
        );
      }
    } catch (err: any) {
      if (currentFetchId !== fetchIdRef.current) return;
      addLog({ en: `Error analyzing sub-functions: ${err.message}`, zh: `分析子函数时出错: ${err.message}` }, 'error');
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsAnalyzingSubFunctions(false);
      }
    }
  };

  const analyzeSubFunctionsRecursive = async (
    entryFilePath: string,
    currentFetchId: number,
    repo: RepoRef,
    targetUrl: string,
    projectSummary: string,
    allFiles: string[]
  ) => {
    if (currentFetchId !== fetchIdRef.current) return;
    setIsAnalyzingSubFunctions(true);
    setSubFunctions([]);
    addLog(
      { en: 'Starting recursive sub-function analysis...', zh: '开始递归分析子函数...' },
      'info'
    );

    try {
      const ai = createGeminiClient();
      if (!ai) return;

      const maxDepth = getMaxDrillDownDepth();
      const endpoint = resolveGeminiEndpoint();
      const allResults: SubFunctionNode[] = [];
      const visited = new Set<string>();
      let idCounter = 0;

      const analyzeFunctionCode = async ({
        functionName,
        callerFile,
        functionCode,
        functionFile,
        depth,
        parentId,
      }: {
        functionName: string;
        callerFile: string;
        functionCode: string;
        functionFile: string;
        depth: number;
        parentId: string;
      }) => {
        if (currentFetchId !== fetchIdRef.current) return;
        if (depth > maxDepth) return;

        const fileList = allFiles.slice(0, 1500).join('\n');
        const prompt = `Analyze the function below and identify up to 12 key child function calls.
Project URL: ${targetUrl}
Project Summary: ${projectSummary}
Caller Function: ${functionName}
Caller File: ${functionFile}
Depth: ${depth}/${maxDepth}

Available Files:
${fileList}

Function Code:
\`\`\`
${functionCode.substring(0, 12000)}
\`\`\`

For each child function return:
1) name
2) file (likely definition file path)
3) description_en
4) description_zh
5) drillDown (-1=no, 0=unsure, 1=yes)`;

        addLog(
          { en: `AI drill-down analyzing ${functionName}...`, zh: `AI 正在下钻分析 ${functionName}...` },
          'info',
          {
            request: {
              model: 'gemini-3-flash-preview',
              baseUrl: endpoint.baseUrl,
              apiVersion: endpoint.apiVersion,
              url: `${endpoint.requestUrl}/models/gemini-3-flash-preview:generateContent`,
              depth,
              maxDepth,
              functionName,
              functionFile,
              prompt,
            },
          }
        );

        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                subFunctions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      file: { type: Type.STRING },
                      description_en: { type: Type.STRING },
                      description_zh: { type: Type.STRING },
                      drillDown: { type: Type.INTEGER },
                    },
                    required: ['name', 'file', 'description_en', 'description_zh', 'drillDown'],
                  },
                },
              },
              required: ['subFunctions'],
            },
          },
        });

        if (!response.text) return;
        const parsed = JSON.parse(response.text);
        const children = parsed?.subFunctions || [];

        for (const child of children) {
          if (currentFetchId !== fetchIdRef.current) return;
          const nodeId = `n-${idCounter++}`;
          const normalizedCall = normalizeCalledFunctionName(child.name || 'unknown');
          const node: SubFunctionNode = {
            id: nodeId,
            parentId,
            depth,
            name: normalizedCall.normalized || child.name || 'unknown',
            file: child.file || '',
            description_en: child.description_en || '',
            description_zh: child.description_zh || '',
            drillDown: Number.isInteger(child.drillDown) ? child.drillDown : 0,
          };
          allResults.push(node);
          setSubFunctions([...allResults]);

          if (!(node.drillDown === 0 || node.drillDown === 1)) continue;
          if (depth >= maxDepth) continue;
          if (isLikelySystemOrLibraryFunction(node.name)) continue;

          const visitKey = `${node.file}::${normalizeCalledFunctionName(node.name).normalized || node.name}`.toLowerCase();
          if (visited.has(visitKey)) continue;
          visited.add(visitKey);

          const located = await locateFunctionDefinition({
            functionName: node.name,
            parentFile: node.file || callerFile,
            allFiles,
            repo,
            ai,
            currentFetchId,
          });

          if (!located) {
            addLog(
              { en: `Stop drill-down: definition not found for ${node.name}`, zh: `停止下钻：未找到 ${node.name} 的定义` },
              'warning',
              { function: node.name, hintedFile: node.file, depth }
            );
            continue;
          }

          await analyzeFunctionCode({
            functionName: node.name,
            callerFile: located.file,
            functionCode: located.code,
            functionFile: located.file,
            depth: depth + 1,
            parentId: nodeId,
          });
        }
      };

      const entryContent = await fetchFileText(repo, entryFilePath);
      if (!entryContent) {
        addLog(
          { en: 'Failed to fetch entry file content for recursive analysis.', zh: '递归分析时获取入口文件内容失败。' },
          'error'
        );
        return;
      }

      await analyzeFunctionCode({
        functionName: 'ENTRY',
        callerFile: entryFilePath,
        functionCode: entryContent.text,
        functionFile: entryFilePath,
        depth: 0,
        parentId: 'root',
      });

      if (currentFetchId !== fetchIdRef.current) return;
      setSubFunctions(allResults);
      addLog(
        { en: `Recursive sub-function analysis complete. Collected ${allResults.length} nodes.`, zh: `递归子函数分析完成。共收集 ${allResults.length} 个节点。` },
        'success',
        { maxDepth, totalNodes: allResults.length }
      );
    } catch (err: any) {
      if (currentFetchId !== fetchIdRef.current) return;
      addLog(
        { en: `Error in recursive sub-function analysis: ${err.message}`, zh: `递归子函数分析出错: ${err.message}` },
        'error'
      );
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsAnalyzingSubFunctions(false);
      }
    }
  };

  const verifyEntryFiles = async (analysisResult: any, currentFetchId: number, repo: {owner: string, repo: string, branch: string}, targetUrl: string, allFiles: string[]) => {
    addLog({ en: 'Starting entry file verification...', zh: '开始验证入口文件...' }, 'info');
    setIsVerifyingEntry(true);

    try {
      const ai = createGeminiClient();
      if (!ai) return;

      for (const filePath of analysisResult.entryFiles) {
        if (currentFetchId !== fetchIdRef.current) return;

        addLog({ en: `Fetching content for ${filePath}...`, zh: `正在获取 ${filePath} 的内容...` }, 'info');
        try {
          const fileContent = await fetchFileText(repo, filePath);
          if (!fileContent) {
            addLog({ en: `Failed to fetch ${filePath}`, zh: `获取 ${filePath} 失败` }, 'warning');
            continue;
          }

          const text = fileContent.text;
          const lines = text.split('\n');
          let contentToSend = text;

          if (lines.length > 4000) {
            const first2000 = lines.slice(0, 2000).join('\n');
            const last2000 = lines.slice(-2000).join('\n');
            contentToSend = `${first2000}\n\n... [CONTENT TRUNCATED] ...\n\n${last2000}`;
            addLog({ en: `File ${filePath} is too large (${lines.length} lines), truncated to 4000 lines.`, zh: `文件 ${filePath} 过大 (${lines.length} 行)，已截断至 4000 行。` }, 'info');
          }

          const prompt = `Analyze the following file from a GitHub repository to determine if it is the main entry point of the project.

Project URL: ${targetUrl}
Primary Language: ${analysisResult.primaryLanguage_en}
Project Summary: ${analysisResult.summary_en}
File Path: ${filePath}

File Content:
\`\`\`
${contentToSend}
\`\`\`

Determine if this file is the main entry point. Provide your reasoning.`;

          addLog({ en: `Verifying ${filePath} with AI...`, zh: `正在使用 AI 验证 ${filePath}...` }, 'info');

          addLog({ en: `AI Request Payload for ${filePath}`, zh: `${filePath} 的 AI 请求数据` }, 'info', {
            request: {
              model: "gemini-3-flash-preview",
              baseUrl: resolveGeminiEndpoint().baseUrl,
              apiVersion: resolveGeminiEndpoint().apiVersion,
              url: `${resolveGeminiEndpoint().requestUrl}/models/gemini-3-flash-preview:generateContent`,
              promptLength: prompt.length,
              prompt: prompt
            }
          });

          const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  isEntryFile: { type: Type.BOOLEAN, description: "True if this is the main entry file, false otherwise" },
                  reason_en: { type: Type.STRING, description: "Reasoning in English" },
                  reason_zh: { type: Type.STRING, description: "Reasoning in Chinese" }
                },
                required: ["isEntryFile", "reason_en", "reason_zh"]
              }
            }
          });

          if (currentFetchId !== fetchIdRef.current) return;

          if (response.text) {
            const result = JSON.parse(response.text);
            addLog({
              en: `Verification result for ${filePath}: ${result.isEntryFile ? 'Confirmed' : 'Rejected'}`,
              zh: `${filePath} 验证结果: ${result.isEntryFile ? '已确认' : '已拒绝'}`
            }, result.isEntryFile ? 'success' : 'info', { result });

            if (result.isEntryFile) {
              setConfirmedEntryFile({
                path: filePath,
                reason_en: result.reason_en,
                reason_zh: result.reason_zh
              });
              addLog({ en: `Found main entry file: ${filePath}`, zh: `找到主入口文件: ${filePath}` }, 'success');

              // Trigger recursive sub-function analysis
              analyzeSubFunctionsRecursive(filePath, currentFetchId, repo, targetUrl, analysisResult.summary_en, allFiles);

              break; // Stop checking other files
            }
          }
        } catch (err: any) {
          if (err instanceof GithubRequestError) {
            addLog(
              { en: `Error verifying ${filePath}: ${err.message}`, zh: `验证 ${filePath} 时出错: ${err.message}` },
              'error',
              { githubError: err.details }
            );
          } else {
            addLog({ en: `Error verifying ${filePath}: ${err.message}`, zh: `验证 ${filePath} 时出错: ${err.message}` }, 'error');
          }
        }
      }
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsVerifyingEntry(false);
      }
    }
  };
  const analyzeWithAI = async (filePaths: string[], currentFetchId: number, repo: {owner: string, repo: string, branch: string}, targetUrl: string) => {
    if (currentFetchId !== fetchIdRef.current) return;
    setIsAnalyzing(true);
    setAiAnalysis(null);
    setConfirmedEntryFile(null);
    addLog({ en: 'Starting AI analysis...', zh: '开始 AI 分析...' }, 'info');
    try {
      const ai = createGeminiClient();
      if (!ai) {
        console.warn("Gemini API key not found");
        addLog({ en: 'Gemini API key not found.', zh: '未找到 Gemini API 密钥。' }, 'error');
        return;
      }
      
      // Limit to 2000 files to avoid excessive token usage
      const pathsToAnalyze = filePaths.slice(0, 2000).join('\n');
      const prompt = `Analyze the following list of file paths from a GitHub repository. Determine the primary programming language, the technology stack (frameworks, libraries, tools), the likely main entry files, and provide a brief project summary based on the file structure.\n\nFiles:\n${pathsToAnalyze}`;

      if (currentFetchId !== fetchIdRef.current) return;
      addLog({ en: 'AI Request Payload', zh: 'AI 请求数据' }, 'info', { 
        request: { 
          model: "gemini-3.1-pro-preview", 
          baseUrl: resolveGeminiEndpoint().baseUrl,
          apiVersion: resolveGeminiEndpoint().apiVersion,
          url: `${resolveGeminiEndpoint().requestUrl}/models/gemini-3.1-pro-preview:generateContent`,
          promptLength: prompt.length,
          filesCount: filePaths.slice(0, 2000).length,
          prompt: prompt
        } 
      });

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary_en: { type: Type.STRING, description: "A brief summary of what this project likely does based on its file structure and names, in English" },
              summary_zh: { type: Type.STRING, description: "A brief summary of what this project likely does based on its file structure and names, in Chinese" },
              primaryLanguage_en: { type: Type.STRING, description: "The primary programming language used in the project, in English" },
              primaryLanguage_zh: { type: Type.STRING, description: "The primary programming language used in the project, in Chinese" },
              techStack: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of technology stack tags" },
              entryFiles: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of possible main entry files" }
            },
            required: ["summary_en", "summary_zh", "primaryLanguage_en", "primaryLanguage_zh", "techStack", "entryFiles"]
          }
        }
      });

      if (currentFetchId !== fetchIdRef.current) return;

      if (response.text) {
        const result = JSON.parse(response.text);
        setAiAnalysis(result);
        addLog({ en: 'AI Response Payload', zh: 'AI 响应数据' }, 'success', { response: result });
        
        await verifyEntryFiles(result, currentFetchId, repo, targetUrl, filePaths);
      }
    } catch (err: any) {
      if (currentFetchId !== fetchIdRef.current) return;
      console.error("AI Analysis failed:", err);
      addLog({ en: `AI analysis failed: ${err.message}`, zh: `AI 分析失败: ${err.message}` }, 'error', { error: err });
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsAnalyzing(false);
      }
    }
  };

  const fetchRepoData = async (targetUrl: string) => {
    const currentFetchId = ++fetchIdRef.current;
    
    setLoading(true);
    setError('');
    setFileTree([]);
    setSelectedFile(null);
    setFileContent('');
    setRepoInfo(null);
    setLogs([]); // Clear logs on new fetch
    setAiAnalysis(null);
    setConfirmedEntryFile(null);

    addLog({ en: `Validating GitHub URL: ${targetUrl}`, zh: `校验 GitHub URL: ${targetUrl}` }, 'info');
    const parsed = parseGithubUrl(targetUrl);
    if (!parsed) {
      if (currentFetchId !== fetchIdRef.current) return;
      setError(lang === 'en' ? 'Invalid GitHub URL' : '无效的 GitHub URL');
      addLog({ en: 'Invalid GitHub URL format.', zh: '无效的 GitHub URL 格式。' }, 'error');
      setLoading(false);
      return;
    }

    try {
      let branch = parsed.branch;
      
      // If branch is not specified, fetch the default branch
      if (!branch) {
        addLog({ en: `Fetching default branch for ${parsed.owner}/${parsed.repo}...`, zh: `正在获取 ${parsed.owner}/${parsed.repo} 的默认分支...` }, 'info');
        const repoData = await fetchGithubApiJson<{ default_branch: string }>(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
          `Fetch repository metadata for ${parsed.owner}/${parsed.repo}`
        );
        branch = repoData.default_branch;
      }

      if (currentFetchId !== fetchIdRef.current) return;

      setRepoInfo({ owner: parsed.owner, repo: parsed.repo, branch: branch || 'main' });
      addLog({ en: `GitHub validation successful. Target: ${parsed.owner}/${parsed.repo} @ ${branch || 'main'}`, zh: `GitHub 校验成功。目标: ${parsed.owner}/${parsed.repo} @ ${branch || 'main'}` }, 'success');

      // Fetch file tree
      addLog({ en: `Fetching file tree from GitHub...`, zh: `正在从 GitHub 获取文件树...` }, 'info');
      const treeData = await fetchGithubApiJson<{ truncated?: boolean; tree: any[] }>(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${branch}?recursive=1`,
        `Fetch repository tree for ${parsed.owner}/${parsed.repo}@${branch}`
      );
      if (currentFetchId !== fetchIdRef.current) return;

      if (treeData.truncated) {
        console.warn('Tree is truncated, some files might be missing');
        addLog({ en: 'Tree is truncated, some files might be missing.', zh: '文件树被截断，可能缺少部分文件。' }, 'warning');
      }
      addLog({ en: `File tree fetched. Total files/directories: ${treeData.tree.length}`, zh: `文件树获取成功。总文件/目录数: ${treeData.tree.length}` }, 'success');

      const tree = buildFileTree(treeData.tree);
      setFileTree(tree);

      // Trigger AI Analysis
      const codeFiles = getCodeFiles(treeData.tree);
      setCodeFilesList(codeFiles);
      addLog({ en: `Filtered code files: ${codeFiles.length} files found.`, zh: `过滤后的代码文件: 找到 ${codeFiles.length} 个文件。` }, 'info', { files: codeFiles });
      if (codeFiles.length > 0) {
        analyzeWithAI(codeFiles, currentFetchId, { owner: parsed.owner, repo: parsed.repo, branch: branch || 'main' }, targetUrl);
      }
    } catch (err: any) {
      if (currentFetchId !== fetchIdRef.current) return;
      setError(err.message || 'An error occurred while fetching data');
      if (err instanceof GithubRequestError) {
        addLog(
          { en: `Error: ${err.message}`, zh: `错误: ${err.message}` },
          'error',
          { githubError: err.details }
        );
      } else {
        addLog({ en: `Error: ${err.message}`, zh: `错误: ${err.message}` }, 'error');
      }
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (initialUrl && initialUrl !== lastFetchedUrl.current) {
      lastFetchedUrl.current = initialUrl;
      fetchRepoData(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  const t = {
    en: {
      title: 'GitHub Code Analyzer',
      analyzeRepo: 'Analyze Repository',
      placeholder: 'https://github.com/owner/repo',
      analyzeBtn: 'Analyze',
      analyzing: 'Analyzing repository...',
      projectInfo: 'Project Info',
      owner: 'Owner',
      repo: 'Repository',
      branch: 'Branch',
      aiAnalysis: 'AI Analysis',
      analyzingCodebase: 'Analyzing codebase...',
      primaryLanguage: 'Primary Language',
      techStack: 'Tech Stack',
      entryFiles: 'Entry Files',
      projectSummary: 'Project Summary',
      analysisNotAvailable: 'Analysis not available',
      enterUrl: 'Enter a repository URL to begin.',
      systemLogs: 'System Logs',
      fileExplorer: 'File Explorer',
      selectFile: 'Select a file to view its contents',
      loadingFile: 'Loading file content...',
      errorLoading: 'Error loading file',
      confirmedEntry: 'Confirmed Entry File',
      verifyingEntry: 'Verifying entry files...',
      entryReason: 'Verification Reason'
    },
    zh: {
      title: 'GitHub 代码分析器',
      analyzeRepo: '分析仓库',
      placeholder: 'https://github.com/owner/repo',
      analyzeBtn: '分析',
      analyzing: '正在分析仓库...',
      projectInfo: '项目信息',
      owner: '所有者',
      repo: '仓库名',
      branch: '分支',
      aiAnalysis: 'AI 分析',
      analyzingCodebase: '正在分析代码库...',
      primaryLanguage: '主要语言',
      techStack: '技术栈',
      entryFiles: '入口文件',
      projectSummary: '项目总结',
      analysisNotAvailable: '暂无分析结果',
      enterUrl: '输入仓库 URL 开始。',
      systemLogs: '系统日志',
      fileExplorer: '文件浏览器',
      selectFile: '选择一个文件查看内容',
      loadingFile: '正在加载文件内容...',
      errorLoading: '加载文件出错',
      confirmedEntry: '已确认的主入口',
      verifyingEntry: '正在验证入口文件...',
      entryReason: '验证理由'
    }
  };

  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    if (url !== initialUrl) {
      router.push(`/analyze?url=${encodeURIComponent(url)}&lang=${lang}`);
    } else {
      lastFetchedUrl.current = url;
      fetchRepoData(url);
    }
  };

  const handleSelectFile = async (node: FileNode) => {
    if (node.type === 'tree') return;
    
    setSelectedFile(node);
    setContentLoading(true);
    setFileContent('');

    try {
      if (!repoInfo) throw new Error('Repository info missing');

      const contentResult = await fetchFileText(repoInfo, node.path);
      if (!contentResult) {
        throw new Error('Failed to fetch file content');
      }

      const content = contentResult.text;
      setFileContent(content);
    } catch (err: any) {
      if (err instanceof GithubRequestError) {
        addLog(
          { en: `Error loading file ${node.path}: ${err.message}`, zh: `加载文件 ${node.path} 失败: ${err.message}` },
          'error',
          { githubError: err.details }
        );
      }
      setFileContent(`${t[lang].errorLoading}: ${err.message}`);
    } finally {
      setContentLoading(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="h-14 border-b border-slate-200 flex items-center justify-between px-4 bg-white shrink-0">
        <div className="flex items-center">
          <button 
            onClick={() => router.push(`/?lang=${lang}`)}
            className="mr-3 p-1.5 hover:bg-slate-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex items-center space-x-2">
            <div className="bg-indigo-600 p-1 rounded-md">
              <Github className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-slate-900">{t[lang].title}</span>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              onClick={() => setShowFileTree(!showFileTree)}
              className={`p-1.5 rounded-md transition-colors ${showFileTree ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
              title={lang === 'en' ? 'Toggle File Tree' : '切换文件树'}
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowCodeViewer(!showCodeViewer)}
              className={`p-1.5 rounded-md transition-colors ${showCodeViewer ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
              title={lang === 'en' ? 'Toggle Code Viewer' : '切换代码面板'}
            >
              <Code2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowPanorama(!showPanorama)}
              className={`p-1.5 rounded-md transition-colors ${showPanorama ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
              title={lang === 'en' ? 'Toggle Panorama' : '切换全景图'}
            >
              <PanelRight className="w-4 h-4" />
            </button>
          </div>
          <button 
            onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
            className="flex items-center px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors shadow-sm"
          >
            <Languages className="w-4 h-4 mr-1.5 text-indigo-500" />
            {lang === 'en' ? '涓枃' : 'English'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        <Group orientation="horizontal">
          {/* Left Panel - Input & Info */}
          <Panel defaultSize={25} minSize={15}>
            <div className="h-full border-r border-slate-200 bg-slate-50 p-4 flex flex-col overflow-y-auto">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">{t[lang].analyzeRepo}</h2>
              
              <form onSubmit={handleAnalyze} className="mb-6">
                <div className="space-y-3">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Search className="h-4 w-4 text-slate-400" />
                    </div>
                    <input
                      type="text"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="block w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      placeholder={t[lang].placeholder}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t[lang].analyzeBtn}
                  </button>
                </div>
              </form>

              {/* System Logs Section */}
              {logs.length > 0 && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center">
                      <Terminal className="w-4 h-4 text-slate-500 mr-2" />
                      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t[lang].systemLogs}</h2>
                    </div>
                    <button 
                      onClick={() => setIsLogsFullscreen(true)}
                      className="p-1 hover:bg-slate-200 rounded text-slate-500 transition-colors"
                      title="Fullscreen"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="bg-slate-900 rounded-lg border border-slate-800 overflow-hidden flex flex-col max-h-64">
                    <div className="overflow-y-auto p-2 space-y-1 font-mono text-[10px] sm:text-xs">
                      {logs.map(log => (
                        <div key={log.id} className="flex flex-col">
                          <div 
                            className={`flex items-start p-1.5 rounded hover:bg-slate-800/50 transition-colors ${log.details ? 'cursor-pointer' : ''}`}
                            onClick={() => log.details && toggleLog(log.id)}
                          >
                            <span className="text-slate-500 mr-2 shrink-0">
                              {log.timestamp.toLocaleTimeString([], { hour12: false })}
                            </span>
                            <span className="mr-1.5 shrink-0 mt-0.5">
                              {log.type === 'info' && <Info className="w-3 h-3 text-blue-400" />}
                              {log.type === 'success' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                              {log.type === 'error' && <XCircle className="w-3 h-3 text-rose-400" />}
                              {log.type === 'warning' && <AlertCircle className="w-3 h-3 text-amber-400" />}
                            </span>
                            <span className={`flex-1 ${
                              log.type === 'error' ? 'text-rose-300' : 
                              log.type === 'success' ? 'text-emerald-300' : 
                              log.type === 'warning' ? 'text-amber-300' : 'text-slate-300'
                            }`}>
                              {log.message[lang]}
                            </span>
                            {log.details && (
                              <span className="shrink-0 ml-2 text-slate-500">
                                {log.expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              </span>
                            )}
                          </div>
                          {log.expanded && log.details && (
                            <div className="ml-6 mr-2 mb-2 mt-1 p-2 bg-slate-950 rounded border border-slate-800 overflow-x-auto">
                              {log.details.request?.prompt ? (
                                <div className="space-y-2">
                                  <div className="text-indigo-400 font-semibold text-xs">Request Meta:</div>
                                  <pre className="text-slate-400 text-[10px] whitespace-pre-wrap">
                                    {JSON.stringify(
                                      truncateLongStrings(
                                        Object.fromEntries(
                                          Object.entries(log.details.request).filter(([key]) => key !== 'prompt')
                                        )
                                      ),
                                      null,
                                      2
                                    )}
                                  </pre>
                                  <div className="text-indigo-400 font-semibold text-xs">Request Prompt:</div>
                                  <pre className="text-slate-400 text-[10px] whitespace-pre-wrap font-mono bg-slate-900 p-2 rounded border border-slate-800">
                                    {log.details.request.prompt}
                                  </pre>
                                  {Object.keys(log.details).filter(k => k !== 'request').length > 0 && (
                                    <pre className="text-slate-400 text-[10px] whitespace-pre-wrap">
                                      {JSON.stringify(truncateLongStrings({ ...log.details, request: undefined }), null, 2)}
                                    </pre>
                                  )}
                                </div>
                              ) : (
                                <pre className="text-slate-400 text-[10px] whitespace-pre-wrap">
                                  {JSON.stringify(truncateLongStrings(log.details), null, 2)}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">{t[lang].projectInfo}</h2>
              {loading ? (
                <div className="flex items-center text-sm text-slate-500">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing repository...
                </div>
              ) : error ? (
                <div className="flex items-start text-sm text-red-600 bg-red-50 p-3 rounded-md">
                  <AlertCircle className="w-4 h-4 mr-2 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              ) : fileTree.length > 0 && repoInfo ? (
                <div className="space-y-4">
                  <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                    <div className="text-sm font-medium text-slate-900 mb-1">Repository</div>
                    <div className="text-xs text-slate-500 break-all">{repoInfo.owner}/{repoInfo.repo}</div>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                    <div className="text-sm font-medium text-slate-900 mb-1">Branch</div>
                    <div className="text-xs text-slate-500">{repoInfo.branch}</div>
                  </div>

                  {/* AI Analysis Section */}
                  <div className="mt-6 pt-6 border-t border-slate-200">
                    <div className="flex items-center mb-4">
                      <Sparkles className="w-4 h-4 text-indigo-500 mr-2" />
                      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">AI Analysis</h2>
                    </div>

                    {isAnalyzing ? (
                      <div className="flex flex-col items-center justify-center py-6 space-y-3 bg-indigo-50/50 rounded-lg border border-indigo-100">
                        <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
                        <span className="text-xs text-indigo-600 font-medium">Analyzing codebase...</span>
                      </div>
                    ) : aiAnalysis ? (
                      <div className="space-y-4">
                        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                          <div className="text-xs font-medium text-slate-500 mb-1 uppercase tracking-wider">{t[lang].primaryLanguage}</div>
                          <div className="text-sm font-semibold text-slate-900">{lang === 'en' ? aiAnalysis.primaryLanguage_en : aiAnalysis.primaryLanguage_zh}</div>
                        </div>

                        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                          <div className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">{t[lang].techStack}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {aiAnalysis.techStack.map((tech, idx) => (
                              <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                                {tech}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                          <div className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">{t[lang].entryFiles}</div>
                          <ul className="space-y-1.5">
                            {aiAnalysis.entryFiles.map((file, idx) => (
                              <li key={idx} className="flex items-start text-xs text-slate-700">
                                <FileCode className="w-3.5 h-3.5 mr-1.5 text-slate-400 shrink-0 mt-0.5" />
                                <span className="break-all">{file}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {confirmedEntryFile ? (
                          <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200 shadow-sm">
                            <div className="text-xs font-medium text-emerald-600 mb-2 uppercase tracking-wider flex items-center">
                              <CheckCircle2 className="w-4 h-4 mr-1.5" />
                              {t[lang].confirmedEntry}
                            </div>
                            <div className="flex items-start text-sm text-slate-900 font-medium mb-2">
                              <FileCode className="w-4 h-4 mr-1.5 text-emerald-500 shrink-0 mt-0.5" />
                              <span className="break-all">{confirmedEntryFile.path}</span>
                            </div>
                            <div className="text-xs font-medium text-emerald-600/80 mb-1 uppercase tracking-wider">{t[lang].entryReason}</div>
                            <div className="text-sm text-slate-700 leading-relaxed">{lang === 'en' ? confirmedEntryFile.reason_en : confirmedEntryFile.reason_zh}</div>
                          </div>
                        ) : isVerifyingEntry ? (
                          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 border-dashed shadow-sm flex items-center justify-center text-slate-500 text-sm">
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            {t[lang].verifyingEntry}
                          </div>
                        ) : null}

                        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                          <div className="text-xs font-medium text-slate-500 mb-1 uppercase tracking-wider">{t[lang].projectSummary}</div>
                          <div className="text-sm text-slate-700 leading-relaxed">{lang === 'en' ? aiAnalysis.summary_en : aiAnalysis.summary_zh}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 border border-dashed border-slate-300 rounded-lg text-center bg-slate-50/50">
                        <span className="text-xs text-slate-400">Analysis not available</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-500">Enter a repository URL to begin.</div>
              )}
            </div>
          </Panel>

          {showFileTree && (
            <>
              <Separator className="w-1 bg-slate-200 hover:bg-indigo-400 transition-colors cursor-col-resize" />
              {/* Middle Panel - File Tree */}
              <Panel defaultSize={15} minSize={10}>
                <div className="h-full border-r border-slate-200 bg-white flex flex-col">
                  <div className="p-3 border-b border-slate-100 bg-slate-50/50">
                    <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Explorer</h2>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2">
                    {fileTree.length > 0 ? (
                      <FileTree 
                        nodes={fileTree} 
                        onSelectFile={handleSelectFile} 
                        selectedPath={selectedFile?.path} 
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-sm text-slate-400 italic">
                        No files to display
                      </div>
                    )}
                  </div>
                </div>
              </Panel>
            </>
          )}

          {showCodeViewer && (
            <>
              <Separator className="w-1 bg-slate-200 hover:bg-indigo-400 transition-colors cursor-col-resize" />
              {/* Code Viewer */}
              <Panel defaultSize={30} minSize={15}>
                <div className="h-full bg-slate-50 p-4 overflow-hidden flex flex-col border-r border-slate-200">
                  {selectedFile ? (
                    contentLoading ? (
                      <div className="flex-1 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                      </div>
                    ) : (
                      <CodeViewer 
                        code={fileContent} 
                        language={getLanguageFromFilename(selectedFile.name)} 
                        filename={selectedFile.path} 
                      />
                    )
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 space-y-4">
                      <FileCode className="w-16 h-16 text-slate-300" />
                      <p>{t[lang].selectFile}</p>
                    </div>
                  )}
                </div>
              </Panel>
            </>
          )}

          {showPanorama && (
            <>
              <Separator className="w-1 bg-slate-200 hover:bg-indigo-400 transition-colors cursor-col-resize" />
              {/* Panorama */}
              <Panel defaultSize={30} minSize={15}>
                <div className="h-full bg-slate-50 flex flex-col">
                  <div className="p-3 border-b border-slate-200 bg-white flex items-center justify-between">
                    <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {lang === 'en' ? 'Function Panorama' : '函数全景图'}
                    </h2>
                    {isAnalyzingSubFunctions && (
                      <div className="flex items-center text-xs text-indigo-500">
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        {lang === 'en' ? 'Analyzing...' : '分析中...'}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    {(confirmedEntryFile || subFunctions.length > 0) ? (
                      <Panorama 
                        entryFile={confirmedEntryFile?.path || null} 
                        subFunctions={subFunctions} 
                        lang={lang} 
                      />
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4 p-8 text-center">
                        <Sparkles className="w-12 h-12 text-slate-300" />
                        <p className="text-sm">
                          {lang === 'en' 
                            ? 'Panorama will appear here after the entry file is confirmed.' 
                            : '确认入口文件后，这里将显示函数全景图。'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </Panel>
            </>
          )}
        </Group>
      </div>

      {/* Fullscreen Logs Modal */}
      {isLogsFullscreen && (
        <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950">
            <div className="flex items-center">
              <Terminal className="w-5 h-5 text-slate-400 mr-3" />
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">{t[lang].systemLogs}</h2>
            </div>
            <button 
              onClick={() => setIsLogsFullscreen(false)}
              className="p-2 hover:bg-slate-800 rounded text-slate-400 transition-colors"
            >
              <Minimize2 className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 font-mono text-sm">
            {logs.map(log => (
              <div key={log.id} className="flex flex-col mb-2">
                <div 
                  className={`flex items-start p-2 rounded hover:bg-slate-800/50 transition-colors ${log.details ? 'cursor-pointer' : ''}`}
                  onClick={() => log.details && toggleLog(log.id)}
                >
                  <span className="text-slate-500 mr-3 shrink-0">
                    {log.timestamp.toLocaleTimeString([], { hour12: false })}
                  </span>
                  <span className="mr-2 shrink-0 mt-0.5">
                    {log.type === 'info' && <Info className="w-4 h-4 text-blue-400" />}
                    {log.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    {log.type === 'error' && <XCircle className="w-4 h-4 text-rose-400" />}
                    {log.type === 'warning' && <AlertCircle className="w-4 h-4 text-amber-400" />}
                  </span>
                  <span className={`flex-1 ${
                    log.type === 'error' ? 'text-rose-300' : 
                    log.type === 'success' ? 'text-emerald-300' : 
                    log.type === 'warning' ? 'text-amber-300' : 'text-slate-300'
                  }`}>
                    {log.message[lang]}
                  </span>
                  {log.details && (
                    <span className="shrink-0 ml-3 text-slate-500">
                      {log.expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </span>
                  )}
                </div>
                {log.expanded && log.details && (
                  <div className="ml-8 mr-4 mb-4 mt-2 p-4 bg-slate-950 rounded-lg border border-slate-800 overflow-x-auto">
                    {log.details.request?.prompt ? (
                      <div className="space-y-3">
                        <div className="text-indigo-400 font-semibold text-sm">Request Meta:</div>
                        <pre className="text-slate-400 text-xs leading-relaxed whitespace-pre-wrap">
                          {JSON.stringify(
                            truncateLongStrings(
                              Object.fromEntries(
                                Object.entries(log.details.request).filter(([key]) => key !== 'prompt')
                              )
                            ),
                            null,
                            2
                          )}
                        </pre>
                        <div className="text-indigo-400 font-semibold text-sm">Request Prompt:</div>
                        <pre className="text-slate-400 text-xs leading-relaxed font-mono bg-slate-900 p-3 rounded border border-slate-800 whitespace-pre-wrap">
                          {log.details.request.prompt}
                        </pre>
                        {Object.keys(log.details).filter(k => k !== 'request').length > 0 && (
                          <pre className="text-slate-400 text-xs leading-relaxed whitespace-pre-wrap">
                            {JSON.stringify(truncateLongStrings({ ...log.details, request: undefined }), null, 2)}
                          </pre>
                        )}
                      </div>
                    ) : (
                      <pre className="text-slate-400 text-xs leading-relaxed whitespace-pre-wrap">
                        {JSON.stringify(truncateLongStrings(log.details), null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnalyzePage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>}>
      <AnalyzeContent />
    </Suspense>
  );
}

