const { getChat } = require('../store');
const { log } = require('../modules/logger');

// userBuckets[chatId:userId] = timestamps[]
const buckets = new Map();
// raidWindows[chatId] = joinTimestamps[]
const raidWindows = new Map();
const raidActive = new Map();

async function floodMiddleware(ctx, next) {
  if (!ctx.message || ctx.chat?.type === 'private') return next();
  const chat = getChat(ctx.chat.id);
  const cfg = chat.antispam;

  if (cfg.forwardBlock && (ctx.message.forward_origin || ctx.message.forward_from || ctx.message.forward_from_chat)) {
    try { await ctx.deleteMessage(); } catch {}
    await log(ctx.api, ctx.chat.id, 'links', `↪️ Forward deleted from <code>${ctx.from.id}</code>`);
    return;
  }

  const k = `${ctx.chat.id}:${ctx.from.id}`;
  const now = Date.now();
  const win = cfg.floodWindowSec * 1000;
  const arr = (buckets.get(k) || []).filter(t => now - t < win);
  arr.push(now);
  buckets.set(k, arr);

  if (arr.length > cfg.floodMsgs) {
    buckets.set(k, []);
    try {
      if (cfg.floodAction === 'mute') {
        await ctx.api.restrictChatMember(ctx.chat.id, ctx.from.id, {
          permissions: { can_send_messages: false },
          until_date: Math.floor(Date.now() / 1000) + cfg.muteMinutes * 60,
        });
      } else if (cfg.floodAction === 'kick') {
        await ctx.api.banChatMember(ctx.chat.id, ctx.from.id);
        await ctx.api.unbanChatMember(ctx.chat.id, ctx.from.id);
      } else if (cfg.floodAction === 'ban') {
        await ctx.api.banChatMember(ctx.chat.id, ctx.from.id);
      }
    } catch {}
    await log(ctx.api, ctx.chat.id, 'bans', `🌊 <b>Flood</b> by <code>${ctx.from.id}</code> (${arr.length} msgs/${cfg.floodWindowSec}s) → ${cfg.floodAction}`);
    return;
  }

  return next();
}

function recordJoin(chatId) {
  const chat = getChat(chatId);
  const cfg = chat.antiraid;
  if (!cfg.enabled) return { raid: false };

  const now = Date.now();
  const win = cfg.windowSec * 1000;
  const arr = (raidWindows.get(chatId) || []).filter(t => now - t < win);
  arr.push(now);
  raidWindows.set(chatId, arr);

  if (arr.length >= cfg.joinThreshold && !raidActive.get(chatId)) {
    raidActive.set(chatId, Date.now() + cfg.autoLockMinutes * 60 * 1000);
    return { raid: true, until: raidActive.get(chatId) };
  }
  return { raid: false };
}

function isRaidActive(chatId) {
  const until = raidActive.get(chatId);
  if (!until) return false;
  if (Date.now() > until) { raidActive.delete(chatId); return false; }
  return true;
}

function clearRaid(chatId) { raidActive.delete(chatId); }

module.exports = { floodMiddleware, recordJoin, isRaidActive, clearRaid };
