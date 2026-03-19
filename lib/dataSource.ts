import { buildFileTree, getCodeFiles, parseGithubUrl, type GithubNode } from '@/lib/github';
import { getLocalDirectorySession } from '@/lib/localSession';
import { getAppSettings } from '@/lib/appSettings';

export type DataSourceKind = 'github' | 'local';

export type DataSourceProjectInfo = {
  kind: DataSourceKind;
  projectUrl: string;
  displayName: string;
  owner?: string;
  repo?: string;
  branch?: string;
  localName?: string;
};

export type DataSourceSnapshot = {
  project: DataSourceProjectInfo;
  nodes: GithubNode[];
  fileTree: ReturnType<typeof buildFileTree>;
  allFiles: string[];
  codeFiles: string[];
};

export class DataSourceError extends Error {
  details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DataSourceError';
    this.details = details;
  }
}

export interface CodeDataSource {
  kind: DataSourceKind;
  loadProject(target: string): Promise<DataSourceSnapshot>;
  readFile(path: string): Promise<{ text: string; source: string }>;
  searchFileContent(params: {
    filePaths: string[];
    query: string | RegExp;
    maxResults?: number;
  }): Promise<string[]>;
}

const toTextMatcher = (query: string | RegExp) => {
  if (query instanceof RegExp) return (text: string) => query.test(text);
  const keyword = query;
  return (text: string) => text.includes(keyword);
};

