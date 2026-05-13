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
  // 每次语言变化都生成新函数引用，确保 zustand selector 能感知 t 的变化并触发重渲染。
  return (key: string): string => {
    if (!isTranslationKey(key)) return key
    return dictionaries[locale][key] ?? dictionaries.en[key]
  }
}

interface I18nStore {
  locale: Locale
  t: (key: string) => string
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
