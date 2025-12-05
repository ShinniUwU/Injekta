// src/handlers/checklogsCommand.ts
import type { CommandInteraction, User } from 'discord.js';
import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
// Ensure this import points to the correctly exported function in src/database.ts
import { getRecentLogs } from '../database'; // <--- VERIFY THIS LINE
import type { InjectionRecord } from '../database';
import logger from '../logger';
import { formatTimestampForDisplay } from '../time';

// ... rest of the file (should be okay from previous updates) ...
export async function handleChecklogsCommand(interaction: CommandInteraction) {
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
            'You need Administrator permissions to check logs for other users.',
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

  const records: InjectionRecord[] = await getRecentLogs(userIdToCheck, 5);

  if (!records || records.length === 0) {
    if (records === null) {
      logger.error('Error fetching logs for checklogs command', {
        userId: userIdToCheck,
      });
      await interaction.editReply(
        `Error retrieving logs for ${userToCheck.username}.`,
      );
    } else {
      await interaction.editReply(
        `No injection logs found for ${userToCheck.username}.`,
      );
    }
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

  const fields = records.map((record) => {
    const med = record.medication ? `\nMedication: ${record.medication}` : '';
    const dose =
      record.dose_mg !== null && record.dose_mg !== undefined
        ? `\nDose: ${record.dose_mg} mg`
        : '';
    const units =
      record.raw_units !== null && record.raw_units !== undefined
        ? `\nUnits: ${record.raw_units}`
        : '';
    return {
      name:
        formatTimestampForDisplay(
          record.performed_at ?? record.injection_date,
          interaction.locale ?? 'en-US',
        ) || 'Unknown Date',
      value: `${record.leg === 'Right' ? '✅ Right leg' : '❌ Left leg'}${med}${dose}${units}`,
      inline: false,
    };
  });

  logsEmbed.addFields(fields);

  await interaction.editReply({ embeds: [logsEmbed] });
}
