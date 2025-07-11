const mineflayer = require('mineflayer');
const express = require('express');
const app = express();

// إعدادات محسنة لمنع الخمول
const IMPROVED_CONFIG = {
  // أوقات أقصر لمنع الخمول
  firstActivityDelay: 30000,       // 30 ثانية بدلاً من دقيقة
  microMovementInterval: 8000,     // كل 8 ثواني بدلاً من 30
  majorActivityInterval: 25000,    // كل 25 ثانية بدلاً من دقيقتين
  chatInterval: 300000,            // كل 5 دقائق بدلاً من 10
  keepAliveInterval: 5000,         // keep-alive كل 5 ثواني
  
  // تأخيرات أقل
  startupDelay: 10000,             // 10 ثواني
  commandDelay: 1500,              // 1.5 ثانية
  reconnectDelay: 20000,           // 20 ثانية
  
  // حدود أعلى للنشاط
  maxActivitiesPerHour: 100,       // 100 نشاط في الساعة
  walkDistance: 2,                 // بلوكين
  
  // رسائل أكثر قليلاً
  maxChatPerHour: 8,               // 8 رسائل في الساعة
  silentMode: false                // إيقاف الوضع الصامت
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
  isConnecting: false,
  lastKeepAlive: null,
  lastMovement: null
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

// Web server - معلومات محسنة مع تفاصيل إعادة الاتصال
app.get('/', (req, res) => {
  const now = Date.now();
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
    isConnecting: systemStatus.isConnecting,
    lastKeepAlive: systemStatus.lastKeepAlive,
    lastMovement: systemStatus.lastMovement,
    timeSinceLastActivity: systemStatus.lastMovement ? now - systemStatus.lastMovement : null,
    reconnectAttempts: reconnectAttempts,
    hasReconnectScheduled: !!reconnectTimeout,
    reconnectTimeoutInfo: reconnectTimeout ? {
      scheduled: true,
      timeLeft: 'calculating...'
    } : null,
    botExists: !!bot,
    botClientState: bot && bot._client ? bot._client.state : null,
    timestamp: new Date().toLocaleString()
  });
});

app.get('/debug', (req, res) => {
  res.json({
    systemStatus: systemStatus,
    botExists: !!bot,
    botClientState: bot && bot._client ? bot._client.state : null,
    isCreatingBot: isCreatingBot,
    reconnectTimeout: !!reconnectTimeout,
    reconnectAttempts: reconnectAttempts,
    lockInfo: {
      locked: BOT_LOCK.locked,
      lockId: BOT_LOCK.lockId,
      lockAge: BOT_LOCK.lockId ? Date.now() - BOT_LOCK.lockId : null
    },
    intervals: activityIntervals.length,
    lastReconnectTimeout: !!global.lastReconnectTimeout,
    processUptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  });
});

app.get('/force-restart', (req, res) => {
  console.log('🔄 Force restart requested via web interface');
  forceRestart();
  res.json({ 
    message: 'Force restart initiated',
    timestamp: new Date().toLocaleString()
  });
});

// إضافة نظام تسجيل الأحداث
let eventLog = [];

function logEvent(type, message, data = {}) {
  const event = {
    timestamp: new Date().toLocaleString(),
    type: type,
    message: message,
    data: data,
    botId: systemStatus.botId
  };
  
  eventLog.push(event);
  
  // الاحتفاظ بآخر 50 حدث فقط
  if (eventLog.length > 50) {
    eventLog = eventLog.slice(-50);
  }
  
  console.log(`📝 EVENT [${type}]: ${message}`);
}

// Web endpoints إضافية
app.get('/events', (req, res) => {
  res.json({
    events: eventLog.slice(-20), // آخر 20 حدث
    totalEvents: eventLog.length
  });
});

app.get('/force-reconnect', (req, res) => {
  console.log('🔄 Manual reconnection requested via web');
  logEvent('MANUAL', 'Force reconnection requested via web interface');
  
  // إلغاء أي reconnect مجدول
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  // فورس reconnect
  handleQuietReconnection();
  
  res.json({ 
    message: 'Manual reconnection initiated',
    timestamp: new Date().toLocaleString()
  });
});

