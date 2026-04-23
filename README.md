# Telegram Security Bot

Professional, button-driven security bot for Telegram supergroups. CAPTCHA, moderation, link/domain filtering, anti-raid, anti-flood, multi-channel audit logs, and X/RSS social-feed relay. Runs on a Raspberry Pi via PM2.

## Features

- **Ownership lockdown** — the bot auto-leaves any chat not explicitly approved by the owner. Only the owner can approve new chats.
- **Two-tier roles** — `OWNER` (you) and `bot admins` (granted by you). Native Telegram chat admins can use mod commands but can't configure the bot unless promoted to bot-admin.
- **New-member CAPTCHA** — button / math / emoji challenges, configurable timeout, mutes user until solved, kicks on failure. Native join-request flow supported (DM captcha).
- **Link security** — whitelist OR blacklist mode, per-domain rules, invite-link blocker, optional "block all links", admin-bypass toggle, configurable action (delete+warn / mute / kick / ban).
- **Anti-spam** — message flood limiter, forward-from-channel block, warn ladder with auto-escalation.
- **Anti-raid** — auto-lock on join floods with configurable threshold.
- **Moderation** — `/warn /mute /ban /kick /unban /unmute /unwarn /purge /pin /report /lock /unlock`. Supports durations (`30s`, `10m`, `2h`, `1d`).
- **Multi-channel logging** — route `joins`, `bans`, `captcha`, `links`, `feeds` to separate chats or forum topics.
- **Admin Panel** — full inline-button UI via `/admin`. No typing commands needed.
- **Social feeds** — X/Twitter (free, public syndication) and generic RSS/Atom. Per-chat/topic target.
- **PM2 ready** — `ecosystem.config.js` with memory cap.

## Setup

```bash
npm install
cp .env.example .env  # (if not already filled in)
node index.js
```

With PM2:

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## First run

1. Bot starts and connects — it will DM you the moment it comes online.
2. DM `/start` → `/approve <chatId>` for each community you want it in.
3. Add the bot to that community as **admin** with at least: Delete messages, Ban users, Pin messages, Invite users.
4. In the group, send `/admin` to open the panel and tune settings with buttons.
5. Use the panel's **Logs** section to route alerts to one or more private log chats.
6. Use **Permissions** (owner-only) to add/remove bot-admins.

## Getting chat / topic / user IDs

Send `/id` in any chat (or forum topic) to print the IDs the bot will use for log targets.

## How ownership lockdown works

- `approvedChats` is a list managed only by you.
- Any time the bot is added to a chat whose ID is not in that list, it:
  1. Records it in `pendingChats`
  2. DMs you with the chat name, ID, and who added it
  3. Leaves the chat
- Approve via `/approve <chatId>` or in the `/admin → Permissions` panel, then add the bot back.

## Project layout

```
├── index.js
├── ecosystem.config.js
├── .env.example
├── package.json
└── src/
    ├── bot.js                 # grammy wiring + ownership lockdown
    ├── store.js               # atomic JSON store
    ├── roles.js               # owner / bot-admin / chat-admin checks
    ├── middleware/
    │   ├── links.js           # whitelist/blacklist filter
    │   └── antispam.js        # flood + forward + raid
    ├── modules/
    │   ├── captcha.js         # button/math/emoji challenges
    │   ├── moderation.js      # warn/mute/ban/kick/purge/pin
    │   ├── panel.js           # /admin inline panel
    │   └── logger.js          # multi-channel router
    └── feeds/
        ├── monitor.js         # polling loop
        ├── twitter.js         # X syndication
        └── rss.js             # RSS/Atom
```

## Environment

| Var | Description |
|---|---|
| `BOT_TOKEN` | From @BotFather |
| `OWNER_ID`  | Your Telegram user ID (supreme admin) |
| `FEED_CHECK_INTERVAL` | X/RSS poll interval in minutes (default 5) |
