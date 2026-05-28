# Color Theme Design

**Date:** 2026-05-28
**Status:** Approved

## Overview

Add dark / light / system-follow color theme support to VidiTranslate. The app currently uses a hardcoded dark Material Design 3 palette. This feature adds a matching light palette and lets users choose between dark, light, or system-follow mode.

## Data Model

### New Type

```typescript
export type ThemeMode = 'dark' | 'light' | 'system'
```

### AppConfig Extension

Add `themeMode: ThemeMode` to `AppConfig` in both:
- `electron/services/types.ts`
- `src/types.ts`

Default value: `'dark'` (preserves current behavior for existing users).

## CSS Architecture

### Strategy: CSS Class Toggle

All components already use semantic Tailwind tokens (`bg-background`, `text-on-surface`, `text-primary`, etc.) defined via `@theme` in `src/index.css`. These tokens are CSS custom properties (`--color-*`).

**Approach:**
1. `@theme` defines the **light** palette values (conventional base)
2. `html.dark` selector overrides all `--color-*` variables with dark palette values
3. Zero component refactoring needed — all existing Tailwind classes resolve through the same CSS variables

### Light Palette (derived from same MD3 seed)

| Token | Dark (current) | Light (new) |
|-------|---------------|-------------|
| `--color-background` | `#131313` | `#f9f9ff` |
| `--color-surface` | `#131313` | `#f9f9ff` |
| `--color-surface-dim` | `#131313` | `#d9d9e0` |
| `--color-surface-bright` | `#393939` | `#f9f9ff` |
| `--color-surface-container-lowest` | `#0e0e0e` | `#ffffff` |
| `--color-surface-container-low` | `#1b1b1c` | `#f3f3fa` |
| `--color-surface-container` | `#202020` | `#eeedf4` |
| `--color-surface-container-high` | `#2a2a2a` | `#e3e2e9` |
| `--color-surface-container-highest` | `#353535` | `#dddce3` |
| `--color-on-surface` | `#e5e2e1` | `#1a1c20` |
| `--color-on-surface-variant` | `#c1c6d7` | `#44474e` |
| `--color-inverse-surface` | `#e5e2e1` | `#2e3036` |
| `--color-inverse-on-surface` | `#303030` | `#f0f0f7` |
| `--color-outline` | `#8b90a0` | `#74777f` |
| `--color-outline-variant` | `#414755` | `#c4c6d0` |
| `--color-surface-tint` | `#adc6ff` | `#005bc1` |
| `--color-primary` | `#adc6ff` | `#005bc1` |
| `--color-on-primary` | `#002e69` | `#ffffff` |
| `--color-primary-container` | `#4b8eff` | `#d8e2ff` |
| `--color-on-primary-container` | `#00285c` | `#001a41` |
| `--color-inverse-primary` | `#005bc1` | `#adc6ff` |
| `--color-secondary` | `#53e16f` | `#006e2c` |
| `--color-on-secondary` | `#003911` | `#ffffff` |
| `--color-secondary-container` | `#05b046` | `#72fe88` |
| `--color-on-secondary-container` | `#003a11` | `#002107` |
| `--color-tertiary` | `#c0c1ff` | `#4a48d0` |
| `--color-on-tertiary` | `#1000a9` | `#ffffff` |
| `--color-tertiary-container` | `#8083ff` | `#e1e0ff` |
| `--color-on-tertiary-container` | `#0d0096` | `#07006c` |
| `--color-error` | `#ffb4ab` | `#ba1a1a` |
| `--color-on-error` | `#690005` | `#ffffff` |
| `--color-error-container` | `#93000a` | `#ffdad6` |
| `--color-on-error-container` | `#ffdad6` | `#410002` |
| `--color-surface-variant` | `#353535` | `#e0e2ec` |