// إضافة endpoint جديد لمراقبة إعادة الاتصال
app.get('/reconnect-status', (req, res) => {
  res.json({
    hasScheduledReconnect: !!reconnectTimeout,
    reconnectAttempts: reconnectAttempts,
    lastReconnectTime: systemStatus.connectionStart,
    botStatus: systemStatus.botStatus,
    canReconnect: !BOT_LOCK.isLocked() && !isCreatingBot,
    troubleshoot: {
      botExists: !!bot,
      clientState: bot && bot._client ? bot._client.state : 'no-client',
      lockStatus: BOT_LOCK.isLocked() ? 'locked' : 'free',
      creatingBot: isCreatingBot,
      intervals: activityIntervals.length
    },
    lastEvents: eventLog.slice(-5) // آخر 5 أحداث للتشخيص السريع
  });
});

app.get('/force-restart', (req, res) => {
  console.log('🔄 Force restart requested');
  forceRestart();
  res.json({ message: 'Force restart initiated' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Improved Bot Server running on port ${PORT}`);
});

function createBot() {
  // فحص القفل أولاً
  if (BOT_LOCK.isLocked()) {
    console.log('⚠️ Cannot create bot - lock is active');
    console.log(`🔒 Lock ID: ${BOT_LOCK.lockId}, Age: ${Date.now() - BOT_LOCK.lockId}ms`);
    return;
  }
  
  // فحص إذا كان هناك بوت موجود
  if (bot && bot._client) {
    console.log('⚠️ Cannot create bot - existing bot found');
    console.log(`🤖 Existing bot state: ${bot._client.state}`);
    return;
  }
  
  if (isCreatingBot) {
    console.log('⚠️ Cannot create bot - creation in progress');
    return;
  }
  
  // الحصول على القفل
  if (!BOT_LOCK.acquire()) {
    console.log('❌ Failed to acquire bot lock');
    return;
  }
  
  isCreatingBot = true;
  systemStatus.isConnecting = true;
  reconnectAttempts++;
  
  console.log(`🔄 Creating improved bot #${reconnectAttempts}...`);
  console.log(`📅 Time: ${new Date().toLocaleString()}`);
  
  // إنشاء معرف فريد للبوت
  const botId = `bot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  systemStatus.botId = botId;
  
  // اسم أكثر طبيعية
  const username = `user${Math.floor(Math.random() * 10000)}`;
  console.log(`👤 Username: ${username}`);
  
  try {
    bot = mineflayer.createBot({
      host: 'og_players11-G2lV.aternos.me',
      port: 41642,
      username: username,
      version: '1.21.1',
      auth: 'offline',
      
      // إعدادات محسنة للاستقرار
      hideErrors: false,
      keepAlive: true,
      checkTimeoutInterval: 30000,     // 30 ثانية
      closeTimeout: 40000,             // 40 ثانية
      
      // تحسين الحزم
      validateChannelProtocol: false,
      skipValidation: true
    });

    console.log(`✅ Bot object created successfully, setting up events...`);
    setupImprovedEvents();
    
  } catch (error) {
    console.log('❌ Failed to create bot:', error.message);
    console.log('📝 Full error:', error);
    isCreatingBot = false;
    systemStatus.isConnecting = false;
    BOT_LOCK.release();
    
    // محاولة فورية أخرى في حالة خطأ بسيط
    console.log('🔄 Attempting immediate retry...');
    setTimeout(() => {
      handleQuietReconnection();
    }, 5000);
  }
}

function setupImprovedEvents() {
  if (!bot) return;
  
  bot.on('login', () => {
    console.log(`🔐 Bot ${systemStatus.botId} logged in`);
    logEvent('LOGIN', `Bot ${systemStatus.botId} successfully logged in`);
    systemStatus.botStatus = 'logged_in';
    systemStatus.connectionStart = Date.now();
    isCreatingBot = false;
    systemStatus.isConnecting = false;
  });

  bot.once('spawn', () => {
    console.log(`✅ Bot ${systemStatus.botId} spawned`);
    logEvent('SPAWN', `Bot ${systemStatus.botId} spawned successfully`);
    spawnPosition = bot.entity.position.clone();
    systemStatus.botStatus = 'spawned';
    systemStatus.silentPeriod = true;
    
    // فترة صمت أقصر
    console.log('😶 Starting short silent period...');
    
    setTimeout(() => {
      if (bot && bot.entity && systemStatus.botId === bot._botId) {
        console.log('🔇 Silent period over, starting active systems...');
        logEvent('ACTIVATION', `Bot ${systemStatus.botId} becoming active`);
        systemStatus.silentPeriod = false;
        systemStatus.botStatus = 'active';
        startImprovedSystems();
      }
    }, IMPROVED_CONFIG.firstActivityDelay);
  });

  // إضافة معرف للبوت
  bot._botId = systemStatus.botId;

  bot.on('chat', (username, message) => {
    if (username !== bot.username && !systemStatus.silentPeriod) {
      console.log(`💬 ${username}: ${message}`);
      
      // رد بسيط أحياناً
      if (Math.random() < 0.1 && systemStatus.messagesCount < IMPROVED_CONFIG.maxChatPerHour) {
        setTimeout(() => {
          if (bot && bot.entity && bot._botId === systemStatus.botId) {
            const responses = ['hi', 'hey', 'hello', '👋'];
            const response = responses[Math.floor(Math.random() * responses.length)];
            try {
              bot.chat(response);
              systemStatus.messagesCount++;
              console.log(`💬 Auto-reply: ${response}`);
            } catch (e) {
              console.log('❌ Auto-reply failed:', e.message);
            }
          }
        }, 2000);
      }
    }
  });

  bot.on('death', () => {
    systemStatus.deaths++;
    console.log(`💀 Bot ${systemStatus.botId} died! (Death #${systemStatus.deaths}) Attempting respawn...`);
    systemStatus.botStatus = 'dead';
    
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
    console.log(`✅ Bot ${systemStatus.botId} respawned!`);
    systemStatus.botStatus = 'respawning';
    
    if (!systemStatus.silentPeriod) {
      setTimeout(() => {
        if (bot && bot.entity && bot._botId === systemStatus.botId) {
          const backMessages = ['back!', 'returned', 'respawned'];
          const message = backMessages[Math.floor(Math.random() * backMessages.length)];
          try {
            bot.chat(message);
            console.log(`💬 Back message: ${message}`);
          } catch (e) {
            console.log('❌ Back message failed:', e.message);
          }
        }
      }, 3000);
    }
    
    setTimeout(() => {
      if (bot && bot.entity && bot._botId === systemStatus.botId) {
        if (spawnPosition) {
          returnToSpawn();
        }
        systemStatus.botStatus = 'active';
      }
    }, 5000);
  });

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

  bot.on('error', (err) => {
    console.log(`❌ Bot ${systemStatus.botId} Error:`, err.message);
    console.log(`📝 Error type: ${err.name || 'Unknown'}`);
    console.log(`🔗 Error code: ${err.code || 'No code'}`);
    console.log(`📅 Error time: ${new Date().toLocaleString()}`);
    
    logEvent('ERROR', `Bot error: ${err.message}`, {
      errorType: err.name,
      errorCode: err.code,
      reconnectAttempt: reconnectAttempts
    });
    
    systemStatus.botStatus = 'error';
    
    // تأخير قصير قبل محاولة إعادة الاتصال
    setTimeout(() => {
      console.log('🔄 Starting reconnection after error...');
      handleQuietReconnection();
    }, 2000);
  });

  bot.on('end', () => {
    const connectionDuration = systemStatus.connectionStart ? Math.floor((Date.now() - systemStatus.connectionStart) / 1000) : 0;
    
    console.log(`🔌 Bot ${systemStatus.botId} disconnected`);
    console.log(`📅 Disconnect time: ${new Date().toLocaleString()}`);
    console.log(`⏱️ Bot was connected for: ${connectionDuration}s`);
    
    logEvent('DISCONNECT', `Bot disconnected after ${connectionDuration}s`, {
      connectionDuration: connectionDuration,
      activitiesPerformed: systemStatus.activitiesCount,
      messagesSent: systemStatus.messagesCount
    });
    
    systemStatus.botStatus = 'disconnected';
    
    // تأخير قصير قبل محاولة إعادة الاتصال
    setTimeout(() => {
      console.log('🔄 Starting reconnection after disconnect...');
      handleQuietReconnection();
    }, 3000);
  });

  bot.on('kicked', (reason) => {
    const connectionDuration = systemStatus.connectionStart ? Math.floor((Date.now() - systemStatus.connectionStart) / 1000) : 0;
    
    console.log(`👢 Bot ${systemStatus.botId} kicked at ${new Date().toLocaleString()}`);
    console.log(`📝 Kick reason: ${reason}`);
    console.log(`⏱️ Bot was online for: ${connectionDuration}s`);
    console.log(`🎯 Activities performed: ${systemStatus.activitiesCount}`);
    console.log(`💬 Messages sent: ${systemStatus.messagesCount}`);
    
    logEvent('KICKED', `Bot kicked: ${reason}`, {
      kickReason: reason,
      connectionDuration: connectionDuration,
      activitiesPerformed: systemStatus.activitiesCount,
      messagesSent: systemStatus.messagesCount,
      reconnectAttempt: reconnectAttempts
    });
    
    systemStatus.botStatus = 'kicked';
    
    // تحليل سبب الطرد
    if (reason.toLowerCase().includes('idle') || reason.toLowerCase().includes('timeout')) {
      console.log('🔍 ANALYSIS: Kicked for idling/timeout - will improve anti-idle');
      logEvent('ANALYSIS', 'Kicked for idle/timeout - anti-idle system needs improvement');
    } else if (reason.toLowerCase().includes('spam')) {
      console.log('🔍 ANALYSIS: Kicked for spam - will reduce chat frequency');
      logEvent('ANALYSIS', 'Kicked for spam - reducing chat frequency');
    }
    
    // محاولة فورية لإعادة الاتصال بعد الطرد
    setTimeout(() => {
      console.log('🔄 Starting immediate reconnection after kick...');
      handleQuietReconnection();
    }, 5000);
  });

  // Resource pack handling
  bot._client.on('resource_pack_send', () => {
    setTimeout(() => {
      if (bot && bot._botId === systemStatus.botId) {
        try {
          bot._client.write('resource_pack_receive', { result: 0 });
        } catch (e) {
          console.log('❌ Resource pack response failed');
        }
      }
    }, 1000);
  });

  bot.on('resourcePack', (url, hash) => {
    setTimeout(() => {
      if (bot && bot.acceptResourcePack && bot._botId === systemStatus.botId) {
        bot.acceptResourcePack();
      }
    }, 1000);
  });
}

function startImprovedSystems() {
  if (!bot || bot._botId !== systemStatus.botId) {
    console.log('⚠️ Cannot start systems - bot mismatch');
    return;
  }
  
  console.log(`🤖 Starting improved anti-idle systems for bot ${systemStatus.botId}...`);
  
  // نظام keep-alive محسن
  const keepAliveInterval = setInterval(() => {
    if (bot && bot._client && bot._client.state === 'play' && bot._botId === systemStatus.botId) {
      // إرسال حزمة position لإبقاء الاتصال نشط
      try {
        if (bot.entity) {
          const pos = bot.entity.position;
          bot._client.write('position', {
            x: pos.x,
            y: pos.y,
            z: pos.z,
            onGround: bot.entity.onGround
          });
          systemStatus.lastKeepAlive = Date.now();
          systemStatus.lastActivity = 'keep_alive_packet';
        }
      } catch (e) {
        console.log('❌ Keep-alive packet failed:', e.message);
      }
    } else {
      clearInterval(keepAliveInterval);
    }
  }, IMPROVED_CONFIG.keepAliveInterval);
  
  // حركات متكررة لمنع الخمول
  const microInterval = setInterval(() => {
    if (bot && bot.entity && systemStatus.botStatus === 'active' && bot._botId === systemStatus.botId) {
      performAntiIdleMovement();
    } else {
      clearInterval(microInterval);
    }
  }, IMPROVED_CONFIG.microMovementInterval);
  
  // أنشطة متنوعة
  const majorInterval = setInterval(() => {
    if (bot && bot.entity && systemStatus.botStatus === 'active' && bot._botId === systemStatus.botId) {
      performVariedActivity();
    } else {
      clearInterval(majorInterval);
    }
  }, IMPROVED_CONFIG.majorActivityInterval);
  
  // رسائل تفاعلية
  const chatInterval = setInterval(() => {
    if (bot && bot.entity && systemStatus.botStatus === 'active' && 
        systemStatus.messagesCount < IMPROVED_CONFIG.maxChatPerHour && 
        Math.random() < 0.15 && bot._botId === systemStatus.botId) {
      sendInteractiveMessage();
    } else if (!bot || bot._botId !== systemStatus.botId) {
      clearInterval(chatInterval);
    }
  }, IMPROVED_CONFIG.chatInterval);
  
  activityIntervals = [keepAliveInterval, microInterval, majorInterval, chatInterval];
  
  console.log(`✅ Anti-idle systems active for bot ${systemStatus.botId}`);
}

function performAntiIdleMovement() {
  if (!bot || !bot.entity || bot._botId !== systemStatus.botId) return;
  
  try {
    const movements = [
      () => {
        // نظرة يمين ويسار
        const currentYaw = bot.entity.yaw;
        bot.look(currentYaw + 0.3, bot.entity.pitch);
        setTimeout(() => {
          if (bot && bot.entity && bot._botId === systemStatus.botId) {
            bot.look(currentYaw - 0.3, bot.entity.pitch);
          }
        }, 1000);
        setTimeout(() => {
          if (bot && bot.entity && bot._botId === systemStatus.botId) {
            bot.look(currentYaw, bot.entity.pitch);
          }
        }, 2000);
      },
      () => {
        // حركة قصيرة للأمام والخلف
        bot.setControlState('forward', true);
        setTimeout(() => {
          if (bot && bot.entity && bot._botId === systemStatus.botId) {
            bot.setControlState('forward', false);
            bot.setControlState('back', true);
          }
        }, 500);
        setTimeout(() => {
          if (bot && bot.entity && bot._botId === systemStatus.botId) {
            bot.setControlState('back', false);
          }
        }, 1000);
      },
      () => {
        // قفزة + نظرة
        bot.setControlState('jump', true);
        bot.look(bot.entity.yaw + (Math.random() - 0.5), bot.entity.pitch);
        setTimeout(() => {
          if (bot && bot.entity && bot._botId === systemStatus.botId) {
            bot.setControlState('jump', false);
          }
        }, 100);
      }
    ];
    
    const movement = movements[Math.floor(Math.random() * movements.length)];
    movement();
    
    systemStatus.lastMovement = Date.now();
    systemStatus.lastActivity = 'anti_idle_movement';
    systemStatus.activitiesCount++;
    
    console.log(`🎯 Anti-idle movement performed by bot ${systemStatus.botId}`);
    
  } catch (e) {
    console.log('❌ Anti-idle movement failed:', e.message);
  }
}

function performVariedActivity() {
  if (!bot || !bot.entity || bot._botId !== systemStatus.botId) return;
  
  console.log(`🎯 Varied activity for bot ${systemStatus.botId}`);
  
  try {
    const activities = [
      () => {
        // دورة كاملة بالنظر
        const steps = 8;
        let currentStep = 0;
        const rotateInterval = setInterval(() => {
          if (!bot || !bot.entity || bot._botId !== systemStatus.botId) {
            clearInterval(rotateInterval);
            return;
          }
          
          const yaw = (currentStep / steps) * Math.PI * 2;
          bot.look(yaw, 0);
          currentStep++;
          
          if (currentStep >= steps) {
            clearInterval(rotateInterval);
          }
        }, 500);
      },
      () => {
        // مشي في مربع صغير
        const directions = [
          () => bot.setControlState('forward', true),
          () => { bot.setControlState('forward', false); bot.setControlState('right', true); },
          () => { bot.setControlState('right', false); bot.setControlState('back', true); },
          () => { bot.setControlState('back', false); bot.setControlState('left', true); },
          () => { bot.setControlState('left', false); }
        ];
        
        let dirIndex = 0;
        const walkInterval = setInterval(() => {
          if (!bot || !bot.entity || bot._botId !== systemStatus.botId || dirIndex >= directions.length) {
            clearInterval(walkInterval);
            stopAllMovement();
            return;
          }
          
          directions[dirIndex]();
          dirIndex++;
        }, 1000);
      },
      () => {
        // قفز متتالي
        let jumps = 0;
        const jumpInterval = setInterval(() => {
          if (!bot || !bot.entity || bot._botId !== systemStatus.botId || jumps >= 3) {
            clearInterval(jumpInterval);
            return;
          }
          
          bot.setControlState('jump', true);
          setTimeout(() => {
            if (bot && bot.entity && bot._botId === systemStatus.botId) {
              bot.setControlState('jump', false);
            }
          }, 100);
          jumps++;
        }, 800);
      }
    ];
    
    const activity = activities[Math.floor(Math.random() * activities.length)];
    activity();
    
    systemStatus.lastActivity = 'varied_activity';
    systemStatus.activitiesCount++;
    
  } catch (e) {
    console.log('❌ Varied activity failed:', e.message);
  }
}

function sendInteractiveMessage() {
  if (!bot || bot._botId !== systemStatus.botId) return;
  
  const messages = [
    'hi everyone',
    'how is everyone doing?',
    'nice server!',
    'good day',
    'anyone here?',
    'what\'s up?',
    'enjoying the game',
    'great server'
  ];
  
  try {
    const message = messages[Math.floor(Math.random() * messages.length)];
    bot.chat(message);
    systemStatus.messagesCount++;
    console.log(`💬 Interactive message from bot ${systemStatus.botId}: ${message}`);
  } catch (e) {
    console.log('❌ Interactive message failed:', e.message);
  }
}

function returnToSpawn() {
  if (!spawnPosition || !bot || !bot.entity || bot._botId !== systemStatus.botId) return;
  
  console.log(`🏠 Bot ${systemStatus.botId} returning to spawn point...`);
  
  const dx = spawnPosition.x - bot.entity.position.x;
  const dz = spawnPosition.z - bot.entity.position.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  
  console.log(`📏 Distance to spawn: ${distance.toFixed(1)} blocks`);
  
  if (distance < 2) {
    console.log('✅ Already at spawn');
    return;
  }
  
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
    
    const targetYaw = Math.atan2(-currentDx, currentDz);
    bot.look(targetYaw, 0);
    bot.setControlState('forward', true);
    
  }, 500);
  
  setTimeout(() => {
    clearInterval(returnInterval);
    stopAllMovement();
    console.log(`⏰ Bot ${systemStatus.botId} return timeout, stopping movement`);
  }, 30000);
}

