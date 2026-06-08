export type ViewFilter = 'all' | 'ungrouped' | 'recent' | 'summary' | 'missing'
export type SettingsPanel = 'personal' | 'groups' | 'model'
export type ThemeMode = 'light' | 'dark'

export interface Group {
  id: string
  name: string
  description?: string
  color?: 'blue' | 'green' | 'amber' | 'violet' | 'red' | string
}

export interface Repository {
  id: number
  storageId?: string
  owner: string
  name: string
  description: string
  stars: number
  growth: string
  language: string
  starredAt: string
  groups: string[]
  aiSummary?: string
  aiDetailSummary?: string
  userSummary?: string
  userDetailSummary?: string
  note?: string
  homepage?: string
}

export interface ModelSettings {
  baseUrl: string
  modelName: string
  hasApiKey: boolean
  allowRepoMetadata: boolean
  allowUserNotes: boolean
}
