import type { CommandInteraction } from 'discord.js';

export function getOptionNumber(
  interaction: CommandInteraction,
  name: string,
): number | null {
  const option = interaction.options.get(name);
  return option && typeof option.value === 'number' ? option.value : null;
}

export function getOptionString(
  interaction: CommandInteraction,
  name: string,
): string | null {
  const option = interaction.options.get(name);
  return option && typeof option.value === 'string' ? option.value : null;
}
