import React, { useEffect, useRef, useState } from 'react'
import type { ProjectSourceType } from '../../../shared/project-types'
import { useI18n } from '../../i18n'

const URL_PREFIXES: Record<'youtube' | 'bilibili', string> = {
  youtube: 'https://www.youtube.com/watch?v=',
  bilibili: 'https://www.bilibili.com/video/',
}

function normalizeUrl(value: string, sourceType: 'youtube' | 'bilibili'): string {
  const input = value.trim()
  if (/^https?:\/\//i.test(input)) return input
  if (sourceType === 'bilibili' && /^b23\.tv\//i.test(input)) return `https://${input}`
  return URL_PREFIXES[sourceType] + input
}

function isValidSource(value: string, sourceType: 'youtube' | 'bilibili'): boolean {
  const url = normalizeUrl(value, sourceType)
  if (sourceType === 'youtube') return /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]{11}/.test(url)
  return /^(https?:\/\/)?((www\.)?bilibili\.com\/video\/(BV[\w]+|av\d+)|b23\.tv\/[^/?#]+)/.test(url)
}

interface VideoToolEntryViewProps {
  onNavigate: (view: string, params?: { projectId?: string }) => void
}

export const VideoToolEntryView: React.FC<VideoToolEntryViewProps> = ({ onNavigate }) => {
  const t = useI18n((state) => state.t)
  const [sourceType, setSourceType] = useState<ProjectSourceType>('youtube')
  const [value, setValue] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ stage: string; percent: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const createdProjectIdRef = useRef<string | null>(null)
  const operationIdRef = useRef<string | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const operationId = operationIdRef.current
      const createdProjectId = createdProjectIdRef.current
      operationIdRef.current = null
      if (operationId && createdProjectId) {
        void window.electronAPI.projectCancel(createdProjectId, operationId)
      } else if (createdProjectId) {
        void window.electronAPI.projectDelete(createdProjectId)
      }
    }
  }, [])
  useEffect(() => {
    const unsubscribe = window.electronAPI.onProjectProgress((event) => {
      if (event.operationId !== operationIdRef.current || !mountedRef.current) return
      setProgress({ stage: event.stage, percent: event.percent })
    })
    return unsubscribe
  }, [])

  const selectFile = async () => {
    const selected = await window.electronAPI.selectVideoFile()
    if (selected && mountedRef.current) setValue(selected)
  }

  const cancel = async () => {
    const operationId = operationIdRef.current
    const id = projectId
    if (!operationId || !id) return
    operationIdRef.current = null
    try {
      await window.electronAPI.projectCancel(id, operationId)
    } finally {
      if (mountedRef.current) { setBusy(false); setProgress(null) }
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!value.trim() || (sourceType !== 'local-file' && !isValidSource(value, sourceType))) {
      setError(sourceType === 'bilibili' ? t('videoTool.validation.bilibili') : t('videoTool.validation.url'))
      return
    }
    setBusy(true)
    setProgress(null)
    const operationId = crypto.randomUUID()
    operationIdRef.current = operationId
    try {
      const manifest = await window.electronAPI.projectCreate(name.trim() ? { name: name.trim() } : {})
      createdProjectIdRef.current = manifest.id
      if (!mountedRef.current) {
        await window.electronAPI.projectDelete(manifest.id)
        createdProjectIdRef.current = null
        return
      }
      setProjectId(manifest.id)
      const acquired = await window.electronAPI.projectAcquire(manifest.id, { sourceType, url: sourceType === 'local-file' ? value : normalizeUrl(value, sourceType) }, operationId)
      if (!mountedRef.current || operationIdRef.current !== operationId) {
        await window.electronAPI.projectDelete(manifest.id)
        createdProjectIdRef.current = null
        return
      }
      operationIdRef.current = null
      setBusy(false)
      setProgress(null)
      createdProjectIdRef.current = null
      onNavigate('video-tool-editor', { projectId: acquired.id })
    } catch (err) {
      operationIdRef.current = null
      const createdProjectId = createdProjectIdRef.current
      if (createdProjectId) {
        try {
          await window.electronAPI.projectDelete(createdProjectId)
        } finally {
          createdProjectIdRef.current = null
        }
      }
      if (mountedRef.current) { setBusy(false); setError(err instanceof Error ? err.message : String(err)) }
    }
  }


  return (
    <div className="w-full max-w-3xl mx-auto px-6 h-full flex flex-col justify-center">
      <div className="text-center mb-8">
        <span className="material-symbols-outlined text-primary text-[48px] mb-3">movie_edit</span>
        <h1 className="text-[32px] font-bold text-on-surface leading-[40px] tracking-tight mb-2">{t('videoTool.entry.heading')}</h1>
        <p className="text-base text-outline">{t('videoTool.entry.description')}</p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-3">
          {(['youtube', 'bilibili', 'local-file'] as ProjectSourceType[]).map((option) => (
            <button key={option} type="button" onClick={() => { setSourceType(option); setValue(''); setError(null) }} className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${sourceType === option ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant text-on-surface-variant hover:bg-surface-variant'}`}>
              {option === 'youtube' ? t('input.sourceYoutube') : option === 'bilibili' ? t('input.sourceBilibili') : t('input.sourceLocalFile')}
            </button>
          ))}
        </div>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('videoTool.entry.namePlaceholder')} className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-3 text-sm text-on-surface outline-none focus:border-primary" />
        {sourceType === 'local-file' ? (
          <button type="button" onClick={selectFile} className="w-full flex items-center gap-3 bg-surface-container-low border border-outline-variant rounded-xl px-4 py-4 text-left hover:border-primary transition-colors">
            <span className="material-symbols-outlined text-primary">folder_open</span>
            <span className="text-sm text-on-surface truncate">{value || t('videoTool.entry.selectFile')}</span>
          </button>
        ) : (
          <div className="flex items-center bg-surface-container-low border border-outline-variant rounded-xl px-3 focus-within:border-primary">
            <span className="text-xs text-outline whitespace-nowrap">{URL_PREFIXES[sourceType]}</span>
            <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={sourceType === 'youtube' ? t('input.urlPlaceholder') : t('input.urlPlaceholderBilibili')} className="flex-1 bg-transparent px-2 py-3 text-sm text-on-surface outline-none" />
          </div>
        )}
        {error && <p className="text-sm text-error flex items-center gap-2"><span className="material-symbols-outlined text-[18px]">error</span>{error}</p>}
        {progress && <div className="rounded-lg bg-surface-container p-3"><div className="flex justify-between text-xs text-on-surface-variant mb-2"><span>{t(`videoTool.stage.${progress.stage}`)}</span><span>{Math.round(progress.percent)}%</span></div><div className="h-1.5 rounded-full bg-surface-variant overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} /></div></div>}
        <div className="flex gap-3">
          <button type="submit" disabled={busy || !value.trim()} className="flex-1 rounded-lg bg-primary text-on-primary py-3 font-semibold disabled:opacity-50 flex items-center justify-center gap-2">{busy ? <span className="animate-spin material-symbols-outlined">progress_activity</span> : <span className="material-symbols-outlined">download</span>}{busy ? t('videoTool.entry.acquiring') : t('videoTool.entry.import')}</button>
          {busy && <button type="button" onClick={() => void cancel()} disabled={!projectId || !operationIdRef.current} className="px-5 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-variant disabled:opacity-50">{t('videoTool.cancel')}</button>}
        </div>
      </form>
    </div>
  )
}
