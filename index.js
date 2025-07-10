const mineflayer = require('mineflayer');
const express = require('express');
const app = express();

// إعدادات مُحسنة للاستقرار والـ Anti-AFK
const STABLE_CONFIG = {
  // أوقات أطول لتجنب Timeout
  microMovementInterval: 10000,    // كل 10 ثواني بدلاً من 3
  majorActivityInterval: 30000,    // كل 30 ثانية بدلاً من 15
  interactionInterval: 90000,      // كل دقيقة ونصف
  chatInterval: 300000,            // كل 5 دقائق
  
  // تأخيرات للاستقرار
  startupDelay: 5000,              // 5 ثواني قبل بدء النشاط
  commandDelay: 1000,              // ثانية بين الأوامر
  reconnectDelay: 15000,           // 15 ثانية قبل إعادة الاتصال
  
  // إعدادات الاتصال المحسنة
  keepAliveInterval: 20000,        // keep-alive كل 20 ثانية
  timeoutThreshold: 25000,         // timeout بعد 25 ثانية
  
  // حدود النشاط
  maxActivitiesPerMinute: 6,       // حد أقصى 6 أنشطة في الدقيقة
  walkDistance: 3,                 // مسافة مشي أقل
  
  // رسائل أقل تكراراً
  maxChatPerHour: 8
};

let systemStatus = {
  botStatus: 'initializing',
  lastActivity: null,
  activitiesCount: 0,
  connectionQuality: 'unknown',
  ping: 0,
  timeOnline: 0,
  reconnectAttempts: 0
};