function handleQuietReconnection() {
  console.log(`🔄 Starting reconnection process...`);
  logEvent('RECONNECT_START', `Starting reconnection process (attempt ${reconnectAttempts + 1})`);
  
  // تنظيف تدريجي بدلاً من completeCleanup الذي قد يكسر الـ reconnect
  if (bot) {
    try {
      stopAllMovement();
      if (bot._client && bot._client.state !== 'disconnected') {
        bot._client.end();
      }
    } catch (e) {
      console.log('⚠️ Cleanup warning:', e.message);
      logEvent('CLEANUP_WARNING', `Cleanup warning: ${e.message}`);
    }
    bot = null;
  }
  
  // إيقاف الـ intervals بدون تحرير القفل
  activityIntervals.forEach(interval => {
    if (interval) clearInterval(interval);
  });
  activityIntervals = [];
  
  // إلغاء أي reconnect مجدول سابق
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
    logEvent('RECONNECT_CANCEL', 'Cancelled previous reconnect timeout');
  }
  
  // تحديد تأخير متدرج - يزيد مع كل محاولة فاشلة
  const baseDelay = IMPROVED_CONFIG.reconnectDelay;
  const maxDelay = 300000; // 5 دقائق كحد أقصى
  const delay = Math.min(baseDelay + (reconnectAttempts * 5000), maxDelay);
  
  console.log(`🔄 Reconnection scheduled in ${delay/1000}s (attempt ${reconnectAttempts + 1})`);
  console.log(`🎯 Will try reconnecting at: ${new Date(Date.now() + delay).toLocaleTimeString()}`);
  
  logEvent('RECONNECT_SCHEDULED', `Reconnection scheduled in ${delay/1000}s`, {
    delay: delay,
    attempt: reconnectAttempts + 1,
    scheduledTime: new Date(Date.now() + delay).toLocaleTimeString()
  });
  
  // تحرير القفل قبل المحاولة الجديدة
  BOT_LOCK.release();
  isCreatingBot = false;
  systemStatus.isConnecting = false;
  
  reconnectTimeout = setTimeout(() => {
    console.log(`⏰ Reconnection time reached! Attempting to create new bot...`);
    logEvent('RECONNECT_EXECUTE', `Executing reconnection attempt ${reconnectAttempts + 1}`);
    reconnectTimeout = null;
    
    // تحديث الحالة
    systemStatus.botStatus = 'reconnecting';
    
    // محاولة إعادة الاتصال
    try {
      createBot();
    } catch (error) {
      console.log(`❌ Reconnection failed: ${error.message}`);
      logEvent('RECONNECT_FAILED', `Reconnection failed: ${error.message}`, {
        error: error.message,
        attempt: reconnectAttempts
      });
      
      // محاولة أخرى بعد 30 ثانية
      setTimeout(() => {
        console.log(`🔄 Retry after error...`);
        logEvent('RECONNECT_RETRY', 'Retrying after reconnection error');
        createBot();
      }, 30000);
    }
  }, delay);
  
  // حفظ الـ timeout في متغير global للمراقبة
  global.lastReconnectTimeout = reconnectTimeout;
}

