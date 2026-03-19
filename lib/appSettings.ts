export type AppSettings = {
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  githubToken: string;
  maxDrillDownDepth: number;
  keySubFunctionCount: number;
  retryMaxRetries: number;
  retryBaseDelayMs: number;
};

export type AppSettingsResolved = {
  effective: AppSettings;
  env: Partial<AppSettings>;
  persisted: AppSettings;
};

const SETTINGS_STORAGE_KEY = 'github-code-analyzer.settings.v1';

const DEFAULT_SETTINGS: AppSettings = {
  aiBaseUrl: 'https://generativelanguage.googleapis.com',
  aiApiKey: '',
  aiModel: 'gemini-3-flash-preview',
  githubToken: '',
  maxDrillDownDepth: 2,
  keySubFunctionCount: 10,
  retryMaxRetries: 0,
  retryBaseDelayMs: 600,
};

const listeners = new Set<() => void>();
const isBrowser = () => typeof window !== 'undefined';
let cachedLocalRaw: string | null = null;
let cachedEffective: AppSettings = DEFAULT_SETTINGS;

const parseBoundedInt = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const normalizeSettings = (value: Partial<AppSettings>): AppSettings => {
  return {
    aiBaseUrl: String(value.aiBaseUrl ?? DEFAULT_SETTINGS.aiBaseUrl).trim() || DEFAULT_SETTINGS.aiBaseUrl,
    aiApiKey: String(value.aiApiKey ?? DEFAULT_SETTINGS.aiApiKey).trim(),
    aiModel: String(value.aiModel ?? DEFAULT_SETTINGS.aiModel).trim() || DEFAULT_SETTINGS.aiModel,
    githubToken: String(value.githubToken ?? DEFAULT_SETTINGS.githubToken).trim(),
    maxDrillDownDepth: parseBoundedInt(value.maxDrillDownDepth, DEFAULT_SETTINGS.maxDrillDownDepth, 0, 6),
    keySubFunctionCount: parseBoundedInt(value.keySubFunctionCount, DEFAULT_SETTINGS.keySubFunctionCount, 1, 30),
    retryMaxRetries: parseBoundedInt(value.retryMaxRetries, DEFAULT_SETTINGS.retryMaxRetries, 0, 10),
    retryBaseDelayMs: parseBoundedInt(value.retryBaseDelayMs, DEFAULT_SETTINGS.retryBaseDelayMs, 100, 10000),
  };
};

const readPersistedSettings = (): AppSettings => {
  if (!isBrowser()) return DEFAULT_SETTINGS;
  const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_SETTINGS;
    return normalizeSettings(parsed as Partial<AppSettings>);
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const writePersistedSettings = (settings: AppSettings) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
};

const getRawEnv = () => {
  return {
    aiBaseUrl:
      process.env.NEXT_PUBLIC_AI_BASE_URL ||
      process.env.NEXT_PUBLIC_GEMINI_BASE_URL ||
      process.env.GEMINI_BASE_URL ||
      '',
    aiApiKey:
      process.env.NEXT_PUBLIC_AI_API_KEY ||
      process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      '',
    aiModel:
      process.env.NEXT_PUBLIC_AI_MODEL ||
      process.env.NEXT_PUBLIC_GEMINI_MODEL ||
      process.env.GEMINI_MODEL ||
      '',
    githubToken:
      process.env.NEXT_PUBLIC_GITHUB_TOKEN ||
      process.env.GITHUB_TOKEN ||
      '',
    maxDrillDownDepth:
      process.env.NEXT_PUBLIC_GEMINI_DRILLDOWN_MAX_DEPTH ||
      process.env.GEMINI_DRILLDOWN_MAX_DEPTH ||
      '',
    keySubFunctionCount:
      process.env.NEXT_PUBLIC_GEMINI_KEY_SUBFUNCTION_COUNT ||
      process.env.GEMINI_KEY_SUBFUNCTION_COUNT ||
      '',
    retryMaxRetries:
      process.env.NEXT_PUBLIC_GEMINI_RETRY_MAX_RETRIES ||
      process.env.GEMINI_RETRY_MAX_RETRIES ||
      '',
    retryBaseDelayMs:
      process.env.NEXT_PUBLIC_GEMINI_RETRY_BASE_DELAY_MS ||
      process.env.GEMINI_RETRY_BASE_DELAY_MS ||
      '',
  };
};

