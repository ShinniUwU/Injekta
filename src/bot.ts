// src/bot.ts (final)
import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import { refreshCommands } from './commands';
import { handleInjectionCommand } from './handlers/injectionCommand';
import { handleChecklogsCommand } from './handlers/checklogsCommand';
import { handleNextInjectionCommand } from './handlers/nextInjectionCommand';
import { handleSetInjectionScheduleCommand } from './handlers/setInjectionScheduleCommand';
import { handleStatsCommand } from './handlers/statsCommand';
import { scheduleWeeklyPrompts } from './scheduler';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  await refreshCommands();
  scheduleWeeklyPrompts(client, '1312689693732896869');
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
        await handleSetInjectionScheduleCommand(interaction);
        break;
      case 'stats':
        await handleStatsCommand(interaction);
        break;
      default:
        await interaction.reply({
          content: 'Unknown command.',
          ephemeral: true,
        });
    }
  } catch (error) {
    console.error('Error handling interaction:', error);
    await interaction.reply({
      content: 'There was an error processing your command.',
      ephemeral: true,
    });
  }
});

client.login(process.env.BOT_TOKEN);
