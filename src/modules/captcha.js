const { InlineKeyboard, API_CONSTANTS } = require('grammy');
const crypto = require('crypto');
const { getChat } = require('../store');
const { log } = require('./logger');

// pending[chatId:userId] = { timer, messageId, answer, attempts }
const pending = new Map();
const key = (c, u) => `${c}:${u}`;
const FULL_CHAT_PERMISSIONS = API_CONSTANTS.ALL_CHAT_PERMISSIONS;

function makeButtonChallenge() {
  const correct = '✅ I am human';
  const decoys = ['🤖 Robot', '👽 Alien', '🐶 Dog', '🦊 Fox'];
  const options = [correct, decoys[Math.floor(Math.random() * decoys.length)]];
  options.sort(() => Math.random() - 0.5);
  const kb = new InlineKeyboard();
  for (const o of options) kb.text(o, `cap:${o === correct ? 'ok' : 'no'}`).row();
  return { kb, answer: 'ok' };
}

function makeMathChallenge() {
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const correct = a + b;
  const opts = new Set([correct]);
  while (opts.size < 4) opts.add(Math.max(2, correct + (Math.floor(Math.random() * 7) - 3)));
  const arr = [...opts].sort(() => Math.random() - 0.5);
  const kb = new InlineKeyboard();
  for (const n of arr) kb.text(String(n), `cap:${n === correct ? 'ok' : 'no'}`);
  return { kb, answer: 'ok', question: `${a} + ${b} = ?` };
}

function makeEmojiChallenge() {
  const emojis = ['🍎', '🚗', '🌙', '⚽', '🎸', '🐙'];
  const target = emojis[Math.floor(Math.random() * emojis.length)];
  const kb = new InlineKeyboard();
  const shuffled = [...emojis].sort(() => Math.random() - 0.5);
  for (const e of shuffled) kb.text(e, `cap:${e === target ? 'ok' : 'no'}`);
  return { kb, answer: 'ok', question: `Tap the ${target}` };
}

async function onChatMember(ctx) {
  const upd = ctx.chatJoinRequest || ctx.update.chat_member;
  const chat = ctx.chat;
  if (!chat) return;
  const cfg = getChat(chat.id).captcha;
  if (!cfg.enabled) return;

  // Native join request flow
  if (ctx.chatJoinRequest) {
    await challengeInDM(ctx, chat, ctx.chatJoinRequest.from, true);
    return;
  }

  const cm = ctx.update.chat_member;
  if (!cm) return;
  const wasIn = ['member', 'administrator', 'creator', 'restricted'].includes(cm.old_chat_member.status);
  const isIn = ['member', 'restricted'].includes(cm.new_chat_member.status);
  if (wasIn || !isIn) return;

  const user = cm.new_chat_member.user;
  if (user.is_bot) return;
  await challengeInGroup(ctx, chat, user);
}

async function sendChallenge(api, chatId, caption, kb, media, topicId) {
  const opts = { parse_mode: 'HTML', reply_markup: kb, message_thread_id: topicId };
  if (media?.fileId) {
    const sendOpts = { ...opts, caption };
    try {
      if (media.type === 'animation') return await api.sendAnimation(chatId, media.fileId, sendOpts);
      if (media.type === 'photo') return await api.sendPhoto(chatId, media.fileId, sendOpts);
      if (media.type === 'video') return await api.sendVideo(chatId, media.fileId, sendOpts);
    } catch (e) {
      console.error('[captcha] media send failed, falling back to text:', e.description || e.message);
    }
  }
  return await api.sendMessage(chatId, caption, opts);
}

async function sendWelcome(api, chatId, userId, firstName, cfg, sourceTopicId) {
  const safeName = escapeHtml(firstName || 'friend');
  const mention = `<a href="tg://user?id=${userId}">${safeName}</a>`;

  let groupTitle = '';
  let memberCount = '';
  try {
    const chatInfo = await api.getChat(chatId);
    groupTitle = chatInfo.title || '';
  } catch {}
  try { memberCount = String(await api.getChatMemberCount(chatId)); } catch {}

  const raw = (cfg.welcomeText || '')
    .replaceAll('{name}', safeName)
    .replaceAll('{mention}', mention)
    .replaceAll('{count}', memberCount || '—')
    .replaceAll('{group}', escapeHtml(groupTitle))
    .replaceAll('{id}', String(userId));

  const text = `${mention}\n\n${raw}`;

  let targetChat = chatId;
  let topicId = sourceTopicId;
  if (cfg.welcomeTarget) {
    const [tc, tt] = String(cfg.welcomeTarget).split(':');
    targetChat = tc;
    topicId = tt ? Number(tt) : undefined;
  }

  const opts = { parse_mode: 'HTML', message_thread_id: topicId };
  try {
    if (cfg.welcomeMedia?.fileId) {
      const { type, fileId } = cfg.welcomeMedia;
      const sendOpts = { ...opts, caption: text };
      if (type === 'animation') await api.sendAnimation(targetChat, fileId, sendOpts);
      else if (type === 'photo') await api.sendPhoto(targetChat, fileId, sendOpts);
      else if (type === 'video') await api.sendVideo(targetChat, fileId, sendOpts);
      else await api.sendMessage(targetChat, text, opts);
    } else {
      await api.sendMessage(targetChat, text, opts);
    }
  } catch (e) {
    console.error('[captcha] welcome send failed:', e.description || e.message);
  }
}