function completeCleanup() {
  console.log('🧹 Complete cleanup...');
  
  activityIntervals.forEach(interval => {
    if (interval) clearInterval(interval);
  });
  activityIntervals = [];
  
  if (bot) {
    try {
      stopAllMovement();
      
      if (bot._client) {
        bot._client.end();
      }
      
      bot.quit();
    } catch (e) {
      console.log('❌ Cleanup error:', e.message);
    }
    
    bot = null;
  }
  
  BOT_LOCK.release();
  
  isCreatingBot = false;
  systemStatus.isConnecting = false;
  systemStatus.botId = null;
}

function forceRestart() {
  console.log('🔄 Forcing complete restart...');
  
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  completeCleanup();
  
  reconnectAttempts = 0;
  systemStatus.deaths = 0;
  systemStatus.activitiesCount = 0;
  systemStatus.messagesCount = 0;
  
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
      console.log('❌ Stop movement failed:', e.message);
    }
  }
}

// التعامل مع إغلاق البرنامج
process.on('SIGINT', () => {
  console.log('🛑 Shutting down...');
  completeCleanup();
  process.exit(0);
});

// بدء محسن مع نظام مراقبة
logEvent('STARTUP', 'System starting up with improved anti-idle features');
createBot();
console.log('🚀 IMPROVED Anti-Idle Bot System Started');
console.log('⚡ Active every 8 seconds to prevent kicks');
console.log('🎯 Varied activities every 25 seconds');
console.log('📡 Keep-alive packets every 5 seconds');
console.log('💬 Interactive chat system enabled');
console.log('🔒 Multi-bot protection active');
console.log('🔍 Advanced reconnection monitoring enabled');

