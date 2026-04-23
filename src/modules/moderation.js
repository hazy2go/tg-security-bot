const { getChat, save, load } = require('../store');
const { log } = require('./logger');
const { isBotAdmin } = require('../roles');

function parseDuration(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d+)\s*([smhd]?)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || 'm').toLowerCase();
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 }[unit]);
}

function getTargetUser(ctx) {
  const reply = ctx.message?.reply_to_message;
  if (reply?.from) return { id: reply.from.id, name: reply.from.first_name || '' };
  const parts = (ctx.message?.text || '').split(/\s+/).slice(1);
  if (parts[0] && /^\d+$/.test(parts[0])) return { id: Number(parts[0]), name: '' };
  return null;
}

async function ensureAuth(ctx) {
  if (!isBotAdmin(ctx.from.id)) {
    try {
      const m = await ctx.getChatMember(ctx.from.id);
      if (!['creator', 'administrator'].includes(m.status)) {
        await ctx.reply('⛔ Admins only.');
        return false;
      }
    } catch { return false; }
  }
  return true;
}

async function cmdBan(ctx) {
  if (!(await ensureAuth(ctx))) return;
  const target = getTargetUser(ctx);
  if (!target) return ctx.reply('Reply to a user or pass their ID.');
  const parts = ctx.message.text.split(/\s+/);
  const durSec = parseDuration(parts.find(p => /^\d+[smhd]?$/i.test(p) && Number(p) !== target.id));
  try {
    await ctx.api.banChatMember(ctx.chat.id, target.id, durSec ? { until_date: Math.floor(Date.now() / 1000) + durSec } : {});
    await ctx.reply(`🔨 Banned ${target.id}${durSec ? ` for ${durSec}s` : ''}.`);
    await log(ctx.api, ctx.chat.id, 'bans', `🔨 <b>Ban</b> <code>${target.id}</code> by <code>${ctx.from.id}</code>${durSec ? ` (${durSec}s)` : ''}`);
  } catch (e) { await ctx.reply(`Failed: ${e.description}`); }
}

async function cmdUnban(ctx) {
  if (!(await ensureAuth(ctx))) return;
  const target = getTargetUser(ctx);
  if (!target) return ctx.reply('Pass user ID.');
  try {
    await ctx.api.unbanChatMember(ctx.chat.id, target.id);
    await ctx.reply(`✅ Unbanned ${target.id}.`);
    await log(ctx.api, ctx.chat.id, 'bans', `✅ <b>Unban</b> <code>${target.id}</code> by <code>${ctx.from.id}</code>`);
  } catch (e) { await ctx.reply(`Failed: ${e.description}`); }
}

async function cmdKick(ctx) {
  if (!(await ensureAuth(ctx))) return;
  const target = getTargetUser(ctx);
  if (!target) return ctx.reply('Reply to a user.');
  try {
    await ctx.api.banChatMember(ctx.chat.id, target.id);
    await ctx.api.unbanChatMember(ctx.chat.id, target.id);
    await ctx.reply(`👢 Kicked ${target.id}.`);
    await log(ctx.api, ctx.chat.id, 'bans', `👢 <b>Kick</b> <code>${target.id}</code> by <code>${ctx.from.id}</code>`);
  } catch (e) { await ctx.reply(`Failed: ${e.description}`); }
}

async function cmdMute(ctx) {
  if (!(await ensureAuth(ctx))) return;
  const target = getTargetUser(ctx);
  if (!target) return ctx.reply('Reply to a user.');
  const parts = ctx.message.text.split(/\s+/);
  const durSec = parseDuration(parts.find(p => /^\d+[smhd]?$/i.test(p) && Number(p) !== target.id)) || 3600;
  try {
    await ctx.api.restrictChatMember(ctx.chat.id, target.id, {
      permissions: { can_send_messages: false },
      until_date: Math.floor(Date.now() / 1000) + durSec,
    });
    await ctx.reply(`🔇 Muted ${target.id} for ${durSec}s.`);
    await log(ctx.api, ctx.chat.id, 'bans', `🔇 <b>Mute</b> <code>${target.id}</code> for ${durSec}s by <code>${ctx.from.id}</code>`);
  } catch (e) { await ctx.reply(`Failed: ${e.description}`); }
}

