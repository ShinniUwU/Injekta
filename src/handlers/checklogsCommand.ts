// src/handlers/checklogsCommand.ts
import type {
  CommandInteraction,
  Message,
  MessageComponentInteraction,
  User,
} from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { DateTime } from 'luxon';
import {
  deleteLogById,
  getGlobalSettings,
  getLogById,
  getNextLeg,
  getRecentLogs,
  recordAdminAction,
  updateLog,
} from '../database';
import type { InjectionRecord } from '../database';
import logger from '../logger';
import { formatTimestampForDisplay, parseUserDateTimeInput } from '../time';
import { hasAdminPermission } from '../utils/permissions';

const EDIT_SESSION_MS = 5 * 60 * 1000;

function buildLogsEmbed(
  user: User,
  records: InjectionRecord[],
  locale: string,
  canEdit: boolean,
  notice?: string,
) {
  const embed = new EmbedBuilder()
    .setTitle(`${user.username}'s Last 5 Injection Logs`)
    .setDescription(
      `${
        canEdit
          ? 'Newest to oldest. Pick a log below to flip its leg, edit it, or delete it.'
          : 'Newest to oldest.'
      }${notice ? `\n\n${notice}` : ''}`,
    )
    .setColor(0x3498db)
    .setThumbnail(
      user.displayAvatarURL() ??
        'https://cdn-icons-png.flaticon.com/512/709/709496.png',
    )
    .setTimestamp();

  const fields = records.map((record, index) => {
    const med = record.medication ? `\n• Medication: ${record.medication}` : '';
    const dose =
      record.dose_mg !== null && record.dose_mg !== undefined
        ? `\n• Dose: ${record.dose_mg} mg`
        : '';
    const units =
      record.raw_units !== null && record.raw_units !== undefined
        ? `\n• Units: ${record.raw_units}`
        : '';
    const headerDate =
      formatTimestampForDisplay(
        record.performed_at ?? record.injection_date,
        locale,
      ) || 'Unknown Date';
    // Two of the same leg in a row is almost always a logging mistake.
    const older = records[index + 1];
    const repeat =
      older && older.leg === record.leg ? ' ⚠️ same leg as the log before' : '';
    return {
      name: `${index + 1}. #${record.id} • ${headerDate}`,
      value: `${
        record.leg === 'Right' ? '✅ Right leg' : '❌ Left leg'
      }${repeat}${med}${dose}${units}`,
      inline: false,
    };
  });

  return embed.addFields(fields);
}

function buildComponents(
  records: InjectionRecord[],
  locale: string,
  ids: {
    select: string;
    flip: string;
    edit: string;
    del: string;
    confirmDel: string;
    back: string;
  },
  selected: InjectionRecord | null,
  confirmingDelete: boolean,
) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(ids.select)
    .setPlaceholder('Pick a log to change')
    .addOptions(
      records.map((record) => ({
        label: `#${record.id} • ${record.leg} leg`,
        description: formatTimestampForDisplay(
          record.performed_at ?? record.injection_date,
          locale,
        ).slice(0, 100),
        value: String(record.id),
        default: selected?.id === record.id,
      })),
    );
  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
  ];
  if (!selected) return rows;

  const buttons = confirmingDelete
    ? [
        new ButtonBuilder()
          .setCustomId(ids.confirmDel)
          .setLabel(`Yes, delete #${selected.id}`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(ids.back)
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary),
      ]
    : [
        new ButtonBuilder()
          .setCustomId(ids.flip)
          .setLabel(`Flip to ${getNextLeg(selected.leg)} leg`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(ids.edit)
          .setLabel('Edit date / dose')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(ids.del)
          .setLabel('Delete')
          .setStyle(ButtonStyle.Danger),
      ];
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons));
  return rows;
}

function parseOptionalNumber(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 'invalid';
}

