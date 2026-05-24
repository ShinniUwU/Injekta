// src/versionCheck.ts
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join, resolve } from 'path';
import type { TextBasedChannel } from 'discord.js';
import { Client } from 'discord.js';
import logger from './logger';
import { config } from './config';

export type UpdateState = 'unknown' | 'up_to_date' | 'behind';
export type UpdateStatus = {
  local: string | null;
  remote: string | null;
  state: UpdateState;
};

let autoNotifyEnabled = true;
let lastNotifiedRemote: string | null = null;
let warnedNoRepo = false;
let warnedNoRemote = false;
let stateLoaded = false;

// Anchor to the project root regardless of where systemd (or anything else) sets cwd
const PROJECT_ROOT = resolve(import.meta.dir, '..');
const STATE_DIR = join(PROJECT_ROOT, '.data');
const STATE_FILE = join(STATE_DIR, 'update-check.json');

function runGit(command: string, opts?: { silentOnError?: boolean; timeoutMs?: number }): string | null {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: PROJECT_ROOT,
      timeout: opts?.timeoutMs,
      shell: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
      .toString()
      .trim();
  } catch (error) {
    if (!opts?.silentOnError) {
      logger.warn(`Git command failed: ${command}`, { error });
    }
    return null;
  }
}

function hasGitRepo(): boolean {
  return existsSync(join(PROJECT_ROOT, '.git'));
}

function hasRemote(remote = 'origin'): boolean {
  return Boolean(runGit(`git remote get-url ${remote}`, { silentOnError: true }));
}

function getLocalHead(): string | null {
  return runGit('git rev-parse HEAD');
}

function getRemoteHead(remote = 'origin', ref = 'HEAD'): string | null {
  const output = runGit(`git ls-remote ${remote} ${ref}`, { timeoutMs: 10000 });
  if (!output) return null;
  const [sha] = output.split(/\s+/);
  return sha || null;
}

const shortSha = (sha: string | null) =>
  sha && sha.length >= 7 ? sha.slice(0, 7) : 'unknown';

function loadState() {
  if (stateLoaded) return;
  stateLoaded = true;
  try {
    if (existsSync(STATE_FILE)) {
      const raw = readFileSync(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as {
        autoNotifyEnabled?: boolean;
        lastNotifiedRemote?: string | null;
      };
      if (typeof parsed.autoNotifyEnabled === 'boolean') {
        autoNotifyEnabled = parsed.autoNotifyEnabled;
      }
      if (typeof parsed.lastNotifiedRemote === 'string' || parsed.lastNotifiedRemote === null) {
        lastNotifiedRemote = parsed.lastNotifiedRemote ?? null;
      }
    }
  } catch (error) {
    logger.warn('Failed to load update-check state; using defaults.', { error });
  }
}

function persistState() {
  try {
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }
    const payload = { autoNotifyEnabled, lastNotifiedRemote };
    const tmpFile = `${STATE_FILE}.tmp`;
    writeFileSync(tmpFile, JSON.stringify(payload, null, 2));
    renameSync(tmpFile, STATE_FILE);
  } catch (error) {
    logger.warn('Failed to persist update-check state.', { error });
  }
}

export function setVersionNotifyEnabled(enabled: boolean) {
  loadState();
  autoNotifyEnabled = enabled;
  persistState();
}

export function getVersionNotifyEnabled() {
  loadState();
  return autoNotifyEnabled;
}

export function getUpdateStatus(): UpdateStatus {
  loadState();
  if (!hasGitRepo()) {
    if (!warnedNoRepo) {
      logger.warn(`Update check: no git repo found at ${PROJECT_ROOT}`);
      warnedNoRepo = true;
    }
    return { local: null, remote: null, state: 'unknown' };
  }

  if (!hasRemote()) {
    if (!warnedNoRemote) {
      logger.warn('Update check: no git remote "origin" configured.');
      warnedNoRemote = true;
    }
    return { local: null, remote: null, state: 'unknown' };
  }

  const local = getLocalHead();
  if (!local) {
    logger.warn('Update check: could not resolve local HEAD (git rev-parse HEAD failed).');
    return { local: null, remote: null, state: 'unknown' };
  }

  const remote = getRemoteHead();
  if (!remote) {
    logger.warn('Update check: could not resolve remote HEAD (git ls-remote failed).');
    return { local, remote: null, state: 'unknown' };
  }
  if (local === remote) {
    return { local, remote, state: 'up_to_date' };
  }
  return { local, remote, state: 'behind' };
}

async function sendUpdateNotice(
  client: Client,
  status: UpdateStatus,
  channelId: string,
) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      logger.warn('Configured version notification channel is not text-based or not found', {
        channelId,
      });
      return;
    }

    if (!('send' in channel)) {
      logger.warn('Configured version notification channel cannot send messages', { channelId });
      return;
    }

    const textChannel = channel as TextBasedChannel & {
      send: (content: string) => Promise<unknown>;
    };
    await textChannel.send(
      `A new commit is available on origin: **${shortSha(status.remote)}** (running **${shortSha(
        status.local,
      )}**). Update with \`git pull && bun install\` and restart the bot.`,
    );
    logger.info(`Posted git update notice to channel ${channelId}`);
  } catch (error) {
    logger.warn('Failed to send version update notification', { channelId, error });
  }
}

export async function notifyIfOutdated(client: Client, opts?: { force?: boolean }) {
  const status = getUpdateStatus();

  if (!opts?.force && !autoNotifyEnabled) {
    logger.info('Skipping version check: auto notifications disabled.');
    return;
  }

  if (status.state !== 'behind') {
    if (opts?.force) {
      logger.info(
        status.state === 'up_to_date'
          ? `Running latest commit (${shortSha(status.local)}).`
          : 'Skipping version check: unable to resolve git HEAD.',
      );
    }
    return;
  }

  // Avoid spamming the same commit repeatedly during periodic checks
  if (!opts?.force && lastNotifiedRemote === status.remote) {
    logger.info('Skipping version alert: already notified for this remote commit.');
    return;
  }

  const channelId = config.versionNotifyChannelId;
  if (!channelId) {
    logger.warn('No channel configured for version notifications.');
    return;
  }

  await sendUpdateNotice(client, status, channelId);
  lastNotifiedRemote = status.remote;
  persistState();
}
