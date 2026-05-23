import React, { useMemo, useState } from 'react'
import { usePipelineStore } from '../store/usePipelineStore'
import type { PipelineStage, SpeakerGender, SpeakerProfile } from '../types'
import { getLanguageDisplayName } from '../types'
import { useI18n } from '../i18n'

const ALL_STAGES: { id: PipelineStage; nameKey: string }[] = [
  { id: 'downloading', nameKey: 'progress.stages.downloading' },
  { id: 'extracting', nameKey: 'progress.stages.extracting' },
  { id: 'transcribing', nameKey: 'progress.stages.transcribing' },
  { id: 'translating', nameKey: 'progress.stages.translating' },
  { id: 'synthesizing', nameKey: 'progress.stages.synthesizing' },
  { id: 'separating-vocals', nameKey: 'progress.stages.separatingVocals' },
  { id: 'recombining', nameKey: 'progress.stages.recombining' },
]

const GENDER_OPTIONS: { value: SpeakerGender; labelKey: string }[] = [
  { value: 'adult-male', labelKey: 'speaker.adultMale' },
  { value: 'adult-female', labelKey: 'speaker.adultFemale' },
  { value: 'child-male', labelKey: 'speaker.childMale' },
  { value: 'child-female', labelKey: 'speaker.childFemale' },
]

