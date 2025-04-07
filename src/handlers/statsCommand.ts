// src/handlers/statsCommand.ts
import type { CommandInteraction, User } from 'discord.js';
import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { supabase } from '../supabase';
import type { InjectionRecord } from '../supabase';
import logger from '../logger';

export async function handleStatsCommand(interaction: CommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Get the user option data slightly differently
  const userOption = interaction.options.get('user'); // Get the raw option
  const targetUserFromOption = userOption?.user; // Access the user property

  let userIdToCheck: string;
  let userToCheck: User;

  if (targetUserFromOption) {
    if (
      !interaction.inGuild() ||
      !interaction.member ||
      typeof interaction.member.permissions === 'string' ||
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      if (targetUserFromOption.id !== interaction.user.id) {
        await interaction.editReply({
          content:
            'You need Administrator permissions to check stats for other users.',
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
  const result = await supabase
    .from('injections')
    .select<string, InjectionRecord>('*')
    .eq('user_id', userIdToCheck)
    .order('created_at', { ascending: true });

  if (result.error) {
    logger.error('Error fetching statistics:', {
      userId: userIdToCheck,
      message: result.error.message,
    });
    await interaction.editReply(
      `Error fetching statistics for ${userToCheck.username}. Please try again later.`,
    );
    return;
  }

  const records = result.data;
  if (!records || records.length === 0) {
    await interaction.editReply(
      `${userToCheck.username} has no injection records.`,
    );
    return;
  }

  const total = records.length;
  let currentStreak = 0;
  if (records.length > 0) {
    currentStreak = 1;
    for (let i = records.length - 1; i > 0; i--) {
      try {
        const current = new Date(records[i].created_at);
        const prev = new Date(records[i - 1].created_at);
        if (isNaN(current.getTime()) || isNaN(prev.getTime())) {
          logger.warn(
            `Invalid date encountered during streak calculation for user ${userIdToCheck}:`,
            { current: records[i].created_at, prev: records[i - 1].created_at },
          );
          break;
        }
        const diffDays =
          (current.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > 0 && diffDays <= 8) {
          currentStreak++;
        } else {
          break;
        }
      } catch (dateError) {
        logger.error(
          `Error processing dates during streak calculation for user ${userIdToCheck}:`,
          dateError,
        );
        break;
      }
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`${userToCheck.username}'s Injection Statistics`)
    .setDescription(
      `Total injections logged: **${total}**\nCurrent weekly streak: **${currentStreak}** week(s)`,
    )
    .setColor(0x2ecc71)
    .setThumbnail(userToCheck.displayAvatarURL() ?? '')
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