const sortNodesForTree = (nodes: GithubNode[]) => {
  return [...nodes].sort((a, b) => {
    const depthA = a.path.split('/').length;
    const depthB = b.path.split('/').length;
    if (depthA !== depthB) return depthA - depthB;
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
};

const createGithubHeaders = () => {
  const appSettings = getAppSettings();
  const token = appSettings.githubToken || process.env.NEXT_PUBLIC_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

const readGithubApiJson = async <T,>(url: string, operation: string): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(url, { headers: createGithubHeaders() });
  } catch (err) {
    throw new DataSourceError(`${operation} failed: network error`, {
      url,
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new DataSourceError(`${operation} failed: HTTP ${res.status}`, {
      url,
      status: res.status,
      statusText: res.statusText,
      responseSnippet: text.slice(0, 500),
    });
  }

  return res.json() as Promise<T>;
};

const decodeBase64Utf8 = (base64: string) => {
  const normalized = (base64 || '').replace(/\n/g, '');
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export const createGithubDataSource = (): CodeDataSource => {
  const readFile = async (owner: string, repo: string, branch: string, filePath: string) => {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    try {
      const rawRes = await fetch(rawUrl);
      if (rawRes.ok) {
        return { text: await rawRes.text(), source: 'github-raw' };
      }
    } catch {
      // Fall through to API mode.
    }

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`;
    const payload = await readGithubApiJson<any>(
      apiUrl,
      `Read GitHub file content (${filePath})`
    );

    if (!payload?.content || payload?.encoding !== 'base64') {
      throw new DataSourceError(`Read GitHub file content (${filePath}) failed: invalid payload`, {
        apiUrl,
        hasContent: Boolean(payload?.content),
        encoding: payload?.encoding,
      });
    }

    return { text: decodeBase64Utf8(payload.content), source: 'github-api' };
  };

  let currentRepo: { owner: string; repo: string; branch: string } | null = null;

  return {
    kind: 'github',
    async loadProject(target: string) {
      const parsed = parseGithubUrl(target);
      if (!parsed) {
        throw new DataSourceError('Invalid GitHub URL');
      }

      let branch = parsed.branch || '';
      if (!branch) {
        const repoMeta = await readGithubApiJson<{ default_branch: string }>(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
          'Read GitHub repository metadata'
        );
        branch = repoMeta.default_branch || 'main';
      }

      const treeData = await readGithubApiJson<{ tree: GithubNode[] }>(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${branch}?recursive=1`,
        'Read GitHub file tree'
      );

      const normalizedNodes = sortNodesForTree(treeData.tree || []);
      const allFiles = normalizedNodes.filter((node) => node.type === 'blob').map((node) => node.path);
      const codeFiles = getCodeFiles(normalizedNodes);

      currentRepo = { owner: parsed.owner, repo: parsed.repo, branch };

      return {
        project: {
          kind: 'github',
          projectUrl: target,
          displayName: `${parsed.owner}/${parsed.repo}`,
          owner: parsed.owner,
          repo: parsed.repo,
          branch,
        },
        nodes: normalizedNodes,
        fileTree: buildFileTree(normalizedNodes),
        allFiles,
        codeFiles,
      };
    },
    async readFile(path: string) {
      if (!currentRepo) {
        throw new DataSourceError('GitHub data source is not initialized');
      }
      return readFile(currentRepo.owner, currentRepo.repo, currentRepo.branch, path);
    },
    async searchFileContent({ filePaths, query, maxResults = 20 }) {
      const matches: string[] = [];
      const match = toTextMatcher(query);
      for (const filePath of filePaths) {
        try {
          const content = await this.readFile(filePath);
          if (match(content.text)) {
            matches.push(filePath);
            if (matches.length >= maxResults) break;
          }
        } catch {
          continue;
        }
      }
      return matches;
    },
  };
};

export const createLocalDataSource = (sessionId: string): CodeDataSource => {
  const session = getLocalDirectorySession(sessionId);
  if (!session) {
    throw new DataSourceError('Local directory session not found. Please select a local folder again.');
  }

  const fileHandleMap = new Map<string, FileSystemFileHandle>();
  let loaded = false;
  let cachedSnapshot: DataSourceSnapshot | null = null;

  const walkDirectory = async (dir: FileSystemDirectoryHandle, prefix = '', nodes: GithubNode[] = []) => {
    for await (const entry of (dir as any).values() as AsyncIterable<FileSystemHandle>) {
      const entryName = entry.name;
      const path = prefix ? `${prefix}/${entryName}` : entryName;
      if (entry.kind === 'directory') {
        nodes.push({
          path,
          mode: '040000',
          type: 'tree',
          sha: `local-tree-${path}`,
          url: `local://${encodeURIComponent(path)}`,
        });
        await walkDirectory(entry as FileSystemDirectoryHandle, path, nodes);
      } else {
        const fileHandle = entry as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        fileHandleMap.set(path, fileHandle);
        nodes.push({
          path,
          mode: '100644',
          type: 'blob',
          sha: `local-blob-${path}`,
          size: file.size,
          url: `local://${encodeURIComponent(path)}`,
        });
      }
    }
    return nodes;
  };

  const ensureLoaded = async () => {
    if (loaded && cachedSnapshot) return cachedSnapshot;

    fileHandleMap.clear();
    const nodes = sortNodesForTree(await walkDirectory(session.handle));
    const allFiles = nodes.filter((node) => node.type === 'blob').map((node) => node.path);
    const codeFiles = getCodeFiles(nodes);
    cachedSnapshot = {
      project: {
        kind: 'local',
        projectUrl: `local://${session.name}`,
        displayName: session.name,
        localName: session.name,
      },
      nodes,
      fileTree: buildFileTree(nodes),
      allFiles,
      codeFiles,
    };
    loaded = true;
    return cachedSnapshot;
  };

  return {
    kind: 'local',
    async loadProject(_target: string) {
      return ensureLoaded();
    },
    async readFile(path: string) {
      await ensureLoaded();
      const handle = fileHandleMap.get(path);
      if (!handle) {
        throw new DataSourceError(`Local file not found: ${path}`);
      }
      const file = await handle.getFile();
      return { text: await file.text(), source: 'local-fs' };
    },
    async searchFileContent({ filePaths, query, maxResults = 20 }) {
      const matches: string[] = [];
      const match = toTextMatcher(query);
      for (const filePath of filePaths) {
        try {
          const content = await this.readFile(filePath);
          if (match(content.text)) {
            matches.push(filePath);
            if (matches.length >= maxResults) break;
          }
        } catch {
          continue;
        }
      }
      return matches;
    },
  };
};