const SpeakerLabelingPanel: React.FC<{
  profiles: SpeakerProfile[]
  onSubmit: (profiles: SpeakerProfile[]) => void
  t: (key: string) => string
}> = ({ profiles, onSubmit, t }) => {
  const [labels, setLabels] = useState<Record<string, SpeakerGender>>(() => {
    const init: Record<string, SpeakerGender> = {}
    for (const p of profiles) {
      init[p.id] = p.gender
    }
    return init
  })

  const allLabeled = profiles.every(p => labels[p.id])

  const handleSubmit = () => {
    const labeled = profiles.map(p => ({ ...p, gender: labels[p.id] }))
    onSubmit(labeled)
  }

  return (
    <div className="space-y-4">
      <h3 className="text-base font-bold text-on-surface mb-2">{t('speaker.title')}</h3>
      <p className="text-sm text-on-surface-variant mb-4">{t('speaker.description')}</p>
      {profiles.map(profile => (
        <div key={profile.id} className="flex items-center gap-4 p-3 bg-surface-container-lowest rounded-lg border border-surface-variant">
          <div className="flex-shrink-0">
            <span className="text-sm font-bold text-on-surface">{profile.id}</span>
          </div>
          {profile.sampleDataUrl && (
            <audio controls src={profile.sampleDataUrl} className="h-8 flex-shrink-0" />
          )}
          <div className="flex gap-2 flex-wrap flex-1">
            {GENDER_OPTIONS.map(opt => (
              <label key={opt.value} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name={`gender-${profile.id}`}
                  value={opt.value}
                  checked={labels[profile.id] === opt.value}
                  onChange={() => setLabels(prev => ({ ...prev, [profile.id]: opt.value }))}
                  className="accent-primary"
                />
                <span className="text-xs text-on-surface-variant">{t(opt.labelKey)}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
      <button
        onClick={handleSubmit}
        disabled={!allLabeled}
        className="mt-4 px-6 py-2 bg-primary text-on-primary hover:bg-primary/90 disabled:bg-surface-variant disabled:text-outline rounded-lg font-semibold transition-colors"
      >
        {t('speaker.continue')}
      </button>
    </div>
  )
}

export const ProgressView: React.FC = () => {
  const { state, config, queueState, cancelPipeline, skipError, removeQueued, submitSpeakerLabels, reset } = usePipelineStore()
  const t = useI18n((s) => s.t)

  const STAGES = useMemo(() =>
    config.pipelineMode === 'subtitleOnly'
      ? ALL_STAGES.filter(s => s.id !== 'synthesizing')
      : ALL_STAGES,
    [config.pipelineMode]
  )
  const currentStage = STAGES.find(s => s.id === state.stage)
  const taskId = useMemo(() => Date.now().toString().slice(-6), [])

  const getStageStatus = (stageId: PipelineStage) => {
    if (state.stage === 'error') return 'error'
    
    const stageIndex = STAGES.findIndex(s => s.id === stageId)
    const currentIndex = STAGES.findIndex(s => s.id === state.stage)
    
    // 阶段是线性流水线，用索引比较即可推断前序已完成、当前进行中、后续待处理。
    if (stageIndex < currentIndex || state.stage === 'completed') return 'completed'
    if (stageIndex === currentIndex) return 'active'
    return 'pending'
  }

  const renderIcon = (status: string) => {
    switch (status) {
      case 'completed': return <span className="material-symbols-outlined text-[16px] text-on-secondary-container">check</span>
      case 'active': return <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse"></div>
      case 'error': return <span className="material-symbols-outlined text-[16px] text-on-error-container">close</span>
      default: return <div className="w-2 h-2 rounded-full bg-surface-variant"></div>
    }
  }

  return (
    <div className="w-full max-w-5xl mx-auto pt-10 px-6">
      {state.stage === 'idle' ? (
        <div className="flex flex-col items-center justify-center py-32 text-outline">
          <span className="material-symbols-outlined text-[48px] mb-4 opacity-50">hourglass_empty</span>
          <p className="text-sm">{t('progress.noActiveTask')}</p>
        </div>
      ) : (
      <div className="bg-surface-container rounded-xl border border-surface-variant overflow-hidden sharp-shadow flex flex-col">
        
        <div className="p-6 border-b border-surface-variant flex justify-between items-start">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className={`px-2.5 py-1 rounded-sm text-xs font-bold tracking-widest uppercase ${
                state.stage === 'error' ? 'bg-error-container text-on-error-container' : 'bg-primary-container text-on-primary-container'
              }`}>
                {state.stage === 'error' ? t('progress.status.error') : t('progress.status.processing')}
              </span>
              <span className="text-on-surface-variant text-sm font-medium">{t('progress.taskId')}: #{taskId}</span>
            </div>
            <h2 className="text-xl font-bold text-on-surface line-clamp-1" title={state.videoTitle || t('progress.processingVideoTitle')}>
              {state.videoTitle || t('progress.processingVideo')}
            </h2>
            {state.translatedTitle && (
              <p className="text-sm text-on-surface-variant line-clamp-1 mt-0.5" title={state.translatedTitle}>
                {state.translatedTitle}
              </p>
            )}
          </div>
          
          <div className="text-right flex flex-col items-end">
            <div className="text-3xl font-bold text-primary tracking-tight">{Math.round(state.overallProgress)}%</div>
            <div className="text-sm text-on-surface-variant mt-1 font-medium">{t('progress.overallProgress')}</div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row min-h-[300px]">
          <div className="w-full lg:w-1/3 bg-surface-container-lowest p-6 flex items-center justify-center border-r border-surface-variant">
            <div className="aspect-video w-full max-w-xs bg-surface-variant rounded-lg flex items-center justify-center border border-outline-variant overflow-hidden relative">
              {state.thumbnailDataUrl ? (
                <img src={state.thumbnailDataUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <span className="material-symbols-outlined text-[48px] text-outline opacity-50">movie</span>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0e0e0e]/80 to-transparent flex items-end p-4">
                 <span className="text-xs text-on-surface font-mono bg-black/60 px-2 py-1 rounded">
                   {getLanguageDisplayName(config.sourceLanguage, config.locale)} → {getLanguageDisplayName(config.targetLanguage, config.locale)}
                 </span>
              </div>
            </div>
          </div>

          <div className="flex-1 p-8 bg-surface-container-low flex flex-col justify-center">
            
            {state.stage === 'error' ? (
              <div className="p-5 bg-error-container/10 border border-error-container rounded-lg flex items-start gap-4 mb-6">
                <span className="material-symbols-outlined text-error text-[24px]">error</span>
                <div className="flex-1">
                  <h3 className="font-bold text-error mb-1">{t('progress.processingError')}</h3>
                  <p className="text-sm text-error/80">{state.error || t('progress.unknownError')}</p>
                </div>
              </div>
            ) : state.stage === 'awaiting-speaker-labels' ? (
              <SpeakerLabelingPanel
                profiles={state.speakerProfiles || []}
                onSubmit={submitSpeakerLabels}
                t={t}
              />
            ) : (
              <div className="mb-10">
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-bold text-on-surface">
                    {currentStage ? t(currentStage.nameKey) : t('progress.processing')}
                  </span>
                  <span className="text-sm font-mono text-primary">{Math.round(state.progress)}%</span>
                </div>
                <div className="w-full bg-surface-variant rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-primary h-2 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${state.progress}%` }}
                  ></div>
                </div>
              </div>
            )}

            <div className="relative w-full mt-4">
              {/* Background connector line spanning all nodes */}
              <div className="absolute left-0 right-0 flex items-center" style={{ top: 15 }}>
                <div className="w-full h-[2px] bg-surface-variant rounded-full mx-4" />
              </div>
              {/* Completed portion overlay */}
              {(() => {
                const currentIndex = STAGES.findIndex(s => s.id === state.stage)
                const completedCount = state.stage === 'completed' ? STAGES.length : currentIndex
                if (completedCount <= 0) return null
                const pct = (completedCount / (STAGES.length - 1)) * 100
                return (
                  <div className="absolute left-0 flex items-center" style={{ top: 15, width: `${pct}%` }}>
                    <div className="w-full h-[2px] bg-secondary-container rounded-full mx-4" />
                  </div>
                )
              })()}
              <div className="relative flex justify-between">
                {STAGES.map((stage) => {
                  const status = getStageStatus(stage.id)
                  return (
                    <div key={stage.id} className="flex flex-col items-center z-10">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors duration-300 ${
                        status === 'completed' ? 'bg-secondary-container border-secondary-container' :
                        status === 'active' ? 'bg-primary-container/20 border-primary shadow-[0_0_12px_rgba(173,198,255,0.4)]' :
                        status === 'error' && state.stage === stage.id ? 'bg-error-container/20 border-error' :
                        'bg-surface-container-lowest border-outline-variant'
                      }`}>
                        {renderIcon(status === 'error' && state.stage === stage.id ? 'error' : status)}
                      </div>
                      <div className="mt-2 w-20 text-center">
                        <span className={`text-[11px] font-bold uppercase tracking-wider ${
                          status === 'completed' ? 'text-secondary' :
                          status === 'active' ? 'text-primary' :
                          status === 'error' && state.stage === stage.id ? 'text-error' :
                          'text-outline-variant'
                        }`}>
                          {t(stage.nameKey)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-surface-variant bg-surface-container flex justify-between items-center">
          {/* Queue info */}
          {queueState.pending.length > 0 && (
            <span className="text-xs text-on-surface-variant flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">queue</span>
              {t('progress.queuePending', { count: String(queueState.pending.length) })}
            </span>
          )}
          {queueState.pending.length === 0 && <span />}

          <div className="flex gap-2">
            {state.stage === 'error' ? (
              <>
                {queueState.pending.length > 0 && (
                  <button
                    onClick={skipError}
                    className="px-5 py-2 bg-primary text-on-primary hover:bg-primary-container rounded-lg font-semibold transition-colors"
                  >
                    {t('progress.skipAndContinue')}
                  </button>
                )}
                <button
                  onClick={reset}
                  className="px-6 py-2 bg-surface-variant text-on-surface hover:bg-outline-variant rounded-lg font-semibold transition-colors"
                >
                  {t('progress.backToHome')}
                </button>
              </>
            ) : (
              <button
                onClick={cancelPipeline}
                className="px-5 py-2 text-error border border-error/50 hover:bg-error-container/10 rounded-lg font-semibold transition-colors"
              >
                {t('progress.cancelPipeline')}
              </button>
            )}
          </div>
        </div>

      </div>
      )}

      {/* Pending queue items */}
      {queueState.pending.length > 0 && (
        <div className="mt-4 bg-surface-container rounded-xl border border-surface-variant overflow-hidden sharp-shadow">
          <div className="p-4 border-b border-surface-variant">
            <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">queue</span>
              {t('progress.queueTitle')} ({queueState.pending.length})
            </h3>
          </div>
          <div className="divide-y divide-surface-variant">
            {queueState.pending.map((task, idx) => (
              <div key={task.id} className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-outline font-mono w-5 shrink-0">#{idx + 1}</span>
                  <span className="text-sm text-on-surface truncate">
                    {task.title || task.url}
                  </span>
                  <span className="text-xs text-outline-variant shrink-0">
                    {task.sourceType}
                  </span>
                </div>
                <button
                  onClick={() => removeQueued(task.id)}
                  className="shrink-0 p-1 rounded hover:bg-error-container/20 text-outline hover:text-error transition-colors"
                  title={t('progress.removeFromQueue')}
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
