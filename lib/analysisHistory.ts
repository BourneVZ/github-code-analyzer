import type { GithubNode } from '@/lib/github';

export type SupportedLanguage = 'en' | 'zh';

export type LocalizedMessage = {
  en: string;
  zh: string;
};

export type StoredLogEntry = {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: LocalizedMessage;
  details?: unknown;
};

export type StoredSubFunctionNode = {
  id: string;
  parentId: string;
  depth: number;
  name: string;
  file: string;
  description_en: string;
  description_zh: string;
  drillDown: number;
  moduleId?: string;
  moduleName_en?: string;
  moduleName_zh?: string;
  moduleColor?: string;
};

export type StoredFunctionModule = {
  id: string;
  name_en: string;
  name_zh: string;
  description_en: string;
  description_zh: string;
  color: string;
  functionIds: string[];
};

export type RepoInfoSnapshot = {
  owner: string;
  repo: string;
  branch: string;
};

export type AiAnalysisSnapshot = {
  summary_en: string;
  summary_zh: string;
  primaryLanguage_en: string;
  primaryLanguage_zh: string;
  techStack: string[];
  entryFiles: string[];
};

export type ConfirmedEntrySnapshot = {
  path: string;
  reason_en: string;
  reason_zh: string;
};

export type AnalysisHistoryRecord = {
  id: string;
  savedAt: string;
  projectName: string;
  projectUrl: string;
  lang: SupportedLanguage;
  repoInfo: RepoInfoSnapshot | null;
  aiAnalysis: AiAnalysisSnapshot | null;
  confirmedEntryFile: ConfirmedEntrySnapshot | null;
  allFilePaths: string[];
  codeFiles: string[];
  fileTreeNodes: GithubNode[];
  subFunctions: StoredSubFunctionNode[];
  functionModules: StoredFunctionModule[];
  agentLogs: StoredLogEntry[];
  engineeringMarkdown: string;
};

const HISTORY_STORAGE_KEY = 'github-code-analyzer.analysis-history.v2';
const MAX_HISTORY_RECORDS = 30;
const historyListeners = new Set<() => void>();
const EMPTY_HISTORY: AnalysisHistoryRecord[] = [];
let cachedRawHistory: string | null = null;
let cachedHistory: AnalysisHistoryRecord[] = EMPTY_HISTORY;

const isBrowser = () => typeof window !== 'undefined';

const safeParse = (raw: string | null): AnalysisHistoryRecord[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === 'object');
  } catch {
    return [];
  }
};

export const buildHistoryId = (repoInfo: RepoInfoSnapshot | null, projectUrl: string) => {
  if (repoInfo) {
    return `${repoInfo.owner}/${repoInfo.repo}#${repoInfo.branch}`.toLowerCase();
  }
  return projectUrl.trim().toLowerCase();
};

export const getAnalysisHistory = (): AnalysisHistoryRecord[] => {
  if (!isBrowser()) return EMPTY_HISTORY;
  const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
  if (raw === cachedRawHistory) {
    return cachedHistory;
  }

  const parsed = safeParse(raw);
  const deduped = new Map<string, AnalysisHistoryRecord>();
  const sorted = parsed.sort((a, b) => +new Date(b.savedAt) - +new Date(a.savedAt));

  for (const item of sorted) {
    if (!item?.id) continue;
    if (!deduped.has(item.id)) {
      deduped.set(item.id, item);
    }
  }

  cachedRawHistory = raw;
  cachedHistory = Array.from(deduped.values()).sort((a, b) => +new Date(b.savedAt) - +new Date(a.savedAt));
  return cachedHistory;
};

export const getAnalysisHistoryById = (id: string): AnalysisHistoryRecord | null => {
  const list = getAnalysisHistory();
  return list.find((item) => item.id === id) ?? null;
};

export const saveAnalysisHistoryRecord = (record: AnalysisHistoryRecord) => {
  if (!isBrowser()) return;
  const list = getAnalysisHistory();
  const filtered = list.filter((item) => item.id !== record.id);
  const next = [record, ...filtered]
    .sort((a, b) => +new Date(b.savedAt) - +new Date(a.savedAt))
    .slice(0, MAX_HISTORY_RECORDS);
  const raw = JSON.stringify(next);
  window.localStorage.setItem(HISTORY_STORAGE_KEY, raw);
  cachedRawHistory = raw;
  cachedHistory = next;
  historyListeners.forEach((listener) => listener());
};

export const subscribeAnalysisHistory = (listener: () => void) => {
  historyListeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key === HISTORY_STORAGE_KEY) {
      listener();
    }
  };

  if (isBrowser()) {
    window.addEventListener('storage', onStorage);
  }

  return () => {
    historyListeners.delete(listener);
    if (isBrowser()) {
      window.removeEventListener('storage', onStorage);
    }
  };
};

export const getAnalysisHistoryServerSnapshot = () => EMPTY_HISTORY;

const jsonBlock = (value: unknown) => {
  return `\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
};

export const buildEngineeringMarkdown = (record: Omit<AnalysisHistoryRecord, 'engineeringMarkdown'>) => {
  const title = record.projectName || 'Unknown Project';
  const primaryLanguage =
    record.aiAnalysis?.primaryLanguage_zh || record.aiAnalysis?.primaryLanguage_en || 'Unknown';
  const summary = record.aiAnalysis?.summary_zh || record.aiAnalysis?.summary_en || 'N/A';
  const techStack = record.aiAnalysis?.techStack?.length ? record.aiAnalysis.techStack.join(', ') : 'N/A';

  return [
    `# Project Analysis Engineering File - ${title}`,
    '',
    `- Saved At: ${record.savedAt}`,
    `- Project URL: ${record.projectUrl || 'N/A'}`,
    `- Project Name: ${record.projectName || 'N/A'}`,
    `- Primary Language: ${primaryLanguage}`,
    `- Tech Stack: ${techStack}`,
    '',
    '## Basic Info',
    jsonBlock({
      projectName: record.projectName,
      projectUrl: record.projectUrl,
      lang: record.lang,
      repoInfo: record.repoInfo,
      confirmedEntryFile: record.confirmedEntryFile,
      summary,
    }),
    '## Programming Language & Tech Stack',
    jsonBlock({
      primaryLanguage_en: record.aiAnalysis?.primaryLanguage_en || '',
      primaryLanguage_zh: record.aiAnalysis?.primaryLanguage_zh || '',
      techStack: record.aiAnalysis?.techStack || [],
      entryFiles: record.aiAnalysis?.entryFiles || [],
      summary_en: record.aiAnalysis?.summary_en || '',
      summary_zh: record.aiAnalysis?.summary_zh || '',
    }),
    '## File List (All Files)',
    jsonBlock(record.allFilePaths),
    '## Code Files',
    jsonBlock(record.codeFiles),
    '## Full Call Chain',
    jsonBlock(record.subFunctions),
    '## Function Modules',
    jsonBlock(record.functionModules || []),
    '## Agent Work Logs',
    jsonBlock(record.agentLogs),
  ].join('\n');
};
