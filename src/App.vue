<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useLibraryStore } from './stores/library'
import type { Repository, SettingsPanel, ViewFilter } from './types/domain'

const store = useLibraryStore()
const {
  groups,
  query,
  filter,
  activeGroupId,
  commandOpen,
  settingsOpen,
  settingsPanel,
  avatarOpen,
  theme,
  toast,
  confirmDialog,
  syncing,
  syncLabel,
  syncProgress,
  summaryGenerating,
  summaryProgress,
  summaryLabel,
  modelTesting,
  modelTestStatus,
  newGroupName,
  starInput,
  modelDraft,
  defaultGroupSuggestions,
  selectedDefaultGroups,
  groupSuggesting,
  groupAccepting,
  groupSuggestionStatus,
  apiConnected,
  loggedIn,
  userLogin,
  loadError,
  initialLoading,
  filteredRepos,
  activeRepo,
  missingSummaryCount,
  counts,
  groupCounts,
  modeTitle,
} = storeToRefs(store)

const commandText = ref('')
const draftShortSummary = ref('')
const draftDetailSummary = ref('')
const contextMenu = ref({ open: false, x: 0, y: 0, repoId: 0 })
const batchMenu = ref({ open: false, x: 0, y: 0, kind: '' as 'ungrouped' | 'missing' | '' })
const summaryEditorOpen = ref(false)
const groupEditorOpen = ref(false)
const draftGroupIds = ref<string[]>([])

const viewItems: Array<{ id: ViewFilter; title: string; desc: string; tone: string }> = [
  { id: 'all', title: 'All Starred', desc: '所有已 star 工程', tone: 'blue' },
  { id: 'ungrouped', title: 'Ungrouped', desc: '没有进入分组', tone: 'amber' },
  { id: 'recent', title: 'Recently Starred', desc: '最近 7 天 star 的工程', tone: 'green' },
  { id: 'missing', title: 'Missing Summary', desc: '等待生成摘要', tone: 'red' },
]

const settingsMeta: Record<SettingsPanel, { title: string; eyebrow: string }> = {
  personal: { title: 'Personal Settings', eyebrow: 'profile' },
  groups: { title: 'Group Settings', eyebrow: 'groups' },
  model: { title: 'Model Settings', eyebrow: 'AI' },
}

const activeSummary = computed(() => activeRepo.value?.userSummary || activeRepo.value?.aiSummary || activeRepo.value?.description || '暂无摘要。')
const activeDetailSummary = computed(() => activeRepo.value?.userDetailSummary || activeRepo.value?.aiDetailSummary || activeRepo.value?.description || '暂无详细摘要。')
const activeLanguage = computed(() => activeRepo.value?.language && activeRepo.value.language !== 'Unknown' ? activeRepo.value.language : '未标注')
const activeGroupLabel = computed(() => {
  const repo = activeRepo.value
  if (!repo || repo.groups.length === 0) return '未分组'
  return repo.groups.map(groupName).join('、')
})
const draftShortCount = computed(() => draftShortSummary.value.trim().length)
const draftDetailCount = computed(() => draftDetailSummary.value.trim().length)
const searchPlaceholder = '搜索已 Star：名称 / 语言 / 分组 / 摘要 / 备注…'
const emptyTitle = computed(() => (query.value ? '没有匹配项目' : '当前视图为空'))

watch(
  () => activeRepo.value?.id,
  () => {
    draftShortSummary.value = activeSummary.value
    draftDetailSummary.value = activeDetailSummary.value
  },
  { immediate: true },
)

watch(theme, (value) => {
  document.documentElement.dataset.theme = value
}, { immediate: true })

function formatStars(stars: number) {
  if (stars >= 1000) return `${(stars / 1000).toFixed(stars >= 10000 ? 1 : 1)}k`
  return String(stars)
}

function repoInitial(repo: Repository) {
  return repo.owner.slice(0, 1).toUpperCase() + repo.name.slice(0, 1).toUpperCase()
}