async function challengeInGroup(ctx, chat, user) {
  const cfg = getChat(chat.id).captcha;
  try {
    await ctx.api.restrictChatMember(chat.id, user.id, {
      permissions: {
        can_send_messages: false, can_send_audios: false, can_send_documents: false,
        can_send_photos: false, can_send_videos: false, can_send_video_notes: false,
        can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false,
        can_add_web_page_previews: false,
      },
    });
    await log(ctx.api, chat.id, 'captcha',
      `🔇 Captcha muted <code>${user.id}</code> in <code>${chat.id}</code>`);
  } catch (e) {
    const reason = e.description || e.message;
    console.error('[captcha] restrict failed:', reason);
    await log(ctx.api, chat.id, 'captcha',
      `⚠️ Captcha could not mute <code>${user.id}</code> in <code>${chat.id}</code>: ${escapeHtml(reason)}`);
  }

  const name = escapeHtml(user.first_name || 'user');
  const joinTopicId = ctx.update?.chat_member?.message_thread_id || ctx.message?.message_thread_id;
  const botUsername = (ctx.me?.username) || (await ctx.api.getMe()).username;
  const token = crypto.randomBytes(18).toString('base64url');
  const deepLink = `https://t.me/${botUsername}?start=cap_${token}`;
  const kb = new InlineKeyboard().url(`🔐 Tap here to verify`, deepLink);

  const promptMsg = await ctx.api.sendMessage(chat.id,
    `👋 <b>Hey <a href="tg://user?id=${user.id}">${name}</a>!</b>\n\n` +
    `Before you can chat, I need to make sure you're a real human. ` +
    `Tap the button below — it opens a DM with me where you'll solve a quick check.\n\n` +
    `⏱ You have <b>${cfg.timeoutSec} seconds</b>. No verification = auto-removed.`,
    { parse_mode: 'HTML', message_thread_id: joinTopicId, reply_markup: kb });
  await log(ctx.api, chat.id, 'captcha',
    `🔐 Captcha challenge posted for <code>${user.id}</code>. topic=<code>${joinTopicId || 'none'}</code> timeout=<code>${cfg.timeoutSec}s</code>`);

  const timer = setTimeout(() => fail(ctx, chat.id, user.id, 'timeout'), cfg.timeoutSec * 1000);
  pending.set(key(chat.id, user.id), {
    timer,
    promptMessageId: promptMsg.message_id,
    groupChatId: chat.id,
    joinTopicId,
    attempts: 0,
    token,
    answer: null,         // filled when user taps /start in DM
    dmMessageId: null,
    started: false,
  });
}

// Called from /start handler when user hits the deep link in DM
async function startDmChallenge(ctx, token) {
  let entry, k;
  for (const [kk, v] of pending) {
    if (v.token === token) { entry = v; k = kk; break; }
  }
  if (!entry) {
    await ctx.reply('This verification link is no longer valid.');
    return true;
  }
  const [chatIdStr, userIdStr] = k.split(':');
  if (String(ctx.from.id) !== userIdStr) {
    // Silent, cheap reply — do NOT touch or advance the real user's pending entry
    await ctx.reply('⛔ This verification link is tied to another user. You cannot use it.');
    return true;
  }
  if (entry.started) {
    await ctx.reply('You already have a verification in progress. Answer the existing challenge.');
    return true;
  }
  const cfg = getChat(chatIdStr).captcha;
  const c = buildChallenge(cfg.type);
  let groupTitle = '';
  try { groupTitle = (await ctx.api.getChat(chatIdStr)).title || ''; } catch {}
  const caption =
    `🔐 <b>Verification for ${groupTitle ? escapeHtml(groupTitle) : 'the group'}</b>\n\n` +
    (c.question
      ? `${c.question}\n\nPick the correct answer below ⬇️`
      : `Tap the correct button to prove you're human ⬇️`) +
    `\n\n<i>You have ${cfg.timeoutSec}s. 3 wrong answers = removed from the group.</i>`;
  const msg = await sendChallenge(ctx.api, ctx.from.id, caption, c.kb, cfg.challengeMedia);
  entry.started = true;
  entry.answer = c.answer;
  entry.dmMessageId = msg.message_id;
  await log(ctx.api, chatIdStr, 'captcha',
    `📩 Captcha DM challenge started by <code>${ctx.from.id}</code>. type=<code>${cfg.type}</code>`);
  return true;
}

