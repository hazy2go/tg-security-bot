const { getChat } = require('../store');

function resolveTargets(chatId, category) {
  const chat = getChat(chatId);
  const t = chat.logTargets || {};
  const list = [];
  if (t[category]) list.push(t[category]);
  if (t.default && t.default !== t[category]) list.push(t.default);
  return list;
}

async function log(bot, chatId, category, text, extra = {}) {
  const targets = resolveTargets(chatId, category);
  for (const target of targets) {
    const [tid, topicId] = String(target).split(':');
    try {
      await bot.api.sendMessage(tid, text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        message_thread_id: topicId ? Number(topicId) : undefined,
        ...extra,
      });
    } catch (e) {
      console.error(`[logger] send to ${target} failed:`, e.description || e.message);
    }
  }
}

module.exports = { log };