export async function handleChecklogsCommand(interaction: CommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userOption = interaction.options.get('user');
  const targetUserFromOption = userOption?.user;
  const isAdmin = hasAdminPermission(interaction);

  let userToCheck: User;

  if (targetUserFromOption) {
    if (targetUserFromOption.id !== interaction.user.id && !isAdmin) {
      await interaction.editReply({
        content:
          'You need Administrator permissions to check logs for other users.',
      });
      return;
    }
    userToCheck = targetUserFromOption;
  } else {
    userToCheck = interaction.user;
  }
  const ownerId = userToCheck.id;
  const actingForSomeoneElse = ownerId !== interaction.user.id;
  const canEdit = !actingForSomeoneElse || isAdmin;
  const locale = interaction.locale ?? 'en-US';

  let records: InjectionRecord[] = await getRecentLogs(ownerId, 5);

  if (records.length === 0) {
    await interaction.editReply(
      `No injection logs yet for ${userToCheck.username}. Run /injection in the designated channel when you are ready to start tracking.`,
    );
    return;
  }

  if (!canEdit) {
    await interaction.editReply({
      embeds: [buildLogsEmbed(userToCheck, records, locale, false)],
    });
    return;
  }

  const ids = {
    select: `logs_select_${interaction.id}`,
    flip: `logs_flip_${interaction.id}`,
    edit: `logs_edit_${interaction.id}`,
    del: `logs_delete_${interaction.id}`,
    confirmDel: `logs_confirm_delete_${interaction.id}`,
    back: `logs_back_${interaction.id}`,
    modal: `logs_modal_${interaction.id}`,
  };
  let selected: InjectionRecord | null = null;
  let confirmingDelete = false;

  const render = (notice?: string) => ({
    embeds: [buildLogsEmbed(userToCheck, records, locale, true, notice)],
    components: records.length
      ? buildComponents(records, locale, ids, selected, confirmingDelete)
      : [],
  });

  const audit = async (action: string, logId: number, details: string) => {
    if (!actingForSomeoneElse) return;
    await recordAdminAction({
      adminUserId: interaction.user.id,
      targetUserId: ownerId,
      action,
      logId,
      details,
    });
  };

  const refresh = async () => {
    records = await getRecentLogs(ownerId, 5);
    selected = selected
      ? records.find((r) => r.id === selected?.id) ?? null
      : null;
    confirmingDelete = false;
  };

  // Re-read the log right before changing it so we never edit another user's
  // log or one that was deleted in the meantime.
  const loadSelected = async () => {
    if (!selected) return null;
    const fresh = await getLogById(selected.id);
    return fresh && fresh.user_id === ownerId ? fresh : null;
  };

  const message = (await interaction.editReply(render())) as Message;

  const collector = message.createMessageComponentCollector({
    filter: (i) => i.user.id === interaction.user.id,
    idle: EDIT_SESSION_MS,
  });

  collector.on('collect', async (i: MessageComponentInteraction) => {
    try {
      if (i.customId === ids.select && i.isStringSelectMenu()) {
        selected = records.find((r) => String(r.id) === i.values[0]) ?? null;
        confirmingDelete = false;
        await i.update(render());
        return;
      }

      if (i.customId === ids.back) {
        confirmingDelete = false;
        await i.update(render());
        return;
      }

      if (i.customId === ids.del) {
        confirmingDelete = true;
        await i.update(render());
        return;
      }

      const current = await loadSelected();
      if (!current) {
        selected = null;
        await refresh();
        await i.update(render('That log no longer exists.'));
        return;
      }

      if (i.customId === ids.flip) {
        const newLeg = getNextLeg(current.leg);
        const updated = await updateLog(current.id, { leg: newLeg });
        await audit('editlog', current.id, `Leg ${current.leg} -> ${newLeg}`);
        await refresh();
        await i.update(
          render(
            updated
              ? `#${current.id} is now **${newLeg} leg**.`
              : `Could not update #${current.id}.`,
          ),
        );
        return;
      }

      if (i.customId === ids.confirmDel) {
        const result = await deleteLogById(current.id, ownerId);
        if (result.success) {
          await audit('deletelog', current.id, `Deleted ${current.leg} leg`);
        }
        selected = null;
        await refresh();
        await i.update(
          render(
            result.success
              ? `Deleted #${current.id}.`
              : `Could not delete #${current.id}.`,
          ),
        );
        if (!records.length) collector.stop('empty');
        return;
      }

      if (i.customId === ids.edit) {
        const tz = (await getGlobalSettings())?.timezone ?? 'UTC';
        const performed = DateTime.fromISO(
          current.performed_at ?? current.injection_date,
        ).setZone(tz);
        const modal = new ModalBuilder()
          .setCustomId(`${ids.modal}_${current.id}`)
          .setTitle(`Edit log #${current.id}`)
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('performed_at')
                .setLabel(`Date and time (${tz})`)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('2026-10-10 14:00')
                .setValue(
                  performed.isValid
                    ? performed.toFormat('yyyy-MM-dd HH:mm')
                    : '',
                )
                .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('dose_mg')
                .setLabel('Dose in mg (leave empty for none)')
                .setStyle(TextInputStyle.Short)
                .setValue(
                  current.dose_mg !== null && current.dose_mg !== undefined
                    ? String(current.dose_mg)
                    : '',
                )
                .setRequired(false),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('raw_units')
                .setLabel('Syringe units (leave empty for none)')
                .setStyle(TextInputStyle.Short)
                .setValue(
                  current.raw_units !== null && current.raw_units !== undefined
                    ? String(current.raw_units)
                    : '',
                )
                .setRequired(false),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('medication')
                .setLabel('Medication (leave empty for none)')
                .setStyle(TextInputStyle.Short)
                .setValue(current.medication ?? '')
                .setMaxLength(100)
                .setRequired(false),
            ),
          );
        await i.showModal(modal);

        const submitted = await i
          .awaitModalSubmit({
            filter: (m) =>
              m.customId === `${ids.modal}_${current.id}` &&
              m.user.id === interaction.user.id,
            time: EDIT_SESSION_MS,
          })
          .catch(() => null);
        if (!submitted || !submitted.isFromMessage()) return;

        const dateInput = submitted.fields.getTextInputValue('performed_at');
        const performedAt = parseUserDateTimeInput(dateInput, tz);
        const dose = parseOptionalNumber(
          submitted.fields.getTextInputValue('dose_mg'),
        );
        const units = parseOptionalNumber(
          submitted.fields.getTextInputValue('raw_units'),
        );
        const medication =
          submitted.fields.getTextInputValue('medication').trim() || null;

        if (!performedAt || dose === 'invalid' || units === 'invalid') {
          const problem = !performedAt
            ? `I couldn't read \`${dateInput}\` as a date. Try \`2026-10-10 14:00\`.`
            : 'Dose and units must be positive numbers.';
          await submitted.update(render(`Not saved. ${problem}`));
          return;
        }

        const updated = await updateLog(current.id, {
          performedAt,
          doseMg: dose,
          rawUnits: units === null ? null : Math.floor(units),
          medication,
        });
        await audit(
          'editlog',
          current.id,
          `performed_at ${performedAt.toISOString()}, dose ${
            dose ?? 'n/a'
          }, units ${units ?? 'n/a'}, medication ${medication ?? 'n/a'}`,
        );
        await refresh();
        await submitted.update(
          render(
            updated
              ? `Saved changes to #${current.id}.`
              : `Could not update #${current.id}.`,
          ),
        );
      }
    } catch (error) {
      logger.error('Error handling /checklogs edit action', { error });
    }
  });

  collector.on('end', () => {
    interaction
      .editReply({ components: [] })
      .catch((e) => logger.warn('Failed to clear /checklogs controls', e));
  });
}
