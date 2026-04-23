const Parser = require('rss-parser');
const parser = new Parser({ timeout: 15000, headers: { 'User-Agent': 'tg-security-bot/1.0' } });

async function fetchRss(url) {
  const feed = await parser.parseURL(url);
  return (feed.items || []).map(i => ({
    id: i.guid || i.id || i.link,
    title: i.title || '',
    text: (i.contentSnippet || i.content || '').slice(0, 500),
    url: i.link,
    date: i.isoDate || i.pubDate || null,
    source: feed.title || url,
  }));
}

module.exports = { fetchRss };
