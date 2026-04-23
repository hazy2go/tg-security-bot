const { getChat, save } = require('../store');
const { log } = require('../modules/logger');

const INVITE_RX = /(?:https?:\/\/)?t(?:elegram)?\.(?:me|dog)\/(?:\+|joinchat\/)[A-Za-z0-9_-]+/i;
const URL_RX = /\bhttps?:\/\/[^\s<>"']+|(?:^|\s)([a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi;

function extractUrls(text) {
  if (!text) return [];
  const out = [];
  const rx = /\bhttps?:\/\/[^\s<>"')\]]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"')\]]*)?/gi;
  let m;
  while ((m = rx.exec(text))) out.push(m[0]);
  return out;
}

function getHost(u) {
  try {
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch { return null; }
}

function matchesDomain(host, list) {
  if (!host) return false;
  return list.some(d => {
    d = d.toLowerCase();
    return host === d || host.endsWith('.' + d);
  });
}

async function linkMiddleware(ctx, next) {
  if (!ctx.message || ctx.chat?.type === 'private') return next();
  const chat = getChat(ctx.chat.id);
  const cfg = chat.links;

  if (cfg.adminsBypass) {
    try {
      const m = await ctx.getChatMember(ctx.from.id);
      if (['creator', 'administrator'].includes(m.status)) return next();
    } catch {}
  }

  const text = ctx.message.text || ctx.message.caption || '';
  const entities = ctx.message.entities || ctx.message.caption_entities || [];
  let urls = extractUrls(text);
  for (const e of entities) {
    if (e.type === 'text_link' && e.url) urls.push(e.url);
  }

  const violations = [];
  if (cfg.blockInvites && INVITE_RX.test(text)) violations.push('invite link');
  if (cfg.blockAllLinks && urls.length) violations.push('links disabled');

  if (!cfg.blockAllLinks && urls.length) {
    for (const u of urls) {
      const host = getHost(u);
      if (!host) continue;
      if (cfg.mode === 'whitelist') {
        if (!matchesDomain(host, cfg.whitelist)) { violations.push(`non-whitelisted: ${host}`); break; }
      } else {
        if (matchesDomain(host, cfg.blacklist)) { violations.push(`blacklisted: ${host}`); break; }
      }
    }
  }

  if (!violations.length) return next();

  try { await ctx.deleteMessage(); } catch {}
  await log(ctx.api, ctx.chat.id, 'links',
    `🔗 <b>Link blocked</b> from <code>${ctx.from.id}</code>: ${violations.join(', ')}\n` +
    `<i>${escapeHtml(text.slice(0, 200))}</i>`);

  if (cfg.action === 'delete_warn') {
    chat.warns.users[ctx.from.id] = (chat.warns.users[ctx.from.id] || 0) + 1;
    save();
    try {
      const m = await ctx.api.sendMessage(ctx.chat.id,
        `⚠️ <a href="tg://user?id=${ctx.from.id}">${escapeHtml(ctx.from.first_name || '')}</a>, links not allowed here (${violations[0]}). Warn ${chat.warns.users[ctx.from.id]}/${chat.warns.limit}.`,
        { parse_mode: 'HTML' });
      setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, m.message_id).catch(() => {}), 10000);
    } catch {}
    if (chat.warns.users[ctx.from.id] >= chat.warns.limit) {
      chat.warns.users[ctx.from.id] = 0;
      save();
      try {
        await ctx.api.restrictChatMember(ctx.chat.id, ctx.from.id, {
          permissions: { can_send_messages: false },
          until_date: Math.floor(Date.now() / 1000) + chat.antispam.muteMinutes * 60,
        });
      } catch {}
    }
  } else if (cfg.action === 'mute') {
    try {
      await ctx.api.restrictChatMember(ctx.chat.id, ctx.from.id, {
        permissions: { can_send_messages: false },
        until_date: Math.floor(Date.now() / 1000) + chat.antispam.muteMinutes * 60,
      });
    } catch {}
  } else if (cfg.action === 'kick') {
    try {
      await ctx.api.banChatMember(ctx.chat.id, ctx.from.id);
      await ctx.api.unbanChatMember(ctx.chat.id, ctx.from.id);
    } catch {}
  } else if (cfg.action === 'ban') {
    try { await ctx.api.banChatMember(ctx.chat.id, ctx.from.id); } catch {}
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

module.exports = { linkMiddleware };