async function challengeInDM(ctx, chat, user, isJoinRequest) {
  try {
    const cfg = getChat(chat.id).captcha;
    const c = buildChallenge(cfg.type);
    const caption =
      `👋 Hey ${escapeHtml(user.first_name || 'there')}!\n\n` +
      `You requested to join <b>${escapeHtml(chat.title || 'the group')}</b>. ` +
      `To keep the community safe, solve this quick check and you're in:\n\n` +
      (c.question
        ? `<b>${c.question}</b>\n\nPick the right answer below ⬇️`
        : `Tap the correct button below ⬇️`) +
      `\n\n<i>${cfg.timeoutSec}s on the clock.</i>`;
    const msg = await sendChallenge(ctx.api, user.id, caption, c.kb, cfg.challengeMedia);
    const timer = setTimeout(async () => {
      if (isJoinRequest) {
        try { await ctx.api.declineChatJoinRequest(chat.id, user.id); } catch {}
      }
      pending.delete(key(chat.id, user.id));
    }, cfg.timeoutSec * 1000);
    pending.set(key(chat.id, user.id), {
      timer, messageId: msg.message_id, answer: c.answer, attempts: 0,
      joinRequestChatId: isJoinRequest ? chat.id : null, dm: true,
    });
    await log(ctx.api, chat.id, 'captcha',
      `📩 Join-request captcha sent to <code>${user.id}</code>. type=<code>${cfg.type}</code> timeout=<code>${cfg.timeoutSec}s</code>`);
  } catch (e) {
    // Can't DM them — reject join request
    if (isJoinRequest) {
      try { await ctx.api.declineChatJoinRequest(chat.id, user.id); } catch {}
    }
    await log(ctx.api, chat.id, 'captcha',
      `⚠️ Could not DM captcha to <code>${user.id}</code>; join request was declined. reason=<code>${escapeHtml(e.description || e.message)}</code>`);
  }
}

async function restoreMemberPermissions(api, chatId, userId) {
  try {
    // Telegram's Bot API documents this as the way to lift restrictions:
    // pass true for every known chat permission.
    await api.restrictChatMember(chatId, userId, {
      permissions: FULL_CHAT_PERMISSIONS,
      use_independent_chat_permissions: true,
      until_date: 0,
    });
    const state = await getPermissionState(api, chatId, userId);
    await log(api, chatId, 'captcha',
      `🔊 Captcha restored permissions for <code>${userId}</code> in <code>${chatId}</code>.\n${state}`);
    return true;
  } catch (e) {
    const reason = e.description || e.message;
    console.error('[captcha] unrestrict failed:', reason);
    const state = await getPermissionState(api, chatId, userId);
    await log(api, chatId, 'captcha',
      `⚠️ Could not restore permissions for <code>${userId}</code>: ${escapeHtml(reason)}\n` +
      `Make sure the bot is an admin with <b>Restrict Members</b> permission.\n${state}`);
    return false;
  }
}

async function getPermissionState(api, chatId, userId) {
  const lines = [];
  try {
    const member = await api.getChatMember(chatId, userId);
    const perms = member.permissions || {};
    lines.push(`member.status=<code>${escapeHtml(member.status)}</code>`);
    lines.push(`member.can_send_messages=<code>${String(perms.can_send_messages)}</code>`);
    lines.push(`member.until_date=<code>${member.until_date || 0}</code>`);
  } catch (e) {
    lines.push(`member_state_error=<code>${escapeHtml(e.description || e.message)}</code>`);
  }
  try {
    const chat = await api.getChat(chatId);
    const perms = chat.permissions || {};
    lines.push(`chat.default_can_send_messages=<code>${String(perms.can_send_messages)}</code>`);
    if (perms.can_send_messages === false) {
      lines.push(`<b>Chat default permissions are locked, so members may still be unable to write.</b>`);
    }
  } catch (e) {
    lines.push(`chat_state_error=<code>${escapeHtml(e.description || e.message)}</code>`);
  }
  try {
    const me = await api.getMe();
    const botMember = await api.getChatMember(chatId, me.id);
    lines.push(`bot.status=<code>${escapeHtml(botMember.status)}</code>`);
    lines.push(`bot.can_restrict_members=<code>${String(botMember.can_restrict_members)}</code>`);
  } catch (e) {
    lines.push(`bot_state_error=<code>${escapeHtml(e.description || e.message)}</code>`);
  }
  return lines.join('\n');
}

