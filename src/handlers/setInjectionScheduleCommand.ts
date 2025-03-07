import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { setGlobalSettings } from '../supabase';

export async function handleSetInjectionScheduleCommand(interaction: any) {
  // Check if the member has Administrator permissions.
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: 'You do not have permission to set the injection schedule.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const day = interaction.options.getString('day'); // e.g., "Saturday"
  const time = interaction.options.getString('time'); // e.g., "09:00"
  const timezone = interaction.options.getString('timezone') || 'UTC';

  const days: { [key: string]: number } = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  const injection_day = days[day.toLowerCase()];
  if (injection_day === undefined) {
    await interaction.reply({
      content: 'Invalid day provided. Please use Sunday, Monday, etc.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!/^\d{2}:\d{2}$/.test(time)) {
    await interaction.reply({
      content: 'Invalid time format. Please use HH:MM (24-hour).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const success = await setGlobalSettings({
    injection_day,
    injection_time: time,
    timezone,
  });
  if (success) {
    await interaction.reply({
      content: `Injection schedule updated to ${day} at ${time} (${timezone}).`,
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.reply({
      content: 'There was an error updating the injection schedule.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
