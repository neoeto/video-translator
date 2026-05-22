import { useEffect, useState } from 'react'
import { usePipelineStore } from './store/usePipelineStore'
import { InputView } from './components/InputView'
import { ProgressView } from './components/ProgressView'
import { ResultView } from './components/ResultView'
import { SettingsView } from './components/SettingsView'
import { SideNavBar } from './components/SideNavBar'
import { TopAppBar } from './components/TopAppBar'
import { useI18n } from './i18n'
import './index.css'

function App() {
  const stage = usePipelineStore((s) => s.state.stage)
  const loadConfig = usePipelineStore((s) => s.loadConfig)
  const configLocale = usePipelineStore((s) => s.config.locale)
  const isLoadingConfig = usePipelineStore((s) => s.isLoadingConfig)
  const initLocale = useI18n((s) => s.initLocale)
  const t = useI18n((s) => s.t)
  const [activeView, setActiveView] = useState<'home' | 'processing' | 'library' | 'settings'>('home')

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
    // 流水线阶段驱动页面自动跳转，让用户无需手动切到进度页或结果页。
    if (stage === 'completed') {
      setActiveView('library')
    } else if (stage === 'idle') {
      setActiveView('home')
    } else if (stage !== 'error') {
      setActiveView('processing')
    }
  }, [stage])

  const getViewTitle = () => {
    switch (activeView) {
      case 'home': return t('app.views.home')
      case 'processing': return t('app.views.processing')
      case 'library': return t('app.views.library')
      case 'settings': return t('app.views.settings')
      default: return ''
    }
  }

  const handleNavigate = (view: string) => {
    if (view === 'home' || view === 'processing' || view === 'library' || view === 'settings') {
      setActiveView(view)
    }
  }

  return (
    <div className="min-h-screen bg-background text-on-background flex flex-row font-body">
      <SideNavBar activeView={activeView} onNavigate={handleNavigate} />
      
      <div className="flex-1 ml-sidebar-width flex flex-col min-w-0">
        <TopAppBar title={getViewTitle()} />
        
        <main className="flex-1 overflow-auto bg-background">
          {activeView === 'home' && <InputView onNavigate={handleNavigate} />}
          {activeView === 'processing' && <ProgressView />}
          {activeView === 'library' && <ResultView />}
          {activeView === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  )
}

export default App
