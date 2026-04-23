const { InlineKeyboard } = require('grammy');
const crypto = require('crypto');
const { getChat } = require('../store');
const { log } = require('./logger');

// pending[chatId:userId] = { timer, messageId, answer, attempts }
const pending = new Map();
const key = (c, u) => `${c}:${u}`;

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
  } catch (e) { console.error('[captcha] restrict failed:', e.description); }

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
  } catch {
    // Can't DM them — reject join request
    if (isJoinRequest) {
      try { await ctx.api.declineChatJoinRequest(chat.id, user.id); } catch {}
    }
  }
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
    for (const [kk, v] of pending) {
      if (kk.endsWith(':' + userId)) { entry = v; k = kk; break; }
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
      try { await ctx.api.approveChatJoinRequest(entry.joinRequestChatId, userId); } catch {}
      await ctx.answerCallbackQuery({ text: '✅ Verified! You can join now.' });
      try {
        if (entry.messageId) await ctx.api.editMessageText(userId, entry.messageId, '✅ Verified. Welcome!');
      } catch {}
    } else {
      try {
        await ctx.api.restrictChatMember(origChat, userId, {
          permissions: {
            can_send_messages: true, can_send_audios: true, can_send_documents: true,
            can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
            can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
            can_add_web_page_previews: true,
          },
        });
      } catch (e) { console.error('[captcha] unrestrict:', e.description); }
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
