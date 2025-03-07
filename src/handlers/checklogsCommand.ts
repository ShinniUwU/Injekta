// src/handlers/checklogsCommand.ts
import { supabase } from '../supabase';
import type { InjectionRecord } from '../supabase';
import { EmbedBuilder, MessageFlags } from 'discord.js';

export async function handleChecklogsCommand(interaction: any) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { data, error } = await supabase
    .from<'injections', InjectionRecord>('injections')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error fetching logs:', error);
    await interaction.editReply('Error retrieving logs.');
    return;
  }

  if (!data || data.length === 0) {
    await interaction.editReply('No logs found.');
    return;
  }

  const logsEmbed = new EmbedBuilder()
    .setTitle('Last 5 Injection Logs')
    .setColor(0x3498db)
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/709/709496.png')
    .setTimestamp();

  const fields = data.map((record) => ({
    name: record.injection_date,
    value: record.leg === 'Good' ? '✅ Right leg' : '❌ Left leg',
    inline: false,
  }));

  logsEmbed.addFields(fields);

  await interaction.editReply({ embeds: [logsEmbed] });
}
