import type { CommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { getLogById, recordAdminAction, updateLog } from '../database';
import logger from '../logger';
import { formatTimestampForDisplay } from '../time';
import { getOptionLeg, getOptionNumber } from '../utils/options';
import { hasAdminPermission } from '../utils/permissions';

export async function handleSetLegCommand(interaction: CommandInteraction) {
  const logId = getOptionNumber(interaction, 'log_id');
  const leg = getOptionLeg(interaction);

  if (logId === null || logId <= 0 || !leg) {
    await interaction.reply({
      content: 'Please provide a valid log ID and leg.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const record = await getLogById(logId);
  const isOwner = record?.user_id === interaction.user.id;
  // Same reply for "missing" and "not yours" so IDs can't be probed
  if (!record || (!isOwner && !hasAdminPermission(interaction))) {
    await interaction.editReply(
      `Log #${logId} not found, or it isn't yours. Check the ID with /checklogs.`,
    );
    return;
  }

  if (record.leg === leg) {
    await interaction.editReply(`Log #${logId} is already **${leg} leg**.`);
    return;
  }

  const updated = await updateLog(logId, { leg });
  if (!updated) {
    await interaction.editReply(`Could not update log #${logId}.`);
    return;
  }

  logger.info(
    `${interaction.user.tag} changed log #${logId} leg ${record.leg} -> ${leg}.`,
  );
  if (!isOwner) {
    await recordAdminAction({
      adminUserId: interaction.user.id,
      targetUserId: record.user_id,
      action: 'setleg',
      logId,
      details: `Leg ${record.leg} -> ${leg}`,
    });
  }

  await interaction.editReply(
    `Log #${logId} (${formatTimestampForDisplay(
      record.performed_at ?? record.injection_date,
      interaction.locale ?? 'en-US',
    )}) changed from **${record.leg}** to **${leg} leg**.`,
  );
}
