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

const CHAT_DEFAULTS = () => ({
  logTargets: { default: null, joins: null, bans: null, captcha: null, links: null, feeds: null },
  captcha: {
    enabled: true,
    type: 'button',
    timeoutSec: 120,
    welcomeText: 'Welcome to the group!',
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

module.exports = { load, save, getChat, updateChat, CHAT_DEFAULTS };