function groupName(groupId: string) {
  return groups.value.find((group) => group.id === groupId)?.name ?? groupId
}

function isGroupActive(groupId: string) {
  return activeGroupId.value === groupId
}

async function regenerateSummaryDraft() {
  if (!activeRepo.value) return
  await store.generateActiveSummary()
  draftShortSummary.value = activeSummary.value
  draftDetailSummary.value = activeDetailSummary.value
}

async function saveSummary() {
  if (!activeRepo.value) return
  await store.updateSummary(activeRepo.value.id, draftShortSummary.value, draftDetailSummary.value)
  summaryEditorOpen.value = false
  store.notify('摘要已保存', '卡片和详情会优先展示人工摘要。', 'success')
}

async function unstarActiveRepo() {
  if (!activeRepo.value) return
  const repo = activeRepo.value
  const confirmed = await store.askConfirm({
    title: '确认 Unstar？',
    message: `${repo.owner}/${repo.name} 会从你的 GitHub Stars 移除。`,
    confirmLabel: 'Unstar',
    tone: 'danger',
  })
  if (!confirmed) return
  await store.toggleStar(repo.id)
}

function openRepoMenuAt(x: number, y: number, repo: Repository) {
  store.selectRepo(repo.id)
  contextMenu.value = {
    open: true,
    x: Math.min(x, window.innerWidth - 286),
    y: Math.min(y, window.innerHeight - 128),
    repoId: repo.id,
  }
}

function openRepoMenu(event: MouseEvent, repo: Repository) {
  openRepoMenuAt(event.clientX, event.clientY, repo)
}

function openViewMenu(event: MouseEvent, id: ViewFilter) {
  if (id !== 'ungrouped' && id !== 'missing') return
  batchMenu.value = {
    open: true,
    x: Math.min(event.clientX, window.innerWidth - 286),
    y: Math.min(event.clientY, window.innerHeight - 96),
    kind: id,
  }
}

function closeRepoMenu() {
  contextMenu.value.open = false
  batchMenu.value.open = false
}

async function runBatchAction() {
  const kind = batchMenu.value.kind
  closeRepoMenu()
  if (kind === 'ungrouped') await store.smartGroupUngrouped()
  if (kind === 'missing') await store.generateMissingSummaries()
}

function openSummaryEditor() {
  if (!activeRepo.value) return
  draftShortSummary.value = activeSummary.value
  draftDetailSummary.value = activeDetailSummary.value
  summaryEditorOpen.value = true
  closeRepoMenu()
}

function openGroupEditor() {
  if (!activeRepo.value) return
  draftGroupIds.value = [...activeRepo.value.groups]
  groupEditorOpen.value = true
  closeRepoMenu()
}

function toggleDraftGroup(groupId: string) {
  draftGroupIds.value = draftGroupIds.value.includes(groupId)
    ? draftGroupIds.value.filter((id) => id !== groupId)
    : [...draftGroupIds.value, groupId]
}

async function saveGroupDraft() {
  if (!activeRepo.value) return
  await store.setRepoGroups(activeRepo.value.id, draftGroupIds.value)
  groupEditorOpen.value = false
}

function runQuickCommand(command: string) {
  commandText.value = command
  store.runCommand(command)
  commandText.value = ''
}

function submitCommand() {
  store.runCommand(commandText.value)
  commandText.value = ''
}

