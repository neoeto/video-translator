import React, { useState } from 'react'
import { useI18n } from '../i18n'

type HelpSection = 'overview' | 'quickstart' | 'settings' | 'editor' | 'faq'

export const HelpView: React.FC = () => {
  const t = useI18n((s) => s.t)
  const [activeSection, setActiveSection] = useState<HelpSection>('overview')

  const sections: { id: HelpSection; icon: string; label: string }[] = [
    { id: 'overview', icon: 'info', label: t('help.sections.overview') },
    { id: 'quickstart', icon: 'rocket_launch', label: t('help.sections.quickstart') },
    { id: 'settings', icon: 'settings', label: t('help.sections.settings') },
    { id: 'editor', icon: 'movie_edit', label: t('help.sections.editor') },
    { id: 'faq', icon: 'help', label: t('help.sections.faq') },
  ]

  return (
    <div className="flex h-full">
      {/* Left sidebar TOC */}
      <aside className="w-56 shrink-0 border-r border-outline-variant/30 bg-surface-container/50 p-4">
        <h2 className="text-sm font-bold text-on-surface-variant uppercase tracking-wider mb-4 px-2">
          {t('help.toc')}
        </h2>
        <nav className="space-y-1">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeSection === s.id
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-8 max-w-4xl">
        {activeSection === 'overview' && <OverviewSection />}
        {activeSection === 'quickstart' && <QuickstartSection />}
        {activeSection === 'settings' && <SettingsSection />}
        {activeSection === 'editor' && <EditorSection />}
        {activeSection === 'faq' && <FaqSection />}
      </main>
    </div>
  )
}

/* ---------- Section components ---------- */

function SectionHeading({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <h2 className="text-2xl font-bold text-on-surface flex items-center gap-3 mb-6">
      <span className="material-symbols-outlined text-primary text-[28px]">{icon}</span>
      {children}
    </h2>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-lg font-semibold text-on-surface mt-8 mb-3">{children}</h3>
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-on-surface-variant leading-relaxed mb-4">{children}</p>
}

function StepList({ steps }: { steps: { icon: string; title: string; desc: string }[] }) {
  return (
    <ol className="space-y-4 my-4">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-4 items-start">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-primary text-[18px]">{step.icon}</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-on-surface">{step.title}</div>
            <div className="text-sm text-on-surface-variant leading-relaxed">{step.desc}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 text-xs font-mono bg-surface-container border border-outline-variant rounded text-on-surface-variant">
      {children}
    </kbd>
  )
}

function InfoCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-container rounded-xl border border-outline-variant/40 p-5 mb-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="material-symbols-outlined text-primary text-[20px]">{icon}</span>
        <h4 className="text-sm font-semibold text-on-surface">{title}</h4>
      </div>
      <div className="text-sm text-on-surface-variant leading-relaxed">{children}</div>
    </div>
  )
}

function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-outline-variant/30 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 py-4 text-left group"
      >
        <span className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">
          {q}
        </span>
        <span className={`material-symbols-outlined text-on-surface-variant text-[20px] transition-transform ${open ? 'rotate-180' : ''}`}>
          expand_more
        </span>
      </button>
      {open && (
        <div className="text-sm text-on-surface-variant leading-relaxed pb-4 pl-1">
          {children}
        </div>
      )}
    </div>
  )
}

/* ---------- Sections ---------- */

