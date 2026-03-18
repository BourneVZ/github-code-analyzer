'use client';

import { useState, useEffect, Suspense, useRef, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Github, Search, Loader2, AlertCircle, ArrowLeft, FileCode, Sparkles, ChevronDown, ChevronRight, Terminal, CheckCircle2, Info, XCircle, Languages, Maximize2, Minimize2, PanelLeft, PanelRight, Code2, Layers } from 'lucide-react';
import { FileTree } from '@/components/FileTree';
import type { FileNode, GithubNode } from '@/lib/github';
import { CodeViewer } from '@/components/CodeViewer';
import { Panorama } from '@/components/Panorama';
import { parseGithubUrl, buildFileTree, getLanguageFromFilename, getCodeFiles } from '@/lib/github';
import { buildEngineeringMarkdown, buildHistoryId, getAnalysisHistoryById, saveAnalysisHistoryRecord, type AiAnalysisSnapshot, type AnalysisHistoryRecord, type ConfirmedEntrySnapshot, type RepoInfoSnapshot, type StoredFunctionModule, type StoredLogEntry, type StoredSubFunctionNode } from '@/lib/analysisHistory';
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
  lineStart?: number;
  lineEnd?: number;
  description_en: string;
  description_zh: string;
  drillDown: number;
  routePath?: string;
  bridgeSource?: string;
  moduleId?: string;
  moduleName_en?: string;
  moduleName_zh?: string;
  moduleColor?: string;
};

