'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Github, Search, AlertCircle, Languages } from 'lucide-react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [lang, setLang] = useState<'en' | 'zh'>('zh');
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
      errInvalid: 'Invalid URL format'
    },
    zh: {
      title: 'GitHub 代码分析器',
      subtitle: '即刻可视化并探索任何 GitHub 仓库的结构与代码。',
      placeholder: 'https://github.com/owner/repository',
      analyzeBtn: '分析',
      errEmpty: '请输入 GitHub 仓库 URL',
      errDomain: '请输入有效的 github.com URL',
      errFormat: 'URL 必须包含所有者和仓库名称',
      errInvalid: '无效的 URL 格式'
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
      
      // Navigate to analyze page with the URL as a query parameter
      router.push(`/analyze?url=${encodeURIComponent(url)}&lang=${lang}`);
    } catch {
      setError(t[lang].errInvalid);
    }
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

      <div className="max-w-2xl w-full space-y-8 text-center">
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
      </div>
    </div>
  );
}
