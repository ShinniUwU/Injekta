// src/handlers/nextInjectionCommand.ts
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getGlobalSettings } from '../supabase';

export async function handleNextInjectionCommand(interaction: any) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const settings = await getGlobalSettings();
  if (!settings) {
    await interaction.editReply(
      'Global injection schedule not set. Please contact an admin.',
    );
    return;
  }
  const now = new Date();
  const [hourStr, minuteStr] = settings.injection_time.split(':');
  let nextInjection = new Date(now);
  nextInjection.setHours(parseInt(hourStr), parseInt(minuteStr), 0, 0);
  const currentDay = now.getDay();
  let daysUntil = (settings.injection_day - currentDay + 7) % 7;
  if (daysUntil === 0 && now >= nextInjection) daysUntil = 7;
  nextInjection.setDate(now.getDate() + daysUntil);

  const diffMs = nextInjection.getTime() - now.getTime();
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);
  const months = Math.floor(days / 30);
  const remainingDays = days % 30;

  const embed = new EmbedBuilder()
    .setTitle('Time Until Next Injection')
    .setDescription(
      `Approximately:
**${months} month(s)**
**${remainingDays} day(s)**
**${hours} hour(s)**
**${minutes} minute(s)**
until the next injection (scheduled for ${nextInjection.toLocaleString()}).`,
    )
    .setColor(0x3498db)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
