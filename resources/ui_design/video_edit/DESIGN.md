---
name: Pro-Video Workflow System
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1b1b1c'
  surface-container: '#202020'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353535'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c1c6d7'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#303030'
  outline: '#8b90a0'
  outline-variant: '#414755'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e69'
  primary-container: '#4b8eff'
  on-primary-container: '#00285c'
  inverse-primary: '#005bc1'
  secondary: '#53e16f'
  on-secondary: '#003911'
  secondary-container: '#05b046'
  on-secondary-container: '#003a11'
  tertiary: '#c0c1ff'
  on-tertiary: '#1000a9'
  tertiary-container: '#8083ff'
  on-tertiary-container: '#0d0096'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a41'
  on-primary-fixed-variant: '#004493'
  secondary-fixed: '#72fe88'
  secondary-fixed-dim: '#53e16f'
  on-secondary-fixed: '#002107'
  on-secondary-fixed-variant: '#00531c'
  tertiary-fixed: '#e1e0ff'
  tertiary-fixed-dim: '#c0c1ff'
  on-tertiary-fixed: '#07006c'
  on-tertiary-fixed-variant: '#2f2ebe'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353535'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-caps:
    fontFamily: Geist
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  mono-data:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  sidebar-width: 260px
  container-padding: 24px
  gutter: 16px
  unit-xs: 4px
  unit-sm: 8px
  unit-md: 16px
  unit-lg: 24px
  unit-xl: 48px
---

## Brand & Style

This design system is built for high-performance video processing and translation, prioritizing speed, reliability, and technical precision. The brand personality is **authoritative and efficient**, designed to fade into the background so the user's content remains the primary focus.

The aesthetic leans into **Modern Corporate Minimalism** with a "High-Tech Dark" execution. It utilizes deep monochromatic layers to reduce eye strain during long editing sessions, punctuated by high-vibrancy functional accents that guide the user's eye to active tasks and successful completions. The visual language conveys a sense of expensive, precision-engineered software used by professionals who value a "no-nonsense" workspace.

## Colors

The palette is anchored in a **Dark Mode** foundation to provide a cinematic backdrop for video assets. 

- **Primary (Electric Blue):** Reserved strictly for primary call-to-actions, active selection states, and focus indicators.
- **Success (Green):** Used for completion states, 100% progress indicators, and "Ready to Export" status.
- **Neutrals:** A carefully tiered scale of deep grays is used to create spatial depth. `#121212` serves as the canvas, while `#1E1E1E` defines the primary sidebar and secondary containers.
- **Accents:** High-contrast white and light grays are used for text and iconography to ensure WCAG 2.1 accessibility against the dark backgrounds.

## Typography

This system utilizes **Inter** for its exceptional legibility and neutral character, ensuring that the interface remains functional across high-density data views. For technical metadata and developer-adjacent features (like timecodes and file paths), the system introduces **Geist** to provide a sharp, monospaced feel that resonates with power users.

A strict hierarchy is maintained:
- **Displays/Headlines:** Used for page titles and major modal headers.
- **Labels:** Uppercase styles are used for sidebar category headers and small metadata descriptors.
- **Mono-data:** Specifically for timecodes (00:00:00:00) and file sizes to ensure character alignment in lists.

## Layout & Spacing

The layout follows a **Fixed-Fluid hybrid model** optimized for desktop productivity. 

- **Sidebar:** A fixed-width (260px) navigation sits on the left, utilizing a darker background (#0B0B0B) than the main content area to anchor the app.
- **Content Area:** A fluid 12-column grid system handles the main dashboard. Task lists and video players span dynamic column counts depending on the window width.
- **Rhythm:** An 8px linear scale (4, 8, 16, 24, 32, 48) is used for all padding and margins to maintain visual balance and "tightness" expected in professional tools. 
- **Density:** The design favors a medium-high density, allowing power users to see multiple video tasks in a single view without scrolling.

## Elevation & Depth

This design system avoids heavy drop shadows in favor of **Tonal Layering and Low-Contrast Outlines**.

- **Level 0 (Background):** #121212 (The main app canvas).
- **Level 1 (Surface):** #1E1E1E (Cards, sidebar, and navigation elements).
- **Level 2 (Active/Floating):** #252525 with a subtle 1px border of #333333.
- **Shadows:** Only used for context menus and dropdowns. Use a "Sharp Ambient" shadow: `0px 4px 12px rgba(0, 0, 0, 0.5)` with no spread.
- **Interaction:** Hover states on cards should subtly lighten the background color (e.g., from #1E1E1E to #2A2A2A) rather than increasing shadow depth.

## Shapes

The shape language is **Soft (0.25rem)**. This provides a modern touch without sacrificing the professional, "engineered" feel of the tool.

- **Buttons & Inputs:** 4px (0.25rem) corner radius.
- **Cards & Modals:** 8px (0.5rem) corner radius.
- **Progress Bars:** Fully rounded (pill-shaped) to distinguish them from structural UI containers.
- **Selection Indicators:** Vertical 2px bars on the left of active sidebar items to maintain a crisp, linear look.

## Components

### Buttons
- **Primary:** Electric Blue background with White text. No gradient.
- **Secondary:** Transparent background with #333333 border.
- **Ghost:** Minimal padding, subtle hover tint. Used for secondary toolbar actions.

### Task List Cards
- Cards use a Level 1 surface (#1E1E1E).
- They feature a 4px left-border "Status Strip" (Blue for processing, Green for complete, Gray for idle).
- Include a thumbnail placeholder with a 4px radius.

### Input Fields
- Sleek, dark-fill inputs (#181818) with a 1px border (#333333).
- Focus state: Border changes to Electric Blue with a subtle 2px outer glow of the same color at 20% opacity.

### Progress Trackers
- Horizontal step indicators using "Connector Lines."
- Completed steps: Success Green circle with a checkmark.
- Active step: Electric Blue circle with a white pulse.
- Pending steps: Outlined gray circles.

### Sidebar Navigation
- Vertical icon + label stack. 
- Active state: Text turns White, background gets a subtle #FFFFFF08 tint, and a 2px blue vertical bar appears on the left edge.
- Grouping: Uses `label-caps` for category headers (e.g., "WORKSPACE", "TRANSFERS").

### Video Preview Component
- A dedicated container with a 16:9 aspect ratio, featuring a subtle inner-glow border to separate video content from the dark UI.