// نظام مراقبة ذكي - Watchdog Timer
setInterval(() => {
  const now = Date.now();
  const timeSinceLastActivity = systemStatus.lastMovement ? now - systemStatus.lastMovement : null;
  
  // فحص إذا كان البوت "عالق" أو متوقف عن النشاط
  if (systemStatus.botStatus === 'active' && timeSinceLastActivity && timeSinceLastActivity > 60000) {
    console.log(`⚠️ WATCHDOG: Bot seems stuck! Last activity was ${Math.floor(timeSinceLastActivity/1000)}s ago`);
    console.log('🔄 Watchdog initiating force restart...');
    logEvent('WATCHDOG_STUCK', `Bot stuck - last activity ${Math.floor(timeSinceLastActivity/1000)}s ago`);
    forceRestart();
  }
  
  // فحص إذا كان البوت في حالة "connecting" لفترة طويلة
  if (systemStatus.isConnecting && systemStatus.connectionStart && now - systemStatus.connectionStart > 120000) {
    console.log('⚠️ WATCHDOG: Bot stuck in connecting state for 2+ minutes');
    console.log('🔄 Watchdog forcing restart...');
    logEvent('WATCHDOG_CONNECTING', 'Bot stuck in connecting state for 2+ minutes');
    forceRestart();
  }
  
  // فحص إذا كان هناك reconnect مجدول لكن لم يحدث
  if (systemStatus.botStatus === 'disconnected' && !reconnectTimeout && !isCreatingBot) {
    console.log('⚠️ WATCHDOG: Bot disconnected but no reconnect scheduled');
    console.log('🔄 Watchdog initiating reconnection...');
    logEvent('WATCHDOG_RECONNECT', 'Disconnected bot with no scheduled reconnect');
    handleQuietReconnection();
  }
  
  // معلومات مراقبة دورية
  if (systemStatus.botStatus === 'active') {
    console.log(`✅ WATCHDOG: Bot healthy - Last activity: ${timeSinceLastActivity ? Math.floor(timeSinceLastActivity/1000) + 's ago' : 'unknown'}`);
  }
  
}, 30000); // كل 30 ثانية

