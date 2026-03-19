'use client';

import { useSyncExternalStore } from 'react';
import {
  getAppSettings,
  getAppSettingsServerSnapshot,
  resolveAppSettings,
  subscribeAppSettings,
  type AppSettings,
} from '@/lib/appSettings';

export const useAppSettings = (): {
  settings: AppSettings;
  envSettings: Partial<AppSettings>;
} => {
  const settings = useSyncExternalStore(
    subscribeAppSettings,
    getAppSettings,
    getAppSettingsServerSnapshot
  );

  const envSettings = resolveAppSettings().env;

  return { settings, envSettings };
};
