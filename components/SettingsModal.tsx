'use client';

import { useState } from 'react';
import { AlertCircle, RefreshCcw, Save, X } from 'lucide-react';
import { getDefaultAppSettings, saveAppSettings, type AppSettings } from '@/lib/appSettings';
import { useAppSettings } from '@/hooks/useAppSettings';

const maskSecret = (value: string) => {
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
};

export function SettingsModal({
  onClose,
  lang,
}: {
  onClose: () => void;
  lang: 'en' | 'zh';
}) {
  const { settings, envSettings } = useAppSettings();
  const defaults = getDefaultAppSettings();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [savedNotice, setSavedNotice] = useState('');

  const hasEnvOverride = (key: keyof AppSettings) => envSettings[key] !== undefined && envSettings[key] !== '';

  const envValue = (key: keyof AppSettings) => {
    const value = envSettings[key];
    if (value === undefined || value === null || value === '') return '';
    if (key === 'aiApiKey' || key === 'githubToken') return maskSecret(String(value));
    return String(value);
  };

  const t = {
    en: {
      title: 'Settings',
      subtitle: 'Environment variables override local persisted values at startup.',
      save: 'Save',
      reset: 'Reset Defaults',
      close: 'Close',
      saved: 'Settings saved.',
      envSource: 'From environment',
      githubTokenHint: 'Used to access private repositories and increase GitHub API rate limits.',
      fields: {
        aiBaseUrl: 'AI Base URL',
        aiApiKey: 'AI API Key',
        aiModel: 'AI Model Name',
        githubToken: 'GitHub Token',
        maxDrillDownDepth: 'Max Drill-down Depth',
        keySubFunctionCount: 'Key Child Function Count',
        retryMaxRetries: 'Retry Max Retries',
        retryBaseDelayMs: 'Retry BASE_DELAY_MS',
      },
    },
    zh: {
      title: '设置',
      subtitle: '项目启动时如果检测到环境变量，将覆盖本地持久化设置。',
      save: '保存',
      reset: '恢复默认',
      close: '关闭',
      saved: '设置已保存。',
      envSource: '来自环境变量',
      githubTokenHint: '用于访问私有仓库，以及提升 GitHub API 访问速率上限。',
      fields: {
        aiBaseUrl: 'AI Base URL',
        aiApiKey: 'AI API Key',
        aiModel: 'AI 模型名称',
        githubToken: 'GitHub Token',
        maxDrillDownDepth: '最大下钻层数',
        keySubFunctionCount: '关键调用子函数数量',
        retryMaxRetries: '失败后最大重试次数',
        retryBaseDelayMs: '重试 BASE_DELAY_MS',
      },
    },
  };

  const setNumber = (key: keyof AppSettings, value: string) => {
    const parsed = Number.parseInt(value, 10);
    setDraft((prev) => ({ ...prev, [key]: Number.isNaN(parsed) ? 0 : parsed }));
  };

  const onSave = () => {
    saveAppSettings(draft);
    setSavedNotice(t[lang].saved);
  };

  const onReset = () => {
    setDraft(defaults);
    saveAppSettings(defaults);
    setSavedNotice(t[lang].saved);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t[lang].title}</h2>
            <div className="text-xs text-slate-500 mt-1">{t[lang].subtitle}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-md hover:bg-slate-200 text-slate-500"
            title={t[lang].close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 max-h-[70vh] overflow-y-auto space-y-4">
          <SettingField
            label={t[lang].fields.aiBaseUrl}
            envTag={hasEnvOverride('aiBaseUrl') ? `${t[lang].envSource}: ${envValue('aiBaseUrl')}` : ''}
          >
            <input
              type="text"
              value={draft.aiBaseUrl}
              onChange={(e) => setDraft((prev) => ({ ...prev, aiBaseUrl: e.target.value }))}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </SettingField>

          <SettingField
            label={t[lang].fields.aiApiKey}
            envTag={hasEnvOverride('aiApiKey') ? `${t[lang].envSource}: ${envValue('aiApiKey')}` : ''}
          >
            <input
              type="password"
              value={draft.aiApiKey}
              onChange={(e) => setDraft((prev) => ({ ...prev, aiApiKey: e.target.value }))}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </SettingField>

          <SettingField
            label={t[lang].fields.aiModel}
            envTag={hasEnvOverride('aiModel') ? `${t[lang].envSource}: ${envValue('aiModel')}` : ''}
          >
            <input
              type="text"
              value={draft.aiModel}
              onChange={(e) => setDraft((prev) => ({ ...prev, aiModel: e.target.value }))}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </SettingField>

          <SettingField
            label={t[lang].fields.githubToken}
            envTag={hasEnvOverride('githubToken') ? `${t[lang].envSource}: ${envValue('githubToken')}` : ''}
            hint={t[lang].githubTokenHint}
          >
            <input
              type="password"
              value={draft.githubToken}
              onChange={(e) => setDraft((prev) => ({ ...prev, githubToken: e.target.value }))}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </SettingField>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SettingField
              label={t[lang].fields.maxDrillDownDepth}
              envTag={hasEnvOverride('maxDrillDownDepth') ? `${t[lang].envSource}: ${envValue('maxDrillDownDepth')}` : ''}
            >
              <input
                type="number"
                value={draft.maxDrillDownDepth}
                onChange={(e) => setNumber('maxDrillDownDepth', e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </SettingField>

            <SettingField
              label={t[lang].fields.keySubFunctionCount}
              envTag={hasEnvOverride('keySubFunctionCount') ? `${t[lang].envSource}: ${envValue('keySubFunctionCount')}` : ''}
            >
              <input
                type="number"
                value={draft.keySubFunctionCount}
                onChange={(e) => setNumber('keySubFunctionCount', e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </SettingField>

            <SettingField
              label={t[lang].fields.retryMaxRetries}
              envTag={hasEnvOverride('retryMaxRetries') ? `${t[lang].envSource}: ${envValue('retryMaxRetries')}` : ''}
            >
              <input
                type="number"
                value={draft.retryMaxRetries}
                onChange={(e) => setNumber('retryMaxRetries', e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </SettingField>

            <SettingField
              label={t[lang].fields.retryBaseDelayMs}
              envTag={hasEnvOverride('retryBaseDelayMs') ? `${t[lang].envSource}: ${envValue('retryBaseDelayMs')}` : ''}
            >
              <input
                type="number"
                value={draft.retryBaseDelayMs}
                onChange={(e) => setNumber('retryBaseDelayMs', e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </SettingField>
          </div>

          {savedNotice ? (
            <div className="flex items-center text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              <AlertCircle className="w-4 h-4 mr-2" />
              {savedNotice}
            </div>
          ) : null}
        </div>

        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onReset}
            className="h-9 px-3 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100 text-sm flex items-center"
          >
            <RefreshCcw className="w-4 h-4 mr-1.5" />
            {t[lang].reset}
          </button>
          <button
            type="button"
            onClick={onSave}
            className="h-9 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm flex items-center"
          >
            <Save className="w-4 h-4 mr-1.5" />
            {t[lang].save}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingField({
  label,
  envTag,
  hint,
  children,
}: {
  label: string;
  envTag?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-slate-700">{label}</label>
        {envTag ? (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            {envTag}
          </span>
        ) : null}
      </div>
      {children}
      {hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}
