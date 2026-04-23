const { InlineKeyboard } = require('grammy');
const { getChat, save, load } = require('../store');
const { isOwner, isBotAdmin, addBotAdmin, removeBotAdmin } = require('../roles');

// Stores pending text-input prompts: key = userId → { chatId, action }
const awaiting = new Map();

function isAuthorizedForPanel(ctx) {
  return isBotAdmin(ctx.from.id);
}

function mainMenu(chatId) {
  const kb = new InlineKeyboard()
    .text('🛡 Security', `p:sec:${chatId}`).text('🤖 CAPTCHA', `p:cap:${chatId}`).row()
    .text('🔗 Links', `p:lnk:${chatId}`).text('🌊 Antispam', `p:asp:${chatId}`).row()
    .text('🚨 Antiraid', `p:raid:${chatId}`).text('⚠️ Warns', `p:warn:${chatId}`).row()
    .text('📰 Feeds', `p:feed:${chatId}`).text('📋 Logs', `p:log:${chatId}`).row()
    .text('👑 Permissions', `p:perm:${chatId}`).text('❌ Close', `p:close`);
  return kb;
}

function backRow(chatId) { return new InlineKeyboard().text('◀️ Back', `p:main:${chatId}`); }

async function cmdAdmin(ctx) {
  if (!isAuthorizedForPanel(ctx)) return ctx.reply('⛔ Bot-admins only.');
  const chatId = ctx.chat.type === 'private'
    ? (() => {
        const approved = load().approvedChats;
        return approved[0] || ctx.chat.id;
      })()
    : ctx.chat.id;
  await ctx.reply(
    `<b>⚙️ Admin Panel</b>\nChat: <code>${chatId}</code>\n\nPick a category:`,
    { parse_mode: 'HTML', reply_markup: mainMenu(chatId) });
}

async function onPanelCallback(ctx) {
  const data = ctx.callbackQuery.data;
  if (!data?.startsWith('p:')) return false;
  if (!isAuthorizedForPanel(ctx)) {
    await ctx.answerCallbackQuery({ text: '⛔ Not authorized.', show_alert: true });
    return true;
  }
  const [, action, chatIdStr, ...rest] = data.split(':');
  const chatId = chatIdStr && chatIdStr !== 'close' ? chatIdStr : null;

  if (data === 'p:close') {
    try { await ctx.deleteMessage(); } catch {}
    await ctx.answerCallbackQuery();
    return true;
  }

  if (action === 'main') return render(ctx, chatId, 'main');
  if (action === 'sec') return render(ctx, chatId, 'sec');
  if (action === 'cap') return render(ctx, chatId, 'cap', rest);
  if (action === 'lnk') return render(ctx, chatId, 'lnk', rest);
  if (action === 'asp') return render(ctx, chatId, 'asp', rest);
  if (action === 'raid') return render(ctx, chatId, 'raid', rest);
  if (action === 'warn') return render(ctx, chatId, 'warn', rest);
  if (action === 'feed') return render(ctx, chatId, 'feed', rest);
  if (action === 'log') return render(ctx, chatId, 'log', rest);
  if (action === 'perm') return render(ctx, chatId, 'perm', rest);
  return true;
}

