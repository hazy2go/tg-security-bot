const SYNDICATION_URL = 'https://syndication.twitter.com/srv/timeline-profile/screen-name';

async function fetchTweets(handle) {
  const res = await fetch(`${SYNDICATION_URL}/${handle}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html',
    },
  });
  if (!res.ok) throw new Error(`X syndication ${res.status}`);
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>({.+?})<\/script>/);
  if (!match) throw new Error('Could not parse X syndication response');
  const data = JSON.parse(match[1]);
  const entries = data?.props?.pageProps?.timeline?.entries || [];
  return entries
    .filter(e => e.type === 'tweet')
    .map(e => {
      const t = e.content?.tweet;
      if (!t) return null;
      return {
        id: t.id_str,
        text: t.text || '',
        url: `https://x.com/${t.user?.screen_name || handle}/status/${t.id_str}`,
        date: t.created_at ? new Date(t.created_at).toISOString() : null,
        author: handle,
        isRetweet: (t.text || '').startsWith('RT @'),
      };
    })
    .filter(Boolean);
}

module.exports = { fetchTweets };
