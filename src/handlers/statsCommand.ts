import { supabase } from '../supabase';
import type { InjectionRecord } from '../supabase';
import { EmbedBuilder, MessageFlags } from 'discord.js';

export async function handleStatsCommand(interaction: any) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const userId = interaction.user.id;
  const result = await supabase
    .from('injections')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (result.error) {
    console.error('Error fetching statistics:', result.error);
    await interaction.editReply(
      'Error fetching your statistics. Please try again later.',
    );
    return;
  }

  const records = result.data as InjectionRecord[];
  if (!records || records.length === 0) {
    await interaction.editReply('You have no injection records.');
    return;
  }

  const total = records.length;
  let streak = 1;
  for (let i = records.length - 1; i > 0; i--) {
    const current = new Date(records[i].created_at);
    const prev = new Date(records[i - 1].created_at);
    const diffDays =
      (current.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays <= 8) {
      streak++;
    } else {
      break;
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('Your Injection Statistics')
    .setDescription(
      `Total injections: **${total}**\nCurrent streak: **${streak}** week(s)`,
    )
    .setColor(0x2ecc71)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
