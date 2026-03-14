export interface GithubNode {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

export interface FileNode {
  path: string;
  name: string;
  type: 'blob' | 'tree';
  url: string;
  children?: FileNode[];
}

export function buildFileTree(nodes: GithubNode[]): FileNode[] {
  const root: FileNode[] = [];
  const map = new Map<string, FileNode>();

  nodes.forEach((node) => {
    const parts = node.path.split('/');
    const name = parts[parts.length - 1];
    
    const fileNode: FileNode = {
      path: node.path,
      name,
      type: node.type,
      url: node.url,
      children: node.type === 'tree' ? [] : undefined,
    };

    map.set(node.path, fileNode);

    if (parts.length === 1) {
      root.push(fileNode);
    } else {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = map.get(parentPath);
      if (parent && parent.children) {
        parent.children.push(fileNode);
      }
    }
  });

  // Sort: directories first, then files
  const sortNodes = (nodes: FileNode[]) => {
    nodes.sort((a, b) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name);
      }
      return a.type === 'tree' ? -1 : 1;
    });
    nodes.forEach((node) => {
      if (node.children) {
        sortNodes(node.children);
      }
    });
  };

  sortNodes(root);
  return root;
}

export function getCodeFiles(nodes: GithubNode[]): string[] {
  const codeExtensions = new Set([
    'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'html', 'css', 'scss', 'json', 'yml', 'yaml', 'toml', 'xml', 'sh', 'bat', 'ps1', 'vue', 'svelte', 'dart'
  ]);
  const exactMatches = new Set([
    'Dockerfile', 'Makefile', 'package.json', 'requirements.txt', 'Cargo.toml', 'pom.xml', 'build.gradle', 'gemfile', 'composer.json'
  ]);

  return nodes
    .filter(node => node.type === 'blob')
    .map(node => node.path)
    .filter(path => {
      const filename = path.split('/').pop()?.toLowerCase() || '';
      if (exactMatches.has(filename)) return true;
      const ext = filename.split('.').pop()?.toLowerCase() || '';
      return codeExtensions.has(ext);
    });
}

export function parseGithubUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return {
      owner: parts[0],
      repo: parts[1],
      branch: parts[3] || null, // if branch is not in URL, we'll fetch default branch
    };
  } catch {
    return null;
  }
}

export function getLanguageFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'java':
      return 'java';
    case 'c':
    case 'h':
      return 'c';
    case 'cpp':
    case 'hpp':
      return 'cpp';
    case 'cs':
      return 'csharp';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'sh':
      return 'bash';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'xml':
      return 'xml';
    case 'sql':
      return 'sql';
    default:
      return 'text';
  }
}
