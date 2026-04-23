const { load, save } = require('../store');
const { fetchTweets } = require('./twitter');
const { fetchRss } = require('./rss');

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function sendToTarget(bot, target, html) {
  const [cid, topicId] = String(target).split(':');
  await bot.api.sendMessage(cid, html, {
    parse_mode: 'HTML',
    message_thread_id: topicId ? Number(topicId) : undefined,
    link_preview_options: { prefer_large_media: true, show_above_text: true },
  });
}

async function tickX(bot) {
  const s = load();
  if (!s.feeds.target || !s.feeds.x.length) return;
  for (const handle of s.feeds.x) {
    try {
      const tweets = await fetchTweets(handle);
      if (!tweets.length) continue;
      const seenKey = `x:${handle}`;
      const lastId = s.feeds.lastSeen[seenKey];
      const sorted = [...tweets].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
      const newest = sorted[sorted.length - 1].id;
      if (!lastId) { s.feeds.lastSeen[seenKey] = newest; save(); continue; }
      const fresh = sorted.filter(t => BigInt(t.id) > BigInt(lastId));
      for (const t of fresh) {
        const body = t.isRetweet ? '🔁 Retweet' : '🐦 New post';
        const html = `<b>${body} from @${escapeHtml(handle)}</b>\n\n${escapeHtml(t.text).slice(0, 800)}\n\n${t.url}`;
        await sendToTarget(bot, s.feeds.target, html);
      }
      s.feeds.lastSeen[seenKey] = newest;
      save();
    } catch (e) { console.error(`[x:${handle}]`, e.message); }
  }
}

async function tickRss(bot) {
  const s = load();
  if (!s.feeds.target || !s.feeds.rss.length) return;
  for (const url of s.feeds.rss) {
    try {
      const items = await fetchRss(url);
      if (!items.length) continue;
      const seenKey = `rss:${url}`;
      const lastId = s.feeds.lastSeen[seenKey];
      if (!lastId) { s.feeds.lastSeen[seenKey] = items[0].id; save(); continue; }
      const fresh = [];
      for (const item of items) {
        if (item.id === lastId) break;
        fresh.push(item);
      }
      for (const item of fresh.reverse()) {
        const html = `<b>📰 ${escapeHtml(item.source)}</b>\n<b>${escapeHtml(item.title)}</b>\n\n${escapeHtml(item.text)}\n\n${item.url}`;
        await sendToTarget(bot, s.feeds.target, html);
      }
      s.feeds.lastSeen[seenKey] = items[0].id;
      save();
    } catch (e) { console.error(`[rss:${url}]`, e.message); }
  }
}

function startFeedMonitor(bot) {
  const intervalMin = Number(process.env.FEED_CHECK_INTERVAL || 5);
  const ms = intervalMin * 60 * 1000;
  const run = async () => {
    try { await tickX(bot); } catch (e) { console.error('[tickX]', e); }
    try { await tickRss(bot); } catch (e) { console.error('[tickRss]', e); }
  };
  setTimeout(run, 10000);
  setInterval(run, ms);
  console.log(`[feeds] polling every ${intervalMin}min`);
}

module.exports = { startFeedMonitor };
