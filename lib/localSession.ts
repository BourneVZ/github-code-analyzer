export type LocalDirectorySession = {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  createdAt: number;
};

const localDirectorySessions = new Map<string, LocalDirectorySession>();

const createSessionId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const registerLocalDirectorySession = (handle: FileSystemDirectoryHandle) => {
  const id = createSessionId();
  const session: LocalDirectorySession = {
    id,
    name: handle.name || 'local-project',
    handle,
    createdAt: Date.now(),
  };
  localDirectorySessions.set(id, session);
  return session;
};

export const getLocalDirectorySession = (id: string) => {
  if (!id) return null;
  return localDirectorySessions.get(id) || null;
};

export const clearLocalDirectorySession = (id: string) => {
  if (!id) return;
  localDirectorySessions.delete(id);
};

