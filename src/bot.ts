// src/bot.ts
import { Client, GatewayIntentBits, Partials, MessageFlags } from 'discord.js'; // Import MessageFlags here
import { config } from './config';
import { refreshCommands } from './commands';
import { handleInjectionCommand } from './handlers/injectionCommand';
import { handleChecklogsCommand } from './handlers/checklogsCommand';
import { handleNextInjectionCommand } from './handlers/nextInjectionCommand';
import { handleSetInjectionScheduleCommand } from './handlers/setInjectionScheduleCommand';
import { handleStatsCommand } from './handlers/statsCommand';
import { handleLogforCommand } from './handlers/logforCommand';
import { initializeScheduler, rescheduleJobs } from './scheduler';
import logger from './logger';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once('ready', async () => {
  if (!client.user) {
    logger.error('Client user is not available on ready event.');
    process.exit(1);
  }
  logger.info(`Logged in as ${client.user.tag}`);
  try {
    await refreshCommands(config.clientId, config.guildId, config.botToken);
    logger.info('Attempting to initialize scheduler...');
    await initializeScheduler(client);
    logger.info('Scheduler initialized successfully.');
  } catch (error) {
    logger.error('Error during initialization:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

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
      case 'setinjectionschedule':
        await handleSetInjectionScheduleCommand(interaction, rescheduleJobs);
        break;
      case 'stats':
        await handleStatsCommand(interaction);
        break;
      case 'logfor':
        await handleLogforCommand(interaction);
        break;
      default:
        // Use imported MessageFlags
        await interaction.reply({
          content: 'Unknown command.',
          flags: MessageFlags.Ephemeral,
        });
        break;
    }
  } catch (error) {
    logger.error(
      `Error handling interaction ${interaction.commandName}:`,
      error,
    );
    if (interaction.deferred || interaction.replied) {
      // No need for flags in followUp typically, make ephemeral if desired
      await interaction
        .followUp({
          content: 'There was an error processing your command.',
          ephemeral: true,
        })
        .catch((e) => logger.error('Failed to follow up error', e));
    } else {
      // Use imported MessageFlags
      await interaction
        .reply({
          content: 'There was an error processing your command.',
          flags: MessageFlags.Ephemeral,
        })
        .catch((e) => logger.error('Failed to reply error', e));
    }
  }
});

client.login(config.botToken).catch((error) => {
  logger.error('Failed to login to Discord:', error);
  process.exit(1);
});
