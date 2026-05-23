import { create } from 'zustand'
import type { Locale } from '../types'
import { usePipelineStore } from '../store/usePipelineStore'
import { en, type TranslationKey } from './locales/en'
import { zh } from './locales/zh'

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  en,
  zh,
}

function isTranslationKey(key: string): key is TranslationKey {
  return key in en
}

function isLocale(locale: string | undefined): locale is Locale {
  return locale === 'en' || locale === 'zh'
}

function makeTranslate(locale: Locale) {
  return (key: string, params?: Record<string, string>): string => {
    if (!isTranslationKey(key)) return key
    let result = dictionaries[locale][key] ?? dictionaries.en[key]
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        result = result.replace(`{${k}}`, v)
      }
    }
    return result
  }
}

interface I18nStore {
  locale: Locale
  t: (key: string, params?: Record<string, string>) => string
  setLocale: (locale: Locale) => Promise<void>
  initLocale: (locale?: Locale) => void
}

export const useI18n = create<I18nStore>((set) => ({
  locale: 'en',
  t: makeTranslate('en'),
  setLocale: async (locale) => {
    // 先更新内存状态保证界面即时切换，再写入 electron-store 持久化用户偏好。
    set({ locale, t: makeTranslate(locale) })
    await usePipelineStore.getState().saveConfig({ locale })
  },
  initLocale: (locale) => {
    if (isLocale(locale)) {
      set({ locale, t: makeTranslate(locale) })
    }
  },
}))

export type { Locale, TranslationKey }
