# Color Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dark / light / system-follow color theme support to VidiTranslate.

**Architecture:** CSS class toggle approach. Light palette is the CSS base defined in `@theme`. Dark palette overrides via `html.dark` selector. A `themeMode` field in `AppConfig` (persisted via electron-store) drives which class is applied. React `useEffect` in `App.tsx` toggles the `.dark` class on `<html>` and listens to `prefers-color-scheme` when in system mode. Electron main process syncs `nativeTheme.themeSource` for native dialog consistency.

**Tech Stack:** React, Tailwind CSS v4 (`@theme`), Zustand, electron-store, Electron `nativeTheme`

**Spec:** `docs/superpowers/specs/2026-05-28-color-theme-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types.ts` | Modify | Add `ThemeMode` type, add `themeMode` to `AppConfig` |
| `electron/services/types.ts` | Modify | Add `ThemeMode` type, add `themeMode` to `AppConfig` |
| `electron/services/config.ts` | Modify | Add default + schema for `themeMode`, add to `simpleKeys` |
| `electron/main.ts` | Modify | Sync `nativeTheme.themeSource` when config changes |
| `src/index.css` | Modify | Restructure: light base in `@theme`, dark overrides in `html.dark` |
| `index.html` | Modify | Add `class="dark"` to `<html>` for flash prevention |
| `src/i18n/locales/en.ts` | Modify | Add theme-related i18n keys |
| `src/i18n/locales/zh.ts` | Modify | Add theme-related i18n keys |
| `src/store/usePipelineStore.ts` | Modify | Add `themeMode` to initial config defaults |
| `src/App.tsx` | Modify | Add theme application effect hook |
| `src/components/SettingsView.tsx` | Modify | Add Appearance section in System tab |

---

### Task 1: Add ThemeMode Type and AppConfig Field

**Files:**
- Modify: `src/types.ts:74-76` (type aliases section)
- Modify: `src/types.ts:112-142` (AppConfig interface)
- Modify: `electron/services/types.ts` (mirrored types)

- [ ] **Step 1: Add `ThemeMode` type to `src/types.ts`**

After the `AudioMixMode` type on line 75, add:

```typescript
export type ThemeMode = 'dark' | 'light' | 'system'
```

- [ ] **Step 2: Add `themeMode` to `AppConfig` in `src/types.ts`**

In the `AppConfig` interface, after `locale: Locale` (line 113), add:

```typescript
  themeMode: ThemeMode
```

- [ ] **Step 3: Add `ThemeMode` type to `electron/services/types.ts`**

After the existing `AudioMixMode` type alias (around line 243), add:

```typescript
export type ThemeMode = 'dark' | 'light' | 'system'
```

- [ ] **Step 4: Add `themeMode` to `AppConfig` in `electron/services/types.ts`**

In the `AppConfig` interface (line 260), after `locale: Locale` (line 261), add:

```typescript
  themeMode: ThemeMode
```

- [ ] **Step 5: Commit**

```
feat(types): add ThemeMode type and themeMode to AppConfig
```

---

### Task 2: Update Electron Config Persistence

**Files:**
- Modify: `electron/services/config.ts:85-125` (defaultConfig)
- Modify: `electron/services/config.ts:127-269` (store schema)
- Modify: `electron/services/config.ts:300-335` (simpleKeys)

- [ ] **Step 1: Add `themeMode` to defaultConfig**

In `defaultConfig` (line 85), after `locale: 'en'` (line 86), add:

```typescript
  themeMode: 'dark',
```

- [ ] **Step 2: Add `themeMode` to the store schema**

In `new Store<AppConfig>({...})` schema object, after the `locale` schema entry (lines 133-137), add:

```typescript
    themeMode: {
      type: 'string',
      enum: ['dark', 'light', 'system'],
      default: 'dark',
    },
```

- [ ] **Step 3: Add `themeMode` to `simpleKeys` array**

In the `setConfig` function, add `'themeMode'` to the `simpleKeys` array (after `'locale'` on line 302):

```typescript
    'locale',
    'themeMode',
```

- [ ] **Step 4: Commit**

```
feat(config): persist themeMode in electron-store
```

---

### Task 3: Sync Electron nativeTheme

**Files:**
- Modify: `electron/main.ts:1` (imports)
- Modify: `electron/main.ts:205-207` (config:set handler)