function buildChallenge(type) {
  if (type === 'math') return makeMathChallenge();
  if (type === 'emoji') return makeEmojiChallenge();
  return makeButtonChallenge();
}

async function onCallback(ctx) {
  const data = ctx.callbackQuery.data;
  if (!data?.startsWith('cap:')) return false;

  const chatId = ctx.chat?.id;
  const userId = ctx.from.id;
  // Always scope by the caller's userId — this alone blocks any cross-user tap.
  let entry, k;
  if (ctx.chat?.type === 'private') {
    const callbackMessageId = ctx.callbackQuery.message?.message_id;
    for (const [kk, v] of pending) {
      if (!kk.endsWith(':' + userId)) continue;
      if (callbackMessageId && (v.dmMessageId === callbackMessageId || v.messageId === callbackMessageId)) {
        entry = v; k = kk; break;
      }
      if (!entry) { entry = v; k = kk; }
    }
  } else {
    k = key(chatId, userId);
    entry = pending.get(k);
  }

  if (!entry) {
    await ctx.answerCallbackQuery({ text: '⛔ Not for you.', show_alert: false });
    return true;
  }

  const answer = data.split(':')[1];
  if (answer === entry.answer) {
    clearTimeout(entry.timer);
    pending.delete(k);
    const [origChat] = k.split(':');

    if (entry.joinRequestChatId) {
      try {
        await ctx.api.approveChatJoinRequest(entry.joinRequestChatId, userId);
        await restoreMemberPermissions(ctx.api, entry.joinRequestChatId, userId);
      } catch (e) {
        const reason = e.description || e.message;
        console.error('[captcha] approve join request failed:', reason);
        await log(ctx.api, entry.joinRequestChatId, 'captcha',
          `⚠️ Could not approve verified join request for <code>${userId}</code>: ${escapeHtml(reason)}`);
      }
      await ctx.answerCallbackQuery({ text: '✅ Verified! You can join now.' });
      try {
        if (entry.messageId) await ctx.api.editMessageText(userId, entry.messageId, '✅ Verified. Welcome!');
      } catch {}
    } else {
      await restoreMemberPermissions(ctx.api, origChat, userId);
      await ctx.answerCallbackQuery({ text: '✅ Verified!' });
      const cfg = getChat(origChat).captcha;
      // Clean up: DM challenge + in-group prompt
      if (entry.dmMessageId) { try { await ctx.api.deleteMessage(userId, entry.dmMessageId); } catch {} }
      if (entry.promptMessageId) { try { await ctx.api.deleteMessage(origChat, entry.promptMessageId); } catch {} }
      try { await ctx.api.sendMessage(userId, '✅ You are verified. Returning to the group.'); } catch {}
      await sendWelcome(ctx.api, origChat, userId, ctx.from.first_name || '', cfg, entry.joinTopicId);
      await log(ctx.api, origChat, 'captcha', `✅ captcha passed by <code>${userId}</code>`);
    }
    return true;
  }

  entry.attempts++;
  if (entry.attempts >= 3) {
    await ctx.answerCallbackQuery({ text: '❌ Too many wrong answers.', show_alert: true });
    await fail(ctx, k.split(':')[0], userId, 'wrong');
  } else {
    await ctx.answerCallbackQuery({ text: `❌ Wrong. ${3 - entry.attempts} tries left.`, show_alert: true });
  }
  return true;
}

async function fail(ctx, chatId, userId, reason) {
  const k = key(chatId, userId);
  const entry = pending.get(k);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(k);

  if (entry.joinRequestChatId) {
    try { await ctx.api.declineChatJoinRequest(entry.joinRequestChatId, userId); } catch {}
    if (entry.messageId) { try { await ctx.api.editMessageText(userId, entry.messageId, '❌ Verification failed.'); } catch {} }
  } else {
    try { await ctx.api.banChatMember(chatId, userId); } catch {}
    try { await ctx.api.unbanChatMember(chatId, userId); } catch {} // kick, not ban
    if (entry.promptMessageId) { try { await ctx.api.deleteMessage(chatId, entry.promptMessageId); } catch {} }
    if (entry.dmMessageId) { try { await ctx.api.deleteMessage(userId, entry.dmMessageId); } catch {} }
  }
  await log(ctx.api, chatId, 'captcha', `❌ captcha failed (${reason}) for <code>${userId}</code>`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

module.exports = { onChatMember, onCallback, startDmChallenge, pending };
