// src/handlers/statsCommand.ts
import type { CommandInteraction, User } from 'discord.js';
import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
// Import the NEW function instead of supabase
import { getAllUserRecords } from '../database';
import type { InjectionRecord } from '../database'; // Use type from database.ts
import logger from '../logger';

export async function handleStatsCommand(interaction: CommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userOption = interaction.options.get('user');
  const targetUserFromOption = userOption?.user;

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
    userIdToCheck = interaction.user.id;
    userToCheck = interaction.user;
  }

  // Use the new function to get all records for the user
  const records: InjectionRecord[] = await getAllUserRecords(userIdToCheck);

  // Check if records is null or empty (getAllUserRecords returns [] on error)
  if (!records || records.length === 0) {
    if (records === null) {
      // Indicates potential fetch error
      logger.error('Error fetching statistics for stats command', {
        userId: userIdToCheck,
      });
      await interaction.editReply(
        `Error fetching statistics for ${userToCheck.username}. Please try again later.`,
      );
    } else {
      // Empty array means no records
      await interaction.editReply(
        `${userToCheck.username} has no injection records.`,
      );
    }
    return;
  }

  // Calculation logic remains largely the same, but uses the 'records' array directly
  const total = records.length;
  let currentStreak = 0;
  if (records.length > 0) {
    currentStreak = 1; // Start with 1 assuming the last record is the start of a potential streak
    // Iterate backwards from the second-to-last record
    for (let i = records.length - 1; i > 0; i--) {
      try {
        const currentDateSrc = records[i]?.performed_at || records[i]?.injection_date;
        const prevDateSrc =
          records[i - 1]?.performed_at || records[i - 1]?.injection_date;

        if (!currentDateSrc || !prevDateSrc) {
          logger.warn(
            `Missing performed_at date during streak calculation for user ${userIdToCheck}:`,
            { record_i: records[i], record_i_1: records[i - 1] },
          );
          break; // Skip calculation if dates are missing
        }

        const current = new Date(currentDateSrc);
        const prev = new Date(prevDateSrc);

        if (isNaN(current.getTime()) || isNaN(prev.getTime())) {
          logger.warn(
            `Invalid date encountered during streak calculation for user ${userIdToCheck}:`,
            { current: currentDateSrc, prev: prevDateSrc },
          );
          break;
        }

        // Calculate difference in days (consider timezones might slightly affect this edge case logic)
        const diffTime = current.getTime() - prev.getTime();
        const diffDays = diffTime / (1000 * 60 * 60 * 24);

        // Check if the gap is more than 0 days and less than or equal to 8 days (allowing for some flexibility around a week)
        if (diffDays > 0 && diffDays <= 8) {
          currentStreak++;
        } else {
          // If the gap is too large, the streak breaks
          break;
        }
      } catch (dateError) {
        logger.error(
          `Error processing dates during streak calculation for user ${userIdToCheck}:`,
          dateError,
        );
        break; // Stop calculation on error
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