async function cmdUnmute(ctx) {
  if (!(await ensureAuth(ctx))) return;
  const target = getTargetUser(ctx);
  if (!target) return ctx.reply('Reply to a user.');
  try {
    await ctx.api.restrictChatMember(ctx.chat.id, target.id, {
      permissions: {
        can_send_messages: true, can_send_audios: true, can_send_documents: true,
        can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
        can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
        can_add_web_page_previews: true,
      },
    });
    await ctx.reply(`🔊 Unmuted ${target.id}.`);
  } catch (e) { await ctx.reply(`Failed: ${e.description}`); }
}

async function cmdWarn(ctx) {
  if (!(await ensureAuth(ctx))) return;
  const target = getTargetUser(ctx);
  if (!target) return ctx.reply('Reply to a user.');
  const chat = getChat(ctx.chat.id);
  const users = chat.warns.users;
  users[target.id] = (users[target.id] || 0) + 1;
  const count = users[target.id];
  save();
  await ctx.reply(`⚠️ Warned ${target.id} (${count}/${chat.warns.limit}).`);
  await log(ctx.api, ctx.chat.id, 'bans', `⚠️ <b>Warn</b> <code>${target.id}</code> (${count}/${chat.warns.limit}) by <code>${ctx.from.id}</code>`);
  if (count >= chat.warns.limit) {
    users[target.id] = 0;
    save();
    if (chat.warns.action === 'ban') {
      try { await ctx.api.banChatMember(ctx.chat.id, target.id); } catch {}
      await ctx.reply(`🔨 ${target.id} banned (warn limit reached).`);
    } else if (chat.warns.action === 'kick') {
      try { await ctx.api.banChatMember(ctx.chat.id, target.id); await ctx.api.unbanChatMember(ctx.chat.id, target.id); } catch {}
    } else {
      try {
        await ctx.api.restrictChatMember(ctx.chat.id, target.id, {
          permissions: { can_send_messages: false },
          until_date: Math.floor(Date.now() / 1000) + chat.antispam.muteMinutes * 60,
        });
      } catch {}
      await ctx.reply(`🔇 ${target.id} muted (warn limit reached).`);
    }
  }
}

async function cmdUnwarn(ctx) {
  if (!(await ensureAuth(ctx))) return;
  const target = getTargetUser(ctx);
  if (!target) return;
  const chat = getChat(ctx.chat.id);
  chat.warns.users[target.id] = Math.max(0, (chat.warns.users[target.id] || 0) - 1);
  save();
  await ctx.reply(`✅ Removed a warn. Now ${chat.warns.users[target.id]}.`);
}

async function cmdPurge(ctx) {
  if (!(await ensureAuth(ctx))) return;
  const reply = ctx.message.reply_to_message;
  if (!reply) return ctx.reply('Reply to the first message to purge from.');
  const from = reply.message_id;
  const to = ctx.message.message_id;
  const ids = [];
  for (let i = from; i <= to; i++) ids.push(i);
  try {
    for (let i = 0; i < ids.length; i += 100) {
      await ctx.api.deleteMessages(ctx.chat.id, ids.slice(i, i + 100));
    }
  } catch (e) { await ctx.reply(`Some messages could not be deleted: ${e.description}`); }
}

async function cmdPin(ctx) {
  if (!(await ensureAuth(ctx))) return;
  const reply = ctx.message.reply_to_message;
  if (!reply) return ctx.reply('Reply to the message to pin.');
  try { await ctx.api.pinChatMessage(ctx.chat.id, reply.message_id); }
  catch (e) { await ctx.reply(`Failed: ${e.description}`); }
}

async function cmdReport(ctx) {
  const reply = ctx.message.reply_to_message;
  if (!reply) return ctx.reply('Reply to the offending message with /report.');
  await log(ctx.api, ctx.chat.id, 'default',
    `🚨 <b>Report</b> by <code>${ctx.from.id}</code>\n` +
    `Target: <code>${reply.from?.id}</code>\n` +
    `Message: ${ctx.chat.username ? `https://t.me/${ctx.chat.username}/${reply.message_id}` : '(private chat)'}`);
  await ctx.reply('✅ Reported to admins.');
}

module.exports = { cmdBan, cmdUnban, cmdKick, cmdMute, cmdUnmute, cmdWarn, cmdUnwarn, cmdPurge, cmdPin, cmdReport };
