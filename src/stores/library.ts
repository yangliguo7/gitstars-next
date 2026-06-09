import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { acceptGroupSuggestions, autoAssignGroups, createGroup, deleteGroup, getDefaultGroupSuggestions, getGroups, getMe, getSettings, getRepoGroupSuggestions, getRepos, mapApiRepo, renameGroup, saveModelSettings, saveRepoGroups, saveUserSummary, starRepo, startMissingSummaries, startSummary, startSync, stepSummary, stepSync, testModelSettings, unstarRepo, type GroupSuggestion, type SummaryJob } from '../services/gitstars-api'
import type { Group, ModelSettings, Repository, SettingsPanel, ThemeMode, ViewFilter } from '../types/domain'

const RECENT_DAYS = 7
const defaultModelSettings: ModelSettings = {
  baseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-4.1-mini',
  hasApiKey: false,
  allowRepoMetadata: true,
  allowUserNotes: false,
}

type ToastType = 'success' | 'error' | 'info'
interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
}

export const useLibraryStore = defineStore('library', () => {
  const repos = ref<Repository[]>([])
  const groups = ref<Group[]>([])
  const apiConnected = ref(false)
  const loggedIn = ref(false)
  const userLogin = ref('Not signed in')
  const userAvatar = ref('')
  const loadError = ref('')
  const initialLoading = ref(true)
  const query = ref('')
  const filter = ref<ViewFilter>('all')
  const activeGroupId = ref<string>('')
  const activeRepoId = ref(0)
  const commandOpen = ref(false)
  const settingsOpen = ref(false)
  const settingsPanel = ref<SettingsPanel>('personal')
  const avatarOpen = ref(false)
  const theme = ref<ThemeMode>('light')
  const syncing = ref(false)
  const syncLabel = ref('Idle')
  const newGroupName = ref('')
  const starInput = ref('')
  const modelDraft = ref({ baseUrl: defaultModelSettings.baseUrl, modelName: defaultModelSettings.modelName, apiKey: '' })
  const defaultGroupSuggestions = ref<GroupSuggestion[]>([])
  const selectedDefaultGroups = ref<string[]>([])
  const repoGroupSuggestions = ref<GroupSuggestion[]>([])
  const groupSuggesting = ref(false)
  const groupAccepting = ref(false)
  const groupSuggestionStatus = ref('点击生成，AI 会分析全部 Star 后给出中文候选分组')
  const syncProgress = ref(0)
  const summaryGenerating = ref(false)
  const summaryProgress = ref(0)
  const summaryLabel = ref('Idle')
  const modelTesting = ref(false)
  const modelTestStatus = ref('Not tested')
  const settings = ref(defaultModelSettings)
  const toast = ref({ open: false, type: 'info' as ToastType, title: '', message: '' })
  const confirmDialog = ref({
    open: false,
    title: '',
    message: '',
    confirmLabel: '确认',
    cancelLabel: '取消',
    tone: 'primary' as 'danger' | 'primary',
    resolve: undefined as undefined | ((value: boolean) => void),
  })
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  const orderedRepos = computed(() => [...repos.value].sort((a, b) => Date.parse(b.starredAt) - Date.parse(a.starredAt)))
  const recentCutoff = computed(() => Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000)
  const isRecentRepo = (repo: Repository) => Date.parse(repo.starredAt) >= recentCutoff.value

  const counts = computed(() => ({
    all: repos.value.length,
    ungrouped: repos.value.filter((repo) => repo.groups.length === 0).length,
    recent: repos.value.filter(isRecentRepo).length,
    summary: repos.value.filter((repo) => repo.userSummary || repo.aiSummary).length,
    missing: repos.value.filter((repo) => !(repo.userSummary || repo.aiSummary)).length,
  }))

  const groupCounts = computed(() => {
    const result: Record<string, number> = {}
    for (const group of groups.value) result[group.id] = 0
    for (const repo of repos.value) for (const groupId of repo.groups) result[groupId] = (result[groupId] ?? 0) + 1
    return result
  })

  function notify(title: string, message = '', type: ToastType = 'info') {
    if (toastTimer) clearTimeout(toastTimer)
    toast.value = { open: true, type, title, message }
    toastTimer = setTimeout(() => {
      toast.value.open = false
    }, 3600)
  }

  function askConfirm(options: ConfirmOptions) {
    return new Promise<boolean>((resolve) => {
      confirmDialog.value = {
        open: true,
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? '确认',
        cancelLabel: options.cancelLabel ?? '取消',
        tone: options.tone ?? 'primary',
        resolve,
      }
    })
  }

  function answerConfirm(value: boolean) {
    confirmDialog.value.resolve?.(value)
    confirmDialog.value.open = false
  }

  const activeRepo = computed(() => repos.value.find((repo) => repo.id === activeRepoId.value) ?? filteredRepos.value[0])
  const missingSummaryCount = computed(() => repos.value.filter((repo) => !(repo.userSummary || repo.aiSummary)).length)

  const filteredRepos = computed(() => {
    const keyword = query.value.trim().toLowerCase()
    return orderedRepos.value.filter((repo) => {
      if (filter.value === 'ungrouped' && repo.groups.length > 0) return false
      if (filter.value === 'recent' && !isRecentRepo(repo)) return false
      if (filter.value === 'summary' && !(repo.userSummary || repo.aiSummary)) return false
      if (filter.value === 'missing' && (repo.userSummary || repo.aiSummary)) return false
      if (activeGroupId.value && !repo.groups.includes(activeGroupId.value)) return false
      if (!keyword) return true
      const groupNames = repo.groups.map((id) => groups.value.find((group) => group.id === id)?.name ?? id).join(' ')
      return [repo.owner, repo.name, repo.description, repo.language, repo.aiSummary, repo.aiDetailSummary, repo.userSummary, repo.userDetailSummary, repo.note, groupNames]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  })

  const modeTitle = computed(() => {
    if (!loggedIn.value) return 'Connect GitHub to start.'
    if (activeGroupId.value) return `${groups.value.find((group) => group.id === activeGroupId.value)?.name ?? 'Group'} Group`
    if (filter.value === 'ungrouped') return 'Repos waiting for a home.'
    if (filter.value === 'recent') return 'Repos starred in the last 7 days.'
    if (filter.value === 'summary') return 'Repos with useful summaries.'
    if (filter.value === 'missing') return 'Repos waiting for AI summaries.'
    return 'Your searchable Star Library.'
  })

  function selectFilter(nextFilter: ViewFilter) {
    filter.value = nextFilter
    activeGroupId.value = ''
    ensureActiveVisible()
  }

  function selectGroup(groupId: string) {
    activeGroupId.value = groupId
    filter.value = 'all'
    ensureActiveVisible()
  }

  function selectRepo(repoId: number) {
    activeRepoId.value = repoId
  }

  function ensureActiveVisible() {
    const first = filteredRepos.value[0]
    if (first && !filteredRepos.value.some((repo) => repo.id === activeRepoId.value)) activeRepoId.value = first.id
    if (!first) activeRepoId.value = 0
  }

  function setQuery(value: string) {
    query.value = value
    ensureActiveVisible()
  }

  function clearQuery() {
    query.value = ''
    ensureActiveVisible()
  }

  function openSettings(panel: SettingsPanel) {
    settingsPanel.value = panel
    settingsOpen.value = true
    avatarOpen.value = false
    if (panel === 'model') void loadModelSettings()
  }

  async function loadModelSettings() {
    try {
      const result = await getSettings()
      if (result.model.base_url) modelDraft.value.baseUrl = result.model.base_url
      if (result.model.model_name) modelDraft.value.modelName = result.model.model_name
      modelDraft.value.apiKey = ''
      settings.value.baseUrl = result.model.base_url || settings.value.baseUrl
      settings.value.modelName = result.model.model_name || settings.value.modelName
      settings.value.hasApiKey = Boolean(result.model.enabled && result.model.api_key_masked)
      modelTestStatus.value = result.model.api_key_masked ? 'Saved key configured. API Key is hidden.' : 'Not tested'
    } catch (error) {
      modelTestStatus.value = error instanceof Error ? error.message : 'Load model settings failed'
    }
  }

  function toggleTheme() {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
  }

  async function updateSummary(repoId: number, shortSummary: string, detailSummary: string) {
    const repo = repos.value.find((item) => item.id === repoId)
    if (!repo) return
    const short = shortSummary.trim() || detailSummary.trim().slice(0, 120)
    const detail = detailSummary.trim()
    await saveUserSummary(repo.storageId ?? repoId, short, detail)
    repo.userSummary = short
    repo.userDetailSummary = detail
  }

  async function toggleGroup(repoId: number, groupId: string) {
    const repo = repos.value.find((item) => item.id === repoId)
    if (!repo) return
    const nextGroups = repo.groups.includes(groupId) ? repo.groups.filter((id) => id !== groupId) : [...repo.groups, groupId]
    await saveRepoGroups(repo.storageId ?? repoId, nextGroups)
    repo.groups = nextGroups
  }

  async function setRepoGroups(repoId: number, groupIds: string[]) {
    const repo = repos.value.find((item) => item.id === repoId)
    if (!repo) return
    await saveRepoGroups(repo.storageId ?? repoId, groupIds)
    repo.groups = groupIds
    notify('分组已保存', `${repo.owner}/${repo.name} 已更新为 ${groupIds.length} 个分组。`, 'success')
  }

  function runCommand(rawCommand: string) {
    const command = rawCommand.toLowerCase().trim()
    if (command.includes('ungroup')) selectFilter('ungrouped')
    else if (command.includes('recent')) selectFilter('recent')
    else if (command.includes('summary')) selectFilter('summary')
    else if (command.includes('dark')) theme.value = 'dark'
    else if (command.includes('light')) theme.value = 'light'
    else if (command.includes('sync')) void syncGitHub()
    else setQuery(command.replace(/^search\s+/, ''))
    commandOpen.value = false
  }

  async function loadDefaultGroupSuggestions() {
    if (groupSuggesting.value) return
    if (!settings.value.hasApiKey) {
      groupSuggestionStatus.value = '请先在 Model Settings 配置大模型'
      openSettings('model')
      return
    }
    groupSuggesting.value = true
    groupSuggestionStatus.value = `AI 正在分析 ${repos.value.length} 个 Star 仓库…`
    try {
      const result = await getDefaultGroupSuggestions()
      defaultGroupSuggestions.value = result.suggestions
      selectedDefaultGroups.value = result.suggestions.map((item) => item.name)
      groupSuggestionStatus.value = result.suggestions.length
        ? `已生成 ${result.suggestions.length} 个最终候选分组，请勾选后入库`
        : repos.value.length ? '模型没有返回可用中文分组，请重试或检查模型输出' : '请先同步 Star，再生成 AI 分组建议'
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 分组生成失败'
      groupSuggestionStatus.value = message
      loadError.value = message
    } finally {
      groupSuggesting.value = false
    }
  }

  async function loadRepoGroupSuggestions() {
    const repo = activeRepo.value
    if (!repo) return
    repoGroupSuggestions.value = (await getRepoGroupSuggestions(repo.storageId ?? repo.id)).suggestions
  }

  function toggleDefaultGroupSelection(name: string) {
    selectedDefaultGroups.value = selectedDefaultGroups.value.includes(name)
      ? selectedDefaultGroups.value.filter((item) => item !== name)
      : [...selectedDefaultGroups.value, name]
  }

  function selectAllDefaultGroups() {
    selectedDefaultGroups.value = defaultGroupSuggestions.value.map((item) => item.name)
  }

  function clearDefaultGroupSelection() {
    selectedDefaultGroups.value = []
  }

  async function acceptSuggestedGroup(name: string) {
    const suggestion = defaultGroupSuggestions.value.find((item) => item.name === name)
    await addGroup(name, suggestion?.reason)
  }

  async function acceptSelectedDefaultGroups() {
    if (groupAccepting.value) return
    const selected = defaultGroupSuggestions.value.filter((item) => selectedDefaultGroups.value.includes(item.name))
    if (!selected.length) {
      groupSuggestionStatus.value = '请先选择要入库的候选分组'
      return
    }
    groupAccepting.value = true
    groupSuggestionStatus.value = `AI 正在为 ${repos.value.length} 个仓库落组并入库…`
    try {
      const result = await acceptGroupSuggestions(selected)
      groups.value.push(...result.groups.map((group) => ({ ...group, description: group.description ?? `${group.name} repositories`, color: group.color ?? 'blue' })))
      selectedDefaultGroups.value = []
      defaultGroupSuggestions.value = []
      groupSuggestionStatus.value = `已入库 ${result.groups.length} 个分组，AI 落组 ${result.ai_assigned_count ?? 0} 条，写入关联 ${result.assigned_count} 条`
      await loadFromApi()
    } catch (error) {
      const message = error instanceof Error ? error.message : '分组入库失败'
      groupSuggestionStatus.value = message
      loadError.value = message
    } finally {
      groupAccepting.value = false
    }
  }

  async function smartGroupUngrouped() {
    if (groupAccepting.value) return
    if (!settings.value.hasApiKey) {
      groupSuggestionStatus.value = '请先在 Model Settings 配置大模型'
      openSettings('model')
      return
    }
    if (counts.value.ungrouped === 0) {
      groupSuggestionStatus.value = '当前没有未分组仓库'
      return
    }
    groupAccepting.value = true
    groupSuggestionStatus.value = `AI 正在为 ${counts.value.ungrouped} 个未分组仓库匹配分组…`
    try {
      let result = await autoAssignGroups(false)
      if (result.needs_confirmation && result.proposed_groups?.length) {
        const names = result.proposed_groups.map((group) => group.name).join('、')
        const confirmed = await askConfirm({
          title: '创建新分组？',
          message: `部分仓库没有合适的现有分组。是否创建新分组：${names}？`,
          confirmLabel: '创建并分组',
        })
        if (!confirmed) {
          groupSuggestionStatus.value = '已取消创建新分组，未写入自动落组'
          notify('已取消智能分组', '没有创建新分组，也没有写入自动落组。', 'info')
          return
        }
        result = await autoAssignGroups(true)
      }
      groupSuggestionStatus.value = `智能分组完成：处理 ${result.considered_count} 个未分组仓库，写入关联 ${result.assigned_count} 条，新建 ${result.created_groups.length} 个分组`
      notify('智能分组完成', `写入关联 ${result.assigned_count} 条，新建 ${result.created_groups.length} 个分组。`, 'success')
      await loadFromApi()
    } catch (error) {
      const message = error instanceof Error ? error.message : '智能分组失败'
      groupSuggestionStatus.value = message
      loadError.value = message
      notify('智能分组失败', message, 'error')
    } finally {
      groupAccepting.value = false
    }
  }

  async function addGroup(name: string, description?: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const result = await createGroup(trimmed, description?.trim())
    groups.value.push({ ...result.group, description: result.group.description ?? description ?? `${result.group.name} repositories`, color: result.group.color ?? 'blue' })
    newGroupName.value = ''
  }

  async function editGroupName(groupId: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    await renameGroup(groupId, trimmed)
    const group = groups.value.find((item) => item.id === groupId)
    if (group) group.name = trimmed
  }

  async function removeGroup(groupId: string) {
    await deleteGroup(groupId)
    groups.value = groups.value.filter((group) => group.id !== groupId)
    for (const repo of repos.value) repo.groups = repo.groups.filter((id) => id !== groupId)
    if (activeGroupId.value === groupId) activeGroupId.value = ''
  }

  async function starPublicRepo(input: string) {
    const [owner, name] = input.trim().replace(/^https:\/\/github.com\//, '').split('/')
    if (!owner || !name) return
    await starRepo(owner, name)
    starInput.value = ''
    await loadFromApi()
  }

  async function toggleStar(repoId: number) {
    const repo = repos.value.find((item) => item.id === repoId)
    if (!repo) return
    await unstarRepo(repo.owner, repo.name)
    repos.value = repos.value.filter((item) => item.id !== repoId)
    ensureActiveVisible()
  }

  async function generateActiveSummary() {
    const repo = activeRepo.value
    if (!repo) return
    if (!settings.value.hasApiKey) {
      loadError.value = '请先在 Model Settings 配置并测试大模型，再生成中文摘要'
      openSettings('model')
      return
    }
    await runSummaryJob((await startSummary(repo.storageId ?? repo.id)).job)
  }

  async function saveModelDraft() {
    try {
      const result = await saveModelSettings(modelDraft.value)
      settings.value.baseUrl = result.model.base_url
      settings.value.modelName = result.model.model_name
      settings.value.hasApiKey = true
      modelDraft.value.apiKey = ''
      modelTestStatus.value = 'Saved. Run test when needed.'
      loadError.value = ''
      settingsOpen.value = false
      notify('模型设置已保存', 'API Key 已隐藏保存。', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save model settings failed'
      modelTestStatus.value = message
      loadError.value = message
      notify('模型设置保存失败', message, 'error')
    }
  }

  async function testModelDraft() {
    if (modelTesting.value) return
    modelTesting.value = true
    modelTestStatus.value = 'Testing connection…'
    try {
      const result = await testModelSettings(modelDraft.value)
      modelTestStatus.value = `Connected · ${result.latency_ms}ms`
    } catch (error) {
      modelTestStatus.value = error instanceof Error ? error.message : 'Model test failed'
    } finally {
      modelTesting.value = false
    }
  }

  async function syncGitHub(mode: 'sync' | 'repair' = 'repair') {
    if (syncing.value) return
    if (!settings.value.hasApiKey) {
      loadError.value = '请先在 Model Settings 配置并测试大模型，再同步 GitHub Stars'
      openSettings('model')
      return
    }
    syncing.value = true
    syncLabel.value = 'Sync GitHub'
    syncProgress.value = 10
    try {
      const started = await startSync(mode)
      let job = started.job
      syncProgress.value = job.status === 'success' ? 100 : 15

      while (job.status === 'pending' || job.status === 'running') {
        const stepped = await stepSync(job.id)
        job = stepped.job
        syncProgress.value = job.status === 'success'
          ? 100
          : Math.min(95, Math.max(15, job.total_count ? Math.round((job.processed_count / job.total_count) * 100) : 15 + job.processed_count))
      }

      if (job.status === 'failed') throw new Error('sync failed')
      if (job.status === 'paused') throw new Error('GitHub rate limited. Try again later.')

      await loadFromApi()
      if (settings.value.hasApiKey && missingSummaryCount.value > 0) await generateMissingSummaries()
      if (groups.value.length > 0) {
        syncLabel.value = 'Auto grouping'
        await autoAssignGroups()
        await loadFromApi()
      }
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : 'sync failed'
    } finally {
      syncing.value = false
    }
  }


  async function generateMissingSummaries() {
    if (!settings.value.hasApiKey) {
      loadError.value = '请先在 Model Settings 配置并测试大模型，再批量生成中文摘要'
      openSettings('model')
      return
    }
    await runSummaryJob((await startMissingSummaries()).job)
  }

  async function runSummaryJob(startJob: SummaryJob) {
    if (summaryGenerating.value) return
    summaryGenerating.value = true
    let job = startJob
    summaryProgress.value = job.total_count ? Math.round((job.processed_count / job.total_count) * 100) : 100
    summaryLabel.value = job.total_count ? `Generating ${job.processed_count}/${job.total_count}` : 'No missing summaries'
    try {
      while (job.status === 'pending' || job.status === 'running') {
        const stepped = await stepSummary(job.id)
        job = stepped.job
        summaryProgress.value = job.total_count ? Math.round((job.processed_count / job.total_count) * 100) : 100
        summaryLabel.value = `Generating ${job.processed_count}/${job.total_count}${job.failed_count ? ` · failed ${job.failed_count}` : ''}`
      }
      await loadFromApi()
      if (job.failed_count) loadError.value = `摘要生成完成，失败 ${job.failed_count} 个，可稍后右键卡片重新生成`
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : 'summary failed'
    } finally {
      summaryGenerating.value = false
    }
  }

  async function loadFromApi() {
    try {
      const me = await getMe()
      loggedIn.value = Boolean(me.user)
      userLogin.value = me.user?.login ?? 'Not signed in'
      userAvatar.value = me.user?.avatar_url ?? ''
      settings.value.hasApiKey = Boolean(me.settings.model_enabled)
      if (!me.user) {
        repos.value = []
        groups.value = []
        apiConnected.value = true
        loadError.value = 'Login required'
        return
      }
      const [repoResult, groupResult] = await Promise.all([
        getRepos(filter.value === 'summary' ? 'has_summary' : filter.value === 'missing' ? 'all' : filter.value, activeGroupId.value),
        getGroups(),
      ])
      groups.value = groupResult.items.map((group) => ({ ...group, description: group.description ?? `${group.name} repositories`, color: group.color ?? 'blue' }))
      repos.value = repoResult.items.map(mapApiRepo)
      apiConnected.value = true
      loadError.value = ''
      ensureActiveVisible()
    } catch (error) {
      repos.value = []
      groups.value = []
      apiConnected.value = false
      loggedIn.value = false
      loadError.value = error instanceof Error ? error.message : 'api unavailable'
    } finally {
      initialLoading.value = false
    }
  }

  function loginWithGitHub() {
    window.location.href = '/api/auth/github/start'
  }

  return {
    repos, groups, query, filter, activeGroupId, activeRepoId, commandOpen, settingsOpen, settingsPanel, avatarOpen, theme, toast, confirmDialog,
    syncing, syncLabel, newGroupName, starInput, modelDraft, defaultGroupSuggestions, selectedDefaultGroups, repoGroupSuggestions, groupSuggesting, groupAccepting, groupSuggestionStatus, apiConnected, loggedIn,
    userLogin, userAvatar, loadError, initialLoading, syncProgress, summaryGenerating, summaryProgress, summaryLabel, modelTesting, modelTestStatus, settings, orderedRepos, filteredRepos, activeRepo, missingSummaryCount, counts, groupCounts,
    modeTitle, notify, askConfirm, answerConfirm, selectFilter, selectGroup, selectRepo, setQuery, clearQuery, openSettings, toggleTheme, updateSummary, toggleGroup, setRepoGroups,
    runCommand, loadDefaultGroupSuggestions, loadRepoGroupSuggestions, toggleDefaultGroupSelection, selectAllDefaultGroups, clearDefaultGroupSelection, acceptSuggestedGroup, acceptSelectedDefaultGroups, smartGroupUngrouped, addGroup, editGroupName, removeGroup,
    starPublicRepo, toggleStar, generateActiveSummary, generateMissingSummaries, saveModelDraft, testModelDraft, syncGitHub, loadFromApi, loginWithGitHub,
  }
})