Fixed colors remain unchanged across themes:
- `--color-primary-fixed`, `--color-primary-fixed-dim`, `--color-on-primary-fixed`, `--color-on-primary-fixed-variant`
- `--color-secondary-fixed`, `--color-secondary-fixed-dim`, `--color-on-secondary-fixed`, `--color-on-secondary-fixed-variant`
- `--color-tertiary-fixed`, `--color-tertiary-fixed-dim`, `--color-on-tertiary-fixed`, `--color-on-tertiary-fixed-variant`

### Additional CSS Changes

- `body` background/color: change hardcoded hex values to use `var()` or remove (already handled by Tailwind utility classes on `<div>`)
- Scrollbar styles: use CSS variables instead of hardcoded `#131313`, `#353535`, `#414755`
- Add `color-scheme: dark` / `color-scheme: light` on `<html>` for native form element styling
- `.sharp-shadow`: adjust shadow opacity for light mode (`rgba(0,0,0,0.5)` → `rgba(0,0,0,0.1)` in light)

## Theme Application Logic

### React Side (`src/App.tsx`)

A `useEffect` hook watches `config.themeMode` and:

1. **`'dark'`**: Add `.dark` class + set `color-scheme: dark` on `<html>`
2. **`'light'`**: Remove `.dark` class + set `color-scheme: light` on `<html>`
3. **`'system'`**: Query `window.matchMedia('(prefers-color-scheme: dark)')`, apply accordingly, and add a `change` event listener. Clean up listener on unmount or mode change.

### Electron Main Process

When `themeMode` config changes, set `nativeTheme.themeSource`:
- `'dark'` → `nativeTheme.themeSource = 'dark'`
- `'light'` → `nativeTheme.themeSource = 'light'`
- `'system'` → `nativeTheme.themeSource = 'system'`

This ensures native dialogs (file picker, etc.) match the app theme.

### Flash Prevention

Set `class="dark"` on `<html>` in `index.html` as the default. The React lifecycle applies the correct theme early (during the first `useEffect` after config loads).

## Settings UI

### Location

Under the existing **System** tab in SettingsView, add an "Appearance" section **above** the "Working Directory" section.

### Control

A 3-option segmented radio group:

- 🌙 Dark
- ☀️ Light  
- 💻 Follow System

Uses Material Symbols icons: `dark_mode`, `light_mode`, `brightness_auto`.

### i18n Keys

```
settings.system.appearance: 'Appearance' / '外观'
settings.system.appearanceDescription: 'Choose your preferred color theme.' / '选择你喜欢的颜色主题。'
settings.system.themeDark: 'Dark' / '暗色'
settings.system.themeLight: 'Light' / '浅色'
settings.system.themeSystem: 'Follow System' / '跟随系统'
```

## Files to Modify

| File | Change |
|------|--------|
| `src/types.ts` | Add `ThemeMode` type, add `themeMode` to `AppConfig` |
| `electron/services/types.ts` | Add `ThemeMode` type, add `themeMode` to `AppConfig` |
| `electron/services/config.ts` | Add default + schema for `themeMode`, add to `simpleKeys` |
| `electron/main.ts` | Sync `nativeTheme.themeSource` when config changes |
| `src/index.css` | Restructure: light base in `@theme`, dark overrides in `html.dark` |
| `index.html` | Add `class="dark"` to `<html>` |
| `src/App.tsx` | Add theme effect hook |
| `src/components/SettingsView.tsx` | Add appearance section in System tab |
| `src/i18n/locales/en.ts` | Add theme i18n keys |
| `src/i18n/locales/zh.ts` | Add theme i18n keys |
| `src/store/usePipelineStore.ts` | Add `themeMode` to initial config |

## Testing

- Manual verification: switch between dark/light/system in settings
- Toggle system appearance while in "system" mode to verify live switching
- Verify native dialogs (file picker) match the selected theme
- Verify no FOUC (flash of unstyled content) on app launch
- Type check passes: `npm run typecheck`
