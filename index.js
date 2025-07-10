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
  food: 20,
  botId: null,
  isConnecting: false
};

// **نظام الحماية من البوتات المتعددة**
let bot = null;
let isCreatingBot = false;
let reconnectTimeout = null;
let spawnPosition = null;
let activityIntervals = [];
let reconnectAttempts = 0;

// قفل لمنع إنشاء بوتات متعددة
const BOT_LOCK = {
  locked: false,
  lockId: null,
  
  acquire() {
    if (this.locked) {
      console.log('🔒 Bot creation blocked - another bot is active');
      return false;
    }
    this.locked = true;
    this.lockId = Date.now();
    console.log(`🔓 Bot lock acquired: ${this.lockId}`);
    return true;
  },
  
  release() {
    if (this.locked) {
      console.log(`🔓 Bot lock released: ${this.lockId}`);
      this.locked = false;
      this.lockId = null;
    }
  },
  
  isLocked() {
    return this.locked;
  }
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
    food: systemStatus.food,
    botId: systemStatus.botId,
    locked: BOT_LOCK.isLocked(),
    isConnecting: systemStatus.isConnecting
  });
});

app.get('/force-restart', (req, res) => {
  console.log('🔄 Force restart requested');
  forceRestart();
  res.json({ message: 'Force restart initiated' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Single Bot Server running on port ${PORT}`);
});

function createBot() {
  // فحص القفل أولاً
  if (BOT_LOCK.isLocked()) {
    console.log('⚠️ Cannot create bot - lock is active');
    return;
  }
  
  // فحص إذا كان هناك بوت موجود
  if (bot && bot._client) {
    console.log('⚠️ Cannot create bot - existing bot found');
    return;
  }
  
  if (isCreatingBot) {
    console.log('⚠️ Cannot create bot - creation in progress');
    return;
  }
  
  // الحصول على القفل
  if (!BOT_LOCK.acquire()) {
    return;
  }
  
  isCreatingBot = true;
  systemStatus.isConnecting = true;
  reconnectAttempts++;
  
  console.log(`🔄 Creating bot #${reconnectAttempts}...`);
  
  // تنظيف كامل قبل الإنشاء
  completeCleanup();
  
  // إنشاء معرف فريد للبوت
  const botId = `bot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  systemStatus.botId = botId;
  
  // اسم أكثر طبيعية
  const username = `user${Math.floor(Math.random() * 10000)}`;
  
  try {
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
    
  } catch (error) {
    console.log('❌ Failed to create bot:', error.message);
    isCreatingBot = false;
    systemStatus.isConnecting = false;
    BOT_LOCK.release();
    handleQuietReconnection();
  }
}

function setupMinimalEvents() {
  if (!bot) return;
  
  // عدم طباعة معلومات كثيرة
  bot.on('login', () => {
    console.log(`🔐 Bot ${systemStatus.botId} logged in`);
    systemStatus.botStatus = 'logged_in';
    systemStatus.connectionStart = Date.now();
    isCreatingBot = false;
    systemStatus.isConnecting = false;
  });

  bot.once('spawn', () => {
    console.log(`✅ Bot ${systemStatus.botId} spawned`);
    spawnPosition = bot.entity.position.clone();
    systemStatus.botStatus = 'spawned';
    systemStatus.silentPeriod = true;
    
    // فترة صمت طويلة - لا نشاط أو رسائل
    console.log('😶 Starting silent period...');
    
    setTimeout(() => {
      if (bot && bot.entity && systemStatus.botId === bot._botId) {
        console.log('🔇 Silent period over, starting minimal activity...');
        systemStatus.silentPeriod = false;
        systemStatus.botStatus = 'active';
        startMinimalSystems();
      }
    }, MINIMAL_CONFIG.firstActivityDelay);
  });

  // إضافة معرف للبوت
  bot._botId = systemStatus.botId;

  // عدم الرد على الرسائل في البداية
  bot.on('chat', (username, message) => {
    if (username !== bot.username && !systemStatus.silentPeriod) {
      // تسجيل بدون رد
      console.log(`💬 ${username}: ${message}`);
    }
  });

  // التعامل مع الموت والعودة
  bot.on('death', () => {
    systemStatus.deaths++;
    console.log(`💀 Bot ${systemStatus.botId} died! (Death #${systemStatus.deaths}) Attempting respawn...`);
    systemStatus.botStatus = 'dead';
    
    // محاولة العودة فوراً
    setTimeout(() => {
      if (bot && bot._botId === systemStatus.botId) {
        try {
          bot.respawn();
          console.log('🔄 Respawn attempted');
        } catch (e) {
          console.log('❌ Respawn failed:', e.message);
        }
      }
    }, 2000);
  });

  bot.on('respawn', () => {
    console.log(`✅ Bot ${systemStatus.botId} respawned! Getting back to spawn...`);
    systemStatus.botStatus = 'respawning';
    
    // إرسال رسالة بعد العودة (إذا لم نكن في فترة الصمت)
    if (!systemStatus.silentPeriod) {
      setTimeout(() => {
        if (bot && bot.entity && bot._botId === systemStatus.botId) {
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
      if (bot && bot.entity && bot._botId === systemStatus.botId) {
        if (spawnPosition) {
          returnToSpawn();
        }
        systemStatus.botStatus = 'active';
      }
    }, 5000);
  });

  // مراقبة الصحة والطعام
  bot.on('health', () => {
    if (bot && bot.health !== undefined) {
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

  // إدارة هادئة للأخطاء
  bot.on('error', (err) => {
    console.log(`❌ Bot ${systemStatus.botId} Error:`, err.message);
    systemStatus.botStatus = 'error';
    handleQuietReconnection();
  });

  bot.on('end', () => {
    console.log(`🔌 Bot ${systemStatus.botId} disconnected`);
    systemStatus.botStatus = 'disconnected';
    handleQuietReconnection();
  });

  bot.on('kicked', (reason) => {
    console.log(`👢 Bot ${systemStatus.botId} kicked:`, reason);
    systemStatus.botStatus = 'kicked';
    handleQuietReconnection();
  });

  // Resource pack - تعامل صامت
  bot._client.on('resource_pack_send', () => {
    setTimeout(() => {
      if (bot && bot._botId === systemStatus.botId) {
        try {
          bot._client.write('resource_pack_receive', { result: 0 });
        } catch (e) {
          // تجاهل صامت
        }
      }
    }, 2000); // تأخير أطول
  });

  bot.on('resourcePack', (url, hash) => {
    setTimeout(() => {
      if (bot && bot.acceptResourcePack && bot._botId === systemStatus.botId) {
        bot.acceptResourcePack();
      }
    }, 1000);
  });
}

function startMinimalSystems() {
  if (!bot || bot._botId !== systemStatus.botId) {
    console.log('⚠️ Cannot start systems - bot mismatch');
    return;
  }
  
  console.log(`🤖 Starting minimal systems for bot ${systemStatus.botId}...`);
  
  // نظام keep-alive بسيط
  const keepAliveInterval = setInterval(() => {
    if (bot && bot._client && bot._client.state === 'play' && bot._botId === systemStatus.botId) {
      // مجرد فحص بدون إرسال حزم إضافية
      systemStatus.lastActivity = 'keep_alive_check';
    } else {
      clearInterval(keepAliveInterval);
    }
  }, 30000);
  
  // حركات نادرة جداً
  const microInterval = setInterval(() => {
    if (bot && bot.entity && systemStatus.botStatus === 'active' && bot._botId === systemStatus.botId) {
      performTinyMovement();
    } else {
      clearInterval(microInterval);
    }
  }, MINIMAL_CONFIG.microMovementInterval);
  
  // نشاط بسيط نادر
  const majorInterval = setInterval(() => {
    if (bot && bot.entity && systemStatus.botStatus === 'active' && bot._botId === systemStatus.botId) {
      performSimpleActivity();
    } else {
      clearInterval(majorInterval);
    }
  }, MINIMAL_CONFIG.majorActivityInterval);
  
  // رسائل نادرة جداً
  const chatInterval = setInterval(() => {
    if (bot && bot.entity && systemStatus.botStatus === 'active' && 
        systemStatus.messagesCount < MINIMAL_CONFIG.maxChatPerHour && 
        Math.random() < 0.1 && bot._botId === systemStatus.botId) { // 10% احتمالية فقط
      sendRareMessage();
    } else if (!bot || bot._botId !== systemStatus.botId) {
      clearInterval(chatInterval);
    }
  }, MINIMAL_CONFIG.chatInterval);
  
  activityIntervals = [keepAliveInterval, microInterval, majorInterval, chatInterval];
  
  console.log(`✅ Minimal systems active for bot ${systemStatus.botId}`);
}

function performTinyMovement() {
  if (!bot || !bot.entity || bot._botId !== systemStatus.botId) return;
  
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
  if (!bot || !bot.entity || bot._botId !== systemStatus.botId) return;
  
  console.log(`🎯 Simple activity for bot ${systemStatus.botId}`);
  
  try {
    const simpleActions = [
      () => {
        // نظرات قليلة
        setTimeout(() => {
          if (bot && bot.entity && bot._botId === systemStatus.botId) {
            bot.look(bot.entity.yaw + 0.5, bot.entity.pitch);
          }
        }, 1000);
        setTimeout(() => {
          if (bot && bot.entity && bot._botId === systemStatus.botId) {
            bot.look(bot.entity.yaw - 0.5, bot.entity.pitch);
          }
        }, 2000);
      },
      () => {
        // قفزة واحدة فقط
        bot.setControlState('jump', true);
        setTimeout(() => {
          if (bot && bot.entity && bot._botId === systemStatus.botId) {
            bot.setControlState('jump', false);
          }
        }, 100);
      },
      () => {
        // حركة صغيرة جداً
        bot.setControlState('forward', true);
        setTimeout(() => {
          if (bot && bot.entity && bot._botId === systemStatus.botId) {
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
  if (!bot || bot._botId !== systemStatus.botId) return;
  
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
    console.log(`💬 Rare message from bot ${systemStatus.botId}: ${message}`);
  } catch (e) {
    // تجاهل صامت
  }
}

function returnToSpawn() {
  if (!spawnPosition || !bot || !bot.entity || bot._botId !== systemStatus.botId) return;
  
  console.log(`🏠 Bot ${systemStatus.botId} returning to spawn point...`);
  
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
    if (!bot || !bot.entity || bot._botId !== systemStatus.botId) {
      clearInterval(returnInterval);
      return;
    }
    
    const currentDx = spawnPosition.x - bot.entity.position.x;
    const currentDz = spawnPosition.z - bot.entity.position.z;
    const currentDistance = Math.sqrt(currentDx * currentDx + currentDz * currentDz);
    
    if (currentDistance < 1) {
      clearInterval(returnInterval);
      stopAllMovement();
      console.log(`🏠 Bot ${systemStatus.botId} reached spawn successfully!`);
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
    console.log(`⏰ Bot ${systemStatus.botId} return timeout, stopping movement`);
  }, 30000);
}

function handleQuietReconnection() {
  completeCleanup();
  
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }
  
  // تأخير أطول مع كل محاولة
  const delay = MINIMAL_CONFIG.reconnectDelay + (reconnectAttempts * 10000);
  console.log(`🔄 Quiet reconnection in ${delay/1000}s (attempt ${reconnectAttempts})`);
  
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    createBot();
  }, delay);
}

function completeCleanup() {
  console.log('🧹 Complete cleanup...');
  
  // إيقاف كل الـ intervals
  activityIntervals.forEach(interval => {
    if (interval) clearInterval(interval);
  });
  activityIntervals = [];
  
  // تنظيف البوت
  if (bot) {
    try {
      // إيقاف كل الحركات صامت
      ['forward', 'back', 'left', 'right', 'jump', 'sneak'].forEach(control => {
        bot.setControlState(control, false);
      });
      
      // إغلاق الاتصال إذا كان موجود
      if (bot._client) {
        bot._client.end();
      }
      
      bot.quit();
    } catch (e) {
      // تجاهل صامت
    }
    
    bot = null;
  }
  
  // تحرير القفل
  BOT_LOCK.release();
  
  // إعادة تعيين الحالة
  isCreatingBot = false;
  systemStatus.isConnecting = false;
  systemStatus.botId = null;
}

function forceRestart() {
  console.log('🔄 Forcing complete restart...');
  
  // إيقاف كل شيء
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  completeCleanup();
  
  // إعادة تعيين العدادات
  reconnectAttempts = 0;
  systemStatus.deaths = 0;
  systemStatus.activitiesCount = 0;
  systemStatus.messagesCount = 0;
  
  // بدء جديد
  setTimeout(() => {
    createBot();
  }, 5000);
}

function stopAllMovement() {
  if (bot && bot._botId === systemStatus.botId) {
    try {
      ['forward', 'back', 'left', 'right', 'jump', 'sneak'].forEach(control => {
        bot.setControlState(control, false);
      });
    } catch (e) {
      // تجاهل صامت
    }
  }
}

// التعامل مع إغلاق البرنامج
process.on('SIGINT', () => {
  console.log('🛑 Shutting down...');
  completeCleanup();
  process.exit(0);
});

// بدء هادئ
createBot();
console.log('🚀 SINGLE Bot System Started');
console.log('😶 Will be silent for first 60 seconds');
console.log('🤫 Minimal activity to avoid timeouts');
console.log('💀 Auto-respawn and return to spawn enabled');
console.log('🔒 Multi-bot protection active');

// Self-ping محدود جداً
if (process.env.RENDER) {
  const url = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  setInterval(() => {
    fetch(url)
      .then(() => console.log('Self-ping'))
      .catch(() => console.log('Self-ping failed'));
  }, 10 * 60 * 1000); // كل 10 دقائق فقط
}
