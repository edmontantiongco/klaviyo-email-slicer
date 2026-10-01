import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_COMPRESS, type CompressOptions } from '@/lib/compress/types'
import { DEFAULT_FOOTER_HTML } from '@/lib/html'

export type ScaleChoice = 'auto' | '1' | '2' | '3'
export type Theme = 'light' | 'dark' | 'system'

export interface SettingsState {
  figmaToken: string
  klaviyoKey: string
  /** Export scale for Figma renders. 'auto' targets a 1200px-wide image. */
  scale: ScaleChoice
  /** Email display width in CSS px. */
  contentWidth: number
  compress: CompressOptions
  footer: boolean
  footerHtml: string
  templateEditorType: 'CODE' | 'USER_DRAGGABLE'
  hideUploadsInLibrary: boolean
  theme: Theme
  recentFigmaUrls: { url: string; label: string }[]
  set: (patch: Partial<Omit<SettingsState, 'set' | 'setCompress' | 'rememberUrl'>>) => void
  setCompress: (patch: Partial<CompressOptions>) => void
  rememberUrl: (url: string, label: string) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      figmaToken: '',
      klaviyoKey: '',
      scale: 'auto',
      contentWidth: 600,
      compress: DEFAULT_COMPRESS,
      footer: true,
      footerHtml: DEFAULT_FOOTER_HTML,
      templateEditorType: 'CODE',
      hideUploadsInLibrary: false,
      theme: 'system',
      recentFigmaUrls: [],
      set: (patch) => set(patch),
      setCompress: (patch) => set((s) => ({ compress: { ...s.compress, ...patch } })),
      rememberUrl: (url, label) =>
        set((s) => ({
          recentFigmaUrls: [{ url, label }, ...s.recentFigmaUrls.filter((r) => r.url !== url)].slice(0, 6),
        })),
    }),
    { name: 'kes-settings', version: 1 },
  ),
)

export function resolveScale(choice: ScaleChoice, frameWidth: number): number {
  if (choice !== 'auto') return Number(choice)
  // Designs are normally 1200px (= 2× a 600px email). 600px frames get rendered at 2×.
  const s = 1200 / frameWidth
  return Math.min(4, Math.max(1, Math.round(s * 4) / 4))
}