async function render(ctx, chatId, section, rest = []) {
  const chat = getChat(chatId);
  let title, text, kb;

  if (section === 'main') {
    title = '⚙️ Admin Panel';
    text = `Chat: <code>${chatId}</code>\nPick a category:`;
    kb = mainMenu(chatId);
  } else if (section === 'sec') {
    text = `<b>🛡 Security overview</b>\n\n` +
      `CAPTCHA: ${chat.captcha.enabled ? '✅' : '❌'} (${chat.captcha.type}, ${chat.captcha.timeoutSec}s)\n` +
      `Link mode: <code>${chat.links.mode}</code> · Invites blocked: ${chat.links.blockInvites ? '✅' : '❌'}\n` +
      `All links blocked: ${chat.links.blockAllLinks ? '✅' : '❌'}\n` +
      `Forward block: ${chat.antispam.forwardBlock ? '✅' : '❌'}\n` +
      `Flood: ${chat.antispam.floodMsgs}/${chat.antispam.floodWindowSec}s → ${chat.antispam.floodAction}\n` +
      `Antiraid: ${chat.antiraid.enabled ? '✅' : '❌'} (≥${chat.antiraid.joinThreshold} joins / ${chat.antiraid.windowSec}s)\n` +
      `Warns: ${chat.warns.limit} → ${chat.warns.action}`;
    kb = backRow(chatId);
  } else if (section === 'cap') {
    const sub = rest[0];
    if (sub === 'toggle') { chat.captcha.enabled = !chat.captcha.enabled; save(); }
    if (sub === 'type') { const types = ['button','math','emoji']; chat.captcha.type = types[(types.indexOf(chat.captcha.type)+1) % 3]; save(); }
    if (sub === 'timeout') { const opts = [60, 120, 180, 300, 600]; const i = opts.indexOf(chat.captcha.timeoutSec); chat.captcha.timeoutSec = opts[(i + 1) % opts.length]; save(); }
    if (sub === 'welcome') { awaiting.set(ctx.from.id, { chatId, action: 'cap.welcome' }); await ctx.answerCallbackQuery(); return ctx.reply('Send the new welcome message text.\n\n<b>Placeholders you can use:</b>\n<code>{name}</code> — user\'s first name\n<code>{mention}</code> — clickable mention\n<code>{count}</code> — member number\n<code>{group}</code> — group title\n<code>{id}</code> — user ID\n\nHTML formatting supported: <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, <code>&lt;u&gt;</code>, <code>&lt;a href=""&gt;</code>, <code>&lt;code&gt;</code>, <code>&lt;blockquote&gt;</code>, emoji.', { parse_mode: 'HTML' }); }
    if (sub === 'media') { awaiting.set(ctx.from.id, { chatId, action: 'cap.media' }); await ctx.answerCallbackQuery(); return ctx.reply('Send a GIF/photo/video for the <b>welcome banner</b> (shown after CAPTCHA pass).\n\nRecommended: 1280×720 (16:9) or 1080×1080 (1:1), &lt;10MB, MP4.\n\nSend "none" to remove.', { parse_mode: 'HTML' }); }
    if (sub === 'cmedia') { awaiting.set(ctx.from.id, { chatId, action: 'cap.cmedia' }); await ctx.answerCallbackQuery(); return ctx.reply('Send a GIF/photo/video for the <b>CAPTCHA banner</b> (shown with the challenge itself).\n\nSame recommendations apply. Send "none" to remove.', { parse_mode: 'HTML' }); }
    if (sub === 'target') { awaiting.set(ctx.from.id, { chatId, action: 'cap.target' }); await ctx.answerCallbackQuery(); return ctx.reply('Send welcome destination as <code>chatId</code> or <code>chatId:topicId</code>, or "same" to post in the topic they joined, or "none" to reset.', { parse_mode: 'HTML' }); }
    const mediaLabel = chat.captcha.welcomeMedia ? `${chat.captcha.welcomeMedia.type} ✅` : '—';
    const cmediaLabel = chat.captcha.challengeMedia ? `${chat.captcha.challengeMedia.type} ✅` : '—';
    const targetLabel = chat.captcha.welcomeTarget || 'same chat/topic';
    text = `<b>🤖 CAPTCHA</b>\n\nEnabled: ${chat.captcha.enabled ? '✅' : '❌'}\nType: <code>${chat.captcha.type}</code>\nTimeout: ${chat.captcha.timeoutSec}s\n\n<b>Welcome text:</b>\n<i>${escapeHtml(chat.captcha.welcomeText || '')}</i>\n\n<b>CAPTCHA banner:</b> ${cmediaLabel}\n<b>Welcome banner:</b> ${mediaLabel}\n<b>Post welcome to:</b> <code>${escapeHtml(targetLabel)}</code>`;
    kb = new InlineKeyboard()
      .text(chat.captcha.enabled ? 'Disable' : 'Enable', `p:cap:${chatId}:toggle`)
      .text('Cycle type', `p:cap:${chatId}:type`).row()
      .text('Cycle timeout', `p:cap:${chatId}:timeout`)
      .text('Set welcome text', `p:cap:${chatId}:welcome`).row()
      .text('🖼 Captcha banner', `p:cap:${chatId}:cmedia`)
      .text('🎉 Welcome banner', `p:cap:${chatId}:media`).row()
      .text('📍 Welcome target', `p:cap:${chatId}:target`).row()
      .text('◀️ Back', `p:main:${chatId}`);
  } else if (section === 'lnk') {
    const sub = rest[0];
    if (sub === 'mode') { chat.links.mode = chat.links.mode === 'whitelist' ? 'blacklist' : 'whitelist'; save(); }
    if (sub === 'invites') { chat.links.blockInvites = !chat.links.blockInvites; save(); }
    if (sub === 'all') { chat.links.blockAllLinks = !chat.links.blockAllLinks; save(); }
    if (sub === 'bypass') { chat.links.adminsBypass = !chat.links.adminsBypass; save(); }
    if (sub === 'action') { const a=['delete_warn','mute','kick','ban']; chat.links.action = a[(a.indexOf(chat.links.action)+1)%a.length]; save(); }
    if (sub === 'addwl') { awaiting.set(ctx.from.id, { chatId, action: 'lnk.addwl' }); await ctx.answerCallbackQuery(); return ctx.reply('Send domain(s) to add to whitelist (space separated, e.g. example.com):'); }
    if (sub === 'rmwl') { awaiting.set(ctx.from.id, { chatId, action: 'lnk.rmwl' }); await ctx.answerCallbackQuery(); return ctx.reply('Send domain(s) to remove from whitelist:'); }
    if (sub === 'addbl') { awaiting.set(ctx.from.id, { chatId, action: 'lnk.addbl' }); await ctx.answerCallbackQuery(); return ctx.reply('Send domain(s) to add to blacklist:'); }
    if (sub === 'rmbl') { awaiting.set(ctx.from.id, { chatId, action: 'lnk.rmbl' }); await ctx.answerCallbackQuery(); return ctx.reply('Send domain(s) to remove from blacklist:'); }
    text = `<b>🔗 Links</b>\n\nMode: <code>${chat.links.mode}</code>\nBlock invites: ${chat.links.blockInvites ? '✅' : '❌'}\nBlock ALL links: ${chat.links.blockAllLinks ? '✅' : '❌'}\nAdmins bypass: ${chat.links.adminsBypass ? '✅' : '❌'}\nAction: <code>${chat.links.action}</code>\n\n<b>Whitelist:</b> ${chat.links.whitelist.map(d=>`<code>${d}</code>`).join(', ') || '—'}\n<b>Blacklist:</b> ${chat.links.blacklist.map(d=>`<code>${d}</code>`).join(', ') || '—'}`;
    kb = new InlineKeyboard()
      .text(`Mode: ${chat.links.mode}`, `p:lnk:${chatId}:mode`)
      .text(`Action: ${chat.links.action}`, `p:lnk:${chatId}:action`).row()
      .text(`Invites ${chat.links.blockInvites ? '✅' : '❌'}`, `p:lnk:${chatId}:invites`)
      .text(`All links ${chat.links.blockAllLinks ? '✅' : '❌'}`, `p:lnk:${chatId}:all`).row()
      .text(`Admins bypass ${chat.links.adminsBypass ? '✅' : '❌'}`, `p:lnk:${chatId}:bypass`).row()
      .text('+ Whitelist', `p:lnk:${chatId}:addwl`).text('− Whitelist', `p:lnk:${chatId}:rmwl`).row()
      .text('+ Blacklist', `p:lnk:${chatId}:addbl`).text('− Blacklist', `p:lnk:${chatId}:rmbl`).row()
      .text('◀️ Back', `p:main:${chatId}`);
  } else if (section === 'asp') {
    const sub = rest[0];
    if (sub === 'fwd') { chat.antispam.forwardBlock = !chat.antispam.forwardBlock; save(); }
    if (sub === 'msgs') { const o=[5,8,10,15,20]; chat.antispam.floodMsgs = o[(o.indexOf(chat.antispam.floodMsgs)+1)%o.length]; save(); }
    if (sub === 'win') { const o=[5,10,15,30,60]; chat.antispam.floodWindowSec = o[(o.indexOf(chat.antispam.floodWindowSec)+1)%o.length]; save(); }
    if (sub === 'action') { const a=['mute','kick','ban']; chat.antispam.floodAction = a[(a.indexOf(chat.antispam.floodAction)+1)%a.length]; save(); }
    if (sub === 'mute') { const o=[5,10,30,60,360,1440]; chat.antispam.muteMinutes = o[(o.indexOf(chat.antispam.muteMinutes)+1)%o.length]; save(); }
    text = `<b>🌊 Antispam</b>\n\nForward block: ${chat.antispam.forwardBlock ? '✅' : '❌'}\nFlood: ${chat.antispam.floodMsgs} msgs / ${chat.antispam.floodWindowSec}s → ${chat.antispam.floodAction}\nMute duration: ${chat.antispam.muteMinutes} min`;
    kb = new InlineKeyboard()
      .text(`Forward ${chat.antispam.forwardBlock ? '✅' : '❌'}`, `p:asp:${chatId}:fwd`).row()
      .text(`Msgs: ${chat.antispam.floodMsgs}`, `p:asp:${chatId}:msgs`)
      .text(`Window: ${chat.antispam.floodWindowSec}s`, `p:asp:${chatId}:win`).row()
      .text(`Action: ${chat.antispam.floodAction}`, `p:asp:${chatId}:action`)
      .text(`Mute: ${chat.antispam.muteMinutes}m`, `p:asp:${chatId}:mute`).row()
      .text('◀️ Back', `p:main:${chatId}`);
  } else if (section === 'raid') {
    const sub = rest[0];
    if (sub === 'toggle') { chat.antiraid.enabled = !chat.antiraid.enabled; save(); }
    if (sub === 'thresh') { const o=[5,8,10,15,25]; chat.antiraid.joinThreshold = o[(o.indexOf(chat.antiraid.joinThreshold)+1)%o.length]; save(); }
    if (sub === 'win') { const o=[15,30,60,120]; chat.antiraid.windowSec = o[(o.indexOf(chat.antiraid.windowSec)+1)%o.length]; save(); }
    if (sub === 'lock') { const o=[5,15,30,60]; chat.antiraid.autoLockMinutes = o[(o.indexOf(chat.antiraid.autoLockMinutes)+1)%o.length]; save(); }
    text = `<b>🚨 Antiraid</b>\n\nEnabled: ${chat.antiraid.enabled ? '✅' : '❌'}\nTrigger: ≥${chat.antiraid.joinThreshold} joins / ${chat.antiraid.windowSec}s\nAuto-lock: ${chat.antiraid.autoLockMinutes} min`;
    kb = new InlineKeyboard()
      .text(chat.antiraid.enabled ? 'Disable' : 'Enable', `p:raid:${chatId}:toggle`).row()
      .text(`Threshold: ${chat.antiraid.joinThreshold}`, `p:raid:${chatId}:thresh`)
      .text(`Window: ${chat.antiraid.windowSec}s`, `p:raid:${chatId}:win`).row()
      .text(`Lock: ${chat.antiraid.autoLockMinutes}m`, `p:raid:${chatId}:lock`).row()
      .text('◀️ Back', `p:main:${chatId}`);
  } else if (section === 'warn') {
    const sub = rest[0];
    if (sub === 'limit') { const o=[2,3,4,5,10]; chat.warns.limit = o[(o.indexOf(chat.warns.limit)+1)%o.length]; save(); }
    if (sub === 'action') { const a=['mute','kick','ban']; chat.warns.action = a[(a.indexOf(chat.warns.action)+1)%a.length]; save(); }
    if (sub === 'reset') { chat.warns.users = {}; save(); }
    const activeWarns = Object.entries(chat.warns.users).filter(([,n])=>n>0);
    text = `<b>⚠️ Warns</b>\n\nLimit: ${chat.warns.limit}\nAction at limit: <code>${chat.warns.action}</code>\n\nActive: ${activeWarns.length ? activeWarns.map(([u,n])=>`<code>${u}</code>:${n}`).join(', ') : '—'}`;
    kb = new InlineKeyboard()
      .text(`Limit: ${chat.warns.limit}`, `p:warn:${chatId}:limit`)
      .text(`Action: ${chat.warns.action}`, `p:warn:${chatId}:action`).row()
      .text('Reset all warns', `p:warn:${chatId}:reset`).row()
      .text('◀️ Back', `p:main:${chatId}`);
  } else if (section === 'log') {
    const sub = rest[0];
    const cats = ['default','joins','bans','captcha','links','feeds'];
    if (sub === 'set') { awaiting.set(ctx.from.id, { chatId, action: `log.set.${rest[1]}` }); await ctx.answerCallbackQuery(); return ctx.reply(`Send the chat ID (or chatId:topicId) to use for <b>${rest[1]}</b> logs, or "none" to clear.`, { parse_mode: 'HTML' }); }
    text = `<b>📋 Log targets</b>\n\n` + cats.map(c => `• <b>${c}</b>: ${chat.logTargets[c] ? `<code>${chat.logTargets[c]}</code>` : '—'}`).join('\n') + `\n\nTip: forward a message from the target chat to the bot in DM to get its ID. Use <code>chatId:topicId</code> for forum topics.`;
    kb = new InlineKeyboard();
    for (const c of cats) kb.text(`Set ${c}`, `p:log:${chatId}:set:${c}`).row();
    kb.text('◀️ Back', `p:main:${chatId}`);
  } else if (section === 'feed') {
    const sub = rest[0];
    const s = load();
    if (sub === 'target') { awaiting.set(ctx.from.id, { chatId, action: 'feed.target' }); await ctx.answerCallbackQuery(); return ctx.reply('Send target as <code>chatId</code> or <code>chatId:topicId</code>.', { parse_mode: 'HTML' }); }
    if (sub === 'addx') { awaiting.set(ctx.from.id, { chatId, action: 'feed.addx' }); await ctx.answerCallbackQuery(); return ctx.reply('Send X/Twitter handle(s) to monitor (without @):'); }
    if (sub === 'rmx') { awaiting.set(ctx.from.id, { chatId, action: 'feed.rmx' }); await ctx.answerCallbackQuery(); return ctx.reply('Send X/Twitter handle(s) to remove:'); }
    if (sub === 'addrss') { awaiting.set(ctx.from.id, { chatId, action: 'feed.addrss' }); await ctx.answerCallbackQuery(); return ctx.reply('Send RSS/Atom feed URL:'); }
    if (sub === 'rmrss') { awaiting.set(ctx.from.id, { chatId, action: 'feed.rmrss' }); await ctx.answerCallbackQuery(); return ctx.reply('Send RSS URL to remove:'); }
    text = `<b>📰 Feeds</b>\n\nTarget: ${s.feeds.target ? `<code>${s.feeds.target}</code>` : '—'}\n\n<b>X handles:</b> ${s.feeds.x.length ? s.feeds.x.map(h=>`@${h}`).join(', ') : '—'}\n<b>RSS:</b> ${s.feeds.rss.length ? s.feeds.rss.map(u=>`<code>${escapeHtml(u)}</code>`).join('\n') : '—'}`;
    kb = new InlineKeyboard()
      .text('Set target', `p:feed:${chatId}:target`).row()
      .text('+ X handle', `p:feed:${chatId}:addx`).text('− X handle', `p:feed:${chatId}:rmx`).row()
      .text('+ RSS', `p:feed:${chatId}:addrss`).text('− RSS', `p:feed:${chatId}:rmrss`).row()
      .text('◀️ Back', `p:main:${chatId}`);
  } else if (section === 'perm') {
    if (!isOwner(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: '⛔ Owner only.', show_alert: true });
      return true;
    }
    const sub = rest[0];
    const s = load();
    if (sub === 'add') { awaiting.set(ctx.from.id, { chatId, action: 'perm.add' }); await ctx.answerCallbackQuery(); return ctx.reply('Send user ID(s) to grant bot-admin:'); }
    if (sub === 'rm') { awaiting.set(ctx.from.id, { chatId, action: 'perm.rm' }); await ctx.answerCallbackQuery(); return ctx.reply('Send user ID(s) to revoke bot-admin:'); }
    if (sub === 'approve') { awaiting.set(ctx.from.id, { chatId, action: 'perm.approve' }); await ctx.answerCallbackQuery(); return ctx.reply('Send chat ID(s) to approve:'); }
    if (sub === 'unapprove') { awaiting.set(ctx.from.id, { chatId, action: 'perm.unapprove' }); await ctx.answerCallbackQuery(); return ctx.reply('Send chat ID(s) to revoke:'); }
    text = `<b>👑 Permissions</b>\n\nOwner: <code>${process.env.OWNER_ID}</code>\n\n<b>Bot admins:</b> ${s.botAdmins.length ? s.botAdmins.map(i=>`<code>${i}</code>`).join(', ') : '—'}\n\n<b>Approved chats:</b> ${s.approvedChats.length ? s.approvedChats.map(i=>`<code>${i}</code>`).join(', ') : '—'}\n\n<b>Pending invites:</b> ${Object.keys(s.pendingChats||{}).length ? Object.entries(s.pendingChats).map(([i,t])=>`<code>${i}</code> — ${escapeHtml(t)}`).join('\n') : '—'}`;
    kb = new InlineKeyboard()
      .text('+ Bot admin', `p:perm:${chatId}:add`).text('− Bot admin', `p:perm:${chatId}:rm`).row()
      .text('+ Approve chat', `p:perm:${chatId}:approve`).text('− Revoke chat', `p:perm:${chatId}:unapprove`).row()
      .text('◀️ Back', `p:main:${chatId}`);
  }

  try {
    await ctx.editMessageText(text || title, { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } });
  } catch {
    await ctx.reply(text || title, { parse_mode: 'HTML', reply_markup: kb });
  }
  await ctx.answerCallbackQuery();
  return true;
}

