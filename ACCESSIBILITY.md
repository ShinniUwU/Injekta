# Accessibility

Injekta is a Discord bot. It has no website or app of its own, so it works through Discord's interface, and how accessible it is depends partly on Discord and the client you use.

## What we aim for

- Everything the bot does is available as text and slash commands, with buttons as a convenience, not the only way.
- Replies are plain text and embeds. Meaning shouldn't depend on color alone.
- Reminders can go by DM or in a channel, your choice in `/privacy`.

## What we haven't done

This is a one-person project and it hasn't been tested with screen readers, voice control, or other assistive tech. We can't promise it meets any formal standard such as WCAG.

## Known limitations

- Some replies use Discord embeds and emoji. How well those are read aloud depends on your client and screen reader.
- Confirmation steps use buttons. If buttons are hard for you to use, tell us so we can add a text alternative.
- Dates and times follow your configured timezone, which has to be set with a command.

## Report a barrier

Open an issue on this repo, or email shinni@tutamail.com if you'd rather not post publicly. Please don't include personal health details. Say what you were trying to do, which command, and what got in the way. I'll try to reply within 7 days.