- [ ] **Step 1: Add `nativeTheme` to the Electron import**

Change line 1 from:

```typescript
import { app, BrowserWindow, dialog, ipcMain, nativeImage, screen, shell } from 'electron'
```

to:

```typescript
import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, screen, shell } from 'electron'
```

- [ ] **Step 2: Sync nativeTheme when config changes**

In `registerIpcHandlers()`, modify the `config:set` handler (lines 205-207). Change from:

```typescript
  ipcMain.handle('config:set', (_event, config: Partial<AppConfig>): void => {
    setConfig(config)
  })
```

to:

```typescript
  ipcMain.handle('config:set', (_event, config: Partial<AppConfig>): void => {
    setConfig(config)
    if (config.themeMode) {
      nativeTheme.themeSource = config.themeMode
    }
  })
```

- [ ] **Step 3: Set initial nativeTheme on app startup**

In `createWindow()`, after `mainWindow = window` (line 138), add:

```typescript
  const initialTheme = getConfig().themeMode ?? 'dark'
  nativeTheme.themeSource = initialTheme
```

- [ ] **Step 4: Commit**

```
feat(electron): sync nativeTheme with themeMode config
```

---

### Task 4: Restructure CSS — Light Base + Dark Override

**Files:**
- Modify: `src/index.css` (entire file)

This is the largest change. Replace the entire `src/index.css` content.

- [ ] **Step 1: Replace `src/index.css` with themed version**

Replace the entire file with:

```css
@import "tailwindcss";

@theme {
  /* ── Light palette (base) ── */
  --color-surface: #f9f9ff;
  --color-surface-dim: #d9d9e0;
  --color-surface-bright: #f9f9ff;
  --color-surface-container-lowest: #ffffff;
  --color-surface-container-low: #f3f3fa;
  --color-surface-container: #eeedf4;
  --color-surface-container-high: #e3e2e9;
  --color-surface-container-highest: #dddce3;
  --color-on-surface: #1a1c20;
  --color-on-surface-variant: #44474e;
  --color-inverse-surface: #2e3036;
  --color-inverse-on-surface: #f0f0f7;
  --color-outline: #74777f;
  --color-outline-variant: #c4c6d0;
  --color-surface-tint: #005bc1;
  --color-primary: #005bc1;
  --color-on-primary: #ffffff;
  --color-primary-container: #d8e2ff;
  --color-on-primary-container: #001a41;
  --color-inverse-primary: #adc6ff;
  --color-secondary: #006e2c;
  --color-on-secondary: #ffffff;
  --color-secondary-container: #72fe88;
  --color-on-secondary-container: #002107;
  --color-tertiary: #4a48d0;
  --color-on-tertiary: #ffffff;
  --color-tertiary-container: #e1e0ff;
  --color-on-tertiary-container: #07006c;
  --color-error: #ba1a1a;
  --color-on-error: #ffffff;
  --color-error-container: #ffdad6;
  --color-on-error-container: #410002;
  --color-primary-fixed: #d8e2ff;
  --color-primary-fixed-dim: #adc6ff;
  --color-on-primary-fixed: #001a41;
  --color-on-primary-fixed-variant: #004493;
  --color-secondary-fixed: #72fe88;
  --color-secondary-fixed-dim: #53e16f;
  --color-on-secondary-fixed: #002107;
  --color-on-secondary-fixed-variant: #00531c;
  --color-tertiary-fixed: #e1e0ff;
  --color-tertiary-fixed-dim: #c0c1ff;
  --color-on-tertiary-fixed: #07006c;
  --color-on-tertiary-fixed-variant: #2f2ebe;
  --color-background: #f9f9ff;
  --color-on-background: #1a1c20;
  --color-surface-variant: #e0e2ec;

  /* Spacing */
  --spacing-sidebar-width: 260px;
  --spacing-container-padding: 24px;
  --spacing-gutter: 16px;
  --spacing-unit-xs: 4px;
  --spacing-unit-sm: 8px;
  --spacing-unit-md: 16px;
  --spacing-unit-lg: 24px;
  --spacing-unit-xl: 48px;

  /* Border radius */
  --radius-sm: 2px;
  --radius-DEFAULT: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-full: 9999px;

  /* Fonts */
  --font-body: Inter, sans-serif;
  --font-mono: Geist, monospace;

  /* Font sizes */
  --text-display-lg: 32px;
  --text-headline-md: 24px;
  --text-title-sm: 18px;
  --text-body-md: 14px;
  --text-body-sm: 13px;
  --text-label-caps: 11px;
  --text-mono-data: 12px;
}

/* ── Dark palette override ── */
html.dark {
  --color-surface: #131313;
  --color-surface-dim: #131313;
  --color-surface-bright: #393939;
  --color-surface-container-lowest: #0e0e0e;
  --color-surface-container-low: #1b1b1c;
  --color-surface-container: #202020;
  --color-surface-container-high: #2a2a2a;
  --color-surface-container-highest: #353535;
  --color-on-surface: #e5e2e1;
  --color-on-surface-variant: #c1c6d7;
  --color-inverse-surface: #e5e2e1;
  --color-inverse-on-surface: #303030;
  --color-outline: #8b90a0;
  --color-outline-variant: #414755;
  --color-surface-tint: #adc6ff;
  --color-primary: #adc6ff;
  --color-on-primary: #002e69;
  --color-primary-container: #4b8eff;
  --color-on-primary-container: #00285c;
  --color-inverse-primary: #005bc1;
  --color-secondary: #53e16f;
  --color-on-secondary: #003911;
  --color-secondary-container: #05b046;
  --color-on-secondary-container: #003a11;
  --color-tertiary: #c0c1ff;
  --color-on-tertiary: #1000a9;
  --color-tertiary-container: #8083ff;
  --color-on-tertiary-container: #0d0096;
  --color-error: #ffb4ab;
  --color-on-error: #690005;
  --color-error-container: #93000a;
  --color-on-error-container: #ffdad6;
  --color-background: #131313;
  --color-on-background: #e5e2e1;
  --color-surface-variant: #353535;
}

/* Custom scrollbar — uses theme tokens */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: var(--color-background); }
::-webkit-scrollbar-thumb { background: var(--color-surface-variant); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--color-outline-variant); }

/* Sharp ambient shadow — theme-aware */
.sharp-shadow { box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1); }
html.dark .sharp-shadow { box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.5); }

/* Material Symbols config */
.material-symbols-outlined {
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}

body {
  background-color: var(--color-background);
  color: var(--color-on-background);
}
```

