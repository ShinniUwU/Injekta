// src/handlers/checklogsCommand.ts
import type { CommandInteraction, User } from 'discord.js';
import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { supabase } from '../supabase';
import type { InjectionRecord } from '../supabase';
import logger from '../logger';

export async function handleChecklogsCommand(interaction: CommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Get the user option data slightly differently
  const userOption = interaction.options.get('user'); // Get the raw option
  const targetUserFromOption = userOption?.user; // Access the user property from the option data

  let userIdToCheck: string;
  let userToCheck: User;

  if (targetUserFromOption) {
    // If a user option was provided and resolved
    if (
      !interaction.inGuild() ||
      !interaction.member ||
      typeof interaction.member.permissions === 'string' ||
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      if (targetUserFromOption.id !== interaction.user.id) {
        await interaction.editReply({
          content:
            'You need Administrator permissions to check logs for other users.',
        });
        return;
      }
    }
    userIdToCheck = targetUserFromOption.id;
    userToCheck = targetUserFromOption;
  } else {
    // Default to the user running the command
    userIdToCheck = interaction.user.id;
    userToCheck = interaction.user;
  }

  // Rest of the function remains the same...
  const { data, error } = await supabase
    .from('injections')
    .select<string, InjectionRecord>('*')
    .eq('user_id', userIdToCheck)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    logger.error('Error fetching logs:', {
      userId: userIdToCheck,
      message: error.message,
    });
    await interaction.editReply(
      `Error retrieving logs for ${userToCheck.username}.`,
    );
    return;
  }

  if (!data || data.length === 0) {
    await interaction.editReply(
      `No injection logs found for ${userToCheck.username}.`,
    );
    return;
  }

  const logsEmbed = new EmbedBuilder()
    .setTitle(`${userToCheck.username}'s Last 5 Injection Logs`)
    .setColor(0x3498db)
    .setThumbnail(
      userToCheck.displayAvatarURL() ??
        'https://cdn-icons-png.flaticon.com/512/709/709496.png',
    )
    .setTimestamp();

  const fields = data.map((record) => ({
    name: record.injection_date,
    value: record.leg === 'Right' ? '✅ Right leg' : '❌ Left leg',
    inline: false,
  }));

  logsEmbed.addFields(fields);

  await interaction.editReply({ embeds: [logsEmbed] });
}