function OverviewSection() {
  const t = useI18n((s) => s.t)
  return (
    <>
      <SectionHeading icon="info">{t('help.overview.title')}</SectionHeading>
      <Paragraph>{t('help.overview.intro')}</Paragraph>

      <SubHeading>{t('help.overview.features')}</SubHeading>
      <div className="grid grid-cols-2 gap-4 my-4">
        <InfoCard icon="translate" title={t('help.overview.feat1Title')}>
          {t('help.overview.feat1Desc')}
        </InfoCard>
        <InfoCard icon="record_voice_over" title={t('help.overview.feat2Title')}>
          {t('help.overview.feat2Desc')}
        </InfoCard>
        <InfoCard icon="subtitles" title={t('help.overview.feat3Title')}>
          {t('help.overview.feat3Desc')}
        </InfoCard>
        <InfoCard icon="movie_edit" title={t('help.overview.feat4Title')}>
          {t('help.overview.feat4Desc')}
        </InfoCard>
      </div>

      <SubHeading>{t('help.overview.pipeline')}</SubHeading>
      <StepList
        steps={[
          { icon: 'download', title: t('help.overview.step1Title'), desc: t('help.overview.step1Desc') },
          { icon: 'mic', title: t('help.overview.step2Title'), desc: t('help.overview.step2Desc') },
          { icon: 'translate', title: t('help.overview.step3Title'), desc: t('help.overview.step3Desc') },
          { icon: 'record_voice_over', title: t('help.overview.step4Title'), desc: t('help.overview.step4Desc') },
          { icon: 'merge', title: t('help.overview.step5Title'), desc: t('help.overview.step5Desc') },
        ]}
      />
    </>
  )
}

function QuickstartSection() {
  const t = useI18n((s) => s.t)
  return (
    <>
      <SectionHeading icon="rocket_launch">{t('help.quickstart.title')}</SectionHeading>
      <Paragraph>{t('help.quickstart.intro')}</Paragraph>

      <SubHeading>{t('help.quickstart.prereqs')}</SubHeading>
      <ul className="list-disc list-inside text-sm text-on-surface-variant space-y-1 mb-4">
        <li>{t('help.quickstart.prereq1')}</li>
        <li>{t('help.quickstart.prereq2')}</li>
        <li>{t('help.quickstart.prereq3')}</li>
      </ul>

      <SubHeading>{t('help.quickstart.stepsTitle')}</SubHeading>
      <StepList
        steps={[
          { icon: 'settings', title: t('help.quickstart.s1Title'), desc: t('help.quickstart.s1Desc') },
          { icon: 'link', title: t('help.quickstart.s2Title'), desc: t('help.quickstart.s2Desc') },
          { icon: 'tune', title: t('help.quickstart.s3Title'), desc: t('help.quickstart.s3Desc') },
          { icon: 'play_arrow', title: t('help.quickstart.s4Title'), desc: t('help.quickstart.s4Desc') },
          { icon: 'download_done', title: t('help.quickstart.s5Title'), desc: t('help.quickstart.s5Desc') },
        ]}
      />

      <SubHeading>{t('help.quickstart.modesTitle')}</SubHeading>
      <div className="grid grid-cols-2 gap-4 my-4">
        <InfoCard icon="record_voice_over" title={t('help.quickstart.modeFullTitle')}>
          {t('help.quickstart.modeFullDesc')}
        </InfoCard>
        <InfoCard icon="subtitles" title={t('help.quickstart.modeSubTitle')}>
          {t('help.quickstart.modeSubDesc')}
        </InfoCard>
      </div>
    </>
  )
}

function SettingsSection() {
  const t = useI18n((s) => s.t)
  return (
    <>
      <SectionHeading icon="settings">{t('help.settings.title')}</SectionHeading>
      <Paragraph>{t('help.settings.intro')}</Paragraph>

      <SubHeading>{t('help.settings.sttTitle')}</SubHeading>
      <Paragraph>{t('help.settings.sttDesc')}</Paragraph>

      <SubHeading>{t('help.settings.translationTitle')}</SubHeading>
      <Paragraph>{t('help.settings.translationDesc')}</Paragraph>

      <SubHeading>{t('help.settings.ttsTitle')}</SubHeading>
      <Paragraph>{t('help.settings.ttsDesc')}</Paragraph>
      <InfoCard icon="sync" title={t('help.settings.syncTitle')}>
        {t('help.settings.syncDesc')}
      </InfoCard>
      <InfoCard icon="volume_up" title={t('help.settings.mixTitle')}>
        {t('help.settings.mixDesc')}
      </InfoCard>

      <SubHeading>{t('help.settings.subtitleTitle')}</SubHeading>
      <Paragraph>{t('help.settings.subtitleDesc')}</Paragraph>

      <SubHeading>{t('help.settings.systemTitle')}</SubHeading>
      <Paragraph>{t('help.settings.systemDesc')}</Paragraph>
    </>
  )
}

