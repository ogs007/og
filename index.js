const mineflayer = require('mineflayer');
const express = require('express');
const app = express();

// إعدادات مينيمال جداً للاستقرار
const MINIMAL_CONFIG = {
  // أوقات طويلة جداً لتجنب أي مشاكل
  firstActivityDelay: 60000,       // دقيقة كاملة قبل أي نشاط
  microMovementInterval: 30000,    // كل 30 ثانية
  majorActivityInterval: 120000,   // كل دقيقتين
  chatInterval: 600000,            // كل 10 دقائق (قليل جداً)
  
  // تأخيرات طويلة
  startupDelay: 15000,             // 15 ثانية قبل أي شيء
  commandDelay: 3000,              // 3 ثواني بين الأوامر
  reconnectDelay: 30000,           // 30 ثانية قبل إعادة الاتصال
  
  // حدود صارمة
  maxActivitiesPerHour: 30,        // 30 نشاط فقط في الساعة
  walkDistance: 1,                 // بلوك واحد فقط
  
  // رسائل نادرة جداً
  maxChatPerHour: 3,               // 3 رسائل فقط في الساعة
  silentMode: true                 // وضع صامت
};

let systemStatus = {
  botStatus: 'initializing',
  lastActivity: 'none',
  activitiesCount: 0,
  messagesCount: 0,
  connectionStart: null,
  silentPeriod: true,
  deaths: 0,
  health: 20,
  food: 20
};