const ENV_SETTINGS: Partial<AppSettings> = (() => {
  const raw = getRawEnv();
  const env: Partial<AppSettings> = {};

  if (raw.aiBaseUrl) env.aiBaseUrl = raw.aiBaseUrl;
  if (raw.aiApiKey) env.aiApiKey = raw.aiApiKey;
  if (raw.aiModel) env.aiModel = raw.aiModel;
  if (raw.githubToken) env.githubToken = raw.githubToken;
  if (raw.maxDrillDownDepth) {
    env.maxDrillDownDepth = parseBoundedInt(raw.maxDrillDownDepth, DEFAULT_SETTINGS.maxDrillDownDepth, 0, 6);
  }
  if (raw.keySubFunctionCount) {
    env.keySubFunctionCount = parseBoundedInt(raw.keySubFunctionCount, DEFAULT_SETTINGS.keySubFunctionCount, 1, 30);
  }
  if (raw.retryMaxRetries) {
    env.retryMaxRetries = parseBoundedInt(raw.retryMaxRetries, DEFAULT_SETTINGS.retryMaxRetries, 0, 10);
  }
  if (raw.retryBaseDelayMs) {
    env.retryBaseDelayMs = parseBoundedInt(raw.retryBaseDelayMs, DEFAULT_SETTINGS.retryBaseDelayMs, 100, 10000);
  }

  return env;
})();

export const getEnvSettings = (): Partial<AppSettings> => ENV_SETTINGS;

export const resolveAppSettings = (): AppSettingsResolved => {
  const persisted = readPersistedSettings();
  const env = ENV_SETTINGS;
  const effective = normalizeSettings({ ...persisted, ...ENV_SETTINGS });
  return { effective, env, persisted };
};

export const getAppSettings = () => {
  if (!isBrowser()) return DEFAULT_SETTINGS;
  const localRaw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (localRaw === cachedLocalRaw) {
    return cachedEffective;
  }

  const persisted = readPersistedSettings();
  cachedEffective = normalizeSettings({ ...persisted, ...ENV_SETTINGS });
  cachedLocalRaw = localRaw;
  return cachedEffective;
};

export const reconcileAppSettingsWithEnv = () => {
  if (!isBrowser()) return;
  const resolved = resolveAppSettings();
  const persistedRaw = JSON.stringify(resolved.persisted);
  const effectiveRaw = JSON.stringify(resolved.effective);
  if (persistedRaw !== effectiveRaw) {
    writePersistedSettings(resolved.effective);
    cachedLocalRaw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    cachedEffective = resolved.effective;
    listeners.forEach((listener) => listener());
  }
};

export const saveAppSettings = (patch: Partial<AppSettings>) => {
  const currentPersisted = readPersistedSettings();
  const nextPersisted = normalizeSettings({ ...currentPersisted, ...patch });
  writePersistedSettings(nextPersisted);
  cachedLocalRaw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  cachedEffective = normalizeSettings({ ...nextPersisted, ...ENV_SETTINGS });
  listeners.forEach((listener) => listener());
};

export const resetAppSettings = () => {
  writePersistedSettings(DEFAULT_SETTINGS);
  cachedLocalRaw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  cachedEffective = normalizeSettings({ ...DEFAULT_SETTINGS, ...ENV_SETTINGS });
  listeners.forEach((listener) => listener());
};

export const subscribeAppSettings = (listener: () => void) => {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key === SETTINGS_STORAGE_KEY) {
      cachedLocalRaw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      const persisted = readPersistedSettings();
      cachedEffective = normalizeSettings({ ...persisted, ...ENV_SETTINGS });
      listener();
    }
  };

  if (isBrowser()) {
    window.addEventListener('storage', onStorage);
  }

  return () => {
    listeners.delete(listener);
    if (isBrowser()) {
      window.removeEventListener('storage', onStorage);
    }
  };
};

export const getAppSettingsServerSnapshot = () => DEFAULT_SETTINGS;

export const getDefaultAppSettings = () => DEFAULT_SETTINGS;