function EditorSection() {
  const t = useI18n((s) => s.t)
  return (
    <>
      <SectionHeading icon="movie_edit">{t('help.editor.title')}</SectionHeading>
      <Paragraph>{t('help.editor.intro')}</Paragraph>

      <SubHeading>{t('help.editor.layoutTitle')}</SubHeading>
      <Paragraph>{t('help.editor.layoutDesc')}</Paragraph>

      <SubHeading>{t('help.editor.playbackTitle')}</SubHeading>
      <Paragraph>{t('help.editor.playbackDesc')}</Paragraph>

      <SubHeading>{t('help.editor.subtitleTitle')}</SubHeading>
      <Paragraph>{t('help.editor.subtitleDesc')}</Paragraph>

      <SubHeading>{t('help.editor.timelineTitle')}</SubHeading>
      <Paragraph>{t('help.editor.timelineDesc')}</Paragraph>

      <SubHeading>{t('help.editor.toolsTitle')}</SubHeading>
      <div className="grid grid-cols-3 gap-3 my-4">
        <InfoCard icon="arrow_selector_tool" title={t('help.editor.toolSelectTitle')}>
          {t('help.editor.toolSelectDesc')}
        </InfoCard>
        <InfoCard icon="content_cut" title={t('help.editor.toolCutTitle')}>
          {t('help.editor.toolCutDesc')}
        </InfoCard>
        <InfoCard icon="delete" title={t('help.editor.toolDeleteTitle')}>
          {t('help.editor.toolDeleteDesc')}
        </InfoCard>
      </div>

      <SubHeading>{t('help.editor.shortcutsTitle')}</SubHeading>
      <div className="bg-surface-container rounded-xl border border-outline-variant/40 p-5 my-4">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-outline-variant/30">
            {[
              ['Space', t('help.editor.scPlayPause')],
              ['Cmd/Ctrl + Z', t('help.editor.scUndo')],
              ['Cmd/Ctrl + Shift + Z', t('help.editor.scRedo')],
              ['Delete / Backspace', t('help.editor.scDelete')],
              ['Alt + Click', t('help.editor.scAltClick')],
            ].map(([keys, desc]) => (
              <tr key={keys}>
                <td className="py-2 pr-4 w-52"><Kbd>{keys}</Kbd></td>
                <td className="py-2 text-on-surface-variant">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function FaqSection() {
  const t = useI18n((s) => s.t)
  return (
    <>
      <SectionHeading icon="help">{t('help.faq.title')}</SectionHeading>
      <Paragraph>{t('help.faq.intro')}</Paragraph>

      <div className="bg-surface-container rounded-xl border border-outline-variant/40 p-5 mt-4">
        <FaqItem q={t('help.faq.q1')}>{t('help.faq.a1')}</FaqItem>
        <FaqItem q={t('help.faq.q2')}>{t('help.faq.a2')}</FaqItem>
        <FaqItem q={t('help.faq.q3')}>{t('help.faq.a3')}</FaqItem>
        <FaqItem q={t('help.faq.q4')}>{t('help.faq.a4')}</FaqItem>
        <FaqItem q={t('help.faq.q5')}>{t('help.faq.a5')}</FaqItem>
        <FaqItem q={t('help.faq.q6')}>{t('help.faq.a6')}</FaqItem>
      </div>
    </>
  )
}
