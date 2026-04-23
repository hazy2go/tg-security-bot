const { load, save } = require('./store');

const OWNER_ID = Number(process.env.OWNER_ID);

function isOwner(userId) {
  return Number(userId) === OWNER_ID;
}

function isBotAdmin(userId) {
  if (isOwner(userId)) return true;
  return load().botAdmins.includes(Number(userId));
}

function addBotAdmin(userId) {
  const s = load();
  const id = Number(userId);
  if (!s.botAdmins.includes(id)) {
    s.botAdmins.push(id);
    save();
  }
}

function removeBotAdmin(userId) {
  const s = load();
  s.botAdmins = s.botAdmins.filter(id => id !== Number(userId));
  save();
}

async function isChatAdmin(ctx) {
  try {
    const m = await ctx.getChatMember(ctx.from.id);
    return m.status === 'creator' || m.status === 'administrator';
  } catch {
    return false;
  }
}

module.exports = { OWNER_ID, isOwner, isBotAdmin, addBotAdmin, removeBotAdmin, isChatAdmin };
