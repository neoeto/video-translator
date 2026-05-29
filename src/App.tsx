import { useEffect, useRef, useState } from 'react'
import { usePipelineStore } from './store/usePipelineStore'
import { InputView } from './components/InputView'
import { ProgressView } from './components/ProgressView'
import { ResultView } from './components/ResultView'
import { SettingsView } from './components/SettingsView'
import { VideoDetailView } from './components/VideoDetailView'
import { SideNavBar } from './components/SideNavBar'
import { TopAppBar } from './components/TopAppBar'
import { useI18n } from './i18n'
import './index.css'

function App() {
  const stage = usePipelineStore((s) => s.state.stage)
  const queueState = usePipelineStore((s) => s.queueState)
  const loadConfig = usePipelineStore((s) => s.loadConfig)
  const configLocale = usePipelineStore((s) => s.config.locale)
  const configThemeMode = usePipelineStore((s) => s.config.themeMode)
  const isLoadingConfig = usePipelineStore((s) => s.isLoadingConfig)
  const initLocale = useI18n((s) => s.initLocale)
  const t = useI18n((s) => s.t)
  const [activeView, setActiveView] = useState<'home' | 'processing' | 'library' | 'settings' | 'detail'>('home')
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null)
  const prevStageRef = useRef(stage)

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    // i18n 必须等配置加载结束后初始化，否则会先用默认语言渲染再被持久化语言覆盖。
    if (!isLoadingConfig) {
      initLocale(configLocale)
    }
  }, [configLocale, initLocale, isLoadingConfig])

  useEffect(() => {
    document.title = t('app.title')
  }, [t])

  useEffect(() => {
    const html = document.documentElement

    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        html.classList.add('dark')
        html.style.colorScheme = 'dark'
      } else {
        html.classList.remove('dark')
        html.style.colorScheme = 'light'
      }
    }

    if (configThemeMode === 'dark') {
      applyTheme(true)
    } else if (configThemeMode === 'light') {
      applyTheme(false)
    } else {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      applyTheme(mq.matches)
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches)
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [configThemeMode])

  const wasProcessingRef = useRef(false)

  useEffect(() => {
    const prevStage = prevStageRef.current
    prevStageRef.current = stage

    // Auto-navigate to processing only on first task start (idle/completed → downloading)
    if ((prevStage === 'idle' || prevStage === 'completed') && stage === 'downloading') {
      setActiveView('processing')
    }
  }, [stage])

  useEffect(() => {
    // Track when we have active tasks
    if (queueState.active) {
      wasProcessingRef.current = true
    }

    // Auto-navigate to library when all tasks complete (not on error — let user see it)
    if (wasProcessingRef.current && !queueState.active && queueState.pending.length === 0 && stage !== 'error') {
      wasProcessingRef.current = false
      setActiveView('library')
    }
  }, [queueState, stage])

  const getViewTitle = () => {
    switch (activeView) {
      case 'home': return t('app.views.home')
      case 'processing': return t('app.views.processing')
      case 'library': return t('app.views.library')
      case 'detail': return t('result.detail.title')
      case 'settings': return t('app.views.settings')
      default: return ''
    }
  }

  const handleNavigate = (view: string, params?: { entryId?: string }) => {
    if (view === 'detail' && params?.entryId) {
      setDetailEntryId(params.entryId)
      setActiveView('detail')
    } else if (view === 'home' || view === 'processing' || view === 'library' || view === 'settings') {
      setActiveView(view)
    }
  }

  return (
    <div className="min-h-screen bg-background text-on-background flex flex-row font-body">
      <SideNavBar activeView={activeView === 'detail' ? 'library' : activeView} onNavigate={handleNavigate} />
      
      <div className="flex-1 ml-sidebar-width flex flex-col min-w-0">
        <TopAppBar title={getViewTitle()} />
        
        <main className="flex-1 overflow-auto bg-background">
          {activeView === 'home' && <InputView onNavigate={handleNavigate} />}
          {activeView === 'processing' && <ProgressView />}
          {activeView === 'library' && <ResultView onNavigate={handleNavigate} />}
          {activeView === 'detail' && detailEntryId && <VideoDetailView entryId={detailEntryId} onNavigate={handleNavigate} />}
          {activeView === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  )
}

export default App
