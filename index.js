const mineflayer = require('mineflayer');
const express = require('express');
const app = express();

// Web server
app.get('/', (req, res) => {
  res.json({
    status: 'alive',
    bot: bot && bot.entity ? 'connected' : 'connecting',
    uptime: process.uptime(),
    server: 'og_players11.aternos.me:39617'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});

let bot;

function createBot() {
  console.log('🔄 Creating bot...');
  
  bot = mineflayer.createBot({
    host: 'og_players11.aternos.me',
    port: 39617,
    username: 'server24h',
    version: '1.21.1',
    auth: 'offline'
  });

  // قبول Resource Pack تلقائياً
  bot._client.on('resource_pack_send', (packet) => {
    console.log('📦 Resource Pack detected!');
    bot._client.write('resource_pack_receive', {
      result: 0 // 0 = successfully loaded
    });
    console.log('✅ Resource Pack accepted!');
  });

  // طريقة بديلة
  bot.on('resourcePack', (url, hash) => {
    console.log('📦 Accepting resource pack...');
    if (bot.acceptResourcePack) {
      bot.acceptResourcePack();
    }
  });

  bot.once('spawn', () => {
    console.log('✅ Bot spawned!');
    bot.chat('Hello! Bot is online 24/7');
    startAntiAFK();
  });

  bot.on('error', (err) => {
    console.log('❌ Error:', err.message);
  });

  bot.on('end', () => {
    console.log('🔌 Disconnected, reconnecting...');
    setTimeout(createBot, 5000);
  });
}

function startAntiAFK() {
  console.log('🤖 Anti-AFK started');
  setInterval(() => {
    if (bot && bot.entity) {
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 100);
    }
  }, 30000);
}

createBot();
console.log('🚀 Bot system started!');
// Self-ping لإبقاء الخدمة حية
if (process.env.RENDER) {
  const url = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  setInterval(() => {
    fetch(url)
      .then(() => console.log('Self-ping successful'))
      .catch(() => console.log('Self-ping failed'));
  }, 4 * 60 * 1000); // كل 4 دقائق
}