// Web server - معلومات أقل
app.get('/', (req, res) => {
  res.json({
    status: systemStatus.botStatus,
    uptime: Math.floor(process.uptime()),
    activities: systemStatus.activitiesCount,
    silent: systemStatus.silentPeriod,
    deaths: systemStatus.deaths,
    health: systemStatus.health,
    food: systemStatus.food
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Minimal Bot Server running on port ${PORT}`);
});

let bot;
let spawnPosition = null;
let activityIntervals = [];
let reconnectAttempts = 0;

function createBot() {
  console.log('🔄 Creating minimal bot...');
  reconnectAttempts++;
  
  // تنظيف كامل
  cleanup();
  
  // اسم أكثر طبيعية
  const username = `user${Math.floor(Math.random() * 10000)}`;
  
  bot = mineflayer.createBot({
    host: 'og_players11-G2lV.aternos.me',
    port: 41642,
    username: username,
    version: '1.21.1',
    auth: 'offline',
    
    // إعدادات محافظة جداً
    hideErrors: true,
    keepAlive: true,
    checkTimeoutInterval: 45000,     // 45 ثانية
    closeTimeout: 50000,             // 50 ثانية
    
    // تقليل الحزم
    validateChannelProtocol: false,
    skipValidation: true
  });

  setupMinimalEvents();
}

function setupMinimalEvents() {
  // عدم طباعة معلومات كثيرة
  bot.on('login', () => {
    console.log('🔐 Logged in');
    systemStatus.botStatus = 'logged_in';
    systemStatus.connectionStart = Date.now();
  });

  bot.once('spawn', () => {
    console.log('✅ Spawned');
    spawnPosition = bot.entity.position.clone();
    systemStatus.botStatus = 'spawned';
    systemStatus.silentPeriod = true;
    
    // فترة صمت طويلة - لا نشاط أو رسائل
    console.log('😶 Starting silent period...');
    
    setTimeout(() => {
      console.log('🔇 Silent period over, starting minimal activity...');
      systemStatus.silentPeriod = false;
      systemStatus.botStatus = 'active';
      startMinimalSystems();
    }, MINIMAL_CONFIG.firstActivityDelay);
  });

  // عدم الرد على الرسائل في البداية
  bot.on('chat', (username, message) => {
    if (username !== bot.username && !systemStatus.silentPeriod) {
      // تسجيل بدون رد
      console.log(`💬 ${username}: ${message}`);
    }
  });

  // إدارة هادئة للأخطاء
  bot.on('error', (err) => {
    console.log('❌ Error:', err.message);
    systemStatus.botStatus = 'error';
    handleQuietReconnection();
  });

  bot.on('end', () => {
    console.log('🔌 Disconnected');
    systemStatus.botStatus = 'disconnected';
    handleQuietReconnection();
  });

  bot.on('kicked', (reason) => {
    console.log('👢 Kicked:', reason);
    systemStatus.botStatus = 'kicked';
    handleQuietReconnection();
  });

  // Resource pack - تعامل صامت
  bot._client.on('resource_pack_send', () => {
    setTimeout(() => {
      try {
        bot._client.write('resource_pack_receive', { result: 0 });
      } catch (e) {
        // تجاهل صامت
      }
    }, 2000); // تأخير أطول
  });

  bot.on('resourcePack', (url, hash) => {
    setTimeout(() => {
      if (bot.acceptResourcePack) {
        bot.acceptResourcePack();
      }
    }, 1000);
  });

  // التعامل مع الموت والعودة
  bot.on('death', () => {
    systemStatus.deaths++;
    console.log(`💀 Bot died! (Death #${systemStatus.deaths}) Attempting respawn...`);
    systemStatus.botStatus = 'dead';
    
    // محاولة العودة فوراً
    setTimeout(() => {
      try {
        bot.respawn();
        console.log('🔄 Respawn attempted');
      } catch (e) {
        console.log('❌ Respawn failed:', e.message);
      }
    }, 2000);
  });

  bot.on('respawn', () => {
    console.log('✅ Bot respawned! Getting back to spawn...');
    systemStatus.botStatus = 'respawning';
    
    // إرسال رسالة بعد العودة (إذا لم نكن في فترة الصمت)
    if (!systemStatus.silentPeriod) {
      setTimeout(() => {
        if (bot && bot.entity) {
          const backMessages = ['back!', 'returned', 'respawned', 'back online'];
          const message = backMessages[Math.floor(Math.random() * backMessages.length)];
          try {
            bot.chat(message);
            console.log(`💬 Back message: ${message}`);
          } catch (e) {
            // تجاهل صامت
          }
        }
      }, 3000);
    }
    
    // العودة لنقطة الانطلاق بعد العودة
    setTimeout(() => {
      if (spawnPosition && bot.entity) {
        returnToSpawn();
      }
      systemStatus.botStatus = 'active';
    }, 5000);
  });

  // مراقبة الصحة والطعام
  bot.on('health', () => {
    if (bot.health !== undefined) {
      systemStatus.health = bot.health;
      systemStatus.food = bot.food;
      
      if (bot.health <= 5) {
        console.log(`⚠️ LOW HEALTH: ${bot.health}/20`);
      }
      
      if (bot.food <= 5) {
        console.log(`🍖 LOW FOOD: ${bot.food}/20`);
      }
      
      if (bot.health <= 0) {
        console.log('💀 Health reached 0, death imminent...');
        systemStatus.botStatus = 'dying';
      }
    }
  });
}

function startMinimalSystems() {
  console.log('🤖 Starting minimal systems...');
  
  // نظام keep-alive بسيط
  const keepAliveInterval = setInterval(() => {
    if (bot && bot._client && bot._client.state === 'play') {
      // مجرد فحص بدون إرسال حزم إضافية
      systemStatus.lastActivity = 'keep_alive_check';
    }
  }, 30000);
  
  // حركات نادرة جداً
  const microInterval = setInterval(() => {
    if (bot && bot.entity && systemStatus.botStatus === 'active') {
      performTinyMovement();
    }
  }, MINIMAL_CONFIG.microMovementInterval);
  
  // نشاط بسيط نادر
  const majorInterval = setInterval(() => {
    if (bot && bot.entity && systemStatus.botStatus === 'active') {
      performSimpleActivity();
    }
  }, MINIMAL_CONFIG.majorActivityInterval);
  
  // رسائل نادرة جداً
  const chatInterval = setInterval(() => {
    if (bot && bot.entity && systemStatus.botStatus === 'active' && 
        systemStatus.messagesCount < MINIMAL_CONFIG.maxChatPerHour && 
        Math.random() < 0.1) { // 10% احتمالية فقط
      sendRareMessage();
    }
  }, MINIMAL_CONFIG.chatInterval);
  
  activityIntervals = [keepAliveInterval, microInterval, majorInterval, chatInterval];
  
  console.log('✅ Minimal systems active');
}

function performTinyMovement() {
  if (!bot || !bot.entity) return;
  
  try {
    // أصغر حركة ممكنة
    const tinyActions = [
      () => {
        // نظرة صغيرة جداً
        const yaw = bot.entity.yaw + (Math.random() - 0.5) * 0.1;
        bot.look(yaw, bot.entity.pitch);
      },
      () => {
        // لا شيء - مجرد فحص
        // أحياناً لا نفعل شيء
      }
    ];
    
    // 50% احتمالية عدم فعل شيء
    if (Math.random() < 0.5) {
      const action = tinyActions[0]; // نظرة فقط
      action();
      systemStatus.lastActivity = 'tiny_look';
      systemStatus.activitiesCount++;
    } else {
      systemStatus.lastActivity = 'no_action';
    }
    
  } catch (e) {
    // تجاهل الأخطاء صامت
  }
}

function performSimpleActivity() {
  if (!bot || !bot.entity) return;
  
  console.log('🎯 Simple activity');
  
  try {
    const simpleActions = [
      () => {
        // نظرات قليلة
        setTimeout(() => {
          if (bot && bot.entity) {
            bot.look(bot.entity.yaw + 0.5, bot.entity.pitch);
          }
        }, 1000);
        setTimeout(() => {
          if (bot && bot.entity) {
            bot.look(bot.entity.yaw - 0.5, bot.entity.pitch);
          }
        }, 2000);
      },
      () => {
        // قفزة واحدة فقط
        bot.setControlState('jump', true);
        setTimeout(() => {
          if (bot && bot.entity) {
            bot.setControlState('jump', false);
          }
        }, 100);
      },
      () => {
        // حركة صغيرة جداً
        bot.setControlState('forward', true);
        setTimeout(() => {
          if (bot && bot.entity) {
            bot.setControlState('forward', false);
          }
        }, 300);
      }
    ];
    
    const action = simpleActions[Math.floor(Math.random() * simpleActions.length)];
    action();
    
    systemStatus.lastActivity = 'simple_activity';
    systemStatus.activitiesCount++;
    
  } catch (e) {
    // تجاهل صامت
  }
}

function sendRareMessage() {
  // رسائل نادرة وطبيعية
  const rareMessages = [
    'hi',
    'how is everyone?',
    'nice server',
    'good day'
  ];
  
  try {
    const message = rareMessages[Math.floor(Math.random() * rareMessages.length)];
    bot.chat(message);
    systemStatus.messagesCount++;
    console.log(`💬 Rare message: ${message}`);
  } catch (e) {
    // تجاهل صامت
  }
}

function returnToSpawn() {
  if (!spawnPosition || !bot.entity) return;
  
  console.log('🏠 Returning to spawn point...');
  
  // حساب المسافة لنقطة الانطلاق
  const dx = spawnPosition.x - bot.entity.position.x;
  const dz = spawnPosition.z - bot.entity.position.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  
  console.log(`📏 Distance to spawn: ${distance.toFixed(1)} blocks`);
  
  if (distance < 2) {
    console.log('✅ Already at spawn');
    return;
  }
  
  // العودة تدريجياً
  const returnInterval = setInterval(() => {
    if (!bot || !bot.entity) {
      clearInterval(returnInterval);
      return;
    }
    
    const currentDx = spawnPosition.x - bot.entity.position.x;
    const currentDz = spawnPosition.z - bot.entity.position.z;
    const currentDistance = Math.sqrt(currentDx * currentDx + currentDz * currentDz);
    
    if (currentDistance < 1) {
      clearInterval(returnInterval);
      stopAllMovement();
      console.log('🏠 Reached spawn successfully!');
      return;
    }
    
    // التوجه نحو نقطة الانطلاق
    const targetYaw = Math.atan2(-currentDx, currentDz);
    bot.look(targetYaw, 0);
    
    // المشي نحو الهدف
    bot.setControlState('forward', true);
    
  }, 500);
  
  // إيقاف المحاولة بعد 30 ثانية
  setTimeout(() => {
    clearInterval(returnInterval);
    stopAllMovement();
    console.log('⏰ Return timeout, stopping movement');
  }, 30000);
}

function handleQuietReconnection() {
  cleanup();
  
  // تأخير أطول مع كل محاولة
  const delay = MINIMAL_CONFIG.reconnectDelay + (reconnectAttempts * 10000);
  console.log(`🔄 Quiet reconnection in ${delay/1000}s (attempt ${reconnectAttempts})`);
  
  setTimeout(() => {
    createBot();
  }, delay);
}

function cleanup() {
  activityIntervals.forEach(interval => {
    if (interval) clearInterval(interval);
  });
  activityIntervals = [];
  
  if (bot) {
    try {
      // إيقاف كل الحركات صامت
      ['forward', 'back', 'left', 'right', 'jump', 'sneak'].forEach(control => {
        bot.setControlState(control, false);
      });
    } catch (e) {
      // تجاهل صامت
    }
  }
}

// بدء هادئ
createBot();
console.log('🚀 MINIMAL Silent Bot Started');
console.log('😶 Will be silent for first 60 seconds');
console.log('🤫 Minimal activity to avoid timeouts');
console.log('💀 Auto-respawn and return to spawn enabled');

// Self-ping محدود جداً
if (process.env.RENDER) {
  const url = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  setInterval(() => {
    fetch(url)
      .then(() => console.log('Self-ping'))
      .catch(() => console.log('Self-ping failed'));
  }, 10 * 60 * 1000); // كل 10 دقائق فقط
}