- [ ] **Step 2: Verify no hardcoded color references remain**

Search the codebase for any remaining hardcoded color references that should use theme variables:

```bash
grep -rn '#131313\|#353535\|#414755\|#e5e2e1' src/
```

Expected: No results (all hardcoded colors are now only in `src/index.css` within the `html.dark` block).

- [ ] **Step 3: Commit**

```
feat(css): restructure theme — light base + dark override
```

---

### Task 5: Update HTML for Flash Prevention

**Files:**
- Modify: `index.html:2`

- [ ] **Step 1: Add `class="dark"` to `<html>` tag**

Change line 2 from:

```html
<html lang="en">
```

to:

```html
<html lang="en" class="dark">
```

This ensures the app starts dark (the default `themeMode`) to prevent a flash of light content before React hydrates.

- [ ] **Step 2: Commit**

```
feat(html): add dark class for flash prevention
```

---

### Task 6: Add i18n Keys

**Files:**
- Modify: `src/i18n/locales/en.ts:189` (after `settings.system.disabled`)
- Modify: `src/i18n/locales/zh.ts:191` (after `settings.system.disabled`)

- [ ] **Step 1: Add English i18n keys**

In `src/i18n/locales/en.ts`, after the line `'settings.system.disabled': 'Disabled',` (line 189), add:

```typescript
  'settings.system.appearance': 'Appearance',
  'settings.system.appearanceDescription': 'Choose your preferred color theme.',
  'settings.system.themeDark': 'Dark',
  'settings.system.themeLight': 'Light',
  'settings.system.themeSystem': 'Follow System',
```

- [ ] **Step 2: Add Chinese i18n keys**

In `src/i18n/locales/zh.ts`, after the line `'settings.system.disabled': '已禁用',` (line 191), add:

```typescript
  'settings.system.appearance': '外观',
  'settings.system.appearanceDescription': '选择你喜欢的颜色主题。',
  'settings.system.themeDark': '暗色',
  'settings.system.themeLight': '浅色',
  'settings.system.themeSystem': '跟随系统',
```

- [ ] **Step 3: Commit**

```
feat(i18n): add theme appearance translation keys
```

