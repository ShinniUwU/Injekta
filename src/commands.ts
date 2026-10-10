// src/commands.ts
import { REST } from '@discordjs/rest';
import {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  Routes,
} from 'discord-api-types/v10';
import { SlashCommandBuilder } from '@discordjs/builders';
import logger from './logger';

export async function refreshCommands(
  clientId: string,
  guildId: string,
  botToken: string,
) {
  const useGlobal = process.env.NODE_ENV === 'production';
  if (!clientId || !botToken || (!guildId && !useGlobal)) {
    logger.error(
      'Missing Client ID, Guild ID, or Bot Token for refreshing commands.',
    );
    return;
  }

  const commandDefinitions = [
    // --- Existing commands ---
    new SlashCommandBuilder()
      .setName('injection')
      .setDescription(
        'Log your injection after confirmation (with optional dose/medication).',
      )
      .addNumberOption((option) =>
        option
          .setName('dose_mg')
          .setDescription('Dose in mg for this injection (e.g., 3.5)')
          .setRequired(false)
          .setMinValue(0.01),
      )
      .addStringOption((option) =>
        option
          .setName('medication')
          .setDescription('Medication name (e.g., estradiol, progesterone)')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('performed_at')
          .setDescription(
            'When the injection was performed (ISO date or YYYY-MM-DD)',
          )
          .setRequired(false),
      )
      .addNumberOption((option) =>
        option
          .setName('raw_units')
          .setDescription('Raw syringe units logged (optional)')
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(200),
      )
      .addStringOption((option) =>
        option
          .setName('leg')
          .setDescription(
            'Which leg (defaults to alternating from the last log)',
          )
          .setRequired(false)
          .addChoices(
            { name: 'Left', value: 'Left' },
            { name: 'Right', value: 'Right' },
          ),
      )
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
      .addNumberOption((option) =>
        option
          .setName('dose_mg')
          .setDescription('Dose in mg for this injection (e.g., 3.5)')
          .setRequired(false)
          .setMinValue(0.01)
          .setMaxValue(1000),
      )
      .addStringOption((option) =>
        option
          .setName('medication')
          .setDescription('Medication name (e.g., estradiol, progesterone)')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('performed_at')
          .setDescription(
            'When the injection was performed (ISO date or YYYY-MM-DD)',
          )
          .setRequired(false),
      )
      .addNumberOption((option) =>
        option
          .setName('raw_units')
          .setDescription('Raw syringe units logged (optional)')
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(200),
      )
      .addStringOption((option) =>
        option
          .setName('leg')
          .setDescription(
            'Which leg (defaults to alternating from the last log)',
          )
          .setRequired(false)
          .addChoices(
            { name: 'Left', value: 'Left' },
            { name: 'Right', value: 'Right' },
          ),
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

    new SlashCommandBuilder()
      .setName('convertunits')
      .setDescription(
        'Convert syringe units to milligrams. Assumes 100 units = 1 mL.',
      )
      .addNumberOption((option) =>
        option
          .setName('units')
          .setDescription('Number of units in the syringe (e.g., 30)')
          .setRequired(true)
          .setMinValue(0.01)
          .setMaxValue(200),
      )
      .addNumberOption((option) =>
        option
          .setName('concentration_mg_per_ml')
          .setDescription('Vial concentration in mg/mL (e.g., 200)')
          .setRequired(true)
          .setMinValue(0.01)
          .setMaxValue(2000),
      )
      .toJSON(),

    new SlashCommandBuilder()
      .setName('sethormonetest')
      .setDescription(
        'Set a hormone test reminder (E/T labs) starting from a date (default: now).',
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((option) =>
        option
          .setName('start_date')
          .setDescription(
            "Start date for reminders in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm). Defaults to 'now'.",
          )
          .setRequired(false),
      )
      .addNumberOption((option) =>
        option
          .setName('interval_days')
          .setDescription('Interval in days between reminders (default 30).')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(120),
      )
      .addStringOption((option) =>
        option
          .setName('timezone')
          .setDescription(
            'Timezone for reminders (e.g., UTC, America/New_York)',
          )
          .setRequired(false),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('setleg')
      .setDescription(
        "Fix which leg a log was saved as (admins can fix anyone's log).",
      )
      .addIntegerOption((option) =>
        option
          .setName('log_id')
          .setDescription('The log ID shown in /checklogs (e.g., 87)')
          .setRequired(true)
          .setMinValue(1),
      )
      .addStringOption((option) =>
        option
          .setName('leg')
          .setDescription('The leg it should be')
          .setRequired(true)
          .addChoices(
            { name: 'Left', value: 'Left' },
            { name: 'Right', value: 'Right' },
          ),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('snooze')
      .setDescription(
        'Push the current injection nag back if you are unavailable.',
      )
      .addIntegerOption((option) =>
        option
          .setName('hours')
          .setDescription('Hours to snooze the nag for (1-24)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(24),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('setupcheck')
      .setDescription('Admin: quick checklist to verify config and database.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Get a simple, friendly walkthrough for using Injekta.')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('timecheck')
      .setDescription('Show the bot/server time and configured timezone.')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('health')
      .setDescription(
        'Admin: Check database connectivity and scheduler status.',
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('updatecheck')
      .setDescription('Check for git updates or configure update alerts.')
      .addSubcommand((sub) =>
        sub
          .setName('check')
          .setDescription('Manually check if a newer commit exists on origin.'),
      )
      .addSubcommand((sub) =>
        sub
          .setName('notify')
          .setDescription('Enable or disable automatic update alerts.')
          .addStringOption((option) =>
            option
              .setName('mode')
              .setDescription('Turn update alerts on or off.')
              .setRequired(true)
              .addChoices(
                { name: 'on', value: 'on' },
                { name: 'off', value: 'off' },
              ),
          ),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('myschedule')
      .setDescription('Your own injection schedule in this server.')
      .addSubcommand((sub) =>
        sub
          .setName('set')
          .setDescription('Set your injection schedule and reminders.')
          .addStringOption((option) =>
            option
              .setName('next')
              .setDescription('Your next injection, e.g. 2026-10-17 09:00')
              .setRequired(true),
          )
          .addNumberOption((option) =>
            option
              .setName('every_days')
              .setDescription('Days between injections (e.g. 7, 3.5, 10)')
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(30),
          )
          .addStringOption((option) =>
            option
              .setName('timezone')
              .setDescription('Your timezone, e.g. Europe/Berlin')
              .setRequired(false),
          )
          .addStringOption((option) =>
            option
              .setName('medication')
              .setDescription('Shown only in your DM reminders and logs')
              .setRequired(false),
          )
          .addNumberOption((option) =>
            option
              .setName('dose_mg')
              .setDescription('Shown only in your DM reminders and logs')
              .setRequired(false)
              .setMinValue(0.01)
              .setMaxValue(1000),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName('show').setDescription('Show your schedule.'),
      )
      .addSubcommand((sub) =>
        sub
          .setName('clear')
          .setDescription('Remove your schedule and stop reminders.'),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('privacy')
      .setDescription(
        'See or change who can access your logs and where reminders go.',
      )
      .addStringOption((option) =>
        option
          .setName('admin_access')
          .setDescription(
            'Let admins view and manage your logs (default: block)',
          )
          .setRequired(false)
          .addChoices(
            { name: 'block', value: 'block' },
            { name: 'allow', value: 'allow' },
          ),
      )
      .addStringOption((option) =>
        option
          .setName('reminders')
          .setDescription('Where your reminders go (default: dm)')
          .setRequired(false)
          .addChoices(
            { name: 'dm', value: 'dm' },
            { name: 'channel', value: 'channel' },
          ),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('exportmydata')
      .setDescription('Download all your data in this server as a JSON file.')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('deletemydata')
      .setDescription('Delete all your logs and settings in this server.')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('setchannel')
      .setDescription('Admin: channel for /injection and channel reminders.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('The channel to use')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText),
      )
      .toJSON(),
  ];

  // Every command needs a server: logs and settings are per server.
  const commands = commandDefinitions.map((command) => ({
    ...command,
    contexts: [InteractionContextType.Guild],
  }));

  const rest = new REST({ version: '10' }).setToken(botToken);

  try {
    const route = useGlobal
      ? Routes.applicationCommands(clientId)
      : Routes.applicationGuildCommands(clientId, guildId);

    logger.info(
      `Started refreshing application (/) commands for ${
        useGlobal ? 'all guilds (global)' : `guild ${guildId}`
      }.`,
    );
    const updatedCommands = await rest.put(route, { body: commands });
    if (useGlobal && guildId) {
      // Drop old guild-scoped copies so they don't show up twice in that server
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: [],
      });
    }
    logger.info(
      `Successfully refreshed application (/) commands as ${
        useGlobal ? 'global' : 'guild-scoped'
      }.`,
    );
    const commandCount = Array.isArray(updatedCommands)
      ? updatedCommands.length
      : 'N/A';
    logger.info(`Refreshed ${commandCount} commands.`);
  } catch (error) {
    logger.error('Error refreshing commands:', { cmdRefreshError: error });
  }
}
