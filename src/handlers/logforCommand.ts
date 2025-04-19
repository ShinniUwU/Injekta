// src/handlers/logforCommand.ts
import type { CommandInteraction } from 'discord.js';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { createInjectionRecord } from '../database';
import logger from '../logger';

export async function handleLogforCommand(interaction: CommandInteraction) {
  if (
    !interaction.inGuild() ||
    !interaction.member ||
    typeof interaction.member.permissions === 'string' ||
    !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    await interaction.reply({
      content: 'You need Administrator permissions to use this command.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Get the user option data slightly differently
  const targetUserOption = interaction.options.get('user', true); // Get the raw option, true makes it required
  const targetUser = targetUserOption?.user; // Access the user property

  // Check if the user was successfully retrieved
  if (!targetUser) {
    logger.error(
      `Could not resolve user option for /logfor command by ${interaction.user.tag}. Option data:`,
      targetUserOption,
    );
    await interaction.reply({
      content: 'Could not find the specified user.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (targetUser.bot) {
    await interaction.reply({
      content: 'You cannot log injections for bots.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const record = await createInjectionRecord(targetUser.id);

    if (record) {
      logger.info(
        `Admin ${interaction.user.tag} logged injection for ${targetUser.tag}: ${record.leg} leg on ${record.date}.`,
      );
      await interaction.editReply(
        `Injection recorded for ${targetUser.username}: **${record.leg} leg** on **${record.date}**.`,
      );
    } else {
      logger.error(
        `Admin ${interaction.user.tag} failed to log injection for ${targetUser.tag}.`,
      );
      await interaction.editReply(
        `There was an error recording the injection for ${targetUser.username}.`,
      );
    }
  } catch (error) {
    logger.error(
      `Error during /logfor command for ${targetUser.tag} triggered by ${interaction.user.tag}:`,
      error,
    );
    await interaction.editReply(
      `An unexpected error occurred while logging the injection for ${targetUser.username}.`,
    );
  }
}
