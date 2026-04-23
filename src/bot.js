const { Bot } = require('grammy');
const { load, save, getChat } = require('./store');
const { OWNER_ID, isOwner, isBotAdmin } = require('./roles');
const { linkMiddleware } = require('./middleware/links');
const { floodMiddleware, recordJoin, isRaidActive } = require('./middleware/antispam');
const { onChatMember, onCallback: onCaptchaCallback, startDmChallenge } = require('./modules/captcha');
const { cmdBan, cmdUnban, cmdKick, cmdMute, cmdUnmute, cmdWarn, cmdUnwarn, cmdPurge, cmdPin, cmdReport } = require('./modules/moderation');
const { cmdAdmin, onPanelCallback, handleTextInput, handleMediaInput } = require('./modules/panel');
const { log } = require('./modules/logger');

async function startBot() {
  const bot = new Bot(process.env.BOT_TOKEN);

  // ────── Ownership lockdown: auto-leave unapproved chats
  bot.on('my_chat_member', async (ctx) => {
    const upd = ctx.update.my_chat_member;
    const newStatus = upd.new_chat_member.status;
    const chat = ctx.chat;

    if (['member', 'administrator'].includes(newStatus) && !['private'].includes(chat.type)) {
      const s = load();
      const approved = s.approvedChats.map(Number);
      if (!approved.includes(Number(chat.id))) {
        s.pendingChats[chat.id] = chat.title || '(untitled)';
        save();
        try {
          await ctx.api.sendMessage(OWNER_ID,
            `🔔 Bot was added to an unapproved chat:\n\n<b>${escapeHtml(chat.title || '')}</b>\nID: <code>${chat.id}</code>\nAdded by: <code>${upd.from.id}</code>\n\nUse /admin → Permissions → Approve chat, or /approve ${chat.id}\nLeaving now for safety.`,
            { parse_mode: 'HTML' });
        } catch {}
        try { await ctx.api.leaveChat(chat.id); } catch {}
        return;
      }
    }
  });

  // ────── Raid detection on chat_member joins + captcha
  bot.on('chat_member', async (ctx) => {
    const upd = ctx.update.chat_member;
    const wasIn = ['member', 'administrator', 'creator', 'restricted'].includes(upd.old_chat_member.status);
    const isIn = ['member', 'restricted'].includes(upd.new_chat_member.status);
    if (!wasIn && isIn && !upd.new_chat_member.user.is_bot) {
      const { raid, until } = recordJoin(ctx.chat.id);
      if (raid) {
        try {
          await ctx.api.setChatPermissions(ctx.chat.id, { can_send_messages: false });
          await ctx.api.sendMessage(ctx.chat.id, `🚨 <b>Anti-raid triggered.</b> Chat locked for ${getChat(ctx.chat.id).antiraid.autoLockMinutes}m.`, { parse_mode: 'HTML' });
        } catch {}
        await log(ctx.api, ctx.chat.id, 'bans', `🚨 Anti-raid triggered — chat locked until ${new Date(until).toISOString()}`);
      }
      await log(ctx.api, ctx.chat.id, 'joins', `➕ Join: <code>${upd.new_chat_member.user.id}</code> ${escapeHtml(upd.new_chat_member.user.first_name || '')} ${upd.new_chat_member.user.username ? '@'+upd.new_chat_member.user.username : ''}`);
    }
    if (wasIn && !isIn) {
      await log(ctx.api, ctx.chat.id, 'joins', `➖ Left/removed: <code>${upd.old_chat_member.user.id}</code>`);
    }
    await onChatMember(ctx);
  });

  bot.on('chat_join_request', async (ctx) => {
    await onChatMember(ctx);
  });

  // ────── Callbacks (captcha + panel)
  bot.on('callback_query:data', async (ctx, next) => {
    if (await onCaptchaCallback(ctx)) return;
    if (await onPanelCallback(ctx)) return;
    return next();
  });

  // ────── Commands
  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const payload = (ctx.match || '').trim();
    if (payload.startsWith('cap_')) {
      const token = payload.slice(4);
      await startDmChallenge(ctx, token);
      return;
    }
    if (isOwner(ctx.from.id)) {
      await ctx.reply(
        `👋 Hi owner. Use /admin to open the control panel.\n\n` +
        `Pending chat invites: use /pending to list.\n` +
        `Approve with /approve <chatId>.`);
    } else if (isBotAdmin(ctx.from.id)) {
      await ctx.reply('👋 You are a bot admin. Use /admin.');
    } else {
      await ctx.reply('👋 Hi!');
    }
  });

  bot.command('id', async (ctx) => {
    await ctx.reply(`user: <code>${ctx.from.id}</code>\nchat: <code>${ctx.chat.id}</code>${ctx.message.message_thread_id ? `\ntopic: <code>${ctx.message.message_thread_id}</code>` : ''}`, { parse_mode: 'HTML' });
  });

  bot.command('pending', async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    const s = load();
    const list = Object.entries(s.pendingChats || {});
    if (!list.length) return ctx.reply('No pending invites.');
    await ctx.reply('Pending chats:\n' + list.map(([id, t]) => `• <code>${id}</code> — ${escapeHtml(t)}`).join('\n'), { parse_mode: 'HTML' });
  });

  bot.command('approve', async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.reply('⛔ Owner only.');
    const id = Number(ctx.message.text.split(/\s+/)[1]);
    if (!id) return ctx.reply('Usage: /approve <chatId>');
    const s = load();
    if (!s.approvedChats.includes(id)) s.approvedChats.push(id);
    delete s.pendingChats[id];
    save();
    await ctx.reply(`✅ Approved ${id}. Add the bot back.`);
  });

  bot.command('unapprove', async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    const id = Number(ctx.message.text.split(/\s+/)[1]);
    const s = load();
    s.approvedChats = s.approvedChats.filter(c => c !== id);
    save();
    try { await ctx.api.leaveChat(id); } catch {}
    await ctx.reply(`✅ Revoked and left ${id}.`);
  });

  bot.command('admin', cmdAdmin);
  bot.command('ban', cmdBan);
  bot.command('unban', cmdUnban);
  bot.command('kick', cmdKick);
  bot.command('mute', cmdMute);
  bot.command('unmute', cmdUnmute);
  bot.command('warn', cmdWarn);
  bot.command('unwarn', cmdUnwarn);
  bot.command('purge', cmdPurge);
  bot.command('pin', cmdPin);
  bot.command('report', cmdReport);

  bot.command('lock', async (ctx) => {
    if (!isBotAdmin(ctx.from.id)) return;
    try {
      await ctx.api.setChatPermissions(ctx.chat.id, { can_send_messages: false });
      await ctx.reply('🔒 Chat locked.');
    } catch (e) { await ctx.reply(e.description); }
  });

  bot.command('unlock', async (ctx) => {
    if (!isBotAdmin(ctx.from.id)) return;
    try {
      await ctx.api.setChatPermissions(ctx.chat.id, {
        can_send_messages: true, can_send_audios: true, can_send_documents: true,
        can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
        can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
        can_add_web_page_previews: true, can_invite_users: true, can_change_info: false, can_pin_messages: false,
      });
      await ctx.reply('🔓 Chat unlocked.');
    } catch (e) { await ctx.reply(e.description); }
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
`<b>Security Bot — commands</b>

<b>Admin panel</b>
/admin — open the button panel

<b>Moderation</b> (reply to user or pass ID)
/warn · /unwarn · /mute [dur] · /unmute
/ban [dur] · /unban · /kick · /purge · /pin · /report
/lock · /unlock

<b>Info</b>
/id — show your ID and chat ID
/pending — list pending chat invites (owner)
/approve &lt;chatId&gt; · /unapprove &lt;chatId&gt; (owner)

Durations: <code>30s</code>, <code>10m</code>, <code>2h</code>, <code>1d</code>`,
      { parse_mode: 'HTML' });
  });

  // ────── DM text/media input for panel prompts
  bot.on('message:text', async (ctx, next) => {
    if (ctx.chat.type === 'private') {
      if (await handleTextInput(ctx)) return;
    }
    return next();
  });
  bot.on(['message:animation', 'message:photo', 'message:video', 'message:document'], async (ctx, next) => {
    if (ctx.chat.type === 'private') {
      if (await handleMediaInput(ctx)) return;
    }
    return next();
  });

  // ────── Group message pipeline: link filter, antispam flood
  bot.on('message', async (ctx, next) => {
    if (ctx.chat?.type === 'private') return next();
    const s = load();
    if (!s.approvedChats.map(Number).includes(Number(ctx.chat.id))) return; // silent in non-approved chats (shouldn't happen, we leave on join)
    return next();
  });
  bot.on('message', linkMiddleware);
  bot.on('message', floodMiddleware);

  bot.catch((err) => {
    console.error('[bot error]', err.error?.description || err.error?.message || err);
  });

  // We want chat_member updates — need to request allowed_updates
  const allowed = [
    'message', 'edited_message', 'callback_query',
    'my_chat_member', 'chat_member', 'chat_join_request',
  ];

  await bot.api.deleteWebhook({ drop_pending_updates: false }).catch(() => {});
  await registerCommands(bot);
  bot.start({ allowed_updates: allowed, drop_pending_updates: false, onStart: (me) => {
    console.log(`[bot] @${me.username} online. owner=${OWNER_ID}`);
  }});

  return bot;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function registerCommands(bot) {
  // Shown to everyone in private chat
  const privateCmds = [
    { command: 'start',     description: 'Start the bot' },
    { command: 'help',      description: 'Show commands' },
    { command: 'id',        description: 'Show your/chat ID' },
    { command: 'report',    description: 'Report a message to admins' },
  ];
  // Shown to everyone in groups
  const groupCmds = [
    { command: 'help',      description: 'Show commands' },
    { command: 'id',        description: 'Show your/chat/topic ID' },
    { command: 'report',    description: 'Reply to report a message to admins' },
  ];
  // Shown to group admins only
  const adminCmds = [
    { command: 'admin',     description: '⚙️ Open admin panel' },
    { command: 'warn',      description: 'Warn a user (reply)' },
    { command: 'unwarn',    description: 'Remove a warn (reply)' },
    { command: 'mute',      description: 'Mute user [duration] (reply)' },
    { command: 'unmute',    description: 'Unmute user (reply)' },
    { command: 'ban',       description: 'Ban user [duration] (reply)' },
    { command: 'unban',     description: 'Unban user by ID' },
    { command: 'kick',      description: 'Kick user (reply)' },
    { command: 'purge',     description: 'Delete messages from reply to now' },
    { command: 'pin',       description: 'Pin replied message' },
    { command: 'lock',      description: '🔒 Lock chat' },
    { command: 'unlock',    description: '🔓 Unlock chat' },
    { command: 'id',        description: 'Show IDs' },
    { command: 'report',    description: 'Report a message' },
    { command: 'help',      description: 'Show commands' },
  ];
  // Owner-only (extra)
  const ownerCmds = [
    { command: 'admin',     description: '⚙️ Open admin panel' },
    { command: 'pending',   description: 'List pending chat invites' },
    { command: 'approve',   description: 'Approve a chat ID' },
    { command: 'unapprove', description: 'Revoke & leave a chat' },
    { command: 'help',      description: 'Show commands' },
    { command: 'id',        description: 'Show your ID' },
  ];

  try {
    await bot.api.setMyCommands(privateCmds, { scope: { type: 'all_private_chats' } });
    await bot.api.setMyCommands(groupCmds,   { scope: { type: 'all_group_chats' } });
    await bot.api.setMyCommands(adminCmds,   { scope: { type: 'all_chat_administrators' } });
    if (process.env.OWNER_ID) {
      await bot.api.setMyCommands(ownerCmds, {
        scope: { type: 'chat', chat_id: Number(process.env.OWNER_ID) },
      });
    }
    console.log('[bot] command menu registered');
  } catch (e) {
    console.error('[bot] setMyCommands failed:', e.description || e.message);
  }
}

module.exports = { startBot };
