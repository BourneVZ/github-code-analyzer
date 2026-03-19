'use client';

import { useEffect } from 'react';
import { reconcileAppSettingsWithEnv } from '@/lib/appSettings';

export function AppBootstrap() {
  useEffect(() => {
    reconcileAppSettingsWithEnv();
  }, []);

  return null;
}
