// src/commands.ts (final)
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { SlashCommandBuilder } from '@discordjs/builders';
import dotenv from 'dotenv';

dotenv.config();

export async function refreshCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('injection')
      .setDescription('Log your weekly injection after confirmation.')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('checklogs')
      .setDescription('Display the last 5 injection logs.')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('nextinjection')
      .setDescription('Check time remaining until next injection.')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('setinjectionschedule')
      .setDescription('Admin: Set the global injection schedule.')
      .addStringOption((option) =>
        option
          .setName('day')
          .setDescription('Day of the week (Sunday, Monday, etc.)')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('time')
          .setDescription('Time in HH:MM (24-hour) format')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('timezone')
          .setDescription('Timezone (e.g., UTC, America/New_York)')
          .setRequired(false),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Show your injection statistics.')
      .toJSON(),
  ];

  const rest = new REST({ version: '10' }).setToken(
    process.env.BOT_TOKEN as string,
  );

  try {
    console.log('Started refreshing application (/) commands.');
    const updatedCommands = await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID as string,
        process.env.GUILD_ID as string,
      ),
      { body: commands },
    );
    console.log('Successfully refreshed application (/) commands.');
    console.log('Updated commands:', updatedCommands);
  } catch (error) {
    console.error('Error refreshing commands:', error);
  }
}