function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    commandOpen.value = true
  }
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) {
    event.preventDefault()
    document.querySelector<HTMLInputElement>('[data-search]')?.focus()
  }
  if (event.key === 'Escape') {
    commandOpen.value = false
    settingsOpen.value = false
    avatarOpen.value = false
    summaryEditorOpen.value = false
    groupEditorOpen.value = false
    closeRepoMenu()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void store.loadFromApi()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="app-shell" @click="closeRepoMenu">
    <aside class="sidebar">
      <section class="brand">
        <div class="brandline">
          <div class="logo">GS</div>
          <div>
            <b>GitStars</b>
            <span>AI GitHub Star manager · MVP</span>
          </div>
        </div>
        <h1>Star Library, built for action.</h1>
        <p>管理 GitHub Stars：搜索、分组、摘要、最近收藏、未分组清理。</p>
      </section>

      <nav class="nav" aria-label="GitStars navigation">
        <section class="sect">
          <div class="sect-title">Views <span>library</span></div>
          <button
            v-for="item in viewItems"
            :key="item.id"
            class="navitem"
            :class="{ active: filter === item.id && !activeGroupId }"
            type="button"
            @click="store.selectFilter(item.id)"
            @contextmenu.prevent.stop="openViewMenu($event, item.id)"
          >
            <i class="dot" :class="`tone-${item.tone}`" />
            <span><b>{{ item.title }}</b><span>{{ item.desc }}</span></span>
            <em>{{ counts[item.id] }}</em>
          </button>
        </section>

        <section class="sect">
          <div class="sect-title">Groups <span>multi</span></div>
          <button
            v-for="group in groups"
            :key="group.id"
            class="navitem"
            :class="{ active: isGroupActive(group.id) }"
            type="button"
            @click="store.selectGroup(group.id)"
          >
            <i class="dot" :class="`tone-${group.color}`" />
            <span><b>{{ group.name }}</b><span>{{ group.description }}</span></span>
            <em>{{ groupCounts[group.id] ?? 0 }}</em>
          </button>
        </section>
      </nav>

      <section class="side-card">
        <b>Default grouping</b>
        <p>AI 可根据真实 Star 生成默认分组；必须用户确认后保存。</p>
        <button type="button" @click="store.openSettings('groups')">Open group settings</button>
      </section>

      <footer class="sidefoot">
        <button class="footbtn" type="button" @click="commandOpen = true">Command</button>
        <button class="footbtn" type="button" aria-label="Toggle dark mode" @click="store.toggleTheme()">
          {{ theme === 'dark' ? '☀' : '◐' }}
        </button>
      </footer>
    </aside>

    <main class="main">
      <header class="topbar">
        <label class="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            data-search
            :value="query"
            :placeholder="searchPlaceholder"
            aria-label="Search starred repositories"
            @input="store.setQuery(($event.target as HTMLInputElement).value)"
          >
          <span class="kbd">/</span>
          <span class="kbd">⌘K</span>
        </label>

        <div class="top-actions">
          <div class="api-pill" :class="{ live: apiConnected }" :title="loadError || 'API connected'">{{ loggedIn ? 'GitHub live' : 'Not signed in' }}</div>
          <div v-if="syncing" class="sync-status" aria-live="polite">
            <i :style="{ width: `${syncProgress}%` }" />
            <span>{{ syncLabel }} {{ syncProgress }}%</span>
          </div>
          <div v-if="summaryGenerating" class="sync-status summary-live" aria-live="polite">
            <i :style="{ width: `${summaryProgress}%` }" />
            <span>摘要生成 {{ summaryProgress }}%</span>
          </div>
          <button v-if="loggedIn" class="btn primary" type="button" :disabled="syncing" title="同步并完整对账 GitHub Stars" @click="store.syncGitHub()">
            {{ syncing ? 'Syncing…' : 'Sync GitHub' }}
          </button>
          <button v-else class="btn primary" type="button" @click="store.loginWithGitHub()">Connect GitHub</button>
          <div class="userwrap">
            <button class="avatarbtn" type="button" aria-label="User settings" @click.stop="avatarOpen = !avatarOpen">{{ loggedIn ? userLogin.slice(0, 2).toUpperCase() : 'GH' }}</button>
            <div v-if="avatarOpen" class="userdrop">
              <div class="userhead">
                <b>{{ userLogin }}</b>
                <span>{{ loggedIn ? 'GitHub connected · Cloud sync on' : 'Connect GitHub to sync stars' }}</span>
              </div>
              <button class="dropitem" type="button" @click="store.openSettings('personal')"><b>Personal Settings</b><span>profile</span></button>
              <button class="dropitem" type="button" @click="store.openSettings('groups')"><b>Group Settings</b><span>groups</span></button>
              <button class="dropitem" type="button" @click="store.openSettings('model')"><b>Model Settings</b><span>AI</span></button>
              <button class="dropitem" type="button" @click="commandOpen = true; avatarOpen = false"><b>Command Palette</b><span>⌘K</span></button>
            </div>
          </div>
        </div>
      </header>

      <section class="workbench">
        <section class="listpane">
          <div v-if="loadError && loggedIn" class="notice">{{ loadError }}</div>
          <div class="head">
            <div class="stamp">{{ activeGroupId ? 'Group View' : filter }}</div>
            <h2>{{ modeTitle }}</h2>
            <p>卡片展示摘要：优先用户编辑，其次 AI 生成。搜索命中名称、语言、分组、摘要和备注。</p>
          </div>

          <div class="querybar statusbar">
            <div class="queryline">
              <span class="qlabel">Current View</span>
              <button class="chip" :class="{ active: filter === 'all' && !activeGroupId }" type="button" @click="store.selectFilter('all')"><i />全部 · {{ counts.all }}</button>
              <button class="chip" :class="{ active: filter === 'ungrouped' && !activeGroupId }" type="button" @click="store.selectFilter('ungrouped')" @contextmenu.prevent.stop="openViewMenu($event, 'ungrouped')"><i />未分组 · {{ counts.ungrouped }}</button>
              <button class="chip" :class="{ active: filter === 'recent' && !activeGroupId }" type="button" @click="store.selectFilter('recent')"><i />最近 · {{ counts.recent }}</button>
              <button class="chip" :class="{ active: filter === 'missing' && !activeGroupId }" type="button" @click="store.selectFilter('missing')" @contextmenu.prevent.stop="openViewMenu($event, 'missing')"><i />缺摘要 · {{ missingSummaryCount }}</button>
            </div>
            <div v-if="summaryGenerating" class="summary-global" aria-live="polite">
              <i :style="{ width: `${summaryProgress}%` }" />
              <span>{{ summaryLabel }} · 摘要异步生成中，完成后自动刷新卡片</span>
            </div>
            <div v-if="groupAccepting" class="summary-global group-global" aria-live="polite">
              <i />
              <span>{{ groupSuggestionStatus }}</span>
            </div>
          </div>

          <div class="items" aria-live="polite">
            <div v-if="initialLoading" class="loading-state" role="status" aria-live="polite">
              <div class="loading-copy">
                <b>正在加载 Star Library</b>
                <span>连接 GitHub 会话、读取 D1 仓库、分组和摘要数据…</span>
              </div>
              <div v-for="item in 6" :key="item" class="repo-card skeleton-card" aria-hidden="true">
                <div class="rank skeleton-block" />
                <div class="repo-main">
                  <div class="skeleton-line title" />
                  <div class="skeleton-line" />
                  <div class="tags">
                    <span class="mini skeleton-tag" />
                    <span class="mini skeleton-tag short" />
                  </div>
                </div>
                <div class="score"><span class="skeleton-line score-line" /></div>
              </div>
            </div>

            <template v-else>
              <article
                v-for="repo in filteredRepos"
                :key="repo.id"
                class="repo-card"
                :class="{ active: activeRepo?.id === repo.id }"
                @click="store.selectRepo(repo.id)"
                @contextmenu.prevent.stop="openRepoMenu($event, repo)"
              >
                <div class="rank" aria-hidden="true">{{ repoInitial(repo) }}</div>
                <div class="repo-main">
                  <div class="repo-title">
                    <b>{{ repo.owner }}/{{ repo.name }}</b>
                  </div>
                  <p class="summary">{{ repo.userSummary || repo.aiSummary || repo.description || '暂无摘要' }}</p>
                  <div class="tags">
                    <span v-if="repo.language !== 'Unknown'" class="mini">Lang · {{ repo.language }}</span>
                    <span v-for="groupId in repo.groups" :key="groupId" class="mini">Group · {{ groupName(groupId) }}</span>
                    <span v-if="repo.groups.length === 0" class="mini warn">未分组</span>
                  </div>
                </div>
                <div class="score">
                  <b>★ {{ formatStars(repo.stars) }}</b>
                </div>
              </article>

              <div v-if="filteredRepos.length === 0" class="empty">
                <b>{{ emptyTitle }}</b>
                <div>{{ loggedIn ? '当前没有数据。点击 Sync GitHub 同步真实 Star。' : '没有本地示例数据。请连接 GitHub 后同步你的真实 Star。' }}</div>
                <button v-if="!loggedIn" type="button" @click="store.loginWithGitHub()">Connect GitHub</button>
                <button v-else type="button" @click="store.syncGitHub()">Sync GitHub</button>
                <button type="button" @click="store.clearQuery()">Clear search</button>
              </div>
            </template>
          </div>
        </section>

        <section v-if="activeRepo" class="detailpane">
          <div class="detail">
            <section class="feature">
              <div class="feature-hero">
                <div class="detail-kicker">
                  <div class="detail-logo" aria-hidden="true">{{ repoInitial(activeRepo) }}</div>
                </div>
                <div class="detail-title-row">
                  <h3>
                    <a :href="activeRepo.homepage" target="_blank" rel="noreferrer">
                      {{ activeRepo.owner }}/{{ activeRepo.name }}
                    </a>
                  </h3>
                </div>
                <p>{{ activeRepo.description || activeSummary }}</p>
              </div>
              <div class="metrics">
                <div class="metric"><b>{{ formatStars(activeRepo.stars) }}</b><span>stars</span></div>
                <div class="metric"><b>{{ activeGroupLabel }}</b><span>groups</span></div>
                <div class="metric"><b>{{ activeLanguage }}</b><span>language</span></div>
                <button class="metric action danger" type="button" @click="unstarActiveRepo"><b>Unstar</b><span>remove from GitHub</span></button>
              </div>
            </section>

            <section class="blocks display-only summary-stack">
              <div class="block ai summary-showcase short-card">
                <h4>简单摘要 <span>卡片展示</span></h4>
                <p>{{ activeSummary }}</p>
              </div>
              <div class="block ai summary-showcase detail-card">
                <h4>详细摘要 <span>详情阅读</span></h4>
                <p>{{ activeDetailSummary }}</p>
                <div v-if="summaryGenerating" class="job-rail"><i :style="{ width: `${summaryProgress}%` }" /><span>{{ summaryLabel }}</span></div>
              </div>
            </section>
          </div>
        </section>
      </section>
    </main>

    <div
      v-if="batchMenu.open"
      class="repo-context-menu"
      :style="{ left: `${batchMenu.x}px`, top: `${batchMenu.y}px` }"
      role="menu"
      @click.stop
    >
      <button v-if="batchMenu.kind === 'ungrouped'" type="button" role="menuitem" :disabled="groupAccepting || counts.ungrouped === 0" @click="runBatchAction">
        <i aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h7l2 3h9v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
        </i>
        <b>一键分组</b>
        <span>未分组仓库进入已有分组；必要时确认新建</span>
      </button>
      <button v-if="batchMenu.kind === 'missing'" type="button" role="menuitem" :disabled="summaryGenerating || missingSummaryCount === 0" @click="runBatchAction">
        <i aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16M4 12h10M4 19h16" /></svg>
        </i>
        <b>一键摘要</b>
        <span>为所有缺摘要仓库批量生成中文摘要</span>
      </button>
    </div>

    <div
      v-if="contextMenu.open"
      class="repo-context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      role="menu"
      @click.stop
    >
      <button type="button" role="menuitem" @click="openSummaryEditor">
        <i aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16M4 12h10M4 19h16" /></svg>
        </i>
        <b>编辑摘要</b>
        <span>修改简单/详细中文摘要</span>
      </button>
      <button type="button" role="menuitem" @click="openGroupEditor">
        <i aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h7l2 3h9v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
        </i>
        <b>编辑分组</b>
        <span>为仓库添加或移除分组</span>
      </button>
    </div>

    <div v-if="toast.open" class="toast-stack" aria-live="polite">
      <div class="system-toast" :class="`toast-${toast.type}`">
        <i />
        <div>
          <b>{{ toast.title }}</b>
          <span v-if="toast.message">{{ toast.message }}</span>
        </div>
        <button type="button" aria-label="Close notification" @click="toast.open = false">×</button>
      </div>
    </div>

    <div v-if="confirmDialog.open" class="modal confirm-layer" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div class="confirm-card">
        <div class="confirm-mark" :class="{ danger: confirmDialog.tone === 'danger' }">!</div>
        <div>
          <span>system confirm</span>
          <h3 id="confirm-title">{{ confirmDialog.title }}</h3>
          <p>{{ confirmDialog.message }}</p>
        </div>
        <div class="confirm-actions">
          <button class="outline" type="button" @click="store.answerConfirm(false)">{{ confirmDialog.cancelLabel }}</button>
          <button class="solid" :class="{ danger: confirmDialog.tone === 'danger' }" type="button" @click="store.answerConfirm(true)">{{ confirmDialog.confirmLabel }}</button>
        </div>
      </div>
    </div>

    <div v-if="summaryEditorOpen" class="modal" role="dialog" aria-modal="true" aria-labelledby="summary-editor-title" @click.self="summaryEditorOpen = false">
      <div class="modal-card summary-editor-modal">
        <div class="modal-head">
          <div>
            <span>summary</span>
            <h3 id="summary-editor-title">编辑中文摘要</h3>
          </div>
          <button class="modal-close" type="button" aria-label="Close summary editor" @click="summaryEditorOpen = false">×</button>
        </div>
        <div class="modal-body">
          <div class="editor-shell">
            <aside class="editor-guide">
              <b>{{ activeRepo?.owner }}/{{ activeRepo?.name }}</b>
              <p>简单摘要给卡片用；详细摘要给右侧详情用。保存后优先展示人工编辑内容。</p>
              <div class="guide-tip">建议：简单摘要控制在 60 字内，让用户一眼判断仓库用途。</div>
            </aside>
            <div class="editor-fields">
              <label class="field-label" for="short-summary">简单摘要 <span>{{ draftShortCount }} 字</span></label>
              <textarea id="short-summary" v-model="draftShortSummary" class="short-textarea" aria-label="Edit short repository summary" />
              <label class="field-label" for="detail-summary">详细摘要 <span>{{ draftDetailCount }} 字</span></label>
              <textarea id="detail-summary" v-model="draftDetailSummary" aria-label="Edit detailed repository summary" />
            </div>
          </div>
          <div class="modal-footer">
            <button class="outline" type="button" :disabled="summaryGenerating" @click="regenerateSummaryDraft">{{ summaryGenerating ? 'Generating…' : '重新生成摘要' }}</button>
            <button class="solid" type="button" @click="saveSummary">保存摘要</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="groupEditorOpen" class="modal" role="dialog" aria-modal="true" aria-labelledby="group-editor-title" @click.self="groupEditorOpen = false">
      <div class="modal-card group-editor-modal">
        <div class="modal-head">
          <div>
            <span>groups</span>
            <h3 id="group-editor-title">编辑分组</h3>
          </div>
          <button class="modal-close" type="button" aria-label="Close group editor" @click="groupEditorOpen = false">×</button>
        </div>
        <div class="modal-body">
          <div class="group-editor-grid">
            <section class="group-editor-copy">
              <b>{{ activeRepo?.owner }}/{{ activeRepo?.name }}</b>
              <p>点击分组即可添加或移除。已选分组会高亮显示。</p>
              <div class="guide-tip">当前草稿：{{ draftGroupIds.length }} 个分组</div>
            </section>
            <section class="group-picker" aria-label="Repository groups">
              <button
                v-for="group in groups"
                :key="group.id"
                class="group-pill"
                :class="{ active: draftGroupIds.includes(group.id) }"
                type="button"
                @click="toggleDraftGroup(group.id)"
              >
                <i />{{ group.name }}<span>{{ draftGroupIds.includes(group.id) ? '已选' : '添加' }}</span>
              </button>
              <span v-if="groups.length === 0" class="chip"><i />暂无分组</span>
            </section>
          </div>
          <section class="smart-group-card">
            <div>
              <b>智能分组</b>
              <p>让 AI 把所有未分组仓库匹配到现有分组；没有合适分组时，会先询问是否创建新分组。</p>
              <span>{{ counts.ungrouped }} 个未分组 · {{ groupSuggestionStatus }}</span>
            </div>
            <button class="solid" type="button" :disabled="groupAccepting || counts.ungrouped === 0" @click="store.smartGroupUngrouped()">
              {{ groupAccepting ? '分组中…' : '智能分组' }}
            </button>
          </section>
          <div class="modal-footer">
            <div class="inline-create"><input v-model="newGroupName" placeholder="New group name" @keydown.enter="store.addGroup(newGroupName)"><button type="button" @click="store.addGroup(newGroupName)">Add group</button></div>
            <button class="solid" type="button" @click="saveGroupDraft">完成</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="settingsOpen" class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" @click.self="settingsOpen = false">
      <div class="modal-card">
        <div class="modal-head">
          <div>
            <span>{{ settingsMeta[settingsPanel].eyebrow }}</span>
            <h3 id="settings-title">{{ settingsMeta[settingsPanel].title }}</h3>
          </div>
          <button class="modal-close" type="button" aria-label="Close settings" @click="settingsOpen = false">×</button>
        </div>
        <div class="modal-body">
          <template v-if="settingsPanel === 'personal'">
            <div class="setting-row"><div><b>GitHub Account</b><p>OAuth 登录后 token 后端加密保存。</p></div><div class="fake-input">{{ userLogin }}</div></div>
            <div class="setting-row"><div><b>Default View</b><p>登录后默认打开的视图。</p></div><div class="fake-input">All Starred</div></div>
          </template>
          <template v-else-if="settingsPanel === 'groups'">
            <div class="setting-row"><div><b>Create Group</b><p>新增自定义分组，保存到 Cloudflare D1。</p></div><div class="inline-create"><input v-model="newGroupName" placeholder="New group name" @keydown.enter="store.addGroup(newGroupName)"><button type="button" @click="store.addGroup(newGroupName)">Add</button></div></div>
            <div class="setting-row group-ai-row">
              <div><b>AI Default Groups</b><p>调用大模型分析全部 Star + 摘要，生成中文候选分组；用户确认后才保存。</p><span class="inline-status">{{ groupSuggestionStatus }}</span></div>
              <button class="solid" type="button" :disabled="groupSuggesting" @click="store.loadDefaultGroupSuggestions()">{{ groupSuggesting ? 'Generating…' : 'Generate suggestions' }}</button>
            </div>
            <div v-if="defaultGroupSuggestions.length" class="setting-row full suggestion-panel">
              <div class="suggest-head">
                <div><b>Suggested Groups</b><p>勾选候选分组，确认后批量入库。入库时会保存标题和 AI 描述。</p></div>
                <div class="suggest-actions">
                  <button class="outline" type="button" @click="store.selectAllDefaultGroups()">全选</button>
                  <button class="outline" type="button" @click="store.clearDefaultGroupSelection()">清空</button>
                  <button class="solid" type="button" :disabled="!selectedDefaultGroups.length || groupAccepting" @click="store.acceptSelectedDefaultGroups()">{{ groupAccepting ? '入库中…' : `入库 ${selectedDefaultGroups.length} 个` }}</button>
                </div>
              </div>
              <div class="suggestions selectable">
                <button
                  v-for="item in defaultGroupSuggestions"
                  :key="item.name"
                  class="suggestion-card"
                  :class="{ selected: selectedDefaultGroups.includes(item.name) }"
                  type="button"
                  @click="store.toggleDefaultGroupSelection(item.name)"
                >
                  <i aria-hidden="true">{{ selectedDefaultGroups.includes(item.name) ? '✓' : '' }}</i>
                  <strong>{{ item.name }}</strong>
                  <em>{{ item.score }} 分<span v-if="item.repo_count_estimate"> · 约 {{ item.repo_count_estimate }} 个</span></em>
                  <span>{{ item.reason }}</span>
                  <small v-if="item.examples?.length">代表：{{ item.examples.join('、') }}</small>
                </button>
              </div>
            </div>
            <div class="setting-row"><div><b>Star Public Repo</b><p>输入 owner/repo，调用 GitHub Star 接口；需要 GitHub OAuth token。</p></div><div class="inline-create"><input v-model="starInput" placeholder="owner/repo" @keydown.enter="store.starPublicRepo(starInput)"><button type="button" @click="store.starPublicRepo(starInput)">Star</button></div></div>
            <div v-for="group in groups" :key="group.id" class="setting-row"><div><input class="name-input" :value="group.name" @change="store.editGroupName(group.id, ($event.target as HTMLInputElement).value)"><p>{{ group.description }}</p></div><button class="danger-btn" type="button" @click="store.removeGroup(group.id)">Delete</button></div>
            <div class="setting-row"><div><b>Multi Group</b><p>一个仓库可加入多个分组。</p></div><div class="toggle">Enabled</div></div>
          </template>
          <template v-else>
            <div class="setting-row"><div><b>Base URL</b><p>用户自定义模型地址，后端做 SSRF 防护。</p></div><input v-model="modelDraft.baseUrl" class="fake-input edit"></div>
            <div class="setting-row"><div><b>Model</b><p>用于生成摘要和分组建议。</p></div><input v-model="modelDraft.modelName" class="fake-input edit"></div>
            <div class="setting-row"><div><b>API Key</b><p>只在服务端加密保存，前端不回显。</p></div><input v-model="modelDraft.apiKey" class="fake-input edit" type="password" placeholder="sk-..."></div>
            <div class="setting-row model-console"><div><b>Connection Test</b><p>发送最小请求验证 baseUrl、model、token 是否可用；不保存配置。</p><span>{{ modelTestStatus }}</span></div><button class="outline" type="button" :disabled="modelTesting" @click="store.testModelDraft()">{{ modelTesting ? 'Testing…' : 'Test connection' }}</button></div>
            <div class="setting-row"><div><b>Save Model</b><p>空 key 不覆盖旧 key。摘要生成会异步入库，有进度。</p></div><button class="solid" type="button" @click="store.saveModelDraft()">Save model settings</button></div>
          </template>
        </div>
      </div>
    </div>

    <div v-if="commandOpen" class="palette" role="dialog" aria-modal="true" aria-label="Command palette" @click.self="commandOpen = false">
      <div class="palette-card">
        <div class="palette-input">
          <span class="stamp">Command Mode</span>
          <input
            v-model="commandText"
            autofocus
            placeholder="show ungrouped / show recent / search vue / sync / dark mode"
            @keydown.enter="submitCommand"
          >
        </div>
        <div class="commands">
          <button class="cmd" type="button" @click="runQuickCommand('show ungrouped')"><b>Show ungrouped</b><span>展示没有进入分组的工程</span></button>
          <button class="cmd" type="button" @click="runQuickCommand('show recent')"><b>Show recent starred</b><span>展示最近 7 天 star 的工程</span></button>
          <button class="cmd" type="button" @click="runQuickCommand('search vue')"><b>Search Vue</b><span>在已 Star 项目中搜索 Vue</span></button>
          <button class="cmd" type="button" @click="runQuickCommand('sync')"><b>Sync GitHub</b><span>同步并完整对账 GitHub Stars</span></button>
          <button class="cmd" type="button" @click="runQuickCommand(theme === 'dark' ? 'light mode' : 'dark mode')"><b>Toggle theme</b><span>切换亮色 / 暗黑模式</span></button>
        </div>
      </div>
    </div>
  </div>
</template>
