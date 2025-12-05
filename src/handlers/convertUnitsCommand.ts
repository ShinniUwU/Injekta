// src/handlers/convertUnitsCommand.ts
import type { CommandInteraction } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';

const UNITS_PER_ML = 100; // Common insulin-style syringes

export async function handleConvertUnitsCommand(
  interaction: CommandInteraction,
) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const unitsOption = interaction.options.get('units');
  const concentrationOption = interaction.options.get('concentration_mg_per_ml');

  const units =
    unitsOption && typeof unitsOption.value === 'number'
      ? unitsOption.value
      : null;
  const concentration =
    concentrationOption && typeof concentrationOption.value === 'number'
      ? concentrationOption.value
      : null;

  if (units === null || concentration === null || units <= 0 || concentration <= 0) {
    await interaction.editReply(
      'Please provide positive numbers for units and concentration (mg/mL).',
    );
    return;
  }
  if (units > 200 || concentration > 2000) {
    await interaction.editReply(
      'Units must be <= 200 and concentration <= 2000 mg/mL for this calculator.',
    );
    return;
  }

  const ml = units / UNITS_PER_ML;
  const mg = ml * concentration;

  const embed = new EmbedBuilder()
    .setTitle('Units to mg Conversion')
    .setDescription(
      `**${units} unit(s)** at **${concentration} mg/mL** equals **${mg.toFixed(
        2,
      )} mg**.\n\nAssumption: ${UNITS_PER_ML} units = 1 mL.`,
    )
    .setColor(0x9b59b6)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