type FunctionModule = {
  id: string;
  name_en: string;
  name_zh: string;
  description_en: string;
  description_zh: string;
  color: string;
  functionIds: string[];
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

type AiUsageStats = {
  inputTokens: number;
  outputTokens: number;
  totalCalls: number;
};

type BridgeSeed = {
  name: string;
  file: string;
  code: string;
  lineStart: number;
  lineEnd: number;
  description_en: string;
  description_zh: string;
  drillDown: number;
  routePath?: string;
  bridgeSource: string;
};

type BridgeSeedPlan = {
  strategyId: string;
  strategyLabel_en: string;
  strategyLabel_zh: string;
  seeds: BridgeSeed[];
};

type BridgeDetectionContext = {
  entryFilePath: string;
  entryContent: string;
  analysisContext: {
    summary_en: string;
    primaryLanguage_en: string;
    techStack: string[];
  };
  allFiles: string[];
  repo: RepoRef;
};

type CallChainBridgeStrategy = {
  id: string;
  label_en: string;
  label_zh: string;
  canApply: (ctx: BridgeDetectionContext) => boolean;
  collectSeeds: (ctx: BridgeDetectionContext, currentFetchId: number) => Promise<BridgeSeed[]>;
};

function AnalyzeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialUrl = searchParams.get('url') || '';
  const historyId = searchParams.get('historyId') || '';
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
  const [allFilePaths, setAllFilePaths] = useState<string[]>([]);
  const [fileTreeNodes, setFileTreeNodes] = useState<GithubNode[]>([]);
  const [codeFilesList, setCodeFilesList] = useState<string[]>([]);
  const [subFunctions, setSubFunctions] = useState<SubFunctionNode[]>([]);
  const [functionModules, setFunctionModules] = useState<FunctionModule[]>([]);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [isAnalyzingSubFunctions, setIsAnalyzingSubFunctions] = useState(false);
  const [isAnalyzingModules, setIsAnalyzingModules] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<{ state: 'idle' | 'working' | 'completed' | 'error'; label_en: string; label_zh: string }>({
    state: 'idle',
    label_en: 'Idle',
    label_zh: '空闲',
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showFileTree, setShowFileTree] = useState(true);
  const [showCodeViewer, setShowCodeViewer] = useState(true);
  const [showPanorama, setShowPanorama] = useState(true);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [isMarkdownFullscreen, setIsMarkdownFullscreen] = useState(false);
  const [aiUsageStats, setAiUsageStats] = useState<AiUsageStats>({ inputTokens: 0, outputTokens: 0, totalCalls: 0 });
  const [manualDrilldownNodeId, setManualDrilldownNodeId] = useState<string | null>(null);
  const lastFetchedUrl = useRef('');
  const lastSavedHistoryHash = useRef('');
  const fetchIdRef = useRef(0);
  const drillDownCacheRef = useRef<Map<string, any[]>>(new Map());
  const functionLocationCacheRef = useRef<Map<string, LocatedFunction | null>>(new Map());
  const defaultGeminiApiVersion = "v1beta";
  const moduleColorPalette = ['#38bdf8', '#34d399', '#f59e0b', '#f97316', '#a78bfa', '#fb7185', '#2dd4bf', '#84cc16', '#eab308', '#60a5fa'];

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
      id: Math.random().toString(36).slice(2, 10),
      timestamp: new Date(),
      type,
      message,
      details,
      expanded: false
    }]);
  };

  const addAiCallLog = (message: LocalizedString, request: any, type: LogEntry['type'] = 'info') => {
    const id = Math.random().toString(36).slice(2, 10);
    setLogs((prev) => [
      ...prev,
      {
        id,
        timestamp: new Date(),
        type,
        message,
        details: {
          aiCall: {
            request,
            status: 'pending',
          },
        },
        expanded: false,
      },
    ]);
    return id;
  };

  const finalizeAiCallLog = (id: string, payload: { response?: any; usage?: any; error?: any; success?: boolean }) => {
    setLogs((prev) =>
      prev.map((log) => {
        if (log.id !== id) return log;
        const existing = log.details?.aiCall || {};
        const hasError = Boolean(payload.error);
        return {
          ...log,
          type: hasError ? 'error' : payload.success === false ? 'warning' : 'success',
          details: {
            ...log.details,
            aiCall: {
              ...existing,
              response: payload.response,
              usage: payload.usage,
              error: payload.error,
              status: hasError ? 'failed' : payload.success === false ? 'incomplete' : 'completed',
            },
          },
        };
      })
    );
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

  const serializeLogs = (items: LogEntry[]): StoredLogEntry[] => {
    return items.map((item) => ({
      id: item.id,
      timestamp: item.timestamp.toISOString(),
      type: item.type,
      message: item.message,
      details: item.details,
    }));
  };

  const hydrateLogs = (items: StoredLogEntry[]): LogEntry[] => {
    return items.map((item) => ({
      id: item.id,
      timestamp: new Date(item.timestamp),
      type: item.type,
      message: item.message,
      details: item.details,
      expanded: false,
    }));
  };

  const setWorkflow = (
    state: 'idle' | 'working' | 'completed' | 'error',
    label_en: string,
    label_zh: string
  ) => {
    setWorkflowStatus({ state, label_en, label_zh });
  };

  const extractAiUsage = (response: any) => {
    const usage = response?.usageMetadata || response?.usage || {};
    const inputTokens =
      Number(usage.promptTokenCount ?? usage.inputTokenCount ?? usage.inputTokens ?? usage.prompt_tokens ?? 0) || 0;
    const outputTokens =
      Number(usage.candidatesTokenCount ?? usage.outputTokenCount ?? usage.outputTokens ?? usage.completion_tokens ?? 0) || 0;
    return { inputTokens, outputTokens };
  };

  const recordAiUsage = (response: any) => {
    const usage = extractAiUsage(response);
    setAiUsageStats((prev) => ({
      inputTokens: prev.inputTokens + usage.inputTokens,
      outputTokens: prev.outputTokens + usage.outputTokens,
      totalCalls: prev.totalCalls + 1,
    }));
    return usage;
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const isTransientAiNetworkError = (err: unknown) => {
    const message = toErrorMessage(err).toLowerCase();
    if (message.includes('failed to fetch')) return true;
    if (message.includes('networkerror')) return true;
    if (message.includes('fetch failed')) return true;
    if (message.includes('timeout')) return true;
    return false;
  };

  const getGeminiRetryPolicy = () => {
    const maxRetriesRaw =
      process.env.NEXT_PUBLIC_GEMINI_RETRY_MAX_RETRIES ||
      process.env.GEMINI_RETRY_MAX_RETRIES ||
      '2';
    const baseDelayRaw =
      process.env.NEXT_PUBLIC_GEMINI_RETRY_BASE_DELAY_MS ||
      process.env.GEMINI_RETRY_BASE_DELAY_MS ||
      '600';

    const maxRetries = Math.min(Math.max(Number.parseInt(maxRetriesRaw, 10) || 2, 0), 6);
    const baseDelayMs = Math.min(Math.max(Number.parseInt(baseDelayRaw, 10) || 600, 150), 10_000);
    return { maxRetries, baseDelayMs };
  };

  const generateContentWithRetry = async ({
    ai,
    model,
    contents,
    config,
    operation,
    context,
  }: {
    ai: GoogleGenAI;
    model: string;
    contents: string;
    config?: any;
    operation: string;
    context?: Record<string, any>;
  }) => {
    const { maxRetries, baseDelayMs } = getGeminiRetryPolicy();
    let attempt = 0;
    let lastErr: unknown = null;

    while (attempt <= maxRetries) {
      try {
        return await ai.models.generateContent({
          model,
          contents,
          ...(config ? { config } : {}),
        });
      } catch (err) {
        lastErr = err;
        const transient = isTransientAiNetworkError(err);
        if (!transient || attempt >= maxRetries) {
          if (transient) {
            const base = toErrorMessage(err);
            throw new Error(
              `Gemini network request failed after ${attempt + 1} attempt(s): ${base}. ` +
              `Check GEMINI_BASE_URL/proxy/network, or increase GEMINI_RETRY_MAX_RETRIES.`
            );
          }
          throw err;
        }

        const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
        addLog(
          {
            en: `AI network jitter detected (${operation}), retry ${attempt + 1}/${maxRetries} in ${delay}ms...`,
            zh: `检测到 AI 网络抖动（${operation}），将在 ${delay}ms 后重试 ${attempt + 1}/${maxRetries}...`,
          },
          'warning',
          buildErrorDiagnostics(err, {
            stage: 'ai-retry',
            operation,
            attempt: attempt + 1,
            maxRetries,
            delay,
            ...(context || {}),
          })
        );
        await sleep(delay);
        attempt += 1;
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error('Unknown AI request error');
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

  const buildErrorDiagnostics = (err: unknown, context?: Record<string, any>) => {
    const base = {
      message: toErrorMessage(err),
      name: err instanceof Error ? err.name : typeof err,
      stack: err instanceof Error ? err.stack : undefined,
      context: context || {},
      timestamp: new Date().toISOString(),
    } as Record<string, any>;

    if (err instanceof GithubRequestError) {
      base.github = err.details;
      base.errorType = 'github_request_error';
    } else {
      base.errorType = 'generic_error';
    }

    return base;
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
    const leafName = name.trim().split('::').pop() || name.trim();
    const n = leafName.toLowerCase();
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
      'foreach',
      'then',
      'catch',
      'finally',
      'setstate',
      'useeffect',
      'usestate',
      'haserrors',
    ]);
    if (deny.has(n)) return true;
    if (/^(get|set|is)[A-Z_]/.test(leafName)) return false;
    return n.length <= 2;
  };

  const isGithubNotFoundError = (err: unknown) => {
    if (!(err instanceof GithubRequestError)) return false;
    return Number(err.details?.status) === 404;
  };

  const stripFunctionCallDecorators = (input: string) => {
    return input
      .replace(/\s+/g, ' ')
      .replace(/^[*&\s]+/, '')
      .replace(/^(?:await|new)\s+/i, '')
      .replace(/\(.*$/, '')
      .replace(/[;,\s]+$/, '')
      .trim();
  };

  const getFunctionLeafName = (input: string) => {
    const withoutScope = input.split('::').pop() || input;
    const withoutDot = withoutScope.split('.').pop() || withoutScope;
    const withoutArrow = withoutDot.split('->').pop() || withoutDot;
    return withoutArrow.replace(/<[^<>]*>/g, '').trim();
  };

  const buildFunctionCacheKey = (file: string, functionName: string) => {
    const normalized = normalizeCalledFunctionName(functionName).normalized || functionName.trim();
    return `${(file || '').toLowerCase()}::${normalized.toLowerCase()}`;
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

    let value = stripFunctionCallDecorators(original);

    if (!value) {
      return {
        original,
        normalized: '',
        candidates: [],
      };
    }

    const cleaned = value
      .replace(/<[^<>]*>/g, '')
      .replace(/\[.*\]$/, '')
      .replace(/^['"`]|['"`]$/g, '')
      .trim();
    const leaf = getFunctionLeafName(cleaned);

    const candidates = Array.from(
      new Set(
        [cleaned, leaf, value.trim(), original]
          .filter(Boolean)
      )
    );

    return {
      original,
      normalized: cleaned || value,
      candidates,
    };
  };

  const buildFunctionDefinitionRegexes = (fnName: string) => {
    const normalized = stripFunctionCallDecorators(fnName);
    const leafName = getFunctionLeafName(normalized);
    const escapedLeaf = leafName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedRaw = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasScope = normalized.includes('::');
    return [
      new RegExp(`\\bfunction\\s+${escapedLeaf}\\s*\\(`, 'm'),
      new RegExp(`\\b(?:const|let|var)\\s+${escapedLeaf}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>`, 'm'),
      new RegExp(`\\b${escapedLeaf}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>`, 'm'),
      new RegExp(`\\b(?:public|private|protected|static|async|export\\s+)*${escapedLeaf}\\s*\\([^)]*\\)\\s*\\{`, 'm'),
      new RegExp(`\\bdef\\s+${escapedLeaf}\\s*\\(`, 'm'),
      new RegExp(`\\b(?:func|fn)\\s+${escapedLeaf}\\s*\\(`, 'm'),
      new RegExp(`\\b${escapedLeaf}\\s*:\\s*function\\s*\\(`, 'm'),
      new RegExp(`\\b${escapedLeaf}\\s*\\([^)]*\\)\\s*\\{`, 'm'),
      // C/C++ free function definition with return type/qualifiers.
      new RegExp(`(?:^|[;{}]\\s*)(?:inline\\s+|constexpr\\s+|static\\s+|virtual\\s+|extern\\s+|friend\\s+|typename\\s+|template\\s*<[^>]+>\\s*)*[\\w:\\<\\>\\*&~\\s]+\\b${hasScope ? escapedRaw : escapedLeaf}\\s*\\([^;{}]*\\)\\s*(?:const\\s*)?(?:noexcept\\s*)?(?:->\\s*[\\w:\\<\\>\\*&\\s]+\\s*)?\\{`, 'm'),
      // C++ class/namespace scoped definition: ClassName::method(...)
      new RegExp(`(?:^|[;{}]\\s*)(?:inline\\s+|constexpr\\s+|static\\s+|virtual\\s+|extern\\s+|friend\\s+|typename\\s+|template\\s*<[^>]+>\\s*)*[\\w:\\<\\>\\*&~\\s]+\\b${hasScope ? escapedRaw : `[\\w:<>~]+::${escapedLeaf}`}\\s*\\([^;{}]*\\)\\s*(?:const\\s*)?(?:noexcept\\s*)?(?:->\\s*[\\w:\\<\\>\\*&\\s]+\\s*)?\\{`, 'm'),
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
      try {
        const parentFileContent = await fetchFileText(repo, parentFile);
        if (parentFileContent) {
          const inParent = findFunctionInFile(parentFileContent.text, functionName);
          if (inParent) {
            return { ...inParent, file: parentFile };
          }
        }
      } catch (err) {
        if (!isGithubNotFoundError(err)) {
          // Continue to next stages on transient fetch/network failures.
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
      const guessResp = await generateContentWithRetry({
        ai,
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
        operation: 'locate-guess-files',
        context: { functionName, parentFile },
      });
      recordAiUsage(guessResp);

      if (guessResp.text) {
        const guessed = JSON.parse(guessResp.text)?.candidateFiles || [];
        for (const file of guessed) {
          if (currentFetchId !== fetchIdRef.current) return null;
          try {
            const content = await fetchFileText(repo, file);
            if (!content) continue;
            const found = findFunctionInFile(content.text, functionName);
            if (found) return { ...found, file };
          } catch (err) {
            if (!isGithubNotFoundError(err)) {
              continue;
            }
          }
        }
      }
    } catch {
      // Continue to stage 3 on any AI-guess failure.
    }

    // Stage 3: regex search across project files
    for (const file of allFiles) {
      if (currentFetchId !== fetchIdRef.current) return null;
      try {
        const content = await fetchFileText(repo, file);
        if (!content) continue;
        const found = findFunctionInFile(content.text, functionName);
        if (found) return { ...found, file };
      } catch {
        continue;
      }
    }

    return null;
  };

  const normalizeUrlPath = (value: string) => {
    const raw = (value || '').trim();
    if (!raw) return '';
    const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
    return withSlash.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  };

  const joinUrlPath = (base: string, child: string) => {
    const left = normalizeUrlPath(base);
    const right = normalizeUrlPath(child);
    if (!left && !right) return '/';
    if (!left) return right;
    if (!right || right === '/') return left;
    return `${left === '/' ? '' : left}${right}`;
  };

  const extractQuotedStrings = (input: string) => {
    const results: string[] = [];
    const re = /"([^"]+)"/g;
    let match: RegExpExecArray | null = null;
    while ((match = re.exec(input)) !== null) {
      const value = (match[1] || '').trim();
      if (value) results.push(value);
    }
    return Array.from(new Set(results));
  };

  const parseSpringMappingPaths = (annotationArgs: string) => {
    const args = (annotationArgs || '').trim();
    if (!args) return ['/'];

    const keyedPathMatch = args.match(/\b(?:path|value)\s*=\s*(\{[\s\S]*?\}|"[^"]*")/);
    const primaryScope = keyedPathMatch ? keyedPathMatch[1] : args;
    const paths = extractQuotedStrings(primaryScope);
    if (paths.length > 0) {
      return paths.map((item) => normalizeUrlPath(item) || '/');
    }
    return ['/'];
  };

  const parseSpringRequestMethod = (annotationType: string, annotationArgs: string) => {
    const normalizedType = (annotationType || '').trim();
    if (/^GetMapping$/i.test(normalizedType)) return 'GET';
    if (/^PostMapping$/i.test(normalizedType)) return 'POST';
    if (/^PutMapping$/i.test(normalizedType)) return 'PUT';
    if (/^DeleteMapping$/i.test(normalizedType)) return 'DELETE';
    if (/^PatchMapping$/i.test(normalizedType)) return 'PATCH';

    const methodMatch = annotationArgs.match(/\bmethod\s*=\s*(?:\{)?\s*RequestMethod\.(\w+)/i);
    if (methodMatch?.[1]) return methodMatch[1].toUpperCase();
    return '';
  };

  const parseSpringControllerSeeds = (filePath: string, fileText: string): BridgeSeed[] => {
    if (!/@(?:RestController|Controller)\b/.test(fileText)) return [];

    const classMatch = /(?:public\s+)?(?:abstract\s+)?class\s+\w+/m.exec(fileText);
    const classHeader = classMatch ? fileText.slice(0, classMatch.index) : fileText.slice(0, 1500);
    const classRequestMappings = Array.from(classHeader.matchAll(/@RequestMapping\s*\(([\s\S]*?)\)/g));
    const classPaths = classRequestMappings.length
      ? parseSpringMappingPaths(classRequestMappings[classRequestMappings.length - 1][1] || '')
      : ['/'];

    const methodRe =
      /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(?:\(([\s\S]*?)\))?[\s\r\n]*(?:@\w+(?:\([^)]*\))?[\s\r\n]*)*(?:public|protected|private)\s+(?:static\s+)?[\w<>\[\],?.\s]+\s+([A-Za-z_]\w*)\s*\(/g;

    const seeds: BridgeSeed[] = [];
    let match: RegExpExecArray | null = null;

    while ((match = methodRe.exec(fileText)) !== null) {
      const annotationType = match[1] || '';
      const annotationArgs = match[2] || '';
      const functionName = match[3] || '';
      if (!functionName) continue;

      const snippet = extractFunctionSnippet(fileText, match.index);
      const methodPaths = parseSpringMappingPaths(annotationArgs);
      const method = parseSpringRequestMethod(annotationType, annotationArgs);

      const routeList = new Set<string>();
      for (const basePath of classPaths) {
        for (const methodPath of methodPaths) {
          const routePath = joinUrlPath(basePath, methodPath);
          const display = method ? `${method} ${routePath}` : routePath;
          routeList.add(display);
        }
      }

      seeds.push({
        name: functionName,
        file: filePath,
        code: snippet.code,
        lineStart: snippet.lineStart,
        lineEnd: snippet.lineEnd,
        description_en: 'Spring Boot controller endpoint handler.',
        description_zh: 'Spring Boot Controller 接口处理函数。',
        drillDown: 1,
        routePath: Array.from(routeList).join(' | '),
        bridgeSource: 'java-springboot-controller',
      });
    }

    return seeds;
  };

  const toDisplayRoutePath = (value: string) => {
    const raw = (value || '').trim();
    if (!raw) return '/';
    if (raw.startsWith('^')) return raw;
    return raw.startsWith('/') ? raw : `/${raw}`;
  };

  const extractPythonBlockSnippet = (fileText: string, matchIndex: number) => {
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

    const maxEnd = Math.min(lines.length - 1, startLine + 220);
    const startText = lines[startLine] || '';
    const baseIndent = (startText.match(/^\s*/) || [''])[0].length;
    let endLine = maxEnd;

    for (let i = startLine + 1; i <= maxEnd; i++) {
      const line = lines[i] || '';
      const trimmed = line.trim();
      if (!trimmed) continue;
      const indent = (line.match(/^\s*/) || [''])[0].length;
      if (indent <= baseIndent && !trimmed.startsWith('@')) {
        endLine = i - 1;
        break;
      }
    }

    if (endLine < startLine) endLine = startLine;
    return {
      code: lines.slice(startLine, endLine + 1).join('\n'),
      lineStart: startLine + 1,
      lineEnd: endLine + 1,
    };
  };

  const parsePythonRouteDecorators = (filePath: string, fileText: string): BridgeSeed[] => {
    const seeds: BridgeSeed[] = [];
    const blockRe = /((?:^\s*@.*\n)+)\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*:/gm;
    let match: RegExpExecArray | null = null;

    while ((match = blockRe.exec(fileText)) !== null) {
      const decoratorsRaw = match[1] || '';
      const functionName = match[2] || '';
      if (!decoratorsRaw || !functionName) continue;

      const decoratorLines = decoratorsRaw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('@'));
      const routeDisplays: string[] = [];

      for (const dec of decoratorLines) {
        const flaskRouteMatch = dec.match(/@\w[\w.]*\.route\(\s*(['"])(.*?)\1([\s\S]*?)\)/);
        if (flaskRouteMatch) {
          const routePath = toDisplayRoutePath(flaskRouteMatch[2] || '/');
          const argRest = flaskRouteMatch[3] || '';
          const methodsMatch = argRest.match(/methods\s*=\s*\[([^\]]+)\]/i);
          const methods = methodsMatch
            ? Array.from((methodsMatch[1] || '').matchAll(/['"]([A-Za-z]+)['"]/g)).map((m) => (m[1] || '').toUpperCase())
            : ['GET'];
          const normalizedMethods = methods.length ? methods : ['GET'];
          for (const method of normalizedMethods) {
            routeDisplays.push(`${method} ${routePath}`);
          }
          continue;
        }

        const fastApiMatch = dec.match(/@\w[\w.]*\.(get|post|put|delete|patch|options|head|trace)\(\s*(['"])(.*?)\2/i);
        if (fastApiMatch) {
          const method = (fastApiMatch[1] || '').toUpperCase();
          const routePath = toDisplayRoutePath(fastApiMatch[3] || '/');
          routeDisplays.push(`${method} ${routePath}`);
        }
      }

      if (!routeDisplays.length) continue;
      const snippet = extractPythonBlockSnippet(fileText, match.index);
      seeds.push({
        name: functionName,
        file: filePath,
        code: snippet.code,
        lineStart: snippet.lineStart,
        lineEnd: snippet.lineEnd,
        description_en: 'Python web route handler (Flask/FastAPI).',
        description_zh: 'Python Web 路由处理函数（Flask/FastAPI）。',
        drillDown: 1,
        routePath: Array.from(new Set(routeDisplays)).join(' | '),
        bridgeSource: 'python-web-route',
      });
    }

    return seeds;
  };

  const parseDjangoUrlMappings = (urlsText: string) => {
    const mappings: Array<{ route: string; targetExpr: string; symbolName: string }> = [];
    const mappingRe = /\b(?:path|re_path)\(\s*(['"])(.*?)\1\s*,\s*([^,\n]+(?:\([^)]*\))?)/g;
    let match: RegExpExecArray | null = null;

    while ((match = mappingRe.exec(urlsText)) !== null) {
      const route = match[2] || '';
      const targetExpr = (match[3] || '').trim();
      if (!targetExpr) continue;

      let symbolName = '';
      const classViewMatch = targetExpr.match(/([A-Za-z_]\w*)\.as_view\s*\(/);
      if (classViewMatch?.[1]) {
        symbolName = classViewMatch[1];
      } else {
        const cleaned = targetExpr.replace(/\([^)]*\)/g, '').trim();
        const leafMatch = cleaned.match(/([A-Za-z_]\w*)$/);
        symbolName = leafMatch?.[1] || '';
      }

      if (!symbolName) continue;
      mappings.push({ route, targetExpr, symbolName });
    }

    return mappings;
  };

  const findPythonCallableInFile = (fileText: string, symbolName: string): LocatedFunction | null => {
    const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`^\\s*def\\s+${escaped}\\s*\\(`, 'm'),
      new RegExp(`^\\s*class\\s+${escaped}\\b`, 'm'),
    ];

    for (const re of patterns) {
      const match = re.exec(fileText);
      if (match?.index !== undefined) {
        const snippet = extractPythonBlockSnippet(fileText, match.index);
        return {
          file: '',
          code: snippet.code,
          lineStart: snippet.lineStart,
          lineEnd: snippet.lineEnd,
        };
      }
    }
    return null;
  };

  const collectDjangoBridgeSeeds = async (
    inputCtx: BridgeDetectionContext,
    fetchId: number
  ): Promise<BridgeSeed[]> => {
    const urlFiles = inputCtx.allFiles.filter((file) => file.toLowerCase().endsWith('urls.py')).slice(0, 80);
    if (!urlFiles.length) return [];

    const contentCache = new Map<string, string>();
    const getFileContent = async (path: string) => {
      if (contentCache.has(path)) return contentCache.get(path) || '';
      const content = await fetchFileText(inputCtx.repo, path);
      if (!content) return '';
      contentCache.set(path, content.text);
      return content.text;
    };

    const viewFiles = inputCtx.allFiles.filter((file) => {
      const lower = file.toLowerCase();
      return lower.endsWith('.py') && (lower.endsWith('/views.py') || lower.includes('/views/'));
    });

    const seeds: BridgeSeed[] = [];
    for (const urlsFile of urlFiles) {
      if (fetchId !== fetchIdRef.current) return [];
      let urlsText = '';
      try {
        urlsText = await getFileContent(urlsFile);
      } catch {
        continue;
      }
      if (!urlsText) continue;

      const mappings = parseDjangoUrlMappings(urlsText);
      if (!mappings.length) continue;

      const dir = urlsFile.includes('/') ? urlsFile.slice(0, urlsFile.lastIndexOf('/')) : '';
      const sameDirView = dir ? `${dir}/views.py` : 'views.py';

      for (const mapping of mappings) {
        if (fetchId !== fetchIdRef.current) return [];
        const candidateFiles = Array.from(
          new Set(
            [sameDirView, ...viewFiles.filter((f) => (dir ? f.startsWith(dir) : true))]
          )
        ).slice(0, 50);

        for (const candidate of candidateFiles) {
          try {
            const viewText = await getFileContent(candidate);
            if (!viewText) continue;
            const found = findPythonCallableInFile(viewText, mapping.symbolName);
            if (!found) continue;

            seeds.push({
              name: mapping.symbolName,
              file: candidate,
              code: found.code,
              lineStart: found.lineStart,
              lineEnd: found.lineEnd,
              description_en: 'Django route handler resolved from urls.py.',
              description_zh: '根据 urls.py 解析得到的 Django 路由处理函数。',
              drillDown: 1,
              routePath: toDisplayRoutePath(mapping.route || '/'),
              bridgeSource: 'python-django-urlconf',
            });
            break;
          } catch {
            continue;
          }
        }
      }
    }

    return seeds;
  };

  const detectAndBuildBridgeSeeds = async (
    ctx: BridgeDetectionContext,
    currentFetchId: number
  ): Promise<BridgeSeedPlan | null> => {
    if (currentFetchId !== fetchIdRef.current) return null;

    const springBootBridge: CallChainBridgeStrategy = {
      id: 'java-springboot-controller',
      label_en: 'Spring Boot controller bridge',
      label_zh: 'Spring Boot Controller 桥接',
      canApply: (inputCtx) => {
        const language = (inputCtx.analysisContext.primaryLanguage_en || '').toLowerCase();
        const tech = inputCtx.analysisContext.techStack.map((item) => (item || '').toLowerCase());
        const isJava = language.includes('java');
        const mentionsSpring = tech.some((item) => item.includes('spring'));
        const looksLikeSpringBootEntry = /SpringApplication\.run\s*\(/.test(inputCtx.entryContent);
        return isJava && (mentionsSpring || looksLikeSpringBootEntry);
      },
      collectSeeds: async (inputCtx, fetchId) => {
        const controllerCandidates = inputCtx.allFiles.filter((file) => {
          const lower = file.toLowerCase();
          if (!lower.endsWith('.java')) return false;
          return lower.includes('/controller/') || lower.includes('/controllers/') || lower.endsWith('controller.java');
        });

        if (!controllerCandidates.length) return [];

        addLog(
          {
            en: `Bridge detection: checking ${controllerCandidates.length} Spring controller candidates...`,
            zh: `桥接检测：正在检查 ${controllerCandidates.length} 个 Spring Controller 候选文件...`,
          },
          'info',
          {
            strategy: 'java-springboot-controller',
            candidates: controllerCandidates.slice(0, 50),
          }
        );

        const seeds: BridgeSeed[] = [];
        const limit = Math.min(controllerCandidates.length, 120);
        for (const filePath of controllerCandidates.slice(0, limit)) {
          if (fetchId !== fetchIdRef.current) return [];
          try {
            const content = await fetchFileText(inputCtx.repo, filePath);
            if (!content) continue;
            const parsed = parseSpringControllerSeeds(filePath, content.text);
            seeds.push(...parsed);
          } catch (err) {
            logGithubError('Bridge controller parse', err, filePath);
          }
        }

        return seeds;
      },
    };

    const pythonWebBridge: CallChainBridgeStrategy = {
      id: 'python-web-route-bridge',
      label_en: 'Python web route bridge',
      label_zh: 'Python Web 路由桥接',
      canApply: (inputCtx) => {
        const language = (inputCtx.analysisContext.primaryLanguage_en || '').toLowerCase();
        const tech = inputCtx.analysisContext.techStack.map((item) => (item || '').toLowerCase());
        const isPython = language.includes('python');
        const hasKnownFramework = tech.some((item) =>
          item.includes('flask') || item.includes('fastapi') || item.includes('django')
        );
        const entryLooksPythonWeb =
          /\bFastAPI\s*\(/.test(inputCtx.entryContent) ||
          /\bFlask\s*\(/.test(inputCtx.entryContent) ||
          /\burlpatterns\s*=/.test(inputCtx.entryContent);
        return isPython && (hasKnownFramework || entryLooksPythonWeb);
      },
      collectSeeds: async (inputCtx, fetchId) => {
        const pyCandidates = inputCtx.allFiles.filter((file) => {
          const lower = file.toLowerCase();
          if (!lower.endsWith('.py')) return false;
          return /(app|main|route|router|api|view|endpoint|controller)/i.test(lower);
        });

        addLog(
          {
            en: `Bridge detection: checking Python route candidates (${pyCandidates.length})...`,
            zh: `桥接检测：正在检查 Python 路由候选文件（${pyCandidates.length}）...`,
          },
          'info',
          {
            strategy: 'python-web-route-bridge',
            candidates: pyCandidates.slice(0, 60),
          }
        );

        const seeds: BridgeSeed[] = [];
        const limit = Math.min(pyCandidates.length, 180);
        for (const filePath of pyCandidates.slice(0, limit)) {
          if (fetchId !== fetchIdRef.current) return [];
          try {
            const content = await fetchFileText(inputCtx.repo, filePath);
            if (!content) continue;
            seeds.push(...parsePythonRouteDecorators(filePath, content.text));
          } catch (err) {
            logGithubError('Bridge python route parse', err, filePath);
          }
        }

        try {
          const djangoSeeds = await collectDjangoBridgeSeeds(inputCtx, fetchId);
          seeds.push(...djangoSeeds);
        } catch (err) {
          addLog(
            {
              en: `Django URL bridge parsing failed: ${toErrorMessage(err)}`,
              zh: `Django URL 桥接解析失败：${toErrorMessage(err)}`,
            },
            'warning',
            buildErrorDiagnostics(err, { stage: 'bridge-python-django' })
          );
        }

        return seeds;
      },
    };

    const bridgeStrategies: CallChainBridgeStrategy[] = [springBootBridge, pythonWebBridge];
    for (const strategy of bridgeStrategies) {
      if (!strategy.canApply(ctx)) continue;
      const seeds = await strategy.collectSeeds(ctx, currentFetchId);
      if (currentFetchId !== fetchIdRef.current) return null;

      const deduped = Array.from(
        new Map(
          seeds.map((item) => [
            `${item.file}::${item.name}::${item.lineStart}`,
            item,
          ])
        ).values()
      );

      if (!deduped.length) continue;

      return {
        strategyId: strategy.id,
        strategyLabel_en: strategy.label_en,
        strategyLabel_zh: strategy.label_zh,
        seeds: deduped.slice(0, 80),
      };
    }

    return null;
  };

  const buildBridgeActivationMessage = (plan: BridgeSeedPlan) => {
    if (plan.strategyId === 'python-web-route-bridge') {
      return {
        en: `Detected Python web framework project. Bridged from entry to route handlers via decorators/urlconf. Identified ${plan.seeds.length} route nodes; this run starts from them.`,
        zh: `检测到 Python Web 框架项目，已通过路由装饰器/URL 配置将主入口桥接到业务响应函数。共识别 ${plan.seeds.length} 个路由节点，本次分析将以这些节点为起点。`,
      };
    }
    if (plan.strategyId === 'java-springboot-controller') {
      return {
        en: `Detected Spring Boot project. Bridged from entry to controller handlers. Identified ${plan.seeds.length} route nodes; this run starts from them.`,
        zh: `检测到 Spring Boot 项目，已通过 Controller 路由将主入口桥接到业务响应函数。共识别 ${plan.seeds.length} 个路由节点，本次分析将以这些节点为起点。`,
      };
    }
    return {
      en: `Bridge activated: ${plan.strategyLabel_en}. Seeded ${plan.seeds.length} handlers from entry.`,
      zh: `桥接模式已启用：${plan.strategyLabel_zh}。已从主入口桥接 ${plan.seeds.length} 个处理函数。`,
    };
  };

  const analyzeSubFunctions = async (entryFilePath: string, currentFetchId: number, repo: {owner: string, repo: string, branch: string}, targetUrl: string, projectSummary: string, allFiles: string[]) => {
    if (currentFetchId !== fetchIdRef.current) return;
    setIsAnalyzingSubFunctions(true);
    setSubFunctions([]);
    addLog({ en: 'Starting sub-function analysis...', zh: '开始分析子函数...' }, 'info');
    let aiCallLogId: string | null = null;

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
      
      const prompt = `Analyze the following entry file from a GitHub repository to identify key sub-functions related to the CORE feature flow.
      
Project URL: ${targetUrl}
Project Summary: ${projectSummary}
Entry File Path: ${entryFilePath}

Available Files in Project:
${fileList}

Entry File Content:
\`\`\`
${text.substring(0, 10000)} // truncate to avoid token limits
\`\`\`

Rules:
1) Return ONLY child calls important to core business flow, orchestration, external interactions, or key error handling.
2) EXCLUDE routine utilities and low-value operations: common data structure operations, simple string helpers, trivial getters/setters, and generic framework lifecycle hooks.
3) For object-oriented languages, if a function belongs to class/namespace, the name must include class scope (example: ClassName::FunctionName).

Identify up to 20 key sub-functions called within this entry file. For each sub-function, provide:
1. name: The name of the sub-function.
2. file: The likely file path where this sub-function is defined (guess based on the available files and context).
3. description_en: A brief description of what this sub-function likely does (in English).
4. description_zh: A brief description of what this sub-function likely does (in Chinese).
5. drillDown: Whether it's worth further drill-down analysis (-1 for no, 0 for unsure, 1 for yes).`;

      const aiRequest = {
        model: "gemini-3-flash-preview",
        baseUrl: resolveGeminiEndpoint().baseUrl,
        apiVersion: resolveGeminiEndpoint().apiVersion,
        url: `${resolveGeminiEndpoint().requestUrl}/models/gemini-3-flash-preview:generateContent`,
        prompt,
      };
      aiCallLogId = addAiCallLog(
        { en: 'Analyzing sub-functions with AI...', zh: '正在使用 AI 分析子函数...' },
        aiRequest
      );

      const response = await generateContentWithRetry({
        ai,
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
        },
        operation: 'legacy-entry-subfunctions',
        context: { entryFilePath, currentFetchId },
      });
      const usage = recordAiUsage(response);

      if (currentFetchId !== fetchIdRef.current) return;

      if (response.text) {
        const result = JSON.parse(response.text);
        finalizeAiCallLog(aiCallLogId, { response: result, usage, success: true });
        const nodes: SubFunctionNode[] = (result.subFunctions || []).map((item: any, index: number) => ({
          id: `legacy-${index}`,
          parentId: 'root',
          depth: 0,
          name: item?.name || 'unknown',
          file: item?.file || '',
          description_en: item?.description_en || '',
          description_zh: item?.description_zh || '',
          drillDown: Number.isInteger(item?.drillDown) ? item.drillDown : 0,
          routePath: typeof item?.routePath === 'string' ? item.routePath : undefined,
        }));
        setSubFunctions(nodes);
        addLog(
          { en: `Found ${result.subFunctions?.length || 0} sub-functions.`, zh: `找到 ${result.subFunctions?.length || 0} 个子函数。` },
          'success',
          { result, usage }
        );
      } else {
        finalizeAiCallLog(aiCallLogId, { response: null, usage, success: false });
      }
    } catch (err: any) {
      if (currentFetchId !== fetchIdRef.current) return;
      if (typeof aiCallLogId === 'string') {
        finalizeAiCallLog(aiCallLogId, { error: err?.message || String(err), success: false });
      }
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
    analysisContext: {
      summary_en: string;
      primaryLanguage_en: string;
      techStack: string[];
    },
    allFiles: string[]
  ) => {
    if (currentFetchId !== fetchIdRef.current) return;
    setIsAnalyzingSubFunctions(true);
    setWorkflow('working', 'AI is analyzing call chain...', 'AI 正在分析调用链...');
    setSubFunctions([]);
    let recursiveStage = 'init';
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
      let idCounter = 0;
      const activeStack = new Set<string>();
      const drillDownCache = drillDownCacheRef.current;
      const locationCache = functionLocationCacheRef.current;

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

        const functionKey = buildFunctionCacheKey(functionFile, functionName);
        if (activeStack.has(functionKey)) {
          addLog(
            { en: `Skip cycle call: ${functionName}`, zh: `跳过循环调用: ${functionName}` },
            'warning',
            { functionName, functionFile, depth }
          );
          return;
        }
        activeStack.add(functionKey);

        try {
          let children: any[] = [];
          const cachedChildren = drillDownCache.get(functionKey);
          if (cachedChildren) {
            addLog(
              { en: `Drill-down cache hit: ${functionName}`, zh: `下钻缓存命中: ${functionName}` },
              'info',
              { cacheKey: functionKey, cachedChildren: cachedChildren.length, depth }
            );
            children = cachedChildren.map((item) => ({ ...item }));
          } else {
            addLog(
              { en: `Drill-down cache miss: ${functionName}`, zh: `下钻缓存未命中: ${functionName}` },
              'info',
              { cacheKey: functionKey, depth }
            );

            const fileList = allFiles.slice(0, 1500).join('\n');
            const prompt = `Analyze the function below and identify up to 12 key child function calls that are part of the CORE business/control flow.
Project URL: ${targetUrl}
Project Summary: ${analysisContext.summary_en}
Caller Function: ${functionName}
Caller File: ${functionFile}
Depth: ${depth}/${maxDepth}

Available Files:
${fileList}

Function Code:
\`\`\`
${functionCode.substring(0, 12000)}
\`\`\`

Strict rules:
1) Return ONLY child calls that are essential to core feature flow, business logic transitions, orchestration, external system interactions, or critical error handling.
2) EXCLUDE generic utilities and low-value operations: plain data structure ops (map/filter/reduce/forEach/push/pop/sort), string formatting/parsing helpers, trivial getters/setters, logging wrappers, and basic framework lifecycle hooks.
3) For object-oriented languages, if a call belongs to a class/namespace, name MUST use full qualified form (example: ClassName::FunctionName). Do not return only FunctionName in this case.
4) Keep max 12 results and prioritize impact on end-to-end behavior.

For each child function return:
1) name
2) file (likely definition file path)
3) description_en
4) description_zh
5) drillDown (-1=no, 0=unsure, 1=yes)`;

            const aiCallLogId = addAiCallLog(
              { en: `AI drill-down analyzing ${functionName}...`, zh: `AI 正在下钻分析 ${functionName}...` },
              {
                model: 'gemini-3-flash-preview',
                baseUrl: endpoint.baseUrl,
                apiVersion: endpoint.apiVersion,
                url: `${endpoint.requestUrl}/models/gemini-3-flash-preview:generateContent`,
                depth,
                maxDepth,
                functionName,
                functionFile,
                prompt,
              }
            );

            try {
              const response = await generateContentWithRetry({
                ai,
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
                operation: 'recursive-drilldown',
                context: {
                  functionName,
                  functionFile,
                  depth,
                  parentId,
                },
              });
              const usage = recordAiUsage(response);

              if (!response.text) {
                finalizeAiCallLog(aiCallLogId, { response: null, usage, success: false });
                return;
              }
              const parsed = JSON.parse(response.text);
              children = Array.isArray(parsed?.subFunctions) ? parsed.subFunctions : [];
              drillDownCache.set(functionKey, children.map((item: any) => ({ ...item })));
              finalizeAiCallLog(aiCallLogId, {
                response: { ...parsed, cacheStored: true, cacheKey: functionKey },
                usage,
                success: true,
              });
            } catch (err: any) {
              finalizeAiCallLog(aiCallLogId, { error: err?.message || String(err), success: false });
              addLog(
                {
                  en: `Skip drill-down for ${functionName}: AI request failed (${err?.message || String(err)}).`,
                  zh: `跳过 ${functionName} 的下钻：AI 请求失败（${err?.message || String(err)}）。`,
                },
                'warning',
                buildErrorDiagnostics(err, {
                  stage: 'drilldown-ai',
                  functionName,
                  functionFile,
                  depth,
                  parentId,
                })
              );
              children = [];
            }
          }

          for (const child of children) {
            if (currentFetchId !== fetchIdRef.current) return;
            const nodeId = `n-${idCounter++}`;
            const normalizedCall = normalizeCalledFunctionName(child?.name || 'unknown');
            const node: SubFunctionNode = {
              id: nodeId,
              parentId,
              depth,
              name: (child?.name || normalizedCall.normalized || 'unknown').trim(),
              file: child?.file || '',
              lineStart: Number.isInteger(child?.lineStart) ? child.lineStart : undefined,
              lineEnd: Number.isInteger(child?.lineEnd) ? child.lineEnd : undefined,
              description_en: child?.description_en || '',
              description_zh: child?.description_zh || '',
              drillDown: Number.isInteger(child?.drillDown) ? child.drillDown : 0,
              routePath: typeof child?.routePath === 'string' ? child.routePath : undefined,
            };
            allResults.push(node);
            setSubFunctions([...allResults]);

            if (!(node.drillDown === 0 || node.drillDown === 1)) {
              addLog(
                {
                  en: `Function ${node.name} marked as non-core / no drill-down, stop.`,
                  zh: `函数 ${node.name} 标记为非核心/无需下钻，停止。`,
                },
                'info',
                { function: node.name, file: node.file, drillDown: node.drillDown, depth }
              );
              continue;
            }
            if (depth >= maxDepth) {
              addLog(
                {
                  en: `Function ${node.name} reached max drill-down depth (${maxDepth}), stop.`,
                  zh: `函数 ${node.name} 已达到最大下钻深度（${maxDepth}），停止。`,
                },
                'info',
                { function: node.name, file: node.file, depth, maxDepth }
              );
              continue;
            }
            if (isLikelySystemOrLibraryFunction(node.name)) {
              addLog(
                {
                  en: `Function ${node.name} marked as system/non-core, stop drill-down.`,
                  zh: `函数 ${node.name} 标记为系统函数/非核心，停止下钻。`,
                },
                'info',
                { function: node.name, file: node.file, depth, reason: 'system-or-library' }
              );
              continue;
            }

            const locationKey = buildFunctionCacheKey(node.file || callerFile, node.name);
            let located: LocatedFunction | null = null;
            if (locationCache.has(locationKey)) {
              located = locationCache.get(locationKey) || null;
              addLog(
                { en: `Location cache hit: ${node.name}`, zh: `定位缓存命中: ${node.name}` },
                'info',
                { cacheKey: locationKey, found: Boolean(located) }
              );
            } else {
              addLog(
                { en: `Location cache miss: ${node.name}`, zh: `定位缓存未命中: ${node.name}` },
                'info',
                { cacheKey: locationKey }
              );
              try {
                located = await locateFunctionDefinition({
                  functionName: node.name,
                  parentFile: callerFile,
                  allFiles,
                  repo,
                  ai,
                  currentFetchId,
                });
                locationCache.set(locationKey, located);
              } catch (err: any) {
                locationCache.set(locationKey, null);
                addLog(
                  {
                    en: `Skip drill-down for ${node.name}: locate definition failed (${err?.message || String(err)}).`,
                    zh: `跳过 ${node.name} 的下钻：定位定义失败（${err?.message || String(err)}）。`,
                  },
                  'warning',
                  buildErrorDiagnostics(err, {
                    stage: 'locate-definition',
                    functionName: node.name,
                    hintedFile: node.file,
                    callerFile,
                    depth,
                    cacheKey: locationKey,
                  })
                );
                continue;
              }
            }

            if (!located) {
              addLog(
                { en: `Stop drill-down: definition not found for ${node.name}`, zh: `停止下钻：未找到 ${node.name} 的定义` },
                'warning',
                { function: node.name, hintedFile: node.file, depth }
              );
              continue;
            }

            node.file = located.file || node.file;
            node.lineStart = located.lineStart;
            node.lineEnd = located.lineEnd;
            setSubFunctions([...allResults]);

            try {
              await analyzeFunctionCode({
                functionName: node.name,
                callerFile: located.file,
                functionCode: located.code,
                functionFile: located.file,
                depth: depth + 1,
                parentId: nodeId,
              });
            } catch (err: any) {
              addLog(
                {
                  en: `Skip nested drill-down for ${node.name}: ${err?.message || String(err)}`,
                  zh: `跳过 ${node.name} 的嵌套下钻：${err?.message || String(err)}`,
                },
                'warning',
                buildErrorDiagnostics(err, {
                  stage: 'nested-drilldown',
                  functionName: node.name,
                  file: located.file,
                  depth: depth + 1,
                })
              );
            }
          }
        } catch (err: any) {
          addLog(
            {
              en: `Skip function ${functionName}: unexpected drill-down error (${err?.message || String(err)}).`,
              zh: `跳过函数 ${functionName}：下钻出现未预期错误（${err?.message || String(err)}）。`,
            },
            'warning',
            buildErrorDiagnostics(err, {
              stage: 'drilldown-function',
              functionName,
              callerFile,
              functionFile,
              depth,
              parentId,
            })
          );
        } finally {
          activeStack.delete(functionKey);
        }
      };

      recursiveStage = 'entry-fetch';
      const entryContent = await fetchFileText(repo, entryFilePath);
      if (!entryContent) {
        addLog(
          { en: 'Failed to fetch entry file content for recursive analysis.', zh: '递归分析时获取入口文件内容失败。' },
          'error'
        );
        return;
      }
      recursiveStage = 'bridge-detection';
      let bridgePlan: BridgeSeedPlan | null = null;
      try {
        bridgePlan = await detectAndBuildBridgeSeeds(
          {
            entryFilePath,
            entryContent: entryContent.text,
            analysisContext,
            allFiles,
            repo,
          },
          currentFetchId
        );
      } catch (err: any) {
        addLog(
          {
            en: `Bridge detection failed, fallback to default entry tracing: ${err?.message || String(err)}`,
            zh: `桥接检测失败，回退到默认入口追踪：${err?.message || String(err)}`,
          },
          'warning',
          buildErrorDiagnostics(err, {
            stage: 'bridge-detection',
            entryFilePath,
          })
        );
      }

      if (bridgePlan?.seeds?.length) {
        recursiveStage = 'bridge-seed-drilldown';
        const bridgeMsg = buildBridgeActivationMessage(bridgePlan);
        addLog(bridgeMsg, 'success', {
          strategy: bridgePlan.strategyId,
          strategyLabel_en: bridgePlan.strategyLabel_en,
          strategyLabel_zh: bridgePlan.strategyLabel_zh,
          seedCount: bridgePlan.seeds.length,
          sampleSeeds: bridgePlan.seeds.slice(0, 12).map((seed) => ({
            name: seed.name,
            file: seed.file,
            routePath: seed.routePath,
            bridgeSource: seed.bridgeSource,
          })),
        });

        for (const seed of bridgePlan.seeds) {
          if (currentFetchId !== fetchIdRef.current) return;
          const nodeId = `n-${idCounter++}`;
          allResults.push({
            id: nodeId,
            parentId: 'root',
            depth: 0,
            name: seed.name,
            file: seed.file,
            lineStart: seed.lineStart,
            lineEnd: seed.lineEnd,
            description_en: seed.description_en,
            description_zh: seed.description_zh,
            drillDown: seed.drillDown,
            routePath: seed.routePath,
            bridgeSource: seed.bridgeSource,
          });
          setSubFunctions([...allResults]);

          try {
            await analyzeFunctionCode({
              functionName: seed.name,
              callerFile: seed.file,
              functionCode: seed.code,
              functionFile: seed.file,
              depth: 1,
              parentId: nodeId,
            });
          } catch (err: any) {
            addLog(
              {
                en: `Skip seed ${seed.name}: ${err?.message || String(err)}`,
                zh: `跳过桥接种子 ${seed.name}：${err?.message || String(err)}`,
              },
              'warning',
              buildErrorDiagnostics(err, {
                stage: 'bridge-seed-drilldown',
                seedName: seed.name,
                seedFile: seed.file,
              })
            );
          }
        }
      } else {
        recursiveStage = 'entry-drilldown';
        try {
          await analyzeFunctionCode({
            functionName: 'ENTRY',
            callerFile: entryFilePath,
            functionCode: entryContent.text,
            functionFile: entryFilePath,
            depth: 0,
            parentId: 'root',
          });
        } catch (err: any) {
          addLog(
            {
              en: `Entry drill-down failed but workflow will continue: ${err?.message || String(err)}`,
              zh: `入口下钻失败，但流程将继续：${err?.message || String(err)}`,
            },
            'warning',
            buildErrorDiagnostics(err, {
              stage: 'entry-drilldown',
              entryFilePath,
            })
          );
        }
      }

      if (currentFetchId !== fetchIdRef.current) return;
      setSubFunctions(allResults);
      addLog(
        { en: `Recursive sub-function analysis complete. Collected ${allResults.length} nodes.`, zh: `递归子函数分析完成。共收集 ${allResults.length} 个节点。` },
        'success',
        { maxDepth, totalNodes: allResults.length }
      );

      recursiveStage = 'module-grouping';
      try {
        await analyzeFunctionModules(allResults, currentFetchId, targetUrl, analysisContext);
      } catch (err: any) {
        addLog(
          {
            en: `Module grouping failed but call-chain results were kept: ${err?.message || String(err)}`,
            zh: `模块划分失败，但调用链结果已保留：${err?.message || String(err)}`,
          },
          'warning',
          buildErrorDiagnostics(err, {
            stage: 'module-grouping',
            nodeCount: allResults.length,
          })
        );
      }
    } catch (err: any) {
      if (currentFetchId !== fetchIdRef.current) return;
      const msg = err?.message || String(err);
      addLog(
        {
          en: `Error in recursive sub-function analysis [stage=${recursiveStage}]: ${msg}`,
          zh: `递归子函数分析出错 [阶段=${recursiveStage}]：${msg}`,
        },
        'error',
        buildErrorDiagnostics(err, { stage: 'recursive-top', recursiveStage })
      );
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsAnalyzingSubFunctions(false);
      }
    }
  };

  const analyzeFunctionModules = async (
    nodes: SubFunctionNode[],
    currentFetchId: number,
    targetUrl: string,
    analysisContext: {
      summary_en: string;
      primaryLanguage_en: string;
      techStack: string[];
    }
  ) => {
    if (currentFetchId !== fetchIdRef.current) return;
    if (!nodes.length) return;
    let aiCallLogId: string | null = null;

    setIsAnalyzingModules(true);
    setWorkflow('working', 'AI is grouping function modules...', 'AI 正在划分功能模块...');
    addLog({ en: 'Starting function module grouping...', zh: '开始进行函数模块划分...' }, 'info');

    try {
      const ai = createGeminiClient();
      if (!ai) {
        setWorkflow('error', 'Workflow ended with errors', '工作流异常结束');
        return;
      }

      const endpoint = resolveGeminiEndpoint();
      const compactNodes = nodes.slice(0, 1200).map((node) => ({
        id: node.id,
        name: node.name,
        file: node.file,
        description_en: node.description_en,
        description_zh: node.description_zh,
      }));

      const prompt = `Group the following function nodes into high-level functional modules for a GitHub project.
Project URL: ${targetUrl}
Project Summary(EN): ${analysisContext.summary_en}
Primary Language(EN): ${analysisContext.primaryLanguage_en}
Tech Stack: ${analysisContext.techStack.join(', ')}

Rules:
1) Create at most 10 modules.
2) Every function node id must be assigned to one module.
3) Return module names/descriptions in English and Chinese.
4) functionIds must only use node ids from the input list.

Function Nodes JSON:
${JSON.stringify(compactNodes)}`;

      aiCallLogId = addAiCallLog(
        { en: 'Function module grouping AI call', zh: '函数模块划分 AI 调用' },
        {
          model: 'gemini-3.1-pro-preview',
          baseUrl: endpoint.baseUrl,
          apiVersion: endpoint.apiVersion,
          url: `${endpoint.requestUrl}/models/gemini-3.1-pro-preview:generateContent`,
          nodeCount: compactNodes.length,
          prompt,
        }
      );

      const response = await generateContentWithRetry({
        ai,
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              modules: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    name_en: { type: Type.STRING },
                    name_zh: { type: Type.STRING },
                    description_en: { type: Type.STRING },
                    description_zh: { type: Type.STRING },
                    functionIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ['id', 'name_en', 'name_zh', 'description_en', 'description_zh', 'functionIds'],
                },
              },
            },
            required: ['modules'],
          },
        },
        operation: 'module-grouping',
        context: { nodeCount: compactNodes.length, targetUrl },
      });
      const usage = recordAiUsage(response);

      if (currentFetchId !== fetchIdRef.current) return;
      if (!response.text) {
        finalizeAiCallLog(aiCallLogId, { response: null, usage, success: false });
        setWorkflow('completed', 'Workflow completed', '工作流已完成');
        return;
      }

      const parsed = JSON.parse(response.text);
      finalizeAiCallLog(aiCallLogId, { response: parsed, usage, success: true });
      const rawModules = Array.isArray(parsed?.modules) ? parsed.modules.slice(0, 10) : [];

      const modules: FunctionModule[] = rawModules.map((item: any, index: number) => ({
        id: item.id || `module-${index + 1}`,
        name_en: item.name_en || `Module ${index + 1}`,
        name_zh: item.name_zh || `模块 ${index + 1}`,
        description_en: item.description_en || '',
        description_zh: item.description_zh || '',
        color: moduleColorPalette[index % moduleColorPalette.length],
        functionIds: Array.isArray(item.functionIds) ? item.functionIds : [],
      }));

      const moduleByFunctionId = new Map<string, FunctionModule>();
      for (const funcModule of modules) {
        for (const fnId of funcModule.functionIds) {
          moduleByFunctionId.set(fnId, funcModule);
        }
      }

      const enrichedNodes = nodes.map((node) => {
        const matched = moduleByFunctionId.get(node.id);
        if (!matched) return node;
        return {
          ...node,
          moduleId: matched.id,
          moduleName_en: matched.name_en,
          moduleName_zh: matched.name_zh,
          moduleColor: matched.color,
        };
      });

      setFunctionModules(modules);
      setSubFunctions(enrichedNodes);
      setActiveModuleId(null);

      addLog(
        { en: `Function modules grouped: ${modules.length}`, zh: `函数模块划分完成，共 ${modules.length} 个模块` },
        'success',
        { response: { modules }, usage }
      );
      setWorkflow('completed', 'Workflow completed', '工作流已完成');
    } catch (err: any) {
      if (currentFetchId !== fetchIdRef.current) return;
      if (aiCallLogId) {
        finalizeAiCallLog(aiCallLogId, { error: err?.message || String(err), success: false });
      }
      setWorkflow('error', 'Workflow ended with errors', '工作流异常结束');
      addLog(
        { en: `Function module grouping failed: ${err.message}`, zh: `函数模块划分失败: ${err.message}` },
        'error',
        buildErrorDiagnostics(err, {
          stage: 'module-grouping',
          nodeCount: nodes.length,
          targetUrl,
        })
      );
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsAnalyzingModules(false);
      }
    }
  };

  const handleReanalyzeModules = async () => {
    if (!subFunctions.length) {
      addLog(
        { en: 'Cannot re-analyze modules: no function nodes yet.', zh: '无法重新分析模块：当前没有函数节点。' },
        'warning'
      );
      return;
    }

    if (!aiAnalysis) {
      addLog(
        { en: 'Cannot re-analyze modules: missing project AI summary.', zh: '无法重新分析模块：缺少项目 AI 摘要。' },
        'warning'
      );
      return;
    }

    await analyzeFunctionModules(subFunctions, fetchIdRef.current, url, {
      summary_en: aiAnalysis.summary_en,
      primaryLanguage_en: aiAnalysis.primaryLanguage_en,
      techStack: aiAnalysis.techStack || [],
    });
  };

  const verifyEntryFiles = async (analysisResult: any, currentFetchId: number, repo: {owner: string, repo: string, branch: string}, targetUrl: string, allFiles: string[]) => {
    addLog({ en: 'Starting entry file verification...', zh: '开始验证入口文件...' }, 'info');
    setWorkflow('working', 'AI is verifying entry files...', 'AI 正在验证入口文件...');
    setIsVerifyingEntry(true);
    let foundEntry = false;

    try {
      const ai = createGeminiClient();
      if (!ai) return;

      for (const filePath of analysisResult.entryFiles) {
        if (currentFetchId !== fetchIdRef.current) return;

        addLog({ en: `Fetching content for ${filePath}...`, zh: `正在获取 ${filePath} 的内容...` }, 'info');
        let aiCallLogId: string | null = null;
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
          aiCallLogId = addAiCallLog(
            { en: `Entry verification AI call: ${filePath}`, zh: `入口验证 AI 调用: ${filePath}` },
            {
              model: "gemini-3-flash-preview",
              baseUrl: resolveGeminiEndpoint().baseUrl,
              apiVersion: resolveGeminiEndpoint().apiVersion,
              url: `${resolveGeminiEndpoint().requestUrl}/models/gemini-3-flash-preview:generateContent`,
              promptLength: prompt.length,
              prompt,
            }
          );

          const response = await generateContentWithRetry({
            ai,
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
            },
            operation: 'verify-entry-file',
            context: { filePath },
          });
          const usage = recordAiUsage(response);

          if (currentFetchId !== fetchIdRef.current) return;

          if (response.text) {
            const result = JSON.parse(response.text);
            finalizeAiCallLog(aiCallLogId, { response: result, usage, success: true });
            addLog({
              en: `Verification result for ${filePath}: ${result.isEntryFile ? 'Confirmed' : 'Rejected'}`,
              zh: `${filePath} 验证结果: ${result.isEntryFile ? '已确认' : '已拒绝'}`
            }, result.isEntryFile ? 'success' : 'info', { result, usage });

            if (result.isEntryFile) {
              foundEntry = true;
              setConfirmedEntryFile({
                path: filePath,
                reason_en: result.reason_en,
                reason_zh: result.reason_zh
              });
              addLog({ en: `Found main entry file: ${filePath}`, zh: `找到主入口文件: ${filePath}` }, 'success');

              // Trigger recursive sub-function analysis
              analyzeSubFunctionsRecursive(
                filePath,
                currentFetchId,
                repo,
                targetUrl,
                {
                  summary_en: analysisResult.summary_en,
                  primaryLanguage_en: analysisResult.primaryLanguage_en,
                  techStack: analysisResult.techStack || [],
                },
                allFiles
              );

              break; // Stop checking other files
            }
          } else {
            finalizeAiCallLog(aiCallLogId, { response: null, usage, success: false });
          }
        } catch (err: any) {
          if (aiCallLogId) {
            finalizeAiCallLog(aiCallLogId, { error: err?.message || String(err), success: false });
          }
          if (err instanceof GithubRequestError) {
            addLog(
              { en: `Error verifying ${filePath}: ${err.message}`, zh: `验证 ${filePath} 时出错: ${err.message}` },
              'error',
              { githubError: err.details }
            );
          } else {
            setWorkflow('error', 'Workflow ended with errors', '工作流异常结束');
            addLog({ en: `Error verifying ${filePath}: ${err.message}`, zh: `验证 ${filePath} 时出错: ${err.message}` }, 'error');
          }
        }
      }
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsVerifyingEntry(false);
        if (!foundEntry) {
          setWorkflow('completed', 'Workflow completed (entry not confirmed)', '工作流结束（未确认入口文件）');
        }
      }
    }
  };
  const analyzeWithAI = async (filePaths: string[], currentFetchId: number, repo: {owner: string, repo: string, branch: string}, targetUrl: string) => {
    if (currentFetchId !== fetchIdRef.current) return;
    setIsAnalyzing(true);
    setAiAnalysis(null);
    setConfirmedEntryFile(null);
    setWorkflow('working', 'AI is analyzing repository...', 'AI 正在分析仓库...');
    addLog({ en: 'Starting AI analysis...', zh: '开始 AI 分析...' }, 'info');
    let aiCallLogId: string | null = null;
    try {
      const ai = createGeminiClient();
      if (!ai) {
        console.warn("Gemini API key not found");
        setWorkflow('error', 'Workflow ended with errors', '工作流异常结束');
        addLog({ en: 'Gemini API key not found.', zh: '未找到 Gemini API 密钥。' }, 'error');
        return;
      }
      
      // Limit to 2000 files to avoid excessive token usage
      const pathsToAnalyze = filePaths.slice(0, 2000).join('\n');
      const prompt = `Analyze the following list of file paths from a GitHub repository. Determine the primary programming language, the technology stack (frameworks, libraries, tools), the likely main entry files, and provide a brief project summary based on the file structure.\n\nFiles:\n${pathsToAnalyze}`;

      if (currentFetchId !== fetchIdRef.current) return;
      aiCallLogId = addAiCallLog(
        { en: 'Repository analysis AI call', zh: '仓库分析 AI 调用' },
        {
          model: "gemini-3.1-pro-preview",
          baseUrl: resolveGeminiEndpoint().baseUrl,
          apiVersion: resolveGeminiEndpoint().apiVersion,
          url: `${resolveGeminiEndpoint().requestUrl}/models/gemini-3.1-pro-preview:generateContent`,
          promptLength: prompt.length,
          filesCount: filePaths.slice(0, 2000).length,
          prompt,
        }
      );

      const response = await generateContentWithRetry({
        ai,
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
        },
        operation: 'repository-analysis',
        context: { fileCount: filePaths.slice(0, 2000).length },
      });
      const usage = recordAiUsage(response);

      if (currentFetchId !== fetchIdRef.current) return;

      if (response.text) {
        const result = JSON.parse(response.text);
        finalizeAiCallLog(aiCallLogId, { response: result, usage, success: true });
        setAiAnalysis(result);
        
        await verifyEntryFiles(result, currentFetchId, repo, targetUrl, filePaths);
      } else {
        finalizeAiCallLog(aiCallLogId, { response: null, usage, success: false });
      }
    } catch (err: any) {
      if (currentFetchId !== fetchIdRef.current) return;
      if (aiCallLogId) {
        finalizeAiCallLog(aiCallLogId, { error: err?.message || String(err), success: false });
      }
      console.error("AI Analysis failed:", err);
      setWorkflow('error', 'Workflow ended with errors', '工作流异常结束');
      addLog({ en: `AI analysis failed: ${err.message}`, zh: `AI 分析失败: ${err.message}` }, 'error', { error: err });
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsAnalyzing(false);
      }
    }
  };

  const fetchRepoData = async (targetUrl: string) => {
    const currentFetchId = ++fetchIdRef.current;
    
    setWorkflow('working', 'Starting workflow...', '工作流启动中...');
    setLoading(true);
    setError('');
    setFileTree([]);
    setSelectedFile(null);
    setFileContent('');
    setRepoInfo(null);
    setLogs([]); // Clear logs on new fetch
    setAiAnalysis(null);
    setConfirmedEntryFile(null);
    setAllFilePaths([]);
    setFileTreeNodes([]);
    setCodeFilesList([]);
    setSubFunctions([]);
    setFunctionModules([]);
    setActiveModuleId(null);
    setIsAnalyzingModules(false);
    setSelectedLine(null);
    setAiUsageStats({ inputTokens: 0, outputTokens: 0, totalCalls: 0 });
    drillDownCacheRef.current.clear();
    functionLocationCacheRef.current.clear();

    addLog({ en: `Validating GitHub URL: ${targetUrl}`, zh: `校验 GitHub URL: ${targetUrl}` }, 'info');
    const parsed = parseGithubUrl(targetUrl);
    if (!parsed) {
      if (currentFetchId !== fetchIdRef.current) return;
      setError(lang === 'en' ? 'Invalid GitHub URL' : '无效的 GitHub URL');
      setWorkflow('error', 'Workflow ended with errors', '工作流异常结束');
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
      setFileTreeNodes(treeData.tree as GithubNode[]);

      const allFiles = treeData.tree
        .filter((node: GithubNode) => node.type === 'blob')
        .map((node: GithubNode) => node.path);
      setAllFilePaths(allFiles);

      // Trigger AI Analysis
      const codeFiles = getCodeFiles(treeData.tree);
      setCodeFilesList(codeFiles);
      addLog({ en: `Filtered code files: ${codeFiles.length} files found.`, zh: `过滤后的代码文件: 找到 ${codeFiles.length} 个文件。` }, 'info', { files: codeFiles });
      if (codeFiles.length > 0) {
        analyzeWithAI(codeFiles, currentFetchId, { owner: parsed.owner, repo: parsed.repo, branch: branch || 'main' }, targetUrl);
      } else {
        setWorkflow('completed', 'Workflow completed (no code files)', '工作流结束（未找到代码文件）');
      }
    } catch (err: any) {
      if (currentFetchId !== fetchIdRef.current) return;
      setError(err.message || 'An error occurred while fetching data');
      if (err instanceof GithubRequestError) {
        setWorkflow('error', 'Workflow ended with errors', '工作流异常结束');
        addLog(
          { en: `Error: ${err.message}`, zh: `错误: ${err.message}` },
          'error',
          { githubError: err.details }
        );
      } else {
        setWorkflow('error', 'Workflow ended with errors', '工作流异常结束');
        addLog({ en: `Error: ${err.message}`, zh: `错误: ${err.message}` }, 'error');
      }
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!historyId) return;

    const record = getAnalysisHistoryById(historyId);
    if (!record) {
      setError(lang === 'en' ? 'History record not found.' : '未找到历史分析记录。');
      if (initialUrl && initialUrl !== lastFetchedUrl.current) {
        lastFetchedUrl.current = initialUrl;
        fetchRepoData(initialUrl);
      }
      return;
    }

    setUrl(record.projectUrl);
    setLang(record.lang);
    setError('');
    setLoading(false);
    setIsAnalyzing(false);
    setIsVerifyingEntry(false);
    setIsAnalyzingSubFunctions(false);
    setIsAnalyzingModules(false);
    setSelectedFile(null);
    setSelectedLine(null);
    setFileContent('');
    setContentLoading(false);

    setRepoInfo(record.repoInfo as RepoInfoSnapshot | null);
    setAiAnalysis(record.aiAnalysis as AiAnalysisSnapshot | null);
    setConfirmedEntryFile(record.confirmedEntryFile as ConfirmedEntrySnapshot | null);
    setAllFilePaths(record.allFilePaths || []);
    setCodeFilesList(record.codeFiles || []);
    setFileTreeNodes(record.fileTreeNodes || []);
    setFileTree(buildFileTree(record.fileTreeNodes || []));
    setSubFunctions((record.subFunctions || []) as SubFunctionNode[]);
    setFunctionModules((record.functionModules || []) as FunctionModule[]);
    setActiveModuleId(null);
    setLogs(hydrateLogs(record.agentLogs || []));
    setAiUsageStats((record as any).aiUsageStats || { inputTokens: 0, outputTokens: 0, totalCalls: 0 });
    setWorkflow('completed', 'Loaded from history', '已加载历史记录');

    lastFetchedUrl.current = record.projectUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyId]);

  useEffect(() => {
    if (historyId) return;
    if (initialUrl && initialUrl !== lastFetchedUrl.current) {
      lastFetchedUrl.current = initialUrl;
      fetchRepoData(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl, historyId]);

  useEffect(() => {
    if (!url.trim() || !repoInfo) return;

    const projectName = `${repoInfo.owner}/${repoInfo.repo}`;
    const recordId = buildHistoryId(repoInfo as RepoInfoSnapshot, url);
    const serializedLogs = serializeLogs(logs);
    const snapshotWithoutMarkdown = {
      id: recordId,
      projectUrl: url,
      projectName,
      lang,
      repoInfo,
      aiAnalysis,
      confirmedEntryFile,
      allFilePaths,
      codeFiles: codeFilesList,
      fileTreeNodes,
      subFunctions,
      functionModules,
      agentLogs: serializedLogs,
      aiUsageStats,
    };

    const hash = JSON.stringify(snapshotWithoutMarkdown);
    if (hash === lastSavedHistoryHash.current) return;
    lastSavedHistoryHash.current = hash;

    const savedAt = new Date().toISOString();
    const baseRecord: Omit<AnalysisHistoryRecord, 'engineeringMarkdown'> = {
      ...snapshotWithoutMarkdown,
      savedAt,
      fileTreeNodes: fileTreeNodes as GithubNode[],
      subFunctions: subFunctions as StoredSubFunctionNode[],
      functionModules: functionModules as StoredFunctionModule[],
    };

    const nextRecord: AnalysisHistoryRecord = {
      ...baseRecord,
      engineeringMarkdown: buildEngineeringMarkdown(baseRecord),
    };

    try {
      saveAnalysisHistoryRecord(nextRecord);
    } catch (err) {
      console.warn('Failed to save analysis history:', err);
    }
  }, [url, lang, repoInfo, aiAnalysis, confirmedEntryFile, allFilePaths, codeFilesList, fileTreeNodes, subFunctions, functionModules, logs, aiUsageStats]);

  const engineeringMarkdownPreview = useMemo(() => {
    if (!repoInfo && !aiAnalysis && !subFunctions.length && !logs.length) return '';

    const projectName = repoInfo ? `${repoInfo.owner}/${repoInfo.repo}` : 'Unknown Project';
    const baseRecord: Omit<AnalysisHistoryRecord, 'engineeringMarkdown'> = {
      id: buildHistoryId((repoInfo as RepoInfoSnapshot | null) || null, url || projectName),
      savedAt: new Date().toISOString(),
      projectName,
      projectUrl: url || '',
      lang,
      repoInfo,
      aiAnalysis,
      confirmedEntryFile,
      allFilePaths,
      codeFiles: codeFilesList,
      fileTreeNodes: fileTreeNodes as GithubNode[],
      subFunctions: subFunctions as StoredSubFunctionNode[],
      functionModules: functionModules as StoredFunctionModule[],
      agentLogs: serializeLogs(logs),
      aiUsageStats,
    };

    return buildEngineeringMarkdown(baseRecord);
  }, [url, lang, repoInfo, aiAnalysis, confirmedEntryFile, allFilePaths, codeFilesList, fileTreeNodes, subFunctions, functionModules, logs, aiUsageStats]);

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
      entryReason: 'Verification Reason',
      moduleList: 'Function Modules',
      allModules: 'All Modules',
      workflowStatus: 'Workflow Status',
      reanalyzeModules: 'Re-analyze Modules',
      engineeringFile: 'Engineering File',
      markdownNotAvailable: 'Engineering markdown is not available yet.'
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
      entryReason: '验证理由',
      moduleList: '功能模块列表',
      allModules: '全部模块',
      workflowStatus: '工作流状态',
      reanalyzeModules: '重新分析模块',
      engineeringFile: '工程文件',
      markdownNotAvailable: '工程 Markdown 文件暂不可用。'
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

  const handleSelectFile = async (node: FileNode, targetLine?: number | null) => {
    if (node.type === 'tree') return;
    
    setSelectedFile(node);
    setContentLoading(true);
    setFileContent('');
    setSelectedLine(targetLine ?? null);

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

  const handleOpenPanoramaNodeSource = async (node: { name: string; file: string; lineStart?: number; lineEnd?: number }) => {
    if (!repoInfo) return;
    setShowFileTree(true);
    setShowCodeViewer(true);

    let resolvedFile = node.file || '';
    let resolvedLine = node.lineStart || null;

    if (!resolvedLine) {
      const locationKey = buildFunctionCacheKey(resolvedFile || confirmedEntryFile?.path || '', node.name);
      let located = functionLocationCacheRef.current.get(locationKey) || null;
      if (!located) {
        const ai = createGeminiClient();
        if (ai) {
          located = await locateFunctionDefinition({
            functionName: node.name,
            parentFile: resolvedFile || confirmedEntryFile?.path || '',
            allFiles: allFilePaths,
            repo: repoInfo,
            ai,
            currentFetchId: fetchIdRef.current,
          });
          functionLocationCacheRef.current.set(locationKey, located);
        }
      }
      if (located) {
        resolvedFile = located.file || resolvedFile;
        resolvedLine = located.lineStart || resolvedLine;
      }
    }

    if (!resolvedFile) {
      addLog(
        { en: `Cannot open source for ${node.name}: file unknown`, zh: `无法打开 ${node.name} 的源码：文件未知` },
        'warning'
      );
      return;
    }

    const githubNode = fileTreeNodes.find((item) => item.path === resolvedFile);
    const fileNode: FileNode = {
      path: resolvedFile,
      name: resolvedFile.split('/').pop() || resolvedFile,
      type: 'blob',
      url: githubNode?.url || '',
    };

    await handleSelectFile(fileNode, resolvedLine);
  };

  const handleManualPanoramaDrillDown = async (node: { id: string; name: string; file: string; depth?: number; drillDown?: number }) => {
    if (manualDrilldownNodeId) return;
    if (!repoInfo) {
      addLog(
        { en: 'Cannot continue drill-down: repository info missing.', zh: '无法继续下钻：缺少仓库信息。' },
        'warning'
      );
      return;
    }
    if (isAnalyzingSubFunctions) {
      addLog(
        { en: 'Recursive drill-down is running. Please wait for it to finish.', zh: '递归下钻正在进行中，请稍后再试。' },
        'warning'
      );
      return;
    }

    const target = subFunctions.find((item) => item.id === node.id);
    if (!target) return;
    if (!(target.drillDown === 0 || target.drillDown === 1)) return;
    if (subFunctions.some((item) => item.parentId === target.id)) return;

    const ai = createGeminiClient();
    if (!ai) {
      addLog(
        { en: 'Gemini API key is missing. Manual drill-down is unavailable.', zh: '未配置 Gemini API Key，无法手动下钻。' },
        'error'
      );
      return;
    }

    setManualDrilldownNodeId(target.id);
    addLog(
      { en: `Manual drill-down started: ${target.name}`, zh: `开始手动下钻：${target.name}` },
      'info',
      { nodeId: target.id, functionName: target.name, file: target.file }
    );

    try {
      const allFiles = allFilePaths || [];
      const maxDepth = getMaxDrillDownDepth();
      const parentFile = target.file || confirmedEntryFile?.path || '';
      const functionKey = buildFunctionCacheKey(parentFile, target.name);
      const drillDownCache = drillDownCacheRef.current;
      const locationCache = functionLocationCacheRef.current;
      let children: any[] = [];

      const cachedChildren = drillDownCache.get(functionKey);
      if (cachedChildren) {
        children = cachedChildren.map((item) => ({ ...item }));
        addLog(
          { en: `Manual drill-down cache hit: ${target.name}`, zh: `手动下钻缓存命中：${target.name}` },
          'info',
          { cacheKey: functionKey, childCount: children.length }
        );
      } else {
        const locationKey = buildFunctionCacheKey(parentFile, target.name);
        let located = locationCache.get(locationKey) || null;
        if (!located) {
          located = await locateFunctionDefinition({
            functionName: target.name,
            parentFile,
            allFiles,
            repo: repoInfo,
            ai,
            currentFetchId: fetchIdRef.current,
          });
          locationCache.set(locationKey, located);
        }

        if (!located) {
          addLog(
            { en: `Stop manual drill-down: definition not found for ${target.name}`, zh: `停止手动下钻：未找到 ${target.name} 的定义` },
            'warning',
            { functionName: target.name, parentFile }
          );
          return;
        }

        setSubFunctions((prev) =>
          prev.map((item) =>
            item.id === target.id
              ? {
                  ...item,
                  file: located?.file || item.file,
                  lineStart: located?.lineStart || item.lineStart,
                  lineEnd: located?.lineEnd || item.lineEnd,
                }
              : item
          )
        );

        const endpoint = resolveGeminiEndpoint();
        const fileList = allFiles.slice(0, 1500).join('\n');
        const prompt = `Analyze the function below and identify up to 12 key child function calls that are part of the CORE business/control flow.
Project URL: ${url}
Project Summary: ${aiAnalysis?.summary_en || ''}
Caller Function: ${target.name}
Caller File: ${located.file}
Depth: ${target.depth ?? 0}/${maxDepth}

Available Files:
${fileList}

Function Code:
\`\`\`
${located.code.substring(0, 12000)}
\`\`\`

Strict rules:
1) Return ONLY child calls that are essential to core feature flow, business logic transitions, orchestration, external system interactions, or critical error handling.
2) EXCLUDE generic utilities and low-value operations: plain data structure ops (map/filter/reduce/forEach/push/pop/sort), string formatting/parsing helpers, trivial getters/setters, logging wrappers, and basic framework lifecycle hooks.
3) For object-oriented languages, if a call belongs to a class/namespace, name MUST use full qualified form (example: ClassName::FunctionName). Do not return only FunctionName in this case.
4) Keep max 12 results and prioritize impact on end-to-end behavior.
5) Return direct child calls only, do not expand grandchildren.

For each child function return:
1) name
2) file (likely definition file path)
3) description_en
4) description_zh
5) drillDown (-1=no, 0=unsure, 1=yes)`;

        const aiCallLogId = addAiCallLog(
          { en: `AI manual drill-down analyzing ${target.name}...`, zh: `AI 正在手动下钻分析 ${target.name}...` },
          {
            model: 'gemini-3-flash-preview',
            baseUrl: endpoint.baseUrl,
            apiVersion: endpoint.apiVersion,
            url: `${endpoint.requestUrl}/models/gemini-3-flash-preview:generateContent`,
            functionName: target.name,
            functionFile: located.file,
            depth: target.depth ?? 0,
            maxDepth,
            prompt,
          }
        );

        try {
          const response = await generateContentWithRetry({
            ai,
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
            operation: 'manual-drilldown',
            context: {
              nodeId: target.id,
              functionName: target.name,
              functionFile: located.file,
              depth: target.depth ?? 0,
            },
          });
          const usage = recordAiUsage(response);

          if (!response.text) {
            finalizeAiCallLog(aiCallLogId, { response: null, usage, success: false });
            children = [];
          } else {
            const parsed = JSON.parse(response.text);
            children = Array.isArray(parsed?.subFunctions) ? parsed.subFunctions : [];
            drillDownCache.set(functionKey, children.map((item: any) => ({ ...item })));
            finalizeAiCallLog(aiCallLogId, {
              response: { ...parsed, cacheStored: true, cacheKey: functionKey },
              usage,
              success: true,
            });
          }
        } catch (err: any) {
          finalizeAiCallLog(aiCallLogId, { error: err?.message || String(err), success: false });
          throw err;
        }
      }

      if (!children.length) {
        addLog(
          { en: `Manual drill-down finished: no new child nodes for ${target.name}.`, zh: `手动下钻完成：${target.name} 无新增子节点。` },
          'info'
        );
        return;
      }

      let addedCount = 0;
      setSubFunctions((prev) => {
        const next = [...prev];
        const existing = new Set(
          prev.map((item) => `${item.parentId}::${item.name.trim().toLowerCase()}::${(item.file || '').trim().toLowerCase()}`)
        );

        for (const child of children) {
          const childName = (child?.name || '').trim();
          if (!childName) continue;
          const childFile = (child?.file || '').trim();
          const key = `${target.id}::${childName.toLowerCase()}::${childFile.toLowerCase()}`;
          if (existing.has(key)) continue;
          existing.add(key);
          addedCount += 1;

          next.push({
            id: `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            parentId: target.id,
            depth: (target.depth ?? 0) + 1,
            name: childName,
            file: childFile,
            description_en: child?.description_en || '',
            description_zh: child?.description_zh || '',
            drillDown: Number.isInteger(child?.drillDown) ? child.drillDown : 0,
            routePath: typeof child?.routePath === 'string' ? child.routePath : undefined,
          });
        }

        return next;
      });

      addLog(
        {
          en: `Manual drill-down complete for ${target.name}: added ${addedCount} child node(s).`,
          zh: `${target.name} 手动下钻完成：新增 ${addedCount} 个子节点。`,
        },
        'success',
        { nodeId: target.id, addedCount }
      );
    } catch (err: any) {
      addLog(
        {
          en: `Manual drill-down failed for ${target.name}: ${err?.message || String(err)}`,
          zh: `${target.name} 手动下钻失败：${err?.message || String(err)}`,
        },
        'warning',
        buildErrorDiagnostics(err, {
          stage: 'manual-drilldown',
          nodeId: target.id,
          functionName: target.name,
          functionFile: target.file,
        })
      );
    } finally {
      setManualDrilldownNodeId(null);
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
            {lang === 'en' ? '中文' : 'English'}
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
                      <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] border ${
                        workflowStatus.state === 'working'
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-600'
                          : workflowStatus.state === 'completed'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                            : workflowStatus.state === 'error'
                              ? 'bg-rose-50 border-rose-200 text-rose-600'
                              : 'bg-slate-50 border-slate-200 text-slate-500'
                      }`}>
                        {lang === 'en' ? workflowStatus.label_en : workflowStatus.label_zh}
                      </span>
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
                    <div className="px-2.5 py-2 border-b border-slate-800 text-[10px] text-slate-300 grid grid-cols-3 gap-2">
                      <div>
                        {lang === 'en' ? 'AI Calls' : 'AI 调用次数'}: <span className="text-emerald-300">{aiUsageStats.totalCalls}</span>
                      </div>
                      <div>
                        {lang === 'en' ? 'Input Tokens' : '输入 Tokens'}: <span className="text-indigo-300">{aiUsageStats.inputTokens}</span>
                      </div>
                      <div>
                        {lang === 'en' ? 'Output Tokens' : '输出 Tokens'}: <span className="text-amber-300">{aiUsageStats.outputTokens}</span>
                      </div>
                    </div>
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
                              {log.details.aiCall ? (
                                <div className="space-y-2">
                                  <details className="group" open>
                                    <summary className="cursor-pointer text-indigo-300 text-xs font-semibold">
                                      {lang === 'en' ? 'AI Request (Prompt)' : 'AI 请求 (Prompt)'}
                                    </summary>
                                    <pre className="mt-1 text-slate-400 text-[10px] whitespace-pre-wrap">
                                      {JSON.stringify(truncateLongStrings(log.details.aiCall.request), null, 2)}
                                    </pre>
                                  </details>
                                  <details className="group" open>
                                    <summary className="cursor-pointer text-emerald-300 text-xs font-semibold">
                                      {lang === 'en' ? 'AI Response (JSON)' : 'AI 响应 (JSON)'}
                                    </summary>
                                    <pre className="mt-1 text-slate-400 text-[10px] whitespace-pre-wrap">
                                      {JSON.stringify(
                                        truncateLongStrings(
                                          log.details.aiCall.error
                                            ? { error: log.details.aiCall.error }
                                            : log.details.aiCall.response
                                        ),
                                        null,
                                        2
                                      )}
                                    </pre>
                                  </details>
                                  {log.details.aiCall.usage && (
                                    <pre className="text-slate-500 text-[10px] whitespace-pre-wrap">
                                      {JSON.stringify(truncateLongStrings({ usage: log.details.aiCall.usage, status: log.details.aiCall.status }), null, 2)}
                                    </pre>
                                  )}
                                </div>
                              ) : log.details.request?.prompt ? (
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

              <div className="mb-6 space-y-3">
                <div>
                  <div className="flex items-center mb-2">
                    <Info className="w-4 h-4 text-slate-500 mr-2" />
                    <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t[lang].workflowStatus}</h2>
                  </div>
                  <div className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                    workflowStatus.state === 'working'
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      : workflowStatus.state === 'completed'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : workflowStatus.state === 'error'
                          ? 'bg-rose-50 border-rose-200 text-rose-700'
                          : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}>
                    {lang === 'en' ? workflowStatus.label_en : workflowStatus.label_zh}
                    {(isAnalyzing || isVerifyingEntry || isAnalyzingSubFunctions || isAnalyzingModules) && (
                      <Loader2 className="w-3.5 h-3.5 inline ml-2 animate-spin" />
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center mb-2">
                    <Layers className="w-4 h-4 text-slate-500 mr-2" />
                    <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t[lang].moduleList}</h2>
                  </div>
                  <button
                    onClick={handleReanalyzeModules}
                    disabled={isAnalyzingModules || !subFunctions.length || !aiAnalysis}
                    className="mb-3 w-full px-3 py-2 rounded-lg text-xs font-medium border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isAnalyzingModules ? (
                      <span className="inline-flex items-center">
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        {lang === 'en' ? 'Analyzing...' : '分析中...'}
                      </span>
                    ) : (
                      t[lang].reanalyzeModules
                    )}
                  </button>
                  <div className="space-y-2">
                    <button
                      onClick={() => setActiveModuleId(null)}
                      className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                        activeModuleId === null
                          ? 'bg-slate-100 border-slate-400'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-800">{t[lang].allModules}</div>
                        <div className="text-xs text-slate-500">
                          {lang === 'en'
                            ? `${subFunctions.length} function nodes`
                            : `${subFunctions.length}个函数节点`}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {lang === 'en'
                          ? 'Show all discovered modules and call-chain nodes.'
                          : '显示全部模块与已识别的调用链节点。'}
                      </div>
                    </button>

                    {functionModules.map((module) => {
                      const isActive = activeModuleId === module.id;
                      const displayName = lang === 'en' ? module.name_en : module.name_zh;
                      const displayDesc =
                        lang === 'en'
                          ? module.description_en || 'No description provided.'
                          : module.description_zh || '暂无模块描述。';
                      const countLabel =
                        lang === 'en'
                          ? `${module.functionIds.length} function nodes`
                          : `${module.functionIds.length}个函数节点`;

                      return (
                        <button
                          key={module.id}
                          onClick={() => setActiveModuleId((prev) => (prev === module.id ? null : module.id))}
                          className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                            isActive ? 'bg-slate-100 border-slate-400' : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center min-w-0">
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-full mr-2.5 shrink-0"
                                style={{ backgroundColor: module.color }}
                              />
                              <span className="text-sm font-semibold text-slate-800 truncate">{displayName}</span>
                            </div>
                            <div className="text-xs text-slate-500 shrink-0">{countLabel}</div>
                          </div>
                          <div className="mt-1 text-xs text-slate-500 leading-relaxed line-clamp-2">
                            {displayDesc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

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

                        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">{t[lang].engineeringFile}</div>
                            <button
                              onClick={() => setIsMarkdownFullscreen(true)}
                              className="p-1 hover:bg-slate-100 rounded text-slate-500 transition-colors"
                              title="Fullscreen"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {engineeringMarkdownPreview ? (
                            <pre className="max-h-56 overflow-auto p-2 bg-slate-50 border border-slate-200 rounded text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap">
                              {engineeringMarkdownPreview}
                            </pre>
                          ) : (
                            <div className="text-xs text-slate-400">{t[lang].markdownNotAvailable}</div>
                          )}
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
                    <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t[lang].fileExplorer}</h2>
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
                        highlightLine={selectedLine}
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
                        activeModuleId={activeModuleId}
                        onOpenSource={handleOpenPanoramaNodeSource}
                        onManualDrillDown={handleManualPanoramaDrillDown}
                        manualDrilldownNodeId={manualDrilldownNodeId}
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
              <span className={`ml-3 px-2 py-0.5 rounded-full text-[10px] border ${
                workflowStatus.state === 'working'
                  ? 'bg-indigo-950 border-indigo-700 text-indigo-300'
                  : workflowStatus.state === 'completed'
                    ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                    : workflowStatus.state === 'error'
                      ? 'bg-rose-950 border-rose-700 text-rose-300'
                      : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}>
                {lang === 'en' ? workflowStatus.label_en : workflowStatus.label_zh}
              </span>
            </div>
            <button 
              onClick={() => setIsLogsFullscreen(false)}
              className="p-2 hover:bg-slate-800 rounded text-slate-400 transition-colors"
            >
              <Minimize2 className="w-5 h-5" />
            </button>
          </div>
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900 text-xs text-slate-300 flex flex-wrap gap-4">
            <span>{lang === 'en' ? 'AI Calls' : 'AI 调用次数'}: <span className="text-emerald-300">{aiUsageStats.totalCalls}</span></span>
            <span>{lang === 'en' ? 'Input Tokens' : '输入 Tokens'}: <span className="text-indigo-300">{aiUsageStats.inputTokens}</span></span>
            <span>{lang === 'en' ? 'Output Tokens' : '输出 Tokens'}: <span className="text-amber-300">{aiUsageStats.outputTokens}</span></span>
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
                    {log.details.aiCall ? (
                      <div className="space-y-3">
                        <details className="group" open>
                          <summary className="cursor-pointer text-indigo-300 text-sm font-semibold">
                            {lang === 'en' ? 'AI Request (Prompt)' : 'AI 请求 (Prompt)'}
                          </summary>
                          <pre className="mt-2 text-slate-400 text-xs leading-relaxed whitespace-pre-wrap">
                            {JSON.stringify(truncateLongStrings(log.details.aiCall.request), null, 2)}
                          </pre>
                        </details>
                        <details className="group" open>
                          <summary className="cursor-pointer text-emerald-300 text-sm font-semibold">
                            {lang === 'en' ? 'AI Response (JSON)' : 'AI 响应 (JSON)'}
                          </summary>
                          <pre className="mt-2 text-slate-400 text-xs leading-relaxed whitespace-pre-wrap">
                            {JSON.stringify(
                              truncateLongStrings(
                                log.details.aiCall.error
                                  ? { error: log.details.aiCall.error }
                                  : log.details.aiCall.response
                              ),
                              null,
                              2
                            )}
                          </pre>
                        </details>
                        {log.details.aiCall.usage && (
                          <pre className="text-slate-500 text-xs leading-relaxed whitespace-pre-wrap">
                            {JSON.stringify(truncateLongStrings({ usage: log.details.aiCall.usage, status: log.details.aiCall.status }), null, 2)}
                          </pre>
                        )}
                      </div>
                    ) : log.details.request?.prompt ? (
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

      {isMarkdownFullscreen && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">{t[lang].engineeringFile}</h2>
            <button
              onClick={() => setIsMarkdownFullscreen(false)}
              className="p-2 hover:bg-slate-200 rounded text-slate-500 transition-colors"
            >
              <Minimize2 className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {engineeringMarkdownPreview ? (
              <pre className="w-full h-full bg-slate-50 border border-slate-200 rounded p-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                {engineeringMarkdownPreview}
              </pre>
            ) : (
              <div className="text-sm text-slate-400">{t[lang].markdownNotAvailable}</div>
            )}
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

