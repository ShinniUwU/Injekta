// src/bot.ts
import { Client, GatewayIntentBits, Partials, MessageFlags } from 'discord.js';
import { config } from './config';
import { refreshCommands } from './commands';
import { handleInjectionCommand } from './handlers/injectionCommand';
import { handleChecklogsCommand } from './handlers/checklogsCommand';
import { handleNextInjectionCommand } from './handlers/nextInjectionCommand';
import { handleStatsCommand } from './handlers/statsCommand';
import { handleLogforCommand } from './handlers/logforCommand';
// Import new handlers
import { handleAdminDeleteLogCommand } from './handlers/adminDeleteLogCommand';
import { handleDeleteMyLogCommand } from './handlers/deleteMyLogCommand';
import { initializeScheduler } from './scheduler';
import logger from './logger';
import { closeDbPool, migrate } from './database';
import { handleConvertUnitsCommand } from './handlers/convertUnitsCommand';
import { handleSetHormoneTestCommand } from './handlers/setHormoneTestCommand';
import { handleHelpCommand } from './handlers/helpCommand';
import { handleSetupCheckCommand } from './handlers/setupCheckCommand';
import { handleUpdateCheckCommand } from './handlers/updateCheckCommand';
import { handleTimeCheckCommand } from './handlers/timeCheckCommand';
import { handleHealthCommand } from './handlers/healthCommand';
import { handleSnoozeCommand } from './handlers/snoozeCommand';
import { handleSetLegCommand } from './handlers/setLegCommand';
import { handleMyScheduleCommand } from './handlers/myScheduleCommand';
import { handlePrivacyCommand } from './handlers/privacyCommand';
import { handleSetChannelCommand } from './handlers/setChannelCommand';
import { handleDeleteMyDataCommand } from './handlers/deleteMyDataCommand';
import { handleExportMyDataCommand } from './handlers/exportMyDataCommand';
import { notifyIfOutdated } from './versionCheck';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // Make sure this is intended/needed
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once('ready', async () => {
  // ... existing ready logic ...
  if (!client.user) {
    logger.error('Client user is not available on ready event.');
    process.exit(1);
  }
  logger.info(`Logged in as ${client.user.tag}`);
  try {
    await refreshCommands(config.clientId, config.guildId, config.botToken);
  } catch (error) {
    logger.error('Failed to register slash commands:', error);
  }

  try {
    logger.info('Attempting to initialize scheduler...');
    await initializeScheduler(client);
  } catch (error) {
    logger.error(
      'Scheduler initialization failed; reminders will not fire:',
      error,
    );
  }

  void notifyIfOutdated(client);
  setInterval(() => void notifyIfOutdated(client), 6 * 60 * 60 * 1000);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.inGuild()) {
    await interaction
      .reply({ content: 'Injekta commands only work inside a server.' })
      .catch((e) => logger.error('Failed to reply outside a server', e));
    return;
  }

  try {
    switch (interaction.commandName) {
      case 'injection':
        await handleInjectionCommand(interaction, client);
        break;
      case 'checklogs':
        await handleChecklogsCommand(interaction);
        break;
      case 'nextinjection':
        await handleNextInjectionCommand(interaction);
        break;
      case 'stats':
        await handleStatsCommand(interaction);
        break;
      case 'logfor':
        await handleLogforCommand(interaction);
        break;
      // Add cases for new commands
      case 'admindeletelog':
        await handleAdminDeleteLogCommand(interaction);
        break;
      case 'deletemylog':
        await handleDeleteMyLogCommand(interaction);
        break;
      case 'convertunits':
        await handleConvertUnitsCommand(interaction);
        break;
      case 'sethormonetest':
        await handleSetHormoneTestCommand(interaction);
        break;
      case 'help':
        await handleHelpCommand(interaction);
        break;
      case 'setupcheck':
        await handleSetupCheckCommand(interaction);
        break;
      case 'updatecheck':
        await handleUpdateCheckCommand(interaction, client);
        break;
      case 'timecheck':
        await handleTimeCheckCommand(interaction);
        break;
      case 'health':
        await handleHealthCommand(interaction);
        break;
      case 'setleg':
        await handleSetLegCommand(interaction);
        break;
      case 'myschedule':
        await handleMyScheduleCommand(interaction);
        break;
      case 'privacy':
        await handlePrivacyCommand(interaction);
        break;
      case 'setchannel':
        await handleSetChannelCommand(interaction);
        break;
      case 'exportmydata':
        await handleExportMyDataCommand(interaction);
        break;
      case 'deletemydata':
        await handleDeleteMyDataCommand(interaction);
        break;
      case 'snooze':
        await handleSnoozeCommand(interaction);
        break;
      default:
        await interaction.reply({
          content: 'Unknown command.',
          flags: MessageFlags.Ephemeral,
        });
        break;
    }
  } catch (error) {
    logger.error(`Error handling interaction ${interaction.commandName}:`, {
      interactionError: error,
    });
    // Ensure replies use flags or followUp correctly
    if (interaction.deferred || interaction.replied) {
      await interaction
        .followUp({
          content: 'There was an error processing your command.',
          flags: MessageFlags.Ephemeral,
        })
        .catch((e) => logger.error('Failed to follow up error', e));
    } else {
      await interaction
        .reply({
          content: 'There was an error processing your command.',
          flags: MessageFlags.Ephemeral,
        })
        .catch((e) => logger.error('Failed to reply error', e));
    }
  }
});

try {
  await migrate();
  logger.info('Database schema is up to date.');
} catch (error) {
  logger.error('Database migration failed; refusing to start.', {
    migrateError: error,
  });
  process.exit(1);
}

client.login(config.botToken).catch((error) => {
  logger.error('Failed to login to Discord:', { loginError: error });
  process.exit(1);
});

const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    await closeDbPool();
    await client.destroy();
  } catch (err) {
    logger.error('Error during shutdown:', err);
  } finally {
    process.exit(0);
  }
};

['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => void gracefulShutdown(sig));
});
