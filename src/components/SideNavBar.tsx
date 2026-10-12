import { useI18n } from '../i18n'
import { useUIStore } from '../store/useUIStore'

export function SideNavBar({ activeView, onNavigate }: { activeView: string, onNavigate: (view: string) => void }) {
  const t = useI18n((s) => s.t)
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  const navItems = [
    { id: 'video-tool', icon: 'movie_edit', label: t('nav.videoTool') },
    { id: 'home', icon: 'download', label: t('nav.home') },
    { id: 'processing', icon: 'sync', label: t('nav.processing') },
    { id: 'library', icon: 'video_library', label: t('nav.library') },
    { id: 'settings', icon: 'settings', label: t('nav.settings') },
    { id: 'help', icon: 'help', label: t('nav.help') },
  ]

  return (
    <div
      className={`fixed top-0 left-0 bottom-0 bg-surface border-r border-surface-variant flex flex-col z-50 transition-[width] duration-200 ${
        collapsed ? 'w-[68px]' : 'w-sidebar-width'
      }`}
    >
      <div className={`flex items-center ${collapsed ? 'px-3 py-5 justify-center' : 'p-6 justify-between'}`}>
        {collapsed ? (
          <button
            onClick={toggleSidebar}
            title="Expand sidebar"
            className="text-xl font-bold text-primary hover:opacity-80 transition-opacity"
          >
            VT
          </button>
        ) : (
          <>
            <div>
              <h1 className="text-xl font-bold text-primary tracking-tight">{t('nav.appName')}</h1>
              <p className="text-xs text-outline uppercase tracking-wider mt-1 font-semibold">{t('nav.subtitle')}</p>
            </div>
            <button
              onClick={toggleSidebar}
              title={t('nav.collapse')}
              className="p-1 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">chevron_left</span>
            </button>
          </>
        )}
      </div>

      <nav className={`flex-1 ${collapsed ? 'px-2' : 'px-3'} space-y-1`}>
        {navItems.map((item) => {
          const isActive = activeView === item.id
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-white/5 border-l-2 border-primary font-bold text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant border-l-2 border-transparent'
              }`}
            >
              <span 
                className="material-symbols-outlined text-[20px]" 
                style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
              >
                {item.icon}
              </span>
              {!collapsed && item.label}
            </button>
          )
        })}
      </nav>

      <div className={`border-t border-surface-variant mt-auto ${collapsed ? 'p-2' : 'p-4'}`}>
        {collapsed ? (
          <div className="flex justify-center py-2">
            <span className="material-symbols-outlined text-outline text-[24px]">account_circle</span>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-variant cursor-pointer transition-colors">
            <span className="material-symbols-outlined text-outline text-[24px]">account_circle</span>
            <div className="flex flex-col text-left">
              <span className="text-sm font-medium text-on-surface">{t('nav.userProfile')}</span>
              <span className="text-xs text-outline">{t('nav.freePlan')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
