PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  github_user_id INTEGER NOT NULL UNIQUE,
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  html_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_users_login ON users(login);

CREATE TABLE github_tokens (
  user_id TEXT PRIMARY KEY,
  access_token_encrypted TEXT NOT NULL,
  iv TEXT NOT NULL,
  key_version TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  csrf_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL UNIQUE,
  full_name TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  language TEXT,
  topics_json TEXT,
  stars_count INTEGER NOT NULL DEFAULT 0,
  forks_count INTEGER NOT NULL DEFAULT 0,
  open_issues_count INTEGER,
  is_archived INTEGER NOT NULL DEFAULT 0,
  is_fork INTEGER NOT NULL DEFAULT 0,
  html_url TEXT NOT NULL,
  pushed_at TEXT,
  github_created_at TEXT,
  github_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_repositories_full_name ON repositories(full_name);
CREATE INDEX idx_repositories_github_id ON repositories(github_id);
CREATE INDEX idx_repositories_language ON repositories(language);

CREATE TABLE user_repositories (
  user_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  is_starred INTEGER NOT NULL DEFAULT 1,
  starred_at TEXT,
  unstarred_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, repository_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);
CREATE INDEX idx_user_repositories_starred_at ON user_repositories(user_id, starred_at);
CREATE INDEX idx_user_repositories_is_starred ON user_repositories(user_id, is_starred);
CREATE INDEX idx_user_repositories_repo ON user_repositories(repository_id);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, name)
);
CREATE INDEX idx_groups_user_sort ON groups(user_id, sort_order);

CREATE TABLE repository_groups (
  user_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, repository_id, group_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);
CREATE INDEX idx_repository_groups_group ON repository_groups(user_id, group_id);
CREATE INDEX idx_repository_groups_repo ON repository_groups(user_id, repository_id);

CREATE TABLE summaries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'ai', 'fallback')),
  content TEXT NOT NULL,
  model_name TEXT,
  source_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE (user_id, repository_id, kind)
);
CREATE INDEX idx_summaries_user_repo ON summaries(user_id, repository_id);
CREATE INDEX idx_summaries_kind ON summaries(user_id, kind);

CREATE TABLE model_settings (
  user_id TEXT PRIMARY KEY,
  provider_name TEXT,
  base_url TEXT,
  model_name TEXT,
  api_key_encrypted TEXT,
  iv TEXT,
  key_version TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  allow_repo_metadata INTEGER NOT NULL DEFAULT 1,
  allow_user_notes INTEGER NOT NULL DEFAULT 0,
  allow_readme_content INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE sync_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'paused', 'success', 'failed', 'cancelled')),
  cursor TEXT,
  page INTEGER NOT NULL DEFAULT 1,
  processed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER,
  locked_at TEXT,
  locked_by TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  retry_after TEXT,
  rate_limited_until TEXT,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_sync_jobs_user_status ON sync_jobs(user_id, status);
CREATE INDEX idx_sync_jobs_expires_at ON sync_jobs(expires_at);
CREATE INDEX idx_sync_jobs_rate_limited_until ON sync_jobs(rate_limited_until);

CREATE TABLE summary_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'paused', 'success', 'failed', 'cancelled')),
  target_type TEXT NOT NULL CHECK (target_type IN ('repo', 'group', 'filter')),
  target_ref TEXT,
  total_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  locked_at TEXT,
  locked_by TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  retry_after TEXT,
  rate_limited_until TEXT,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_summary_jobs_user_status ON summary_jobs(user_id, status);
CREATE INDEX idx_summary_jobs_expires_at ON summary_jobs(expires_at);

CREATE TABLE summary_job_items (
  job_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'skipped')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (job_id, repository_id),
  FOREIGN KEY (job_id) REFERENCES summary_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);
CREATE INDEX idx_summary_job_items_status ON summary_job_items(job_id, status);