// Web server
app.get('/', (req, res) => {
  res.json({
    ...systemStatus,
    uptime: Math.floor(process.uptime()),
    config: STABLE_CONFIG
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Stable Bot Server running on port ${PORT}`);
});

let bot;
let spawnPosition = null;
let currentActivity = 'idle';
let activityIntervals = [];
let connectionStartTime = null;
let lastKeepAlive = Date.now();

function createBot() {
  console.log('🔄 Creating stable bot...');
  systemStatus.reconnectAttempts++;
  
  // تنظيف قبل إنشاء بوت جديد
  cleanup();
  
  bot = mineflayer.createBot({
    host: 'og_players11-G2lV.aternos.me',
    port: 41642,
    username: 'stable_player' + Math.floor(Math.random() * 10000),
    version: '1.21.1',
    auth: 'offline',
    
    // إعدادات محسنة للاستقرار
    hideErrors: false,
    keepAlive: true,
    checkTimeoutInterval: STABLE_CONFIG.timeoutThreshold,
    closeTimeout: STABLE_CONFIG.timeoutThreshold,
    
    // تقليل الـ packet flooding
    validateChannelProtocol: false,
    
    // إعدادات TCP محسنة
    connect: (client) => {
      client.socket.setKeepAlive(true, 1000);
      client.socket.setNoDelay(true);
      client.socket.timeout = STABLE_CONFIG.timeoutThreshold;
    }
  });

  setupBotEvents();
}

function setupBotEvents() {
  // مراقبة جودة الاتصال
  bot.on('login', () => {
    console.log('🔐 Logged in successfully!');
    connectionStartTime = Date.now();
    systemStatus.botStatus = 'logged_in';
    systemStatus.connectionQuality = 'good';
  });

  bot.once('spawn', () => {
    console.log('✅ Bot spawned! Starting optimized systems...');
    spawnPosition = bot.entity.position.clone();
    systemStatus.botStatus = 'active';
    
    // تأخير قبل بدء النشاط لضمان الاستقرار
    setTimeout(() => {
      bot.chat('Stable connection established!');
      startOptimizedSystems();
    }, STABLE_CONFIG.startupDelay);
  });

  // مراقبة الـ ping
  bot._client.on('keep_alive', (packet) => {
    const now = Date.now();
    systemStatus.ping = now - lastKeepAlive;
    lastKeepAlive = now;
    
    // تقييم جودة الاتصال
    if (systemStatus.ping < 100) {
      systemStatus.connectionQuality = 'excellent';
    } else if (systemStatus.ping < 200) {
      systemStatus.connectionQuality = 'good';
    } else if (systemStatus.ping < 500) {
      systemStatus.connectionQuality = 'fair';
    } else {
      systemStatus.connectionQuality = 'poor';
      console.log(`⚠️ High ping detected: ${systemStatus.ping}ms`);
    }
  });

  // مراقبة الرسائل
  bot.on('chat', (username, message) => {
    if (username !== bot.username) {
      console.log(`💬 ${username}: ${message}`);
      
      // كشف تحذيرات AFK مع رد مناسب
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('idle') || lowerMessage.includes('afk')) {
        console.log('⚠️ AFK warning detected! Performing safe activity...');
        setTimeout(() => performSafeActivity(), 2000);
      }
    }
  });

  // إدارة أفضل للأخطاء
  bot.on('error', (err) => {
    console.log('❌ Bot Error:', err.message);
    systemStatus.botStatus = 'error';
    
    // تشخيص نوع الخطأ
    if (err.message.includes('ECONNRESET')) {
      console.log('🔧 Connection reset - network issue');
      systemStatus.connectionQuality = 'lost';
    } else if (err.message.includes('timeout')) {
      console.log('🔧 Connection timeout - reducing activity');
      systemStatus.connectionQuality = 'timeout';
    }
    
    handleReconnection();
  });

  bot.on('end', () => {
    console.log('🔌 Connection ended. Attempting reconnection...');
    systemStatus.botStatus = 'disconnected';
    handleReconnection();
  });

  bot.on('kicked', (reason) => {
    console.log('👢 Kicked from server:', reason);
    systemStatus.botStatus = 'kicked';
    
    if (reason.includes('timeout')) {
      console.log('💡 Kicked for timeout - will reduce activity level');
    }
    
    handleReconnection();
  });

  // Resource pack - تعامل آمن
  bot._client.on('resource_pack_send', (packet) => {
    setTimeout(() => {
      try {
        bot._client.write('resource_pack_receive', { result: 0 });
        console.log('📦 Resource pack accepted');
      } catch (e) {
        console.log('📦 Resource pack handling failed:', e.message);
      }
    }, 1000);
  });

  bot.on('resourcePack', (url, hash) => {
    setTimeout(() => {
      if (bot.acceptResourcePack) {
        bot.acceptResourcePack();
      }
    }, 500);
  });
}

function startOptimizedSystems() {
  console.log('🤖 Starting OPTIMIZED Anti-AFK systems...');
  
  // نظام keep-alive محسن
  const keepAliveInterval = setInterval(() => {
    if (bot && bot._client && bot._client.state === 'play') {
      try {
        lastKeepAlive = Date.now();
        // إرسال keep-alive packet
        bot._client.write('keep_alive', {
          keepAliveId: Date.now()
        });
      } catch (e) {
        console.log('⚠️ Keep-alive failed:', e.message);
      }
    }
  }, STABLE_CONFIG.keepAliveInterval);
  
  // حركات بسيطة وآمنة
  const microInterval = setInterval(() => {
    if (bot && bot.entity && systemStatus.botStatus === 'active') {
      performSafeMicroMovement();
    }
  }, STABLE_CONFIG.microMovementInterval);
  
  // نشاط رئيسي آمن
  const majorInterval = setInterval(() => {
    if (bot && bot.entity && systemStatus.botStatus === 'active') {
      performSafeMajorActivity();
    }
  }, STABLE_CONFIG.majorActivityInterval);
  
  // رسائل أقل تكراراً
  const chatInterval = setInterval(() => {
    if (bot && bot.entity && systemStatus.botStatus === 'active' && Math.random() < 0.3) {
      sendSafeMessage();
    }
  }, STABLE_CONFIG.chatInterval);
  
  // مراقبة الاتصال
  const connectionMonitor = setInterval(() => {
    monitorConnection();
  }, 30000); // كل 30 ثانية
  
  activityIntervals = [keepAliveInterval, microInterval, majorInterval, chatInterval, connectionMonitor];
  
  console.log('✅ All optimized systems running!');
  console.log('📊 Activity schedule:');
  console.log(`   - Micro movement: every ${STABLE_CONFIG.microMovementInterval/1000}s`);
  console.log(`   - Major activity: every ${STABLE_CONFIG.majorActivityInterval/1000}s`);
  console.log(`   - Chat messages: every ${STABLE_CONFIG.chatInterval/1000}s`);
}

function performSafeMicroMovement() {
  if (!bot || !bot.entity) return;
  
  // حركات آمنة وبسيطة
  const safeActions = [
    () => {
      // نظرة بسيطة
      const yaw = bot.entity.yaw + (Math.random() - 0.5) * 0.3;
      bot.look(yaw, bot.entity.pitch);
    },
    () => {
      // حركة صغيرة جداً
      const direction = ['left', 'right'][Math.floor(Math.random() * 2)];
      bot.setControlState(direction, true);
      setTimeout(() => bot.setControlState(direction, false), 100);
    }
  ];
  
  const action = safeActions[Math.floor(Math.random() * safeActions.length)];
  
  try {
    action();
    systemStatus.lastActivity = 'micro_safe';
    systemStatus.activitiesCount++;
  } catch (e) {
    console.log('⚠️ Micro movement failed:', e.message);
  }
}

function performSafeMajorActivity() {
  if (!bot || !bot.entity) return;
  
  console.log('🎯 Performing safe major activity...');
  
  const safeActivities = [
    () => performSafeLooking(),
    () => performSafeWalk(),
    () => performSafeJump()
  ];
  
  const activity = safeActivities[Math.floor(Math.random() * safeActivities.length)];
  
  try {
    activity();
    systemStatus.activitiesCount++;
  } catch (e) {
    console.log('⚠️ Major activity failed:', e.message);
  }
}

function performSafeLooking() {
  // نظرات آمنة - 3 نظرات فقط
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      if (bot && bot.entity) {
        const yaw = bot.entity.yaw + (Math.random() - 0.5) * Math.PI * 0.5;
        const pitch = (Math.random() - 0.5) * Math.PI * 0.3;
        bot.look(yaw, pitch);
      }
    }, i * 1000);
  }
  
  systemStatus.lastActivity = 'safe_looking';
}

function performSafeWalk() {
  if (!spawnPosition) return;
  
  // مشي قصير وآمن
  const distance = 1 + Math.random() * 2; // مسافة قصيرة
  const angle = Math.random() * Math.PI * 2;
  
  const targetX = spawnPosition.x + Math.cos(angle) * distance;
  const targetZ = spawnPosition.z + Math.sin(angle) * distance;
  
  const targetYaw = Math.atan2(-(targetX - bot.entity.position.x), targetZ - bot.entity.position.z);
  bot.look(targetYaw, 0);
  
  // مشي لمدة قصيرة
  bot.setControlState('forward', true);
  setTimeout(() => {
    bot.setControlState('forward', false);
  }, 1000 + Math.random() * 1000);
  
  systemStatus.lastActivity = 'safe_walk';
}

function performSafeJump() {
  // قفزة واحدة أو اثنتين فقط
  const jumpCount = 1 + Math.floor(Math.random() * 2);
  
  for (let i = 0; i < jumpCount; i++) {
    setTimeout(() => {
      if (bot && bot.entity) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 100);
      }
    }, i * 800);
  }
  
  systemStatus.lastActivity = 'safe_jump';
}

function performSafeActivity() {
  // نشاط آمن عند التحذير
  console.log('🛡️ Performing safe emergency activity...');
  
  if (bot && bot.entity) {
    // نظرة + قفزة بسيطة
    bot.look(bot.entity.yaw + Math.PI * 0.25, 0);
    
    setTimeout(() => {
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 100);
    }, 500);
    
    setTimeout(() => {
      bot.chat('Status: Active and stable');
    }, 1000);
  }
}

function sendSafeMessage() {
  const safeMessages = [
    'Connection stable',
    'All systems normal',
    'Running smoothly',
    'Status: Online',
    'System operational',
    'Performance good'
  ];
  
  const message = safeMessages[Math.floor(Math.random() * safeMessages.length)];
  
  try {
    bot.chat(message);
    console.log(`💬 Sent: ${message}`);
  } catch (e) {
    console.log('💬 Chat failed:', e.message);
  }
}

function monitorConnection() {
  if (!bot || !bot.entity) return;
  
  const timeOnline = connectionStartTime ? Date.now() - connectionStartTime : 0;
  systemStatus.timeOnline = Math.floor(timeOnline / 1000);
  
  console.log(`📊 Connection Status:`);
  console.log(`   - Time online: ${Math.floor(timeOnline / 60000)} minutes`);
  console.log(`   - Ping: ${systemStatus.ping}ms`);
  console.log(`   - Quality: ${systemStatus.connectionQuality}`);
  console.log(`   - Activities performed: ${systemStatus.activitiesCount}`);
  
  // تحذير إذا كان الـ ping عالي
  if (systemStatus.ping > 1000) {
    console.log('⚠️ High latency detected - connection may be unstable');
  }
}

function handleReconnection() {
  cleanup();
  
  const delay = STABLE_CONFIG.reconnectDelay + (systemStatus.reconnectAttempts * 5000);
  console.log(`🔄 Reconnecting in ${delay/1000} seconds... (attempt ${systemStatus.reconnectAttempts})`);
  
  setTimeout(() => {
    createBot();
  }, delay);
}

function cleanup() {
  activityIntervals.forEach(interval => {
    if (interval) clearInterval(interval);
  });
  activityIntervals = [];
  currentActivity = 'idle';
  
  if (bot) {
    try {
      ['forward', 'back', 'left', 'right', 'jump', 'sneak'].forEach(control => {
        bot.setControlState(control, false);
      });
    } catch (e) {
      // تجاهل الأخطاء عند التنظيف
    }
  }
}

// بدء النظام
createBot();
console.log('🚀 STABLE Bot System Started!');
console.log('⚡ Optimized for connection stability');
console.log('🔄 Reduced activity frequency for better performance');
console.log('📊 Connection monitoring enabled');

// Self-ping محدود
if (process.env.RENDER) {
  const url = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  setInterval(() => {
    fetch(url)
      .then(() => console.log('Self-ping successful'))
      .catch(() => console.log('Self-ping failed'));
  }, 8 * 60 * 1000); // كل 8 دقائق لتقليل الحمل
}