async function handleTextInput(ctx) {
  const pending = awaiting.get(ctx.from.id);
  if (!pending) return false;
  awaiting.delete(ctx.from.id);
  const text = (ctx.message.text || '').trim();
  const [cat, op, arg] = pending.action.split('.');
  const chat = getChat(pending.chatId);
  const s = load();

  try {
    if (cat === 'cap' && op === 'welcome') {
      chat.captcha.welcomeText = text.slice(0, 1000); save();
      await ctx.reply('✅ Welcome text updated.');
    } else if (cat === 'cap' && op === 'target') {
      const v = text.toLowerCase();
      chat.captcha.welcomeTarget = (v === 'same' || v === 'none') ? null : text;
      save();
      await ctx.reply(`✅ Welcome target: ${chat.captcha.welcomeTarget || 'same chat/topic'}`);
    } else if (cat === 'cap' && op === 'media' && text.toLowerCase() === 'none') {
      chat.captcha.welcomeMedia = null; save();
      await ctx.reply('✅ Welcome banner removed.');
    } else if (cat === 'cap' && op === 'cmedia' && text.toLowerCase() === 'none') {
      chat.captcha.challengeMedia = null; save();
      await ctx.reply('✅ CAPTCHA banner removed.');
    } else if (cat === 'lnk') {
      const list = op === 'addwl' || op === 'rmwl' ? chat.links.whitelist : chat.links.blacklist;
      const domains = text.toLowerCase().split(/\s+/).map(d=>d.replace(/^https?:\/\//,'').replace(/\/.*/,'').replace(/^www\./,'')).filter(Boolean);
      if (op.startsWith('add')) {
        for (const d of domains) if (!list.includes(d)) list.push(d);
      } else {
        for (const d of domains) { const i = list.indexOf(d); if (i>=0) list.splice(i,1); }
      }
      save();
      await ctx.reply(`✅ Updated (${list.length} entries).`);
    } else if (cat === 'log' && op === 'set') {
      const category = arg;
      chat.logTargets[category] = text.toLowerCase() === 'none' ? null : text;
      save();
      await ctx.reply(`✅ Log target for ${category}: ${chat.logTargets[category] || 'none'}`);
    } else if (cat === 'feed') {
      if (op === 'target') { s.feeds.target = text; save(); await ctx.reply('✅ Feed target set.'); }
      else if (op === 'addx') { const h = text.replace(/^@/,'').split(/\s+/).filter(Boolean); for (const x of h) if (!s.feeds.x.includes(x)) s.feeds.x.push(x); save(); await ctx.reply(`✅ Now monitoring ${s.feeds.x.length} X accounts.`); }
      else if (op === 'rmx') { const h = text.replace(/^@/,'').split(/\s+/).filter(Boolean); s.feeds.x = s.feeds.x.filter(x=>!h.includes(x)); save(); await ctx.reply('✅ Removed.'); }
      else if (op === 'addrss') { if (!s.feeds.rss.includes(text)) s.feeds.rss.push(text); save(); await ctx.reply(`✅ RSS added (${s.feeds.rss.length}).`); }
      else if (op === 'rmrss') { s.feeds.rss = s.feeds.rss.filter(u=>u!==text); save(); await ctx.reply('✅ Removed.'); }
    } else if (cat === 'perm') {
      if (!isOwner(ctx.from.id)) return true;
      const ids = text.split(/\s+/).map(x=>Number(x)).filter(Boolean);
      if (op === 'add') { for (const id of ids) addBotAdmin(id); await ctx.reply('✅ Added.'); }
      else if (op === 'rm') { for (const id of ids) removeBotAdmin(id); await ctx.reply('✅ Removed.'); }
      else if (op === 'approve') { for (const id of ids) { if (!s.approvedChats.includes(id)) s.approvedChats.push(id); delete s.pendingChats[id]; } save(); await ctx.reply('✅ Approved.'); }
      else if (op === 'unapprove') { s.approvedChats = s.approvedChats.filter(c=>!ids.includes(c)); save(); await ctx.reply('✅ Revoked.'); }
    }
  } catch (e) {
    await ctx.reply(`Error: ${e.message}`);
  }
  return true;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function handleMediaInput(ctx) {
  const pending = awaiting.get(ctx.from.id);
  if (!pending || (pending.action !== 'cap.media' && pending.action !== 'cap.cmedia')) return false;
  const msg = ctx.message;
  let type, fileId;
  if (msg.animation) { type = 'animation'; fileId = msg.animation.file_id; }
  else if (msg.photo) { type = 'photo'; fileId = msg.photo[msg.photo.length - 1].file_id; }
  else if (msg.video) { type = 'video'; fileId = msg.video.file_id; }
  else if (msg.document && /^(image|video)\//.test(msg.document.mime_type || '')) {
    type = msg.document.mime_type.startsWith('video') ? 'video' : 'photo';
    fileId = msg.document.file_id;
  } else {
    return false;
  }
  awaiting.delete(ctx.from.id);
  const chat = getChat(pending.chatId);
  const field = pending.action === 'cap.cmedia' ? 'challengeMedia' : 'welcomeMedia';
  chat.captcha[field] = { type, fileId };
  save();
  const label = field === 'challengeMedia' ? 'CAPTCHA banner' : 'Welcome banner';
  await ctx.reply(`✅ ${label} saved (${type}).`);
  return true;
}

module.exports = { cmdAdmin, onPanelCallback, handleTextInput, handleMediaInput, awaiting };
