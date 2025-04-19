// src/commands.ts
import { REST } from '@discordjs/rest';
import {
  Routes,
  ApplicationCommandOptionType,
  PermissionFlagsBits,
} from 'discord-api-types/v10'; // Import Permissions
import { SlashCommandBuilder } from '@discordjs/builders';
import logger from './logger';

export async function refreshCommands(
  clientId: string,
  guildId: string,
  botToken: string,
) {
  if (!clientId || !guildId || !botToken) {
    logger.error(
      'Missing Client ID, Guild ID, or Bot Token for refreshing commands.',
    );
    return;
  }

  const commands = [
    // --- Existing commands ---
    new SlashCommandBuilder()
      .setName('injection')
      .setDescription('Log your weekly injection after confirmation.')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('checklogs')
      .setDescription('Display injection logs.')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('User whose logs to check (defaults to you)')
          .setRequired(false),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('nextinjection')
      .setDescription('Check time remaining until next injection.')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('setinjectionschedule')
      .setDescription('Admin: Set the global injection schedule.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // Set admin permission requirement
      .addStringOption((option) =>
        option
          .setName('day')
          .setDescription('Day of the week (Sunday, Monday, etc.)')
          .setRequired(true)
          .addChoices(
            { name: 'Sunday', value: 'Sunday' },
            { name: 'Monday', value: 'Monday' },
            { name: 'Tuesday', value: 'Tuesday' },
            { name: 'Wednesday', value: 'Wednesday' },
            { name: 'Thursday', value: 'Thursday' },
            { name: 'Friday', value: 'Friday' },
            { name: 'Saturday', value: 'Saturday' },
          ),
      )
      .addStringOption((option) =>
        option
          .setName('time')
          .setDescription('Time in HH:MM (24-hour) format (e.g., 09:00, 14:30)')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('timezone')
          .setDescription(
            'Timezone name (e.g., UTC, America/New_York, Europe/Sofia)',
          )
          .setRequired(false),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Show injection statistics.')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('User whose stats to check (defaults to you)')
          .setRequired(false),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('logfor')
      .setDescription('Admin: Log an injection for another user.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // Set admin permission requirement
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('The user to log an injection for.')
          .setRequired(true),
      )
      .toJSON(),

    // --- NEW Deletion Commands ---
    new SlashCommandBuilder()
      .setName('admindeletelog')
      .setDescription(
        'Admin: Delete a specific injection log entry for a user.',
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // Admin only
      .addUserOption(
        (
          option, // Required user option
        ) =>
          option
            .setName('user')
            .setDescription('The user whose log entry should be deleted.')
            .setRequired(true),
      )
      .addIntegerOption(
        (
          option, // Required log ID option
        ) =>
          option
            .setName('log_id')
            .setDescription(
              'The specific ID of the injection log entry to delete.',
            )
            .setRequired(true)
            .setMinValue(1), // Log IDs should be positive
      )
      .toJSON(),

    new SlashCommandBuilder()
      .setName('deletemylog')
      .setDescription(
        'Delete one of your own injection log entries (defaults to latest).',
      )
      .addIntegerOption(
        (
          option, // Optional log ID
        ) =>
          option
            .setName('log_id')
            .setDescription(
              'The specific ID of the log entry to delete (optional).',
            )
            .setRequired(false)
            .setMinValue(1), // Log IDs should be positive
      )
      .toJSON(),
  ];

  const rest = new REST({ version: '10' }).setToken(botToken);

  try {
    logger.info(
      `Started refreshing application (/) commands for guild ${guildId}.`,
    );
    const updatedCommands = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands },
    );
    logger.info('Successfully refreshed application (/) commands.');
    // Ensure updatedCommands is treated as an array before accessing length
    const commandCount = Array.isArray(updatedCommands)
      ? updatedCommands.length
      : 'N/A';
    logger.info(`Refreshed ${commandCount} commands.`);
  } catch (error) {
    logger.error('Error refreshing commands:', { cmdRefreshError: error });
  }
}
