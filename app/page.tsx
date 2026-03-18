'use client';

import { useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Github, Search, AlertCircle, Languages, History, Clock3, Trash2 } from 'lucide-react';
import { getAnalysisHistory, getAnalysisHistoryServerSnapshot, removeAnalysisHistoryRecord, subscribeAnalysisHistory, type AnalysisHistoryRecord } from '@/lib/analysisHistory';

export default function Home() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [lang, setLang] = useState<'en' | 'zh'>('zh');
  const historyRecords = useSyncExternalStore(
    subscribeAnalysisHistory,
    getAnalysisHistory,
    getAnalysisHistoryServerSnapshot
  ) as AnalysisHistoryRecord[];
  const router = useRouter();

  const t = {
    en: {
      title: 'GitHub Code Analyzer',
      subtitle: "Visualize and explore any GitHub repository's structure and code instantly.",
      placeholder: 'https://github.com/owner/repository',
      analyzeBtn: 'Analyze',
      errEmpty: 'Please enter a GitHub repository URL',
      errDomain: 'Please enter a valid github.com URL',
      errFormat: 'URL must include owner and repository name',
      errInvalid: 'Invalid URL format',
      historyTitle: 'Analysis History',
      historyEmpty: 'No history yet. Analyze a repository to create one.',
      openHistory: 'Open Analysis',
      projectUrl: 'Project URL',
      language: 'Language',
    },
    zh: {
      title: 'GitHub 代码分析器',
      subtitle: '可视化并探索任意 GitHub 仓库的结构与代码。',
      placeholder: 'https://github.com/owner/repository',
      analyzeBtn: '分析',
      errEmpty: '请输入 GitHub 仓库 URL',
      errDomain: '请输入有效的 github.com URL',
      errFormat: 'URL 必须包含所有者和仓库名',
      errInvalid: '无效的 URL 格式',
      historyTitle: '历史分析记录',
      historyEmpty: '暂无历史记录，先分析一个仓库吧。',
      openHistory: '打开分析',
      projectUrl: '项目地址',
      language: '编程语言',
    }
  };

  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!url.trim()) {
      setError(t[lang].errEmpty);
      return;
    }

    try {
      const parsed = new URL(url);
      if (parsed.hostname !== 'github.com') {
        setError(t[lang].errDomain);
        return;
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length < 2) {
        setError(t[lang].errFormat);
        return;
      }

      router.push(`/analyze?url=${encodeURIComponent(url)}&lang=${lang}`);
    } catch {
      setError(t[lang].errInvalid);
    }
  };

  const openHistoryRecord = (record: AnalysisHistoryRecord) => {
    router.push(
      `/analyze?historyId=${encodeURIComponent(record.id)}&url=${encodeURIComponent(record.projectUrl)}&lang=${lang}`
    );
  };

  const deleteHistoryRecord = (e: React.MouseEvent, record: AnalysisHistoryRecord) => {
    e.stopPropagation();
    const confirmed = window.confirm(
      lang === 'en' ? 'Delete this history record?' : '确定删除这条历史记录吗？'
    );
    if (!confirmed) return;
    removeAnalysisHistoryRecord(record.id);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 relative">
      <button
        onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
        className="absolute top-4 right-4 flex items-center px-3 py-1.5 bg-white border border-slate-200 rounded-full text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
      >
        <Languages className="w-4 h-4 mr-1.5 text-indigo-500" />
        {lang === 'en' ? '中文' : 'English'}
      </button>

      <div className="max-w-4xl w-full space-y-8 text-center">
        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="bg-indigo-600 p-4 rounded-2xl shadow-lg shadow-indigo-200">
            <Github className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            {t[lang].title}
          </h1>
          <p className="text-lg text-slate-600 max-w-xl mx-auto">
            {t[lang].subtitle}
          </p>
        </div>

        <form onSubmit={handleAnalyze} className="mt-8 max-w-xl mx-auto w-full">
          <div className="relative flex items-center">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-slate-400" />
            </div>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="block w-full pl-11 pr-32 py-4 text-base rounded-xl border-slate-200 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 bg-white"
              placeholder={t[lang].placeholder}
            />
            <button
              type="submit"
              className="absolute right-2 top-2 bottom-2 px-6 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
            >
              {t[lang].analyzeBtn}
            </button>
          </div>
          {error && (
            <div className="mt-3 flex items-center justify-center text-red-500 text-sm">
              <AlertCircle className="w-4 h-4 mr-1.5" />
              {error}
            </div>
          )}
        </form>

        <section className="max-w-4xl mx-auto w-full mt-8 text-left">
          <div className="flex items-center mb-4">
            <History className="w-5 h-5 text-indigo-500 mr-2" />
            <h2 className="text-lg font-semibold text-slate-900">{t[lang].historyTitle}</h2>
          </div>

          {historyRecords.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-5 text-sm text-slate-500">
              {t[lang].historyEmpty}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {historyRecords.map((record) => {
                const primaryLanguage =
                  record.aiAnalysis?.primaryLanguage_zh ||
                  record.aiAnalysis?.primaryLanguage_en ||
                  'N/A';

                return (
                  <div
                    key={record.id}
                    onClick={() => openHistoryRecord(record)}
                    className="relative w-full text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition-all cursor-pointer"
                  >
                    <button
                      type="button"
                      onClick={(e) => deleteHistoryRecord(e, record)}
                      title={lang === 'en' ? 'Delete' : '删除'}
                      aria-label={lang === 'en' ? 'Delete history' : '删除历史记录'}
                      className="absolute top-3 right-3 p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <div className="font-semibold text-slate-900 truncate mb-1">{record.projectName}</div>
                    <div className="text-xs text-slate-500 break-all mb-3">
                      {t[lang].projectUrl}: {record.projectUrl}
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
                      <span>{t[lang].language}: {primaryLanguage}</span>
                      <span className="inline-flex items-center text-slate-500">
                        <Clock3 className="w-3.5 h-3.5 mr-1" />
                        {new Date(record.savedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-indigo-600 font-medium">{t[lang].openHistory}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
