import { useI18n } from '../i18n'

export function TopAppBar({ title }: { title?: string }) {
  const { locale, setLocale, t } = useI18n()

  // 两个语言按钮共享同一容器和选中态样式，模拟 segmented control 而不引入额外状态。
  return (
    <div className="h-16 bg-surface border-b border-outline-variant flex items-center justify-between px-6 sticky top-0 z-40">
      <div className="flex items-center">
        {title && <h2 className="text-lg font-semibold text-on-surface">{title}</h2>}
      </div>
      
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1 rounded-full border border-outline-variant bg-surface-container-lowest p-1" aria-label={t('topBar.language')}>
          <button
            type="button"
            onClick={() => setLocale('en')}
            className={`px-2.5 py-1 rounded-full text-xs font-bold transition-colors ${
              locale === 'en' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant'
            }`}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => setLocale('zh')}
            className={`px-2.5 py-1 rounded-full text-xs font-bold transition-colors ${
              locale === 'zh' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant'
            }`}
          >
            中
          </button>
        </div>
        <button title={t('topBar.notifications')} className="text-on-surface-variant hover:text-on-surface transition-colors p-2 rounded-full hover:bg-surface-variant flex items-center justify-center">
          <span className="material-symbols-outlined">notifications</span>
        </button>
        <button title={t('topBar.account')} className="text-on-surface-variant hover:text-on-surface transition-colors p-2 rounded-full hover:bg-surface-variant flex items-center justify-center">
          <span className="material-symbols-outlined">account_circle</span>
        </button>
      </div>
    </div>
  )
}