---

### Task 7: Update Zustand Store Defaults

**Files:**
- Modify: `src/store/usePipelineStore.ts:43-44`

- [ ] **Step 1: Add `themeMode` to initial config**

In `usePipelineStore`, inside the `config` object (line 43), after `locale: 'en'` (line 44), add:

```typescript
    themeMode: 'dark' as const,
```

- [ ] **Step 2: Commit**

```
feat(store): add themeMode to initial config defaults
```

---

### Task 8: Add Theme Application Effect in App.tsx

**Files:**
- Modify: `src/App.tsx:1-10` (imports and hooks)
- Modify: `src/App.tsx:23-36` (add new useEffect)

- [ ] **Step 1: Read `themeMode` from store**

In `App.tsx`, add a new selector for `themeMode` after the existing selectors (around line 16):

```typescript
  const configThemeMode = usePipelineStore((s) => s.config.themeMode)
```

- [ ] **Step 2: Add the theme effect**

After the `useEffect` that calls `initLocale(configLocale)` (lines 27-32), add this new effect:

```typescript
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
      // system mode
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      applyTheme(mq.matches)
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches)
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [configThemeMode])
```

- [ ] **Step 3: Commit**

```
feat(app): add theme application effect with system detection
```

---

### Task 9: Add Appearance Section to Settings

**Files:**
- Modify: `src/components/SettingsView.tsx:652-662` (system tab content)

- [ ] **Step 1: Add Appearance section at the top of the System tab**

In `SettingsView.tsx`, inside the `{activeTab === 'system' && (...)}` block (line 652), **before** the existing `<section>` for "System Preferences" (line 653), add a new section:

Insert this JSX right after `{activeTab === 'system' && (` on line 652, before the existing `<section>`:

```tsx
            <section className="bg-surface-container rounded-xl border border-outline-variant/40 p-unit-lg shadow-sm mb-unit-lg">
              <div className="border-b border-outline-variant/30 pb-4 mb-6">
                <h3 className="text-lg font-semibold text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">palette</span>
                  {t('settings.system.appearance')}
                </h3>
                <p className="text-[13px] text-on-surface-variant mt-1">
                  {t('settings.system.appearanceDescription')}
                </p>
              </div>
              <div className="flex gap-3 max-w-md">
                {([
                  { value: 'dark', icon: 'dark_mode', label: t('settings.system.themeDark') },
                  { value: 'light', icon: 'light_mode', label: t('settings.system.themeLight') },
                  { value: 'system', icon: 'brightness_auto', label: t('settings.system.themeSystem') },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => saveConfig({ themeMode: opt.value })}
                    className={`flex-1 flex flex-col items-center gap-2 px-4 py-3 rounded-lg border transition-colors ${
                      config.themeMode === opt.value
                        ? 'bg-primary/15 border-primary text-primary'
                        : 'bg-surface-container-low border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[24px]">{opt.icon}</span>
                    <span className="text-[13px] font-medium">{opt.label}</span>
                  </button>
                ))}
              </div>
            </section>
```

- [ ] **Step 2: Commit**

```
feat(settings): add appearance theme selector in system tab
```

---

### Task 10: Type Check and Verify

- [ ] **Step 1: Run type check**

```bash
npm run typecheck
```

Expected: PASS. No type errors — `ThemeMode` and `themeMode` are consistent across `src/types.ts`, `electron/services/types.ts`, config store, and components.

- [ ] **Step 2: Run dev server and manually verify**

```bash
npm run dev
```

Verify:
1. App launches in dark mode (default)
2. Go to Settings → System tab → Appearance section is visible at the top
3. Click "Light" — app switches to light theme immediately
4. Click "Dark" — app switches back to dark theme
5. Click "Follow System" — app matches OS theme
6. Toggle OS appearance (System Preferences → Appearance) while in "Follow System" — app updates live
7. Restart the app — theme preference persists
8. Open a native file dialog (via "Browse" button) — dialog matches app theme

- [ ] **Step 3: Final commit**

```
feat: add dark/light/system color theme support

- ThemeMode type with dark/light/system options
- Material Design 3 light palette derived from existing dark seed
- CSS class toggle via html.dark selector
- System theme detection via prefers-color-scheme media query
- Electron nativeTheme sync for native dialogs
- Appearance section in Settings > System tab
- Persisted via electron-store, default: dark
```