// مراقبة خاصة لحالات إعادة الاتصال
setInterval(() => {
  if (reconnectTimeout) {
    console.log(`🔄 RECONNECT MONITOR: Reconnection scheduled and waiting...`);
  }
  
  if (systemStatus.botStatus === 'kicked' || systemStatus.botStatus === 'disconnected' || systemStatus.botStatus === 'error') {
    if (!reconnectTimeout && !isCreatingBot) {
      console.log(`❌ RECONNECT MONITOR: Bot in ${systemStatus.botStatus} state but no reconnection process!`);
      console.log('🚨 Initiating emergency reconnection...');
      logEvent('EMERGENCY_RECONNECT', `Emergency reconnection for ${systemStatus.botStatus} state`);
      handleQuietReconnection();
    }
  }
}, 15000); // كل 15 ثانية

// Self-ping محسن مع مراقبة
if (process.env.RENDER) {
  const url = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  setInterval(() => {
    fetch(url)
      .then(() => {
        console.log('✅ Self-ping successful');
        // فحص إضافي للحالة عبر self-ping
        if (systemStatus.botStatus === 'disconnected' && !reconnectTimeout) {
          console.log('🔍 Self-ping detected disconnected state with no reconnect');
          logEvent('SELFPING_RECONNECT', 'Self-ping detected disconnected state');
          handleQuietReconnection();
        }
      })
      .catch(() => console.log('❌ Self-ping failed'));
  }, 8 * 60 * 1000); // كل 8 دقائق
}

// مراقبة إضافية للتأكد من عمل النظام
setTimeout(() => {
  console.log('🔍 Initial system check after 2 minutes...');
  if (!bot && !isCreatingBot && !reconnectTimeout) {
    console.log('❌ No bot detected after startup! Initiating creation...');
    logEvent('STARTUP_CHECK', 'No bot detected after 2 minutes - creating bot');
    createBot();
  }
}, 120000); // بعد دقيقتين من البدء
