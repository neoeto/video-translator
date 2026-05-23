import React, { useState } from 'react'
import { usePipelineStore } from '../store/usePipelineStore'
import { useI18n } from '../i18n'

type SettingsTab = 'ai-services' | 'translation' | 'tts' | 'subtitles' | 'system'

export const SettingsView: React.FC = () => {
  const { config, saveConfig } = usePipelineStore()
  const t = useI18n((s) => s.t)
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai-services')
  const [showOpenAiKey, setShowOpenAiKey] = useState(false)
  const [showDeepseekKey, setShowDeepseekKey] = useState(false)
  const [showGlmKey, setShowGlmKey] = useState(false)

  const handleSelectDirectory = async () => {
    const dir = await window.electronAPI.selectDirectory()
    if (dir) {
      saveConfig({ outputDir: dir })
    }
  }

  const tabs: { id: SettingsTab; icon: string; label: string }[] = [
    { id: 'ai-services', icon: 'smart_toy', label: t('settings.tabs.aiServices') },
    { id: 'translation', icon: 'translate', label: t('settings.tabs.translation') },
    { id: 'tts', icon: 'record_voice_over', label: t('settings.tabs.tts') },
    { id: 'subtitles', icon: 'subtitles', label: t('settings.tabs.subtitles') },
    { id: 'system', icon: 'dns', label: t('settings.tabs.system') },
  ]

  // 下方按 transcribeMode/translateMode/ttsMode 条件挂载配置项，避免隐藏字段让用户误以为会生效。
  // 未选择模式时沿用默认 OpenAI/Edge 分支，兼容旧配置和首次启动的空值。
  // proxyEnabled 直接基于持久化配置取反，避免为开关再维护一份易失本地状态。
  return (
    <div className="max-w-5xl mx-auto p-container-padding">
      <div className="mb-unit-lg">
        <h2 className="text-2xl font-semibold text-on-surface">{t('settings.heading')}</h2>
        <p className="text-sm text-on-surface-variant mt-1">
          {t('settings.description')}
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-unit-lg items-start">
        <nav className="w-full md:w-56 shrink-0 bg-surface-container rounded-lg border border-outline-variant/30 overflow-hidden sticky top-0">
          <ul className="flex flex-col">
            {tabs.map((tab) => (
              <li key={tab.id}>
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                    activeTab === tab.id
                      ? 'bg-surface-variant border-l-2 border-primary text-on-surface font-semibold'
                      : 'border-l-2 border-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px]">{tab.icon}</span>
                  <span className="text-[13px]">{tab.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex-1 space-y-unit-lg min-w-0">
          {activeTab === 'ai-services' && (
            <section className="bg-surface-container rounded-xl border border-outline-variant/40 p-unit-lg shadow-sm">
              <div className="border-b border-outline-variant/30 pb-4 mb-6">
                <h3 className="text-lg font-semibold text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">smart_toy</span>
                  {t('settings.aiServices.transcriptionEngine')}
                </h3>
                <p className="text-[13px] text-on-surface-variant mt-1">
                  {t('settings.aiServices.transcriptionDescription')}
                </p>
              </div>

              <div className="mb-6">
                <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                  {t('settings.aiServices.engineType')}
                </label>
                <div className="flex bg-surface-container-lowest rounded-lg p-1 border border-outline-variant/50 max-w-2xl">
                  <button
                    onClick={() => saveConfig({ transcribeMode: 'openai' })}
                    className={`flex-1 py-2 px-4 rounded-md text-[13px] font-semibold transition-all ${
                      config.transcribeMode === 'openai' || !config.transcribeMode
                        ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {t('settings.aiServices.openaiWhisperApi')}
                  </button>
                  <button
                    onClick={() => saveConfig({ transcribeMode: 'local-api' })}
                    className={`flex-1 py-2 px-4 rounded-md text-[13px] font-semibold transition-all ${
                      config.transcribeMode === 'local-api'
                        ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {t('settings.aiServices.localApiServer')}
                  </button>
                  <button
                    onClick={() => saveConfig({ transcribeMode: 'local-cli' })}
                    className={`flex-1 py-2 px-4 rounded-md text-[13px] font-semibold transition-all ${
                      config.transcribeMode === 'local-cli'
                        ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {t('settings.aiServices.localCli')}
                  </button>
                  <button
                    onClick={() => saveConfig({ transcribeMode: 'whisperx' })}
                    className={`flex-1 py-2 px-4 rounded-md text-[13px] font-semibold transition-all ${
                      config.transcribeMode === 'whisperx'
                        ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {t('settings.aiServices.whisperx')}
                  </button>
                </div>
              </div>

              {(config.transcribeMode === 'openai' || !config.transcribeMode) && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                      {t('settings.aiServices.apiKey')}
                    </label>
                    <div className="flex gap-2 max-w-2xl">
                      <input
                        type={showOpenAiKey ? 'text' : 'password'}
                        value={config.openaiApiKey || ''}
                        onChange={(e) => saveConfig({ openaiApiKey: e.target.value })}
                        placeholder="sk-..."
                        className="flex-1 bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOpenAiKey(!showOpenAiKey)}
                        className="px-4 py-2 bg-surface-variant border border-outline-variant rounded-md text-on-surface text-[13px] hover:bg-surface-container-high transition-colors"
                      >
                        {showOpenAiKey ? t('settings.actions.hide') : t('settings.actions.show')}
                      </button>
                    </div>
                    <p className="text-[12px] text-on-surface-variant mt-1">
                      {t('settings.aiServices.secureKeyHelp')}
                    </p>
                  </div>
                </div>
              )}

              {config.transcribeMode === 'local-api' && (
                <div className="space-y-4 max-w-2xl">
                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                      {t('settings.aiServices.apiServerUrl')}
                    </label>
                    <input
                      type="text"
                      value={config.localWhisperApiUrl || ''}
                      onChange={(e) => saveConfig({ localWhisperApiUrl: e.target.value })}
                      placeholder="http://localhost:9000"
                      className="w-full bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              )}

              {config.transcribeMode === 'local-cli' && (
                <div className="space-y-4 max-w-2xl">
                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                      {t('settings.aiServices.cliCommandPath')}
                    </label>
                    <input
                      type="text"
                      value={config.localWhisperCliPath || ''}
                      onChange={(e) => saveConfig({ localWhisperCliPath: e.target.value })}
                      placeholder="whisper"
                      className="w-full bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              )}

              {config.transcribeMode === 'whisperx' && (
                <div className="space-y-4 max-w-2xl">
                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                      {t('settings.aiServices.whisperxPath')}
                    </label>
                    <input
                      type="text"
                      value={config.whisperxPath || ''}
                      onChange={(e) => saveConfig({ whisperxPath: e.target.value })}
                      placeholder="whisperx"
                      className="w-full bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                    />
                    <p className="text-[12px] text-on-surface-variant mt-1">
                      {t('settings.aiServices.whisperxPathHelp')}
                    </p>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                      {t('settings.aiServices.whisperxHfToken')}
                    </label>
                    <input
                      type="password"
                      value={config.whisperxHfToken || ''}
                      onChange={(e) => saveConfig({ whisperxHfToken: e.target.value })}
                      placeholder="hf_xxxxxxxxxxxxxxxx"
                      className="w-full bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                    />
                    <p className="text-[12px] text-on-surface-variant mt-1">
                      {t('settings.aiServices.whisperxHfTokenHelp')}
                    </p>
                  </div>
                </div>
              )}
            </section>
          )}

          {activeTab === 'translation' && (
            <section className="bg-surface-container rounded-xl border border-outline-variant/40 p-unit-lg shadow-sm">
              <div className="border-b border-outline-variant/30 pb-4 mb-6">
                <h3 className="text-lg font-semibold text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">translate</span>
                  {t('settings.translation.model')}
                </h3>
                <p className="text-[13px] text-on-surface-variant mt-1">
                  {t('settings.translation.description')}
                </p>
              </div>

              <div className="space-y-4 max-w-2xl">
                <div>
                  <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                    {t('settings.translation.targetProvider')}
                  </label>
                  <div className="flex bg-surface-container-lowest rounded-lg p-1 border border-outline-variant/50">
                    {(['openai', 'deepseek', 'glm'] as const).map((mode) => {
                      const labels = { openai: 'OpenAI', deepseek: 'DeepSeek', glm: 'GLM 智谱' }
                      return (
                        <button
                          key={mode}
                          onClick={() => saveConfig({ translateMode: mode })}
                          className={`flex-1 py-2 px-3 rounded-md text-[13px] font-semibold transition-all ${
                            config.translateMode === mode || (!config.translateMode && mode === 'openai')
                              ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                              : 'text-on-surface-variant hover:text-on-surface'
                          }`}
                        >
                          {labels[mode]}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {(config.translateMode === 'openai' || !config.translateMode) && (
                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                      {t('settings.translation.modelName')}
                    </label>
                    <input
                      type="text"
                      value={config.openaiModel || ''}
                      onChange={(e) => saveConfig({ openaiModel: e.target.value })}
                      placeholder="gpt-4o"
                      className="w-full bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                    />
                  </div>
                )}

                {config.translateMode === 'deepseek' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                        {t('settings.aiServices.apiKey')}
                      </label>
                      <div className="flex gap-2">
                        <input
                          type={showDeepseekKey ? 'text' : 'password'}
                          value={config.deepseekApiKey || ''}
                          onChange={(e) => saveConfig({ deepseekApiKey: e.target.value })}
                          placeholder={t('settings.translation.deepseekApiKeyPlaceholder')}
                          className="flex-1 bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowDeepseekKey(!showDeepseekKey)}
                          className="px-3 py-2 bg-surface-variant border border-outline-variant rounded-md text-on-surface text-[13px] hover:bg-surface-container-high transition-colors"
                        >
                          {showDeepseekKey ? t('settings.actions.hide') : t('settings.actions.show')}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                        {t('settings.translation.modelName')}
                      </label>
                      <input
                        type="text"
                        value={config.deepseekModel || ''}
                        onChange={(e) => saveConfig({ deepseekModel: e.target.value })}
                        placeholder="deepseek-chat"
                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                )}

                {config.translateMode === 'glm' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                        {t('settings.aiServices.apiKey')}
                      </label>
                      <div className="flex gap-2">
                        <input
                          type={showGlmKey ? 'text' : 'password'}
                          value={config.glmApiKey || ''}
                          onChange={(e) => saveConfig({ glmApiKey: e.target.value })}
                          placeholder={t('settings.translation.glmApiKeyPlaceholder')}
                          className="flex-1 bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowGlmKey(!showGlmKey)}
                          className="px-3 py-2 bg-surface-variant border border-outline-variant rounded-md text-on-surface text-[13px] hover:bg-surface-container-high transition-colors"
                        >
                          {showGlmKey ? t('settings.actions.hide') : t('settings.actions.show')}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                        {t('settings.translation.modelName')}
                      </label>
                      <input
                        type="text"
                        value={config.glmModel || ''}
                        onChange={(e) => saveConfig({ glmModel: e.target.value })}
                        placeholder="glm-4-flash"
                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'tts' && (
            <section className="bg-surface-container rounded-xl border border-outline-variant/40 p-unit-lg shadow-sm">
              <div className="border-b border-outline-variant/30 pb-4 mb-6">
                <h3 className="text-lg font-semibold text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">record_voice_over</span>
                  {t('settings.tts.engine')}
                </h3>
                <p className="text-[13px] text-on-surface-variant mt-1">
                  {t('settings.tts.description')}
                </p>
              </div>

              <div className="space-y-4 max-w-2xl">
                <div>
                  <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                    {t('settings.tts.synthesizerProvider')}
                  </label>
                  <div className="flex bg-surface-container-lowest rounded-lg p-1 border border-outline-variant/50">
                    <button
                      onClick={() => saveConfig({ ttsMode: 'edge' })}
                      className={`flex-1 py-2 px-4 rounded-md text-[13px] font-semibold transition-all ${
                        config.ttsMode === 'edge' || !config.ttsMode
                          ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {t('settings.tts.edge')}
                    </button>
                    <button
                      onClick={() => saveConfig({ ttsMode: 'openai' })}
                      className={`flex-1 py-2 px-4 rounded-md text-[13px] font-semibold transition-all ${
                        config.ttsMode === 'openai'
                          ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {t('settings.tts.openai')}
                    </button>
                    <button
                      onClick={() => saveConfig({ ttsMode: 'indextts' })}
                      className={`flex-1 py-2 px-4 rounded-md text-[13px] font-semibold transition-all ${
                        config.ttsMode === 'indextts'
                          ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {t('settings.tts.indextts')}
                    </button>
                  </div>
                </div>

                {config.ttsMode === 'openai' && (
                  <p className="text-[12px] text-on-surface-variant">
                    {t('settings.tts.openaiKeyHelp')}
                  </p>
                )}

                {config.ttsMode === 'indextts' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                        {t('settings.tts.indextts.apiUrl')}
                      </label>
                      <input
                        type="text"
                        value={config.indexttsApiUrl || ''}
                        onChange={(e) => saveConfig({ indexttsApiUrl: e.target.value })}
                        placeholder={t('settings.tts.indextts.apiUrlPlaceholder')}
                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                      />
                      <p className="text-[12px] text-on-surface-variant mt-1">
                        {t('settings.tts.indextts.apiUrlHelp')}
                      </p>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                        {t('settings.tts.indextts.referenceAudio')}
                      </label>
                      <input
                        type="text"
                        value={config.indexttsReferenceAudio || ''}
                        onChange={(e) => saveConfig({ indexttsReferenceAudio: e.target.value })}
                        placeholder={t('settings.tts.indextts.referenceAudioPlaceholder')}
                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                      />
                      <p className="text-[12px] text-on-surface-variant mt-1">
                        {t('settings.tts.indextts.referenceAudioHelp')}
                      </p>
                    </div>
                  </div>
                )}

                <div className="mt-6 pt-6 border-t border-outline-variant/30">
                  <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                    {t('settings.tts.syncMode')}
                  </label>
                  <div className="flex bg-surface-container-lowest rounded-lg p-1 border border-outline-variant/50">
                    <button
                      onClick={() => saveConfig({ syncMode: 'natural' })}
                      className={`flex-1 py-2 px-4 rounded-md text-[13px] font-semibold transition-all ${
                        config.syncMode === 'natural' || !config.syncMode
                          ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {t('settings.tts.syncNatural')}
                    </button>
                    <button
                      onClick={() => saveConfig({ syncMode: 'strict' })}
                      className={`flex-1 py-2 px-4 rounded-md text-[13px] font-semibold transition-all ${
                        config.syncMode === 'strict'
                          ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {t('settings.tts.syncStrict')}
                    </button>
                  </div>
                  <p className="text-[12px] text-on-surface-variant mt-2">
                    {config.syncMode === 'strict' ? t('settings.tts.syncStrictHelp') : t('settings.tts.syncNaturalHelp')}
                  </p>
                </div>

                <div className="mt-6 pt-6 border-t border-outline-variant/30">
                  <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                    {t('settings.tts.audioMixMode')}
                  </label>
                  <div className="flex bg-surface-container-lowest rounded-lg p-1 border border-outline-variant/50">
                    <button
                      onClick={() => saveConfig({ audioMixMode: 'replace' })}
                      className={`flex-1 py-2 px-3 rounded-md text-[13px] font-semibold transition-all ${
                        config.audioMixMode === 'replace'
                          ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {t('settings.tts.audioMixReplace')}
                    </button>
                    <button
                      onClick={() => saveConfig({ audioMixMode: 'mix-gate' })}
                      className={`flex-1 py-2 px-3 rounded-md text-[13px] font-semibold transition-all ${
                        config.audioMixMode === 'mix-gate'
                          ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {t('settings.tts.audioMixGate')}
                    </button>
                    <button
                      onClick={() => saveConfig({ audioMixMode: 'mix-vocal-removal' })}
                      className={`flex-1 py-2 px-3 rounded-md text-[13px] font-semibold transition-all ${
                        config.audioMixMode === 'mix-vocal-removal'
                          ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {t('settings.tts.audioMixVocalRemoval')}
                    </button>
                  </div>
                  <p className="text-[12px] text-on-surface-variant mt-2">
                    {config.audioMixMode === 'mix-gate'
                      ? t('settings.tts.audioMixGateHelp')
                      : config.audioMixMode === 'mix-vocal-removal'
                        ? t('settings.tts.audioMixVocalRemovalHelp')
                        : t('settings.tts.audioMixReplaceHelp')}
                  </p>

                  {config.audioMixMode === 'mix-vocal-removal' && (
                    <div className="mt-4">
                      <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                        {t('settings.tts.audioSeparatorPath')}
                      </label>
                      <input
                        type="text"
                        value={config.audioSeparatorPath || ''}
                        onChange={(e) => saveConfig({ audioSeparatorPath: e.target.value })}
                        placeholder="audio-separator"
                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                      />
                      <p className="text-[12px] text-on-surface-variant mt-1">
                        {t('settings.tts.audioSeparatorPathHelp')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {activeTab === 'subtitles' && (
            <section className="bg-surface-container rounded-xl border border-outline-variant/40 p-unit-lg shadow-sm">
              <div className="border-b border-outline-variant/30 pb-4 mb-6">
                <h3 className="text-lg font-semibold text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">subtitles</span>
                  {t('settings.subtitles.heading')}
                </h3>
                <p className="text-[13px] text-on-surface-variant mt-1">
                  {t('settings.subtitles.description')}
                </p>
              </div>

              <div className="space-y-6 max-w-2xl">
                <div>
                  <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                    {t('settings.subtitles.enFontSize')}
                  </label>
                  <input
                    type="number"
                    min={8}
                    max={120}
                    value={config.subtitleStyle.enFontSize}
                    onChange={(e) => saveConfig({ subtitleStyle: { enFontSize: Number(e.target.value) } })}
                    className="w-32 bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                    {t('settings.subtitles.cnFontSize')}
                  </label>
                  <input
                    type="number"
                    min={8}
                    max={120}
                    value={config.subtitleStyle.cnFontSize}
                    onChange={(e) => saveConfig({ subtitleStyle: { cnFontSize: Number(e.target.value) } })}
                    className="w-32 bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                  />
                  <p className="text-[12px] text-on-surface-variant mt-1">
                    {t('settings.subtitles.fontSizeHelp')}
                  </p>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'system' && (
            <section className="bg-surface-container rounded-xl border border-outline-variant/40 p-unit-lg shadow-sm">
              <div className="border-b border-outline-variant/30 pb-4 mb-6">
                <h3 className="text-lg font-semibold text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">dns</span>
                  {t('settings.system.preferences')}
                </h3>
                <p className="text-[13px] text-on-surface-variant mt-1">
                  {t('settings.system.description')}
                </p>
              </div>

              <div className="space-y-6 max-w-2xl">
                <div>
                  <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                    {t('settings.system.workingDirectory')}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={config.outputDir || ''}
                      readOnly
                      placeholder={t('settings.system.selectDirectoryPlaceholder')}
                      className="flex-1 bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none cursor-not-allowed opacity-80"
                    />
                    <button
                      type="button"
                      onClick={handleSelectDirectory}
                      className="px-4 py-2 bg-transparent border border-outline-variant rounded-md text-on-surface text-[13px] hover:bg-surface-variant transition-colors flex items-center gap-2"
                    >
                      <span className="material-symbols-outlined text-[18px]">folder_open</span>
                      {t('settings.system.browse')}
                    </button>
                  </div>
                  <p className="text-[12px] text-on-surface-variant mt-1">
                    {t('settings.system.workingDirectoryHelp')}
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                    {t('settings.system.networkProxy')}
                  </label>
                  <div className="flex items-center gap-3 mb-3">
                    <button
                      type="button"
                      onClick={() => saveConfig({ proxyEnabled: !config.proxyEnabled })}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        config.proxyEnabled ? 'bg-primary-container' : 'bg-surface-variant'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-on-surface transition-transform ${
                          config.proxyEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <span className="text-sm text-on-surface-variant">
                      {config.proxyEnabled ? t('settings.system.enabled') : t('settings.system.disabled')}
                    </span>
                  </div>
                  {config.proxyEnabled && (
                    <>
                      <input
                        type="text"
                        value={config.proxyUrl || ''}
                        onChange={(e) => saveConfig({ proxyUrl: e.target.value })}
                        placeholder="http://127.0.0.1:7890"
                        className="w-full max-w-2xl bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                      />
                      <label className="text-xs font-medium text-on-surface-variant mt-3 block">
                        {t('settings.system.proxyBypass')}
                      </label>
                      <input
                        type="text"
                        value={config.proxyBypass || ''}
                        onChange={(e) => saveConfig({ proxyBypass: e.target.value })}
                        placeholder="localhost, 127.0.0.1, *.local"
                        className="w-full max-w-2xl bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors mt-1"
                      />
                      <p className="text-xs text-on-surface-variant mt-1">
                        {t('settings.system.proxyBypassHelp')}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
