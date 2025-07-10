const mineflayer = require('mineflayer');
const express = require('express');
const { ping } = require('minecraft-protocol');
const app = express();

// إعدادات الخادم
const SERVER_CONFIG = {
  host: 'og_players11-G2lV.aternos.me',
  port: 41642,
  username: 'server24h',
  version: '1.21.1',
  auth: 'offline'
};

// حالة النظام
let systemStatus = {
  botStatus: 'initializing',
  serverStatus: 'checking',
  lastPing: null,
  connectionAttempts: 0,
  lastError: null,
  uptime: 0
};

// Web server with detailed status
app.get('/', (req, res) => {
  res.json({
    ...systemStatus,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/status', (req, res) => {
  res.json({
    server: SERVER_CONFIG,
    status: systemStatus,
    tips: [
      'Make sure Aternos server is running',
      'Check if IP/port is correct',
      'Verify server is online at aternos.org'
    ]
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
  console.log(`📊 Check status at: http://localhost:${PORT}/status`);
});

let bot;
let reconnectTimeout;
let pingInterval;

// بدء النظام
async function startSystem() {
  console.log('🚀 Starting bot system...');
  console.log('📡 Checking server status...');
  
  // فحص حالة الخادم أولاً
  await checkServerStatus();
  
  // بدء محاولة الاتصال
  createBot();
  
  // فحص دوري للخادم
  startServerMonitoring();
}

async function checkServerStatus() {
  try {
    console.log('🔍 Pinging server...');
    systemStatus.serverStatus = 'pinging';
    
    const response = await ping({
      host: SERVER_CONFIG.host,
      port: SERVER_CONFIG.port,
      timeout: 10000
    });
    
    console.log('✅ Server is online!');
    console.log(`📋 Server info:`, {
      version: response.version?.name || 'Unknown',
      players: `${response.players?.online || 0}/${response.players?.max || 0}`,
      description: response.description?.text || 'No description'
    });
    
    systemStatus.serverStatus = 'online';
    systemStatus.lastPing = Date.now();
    
    return true;
  } catch (error) {
    console.log('❌ Server ping failed:', error.message);
    systemStatus.serverStatus = 'offline';
    systemStatus.lastError = error.message;
    
    if (error.message.includes('ENOTFOUND')) {
      console.log('🔧 DNS resolution failed - check server address');
    } else if (error.message.includes('ECONNREFUSED')) {
      console.log('🔧 Connection refused - server might be offline');
    } else if (error.message.includes('timeout')) {
      console.log('🔧 Connection timeout - server might be starting');
    }
    
    return false;
  }
}

function createBot() {
  console.log('🔄 Creating bot...');
  console.log(`📡 Connecting to: ${SERVER_CONFIG.host}:${SERVER_CONFIG.port}`);
  
  systemStatus.botStatus = 'connecting';
  systemStatus.connectionAttempts++;
  
  // إنشاء البوت مع إعدادات مفصلة
  bot = mineflayer.createBot({
    host: SERVER_CONFIG.host,
    port: SERVER_CONFIG.port,
    username: SERVER_CONFIG.username,
    version: SERVER_CONFIG.version,
    auth: SERVER_CONFIG.auth,
    
    // إعدادات الاتصال
    hideErrors: false,
    keepAlive: true,
    checkTimeoutInterval: 30000,
    
    // إعدادات إضافية لتجنب المشاكل
    clientToken: null,
    accessToken: null,
    selectedProfile: null,
    
    // تسجيل مفصل
    logErrors: true
  });

  // أحداث الاتصال
  bot.on('connect', () => {
    console.log('🔗 Connected to server!');
    systemStatus.botStatus = 'connected';
  });

  bot.on('login', () => {
    console.log('🔐 Logged in successfully!');
    systemStatus.botStatus = 'logged_in';
  });

  bot.once('spawn', () => {
    console.log('✅ Bot spawned successfully!');
    console.log(`📍 Position: ${bot.entity.position.x.toFixed(2)}, ${bot.entity.position.y.toFixed(2)}, ${bot.entity.position.z.toFixed(2)}`);
    
    systemStatus.botStatus = 'active';
    systemStatus.lastError = null;
    
    // رسالة ترحيب
    setTimeout(() => {
      bot.chat('Hello! Connection successful!');
    }, 2000);
    
    // بدء النشاط البسيط
    startBasicActivity();
  });

  // التعامل مع الأخطاء
  bot.on('error', (err) => {
    console.log('❌ Bot Error:', err.message);
    systemStatus.lastError = err.message;
    systemStatus.botStatus = 'error';
    
    // تشخيص الأخطاء الشائعة
    if (err.message.includes('ENOTFOUND')) {
      console.log('🔧 Fix: Check if server address is correct');
      console.log('🔧 Fix: Make sure server is running on Aternos');
    } else if (err.message.includes('ECONNREFUSED')) {
      console.log('🔧 Fix: Server is offline, start it on Aternos');
    } else if (err.message.includes('Invalid username')) {
      console.log('🔧 Fix: Try different username');
    } else if (err.message.includes('Failed to verify username')) {
      console.log('🔧 Fix: Check auth settings');
    }
    
    handleReconnect();
  });

  bot.on('end', (reason) => {
    console.log('🔌 Connection ended:', reason);
    systemStatus.botStatus = 'disconnected';
    handleReconnect();
  });

  bot.on('kicked', (reason) => {
    console.log('👢 Kicked from server:', reason);
    systemStatus.botStatus = 'kicked';
    systemStatus.lastError = reason;
    handleReconnect();
  });

  // Resource Pack handling
  bot._client.on('resource_pack_send', (packet) => {
    console.log('📦 Resource Pack detected, accepting...');
    bot._client.write('resource_pack_receive', {
      result: 0
    });
  });

  bot.on('resourcePack', (url, hash) => {
    console.log('📦 Accepting resource pack...');
    if (bot.acceptResourcePack) {
      bot.acceptResourcePack();
    }
  });

  // معلومات إضافية
  bot.on('login', () => {
    console.log('🎮 Game info:', {
      gameMode: bot.game?.gameMode,
      difficulty: bot.game?.difficulty,
      dimension: bot.game?.dimension
    });
  });

  // تسجيل الرسائل
  bot.on('chat', (username, message) => {
    if (username !== bot.username) {
      console.log(`💬 ${username}: ${message}`);
    }
  });

  // تسجيل انضمام/مغادرة اللاعبين
  bot.on('playerJoined', (player) => {
    console.log(`👋 ${player.username} joined the game`);
  });

  bot.on('playerLeft', (player) => {
    console.log(`👋 ${player.username} left the game`);
  });
}

function handleReconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }
  
  const delay = Math.min(5000 * systemStatus.connectionAttempts, 60000); // تأخير متزايد
  console.log(`🔄 Reconnecting in ${delay/1000} seconds...`);
  
  reconnectTimeout = setTimeout(async () => {
    // فحص الخادم قبل إعادة المحاولة
    const serverOnline = await checkServerStatus();
    
    if (serverOnline) {
      createBot();
    } else {
      console.log('⏳ Server still offline, waiting longer...');
      setTimeout(() => createBot(), 30000); // انتظار 30 ثانية إضافية
    }
  }, delay);
}

function startBasicActivity() {
  console.log('🤖 Starting basic activity...');
  
  // نشاط بسيط لتجنب AFK
  setInterval(() => {
    if (bot && bot.entity) {
      // حركة بسيطة
      const actions = [
        () => bot.look(bot.entity.yaw + (Math.random() - 0.5) * 0.5, bot.entity.pitch),
        () => {
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 100);
        },
        () => {
          bot.setControlState('forward', true);
          setTimeout(() => bot.setControlState('forward', false), 200);
        }
      ];
      
      const action = actions[Math.floor(Math.random() * actions.length)];
      action();
    }
  }, 30000 + Math.random() * 30000); // كل 30-60 ثانية

  // رسائل دورية
  setInterval(() => {
    if (bot && bot.entity && Math.random() < 0.1) {
      const messages = [
        'Still here!',
        'Server running smooth',
        'Good connection',
        'All systems operational'
      ];
      
      const message = messages[Math.floor(Math.random() * messages.length)];
      bot.chat(message);
    }
  }, 5 * 60 * 1000); // كل 5 دقائق
}

function startServerMonitoring() {
  // فحص حالة الخادم كل دقيقة
  pingInterval = setInterval(async () => {
    if (systemStatus.botStatus !== 'active') {
      await checkServerStatus();
    }
  }, 60000);
}

// إيقاف نظيف
process.on('SIGINT', () => {
  console.log('🛑 Shutting down...');
  
  if (bot) {
    bot.chat('Goodbye! Shutting down...');
    bot.quit();
  }
  
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (pingInterval) clearInterval(pingInterval);
  
  process.exit(0);
});

// معلومات التشغيل
console.log('🔧 Bot Configuration:');
console.log('📡 Server:', `${SERVER_CONFIG.host}:${SERVER_CONFIG.port}`);
console.log('👤 Username:', SERVER_CONFIG.username);
console.log('🎮 Version:', SERVER_CONFIG.version);
console.log('🔐 Auth:', SERVER_CONFIG.auth);
console.log('');
console.log('💡 Troubleshooting Tips:');
console.log('1. Make sure Aternos server is running');
console.log('2. Check server address and port');
console.log('3. Verify server accepts your Minecraft version');
console.log('4. Try different username if needed');
console.log('');

// بدء النظام
startSystem();

// Self-ping للخدمات السحابية
if (process.env.RENDER || process.env.RAILWAY_ENVIRONMENT) {
  const serviceUrl = process.env.RENDER_EXTERNAL_URL || 
                    `https://${process.env.RAILWAY_STATIC_URL}` ||
                    `http://localhost:${PORT}`;
  
  console.log('☁️ Cloud service detected, enabling self-ping...');
  
  setInterval(() => {
    fetch(serviceUrl)
      .then(() => console.log('📡 Self-ping successful'))
      .catch(err => console.log('📡 Self-ping failed:', err.message));
  }, 5 * 60 * 1000);
}
