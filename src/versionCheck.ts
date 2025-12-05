// src/versionCheck.ts
import { readFileSync } from 'fs';
import type { TextBasedChannel } from 'discord.js';
import { Client } from 'discord.js';
import logger from './logger';
import { config } from './config';

const LOCAL_VERSION = (() => {
  try {
    const pkgRaw = readFileSync(new URL('../package.json', import.meta.url), 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    return pkg.version as string;
  } catch (error) {
    logger.warn('Could not read local version from package.json', { error });
    return '0.0.0';
  }
})();

function compareSemver(current: string, latest: string): number {
  const cur = current.split('.').map((v) => parseInt(v, 10));
  const lat = latest.split('.').map((v) => parseInt(v, 10));
  for (let i = 0; i < 3; i += 1) {
    const a = cur[i] || 0;
    const b = lat[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch('https://registry.npmjs.org/injekta/latest', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) {
      logger.info('Version check: package not published to npm; skipping check.');
      return null;
    }
    if (!res.ok) {
      logger.warn('Version check failed: npm registry responded with non-OK status', {
        status: res.status,
        statusText: res.statusText,
      });
      return null;
    }
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch (error) {
    logger.warn('Failed to check latest version from npm', { error });
    return null;
  }
}

export async function notifyIfOutdated(client: Client) {
  const latest = await fetchLatestVersion();
  if (!latest) return;

  const comparison = compareSemver(LOCAL_VERSION, latest);
  if (comparison >= 0) {
    logger.info(`Running latest Injekta version (${LOCAL_VERSION}).`);
    return;
  }

  const channelId = config.versionNotifyChannelId;
  if (!channelId) {
    logger.warn('No channel configured for version notifications.');
    return;
  }

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

    const textChannel = channel as TextBasedChannel & { send: (content: string) => Promise<unknown> };
    await textChannel.send(
      `A new Injekta version is available: **v${latest}** (running v${LOCAL_VERSION}). Update with \`git pull && bun install\` and restart the bot.`,
    );
    logger.info(`Posted version update notice to channel ${channelId}`);
  } catch (error) {
    logger.warn('Failed to send version update notification', { channelId, error });
  }
}
