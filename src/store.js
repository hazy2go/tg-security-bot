const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'store.json');

const DEFAULTS = {
  botAdmins: [],
  approvedChats: [],
  pendingChats: {},
  chats: {},
  feeds: {
    x: [],
    rss: [],
    target: null,
    lastSeen: {},
  },
};

const USER_CACHE_LIMIT = 5000;

function rememberUser(chatId, user) {
  if (!user?.id || user.is_bot) return;
  const s = load();
  const chatKey = String(chatId);
  const entry = {
    id: Number(user.id),
    first_name: user.first_name || '',
    username: user.username || '',
    last_seen: Date.now(),
  };

  s.memberCache = s.memberCache || {};
  s.memberCache[chatKey] = s.memberCache[chatKey] || {};
  const prev = s.memberCache[chatKey][entry.id];
  const recentlySeen = prev && Date.now() - (prev.last_seen || 0) < 60_000;
  const usernameCached = !entry.username || s.userCache?.[chatKey]?.[entry.username.toLowerCase()];
  const unchanged = prev &&
    prev.first_name === entry.first_name &&
    prev.username === entry.username &&
    usernameCached;
  if (recentlySeen && unchanged) return;

  s.memberCache[chatKey][entry.id] = entry;

  const members = Object.entries(s.memberCache[chatKey]);
  if (members.length > USER_CACHE_LIMIT) {
    members.sort((a, b) => (a[1].last_seen || 0) - (b[1].last_seen || 0));
    s.memberCache[chatKey] = Object.fromEntries(members.slice(-USER_CACHE_LIMIT));
  }

  if (user.username) {
    s.userCache = s.userCache || {};
    s.userCache[chatKey] = s.userCache[chatKey] || {};
    s.userCache[chatKey][user.username.toLowerCase()] = entry;
    const usernames = Object.entries(s.userCache[chatKey]);
    if (usernames.length > USER_CACHE_LIMIT) {
      s.userCache[chatKey] = Object.fromEntries(usernames.slice(-USER_CACHE_LIMIT));
    }
  }
  save();
}

function lookupUser(chatId, username) {
  const s = load();
  const hit = s.userCache?.[chatId]?.[username.toLowerCase()];
  return hit || null;
}

function listCachedUsers(chatId) {
  const s = load();
  const chatKey = String(chatId);
  const byId = new Map();
  for (const user of Object.values(s.memberCache?.[chatKey] || {})) {
    if (user?.id) byId.set(Number(user.id), user);
  }
  for (const user of Object.values(s.userCache?.[chatKey] || {})) {
    if (user?.id && !byId.has(Number(user.id))) byId.set(Number(user.id), user);
  }
  return [...byId.values()].sort((a, b) => (a.last_seen || 0) - (b.last_seen || 0));
}

const CHAT_DEFAULTS = () => ({
  logTargets: { default: null, joins: null, bans: null, captcha: null, links: null, feeds: null },
  captcha: {
    enabled: true,
    type: 'button',
    timeoutSec: 120,
    welcomeText: "🎉 Welcome aboard, {name}!\n\nYou're member #{count}. Glad to have you here.\n\n• Introduce yourself if you like\n• Check the pinned messages for the rules\n• Be kind, stay on topic, and have fun",
    welcomeMedia: null,       // { type: 'animation'|'photo'|'video', fileId: string }
    welcomeTarget: null,      // 'chatId' or 'chatId:topicId'; null = same chat/topic as join
    challengeMedia: null,     // { type, fileId } — banner shown with the CAPTCHA prompt
  },
  links: {
    mode: 'whitelist',
    whitelist: ['t.me', 'telegram.me', 'telegram.org'],
    blacklist: [],
    blockInvites: true,
    blockAllLinks: false,
    adminsBypass: true,
    action: 'delete_warn',
  },
  antispam: {
    forwardBlock: false,
    floodMsgs: 8,
    floodWindowSec: 10,
    floodAction: 'mute',
    muteMinutes: 10,
  },
  antiraid: { enabled: true, joinThreshold: 8, windowSec: 30, autoLockMinutes: 15 },
  warns: { limit: 3, action: 'mute', users: {} },
  trustedAdmins: [],
});

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    cache = JSON.parse(JSON.stringify(DEFAULTS));
  }
  return cache;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, FILE);
}

function getChat(chatId) {
  const s = load();
  const key = String(chatId);
  if (!s.chats[key]) {
    s.chats[key] = CHAT_DEFAULTS();
    save();
  } else {
    const def = CHAT_DEFAULTS();
    for (const k of Object.keys(def)) {
      if (s.chats[key][k] === undefined) s.chats[key][k] = def[k];
    }
  }
  return s.chats[key];
}

function updateChat(chatId, patch) {
  const c = getChat(chatId);
  Object.assign(c, patch);
  save();
  return c;
}

module.exports = { load, save, getChat, updateChat, CHAT_DEFAULTS, rememberUser, lookupUser, listCachedUsers };
