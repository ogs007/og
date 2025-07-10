const mineflayer = require('mineflayer');
const express = require('express');
const app = express();

// إعدادات Anti-AFK المتقدمة
const ANTI_AFK_CONFIG = {
  // تكرار النشاط
  microMovementInterval: 3000,    // كل 3 ثواني - حركات صغيرة
  majorActivityInterval: 15000,   // كل 15 ثانية - نشاط كبير
  interactionInterval: 45000,     // كل 45 ثانية - تفاعل مع البيئة
  
  // فترات النشاط
  movementDuration: {
    min: 100,
    max: 500
  },
  
  // حدود الحركة
  walkDistance: 5,               // مسافة المشي من نقطة الانطلاق
  
  // تنويع النشاط
  activities: {
    'micro_look': 0.4,           // 40% - نظرات صغيرة
    'walk_around': 0.25,         // 25% - المشي
    'jump_sequence': 0.15,       // 15% - قفزات
    'crouch_walk': 0.1,          // 10% - مشي منحني
    'circle_walk': 0.1           // 10% - مشي دائري
  }
};

let systemStatus = {
  botStatus: 'initializing',
  lastActivity: null,
  activitiesPerformed: 0,
  timeAlive: 0,
  afkWarnings: 0
};

// Web server
app.get('/', (req, res) => {
  res.json({
    ...systemStatus,
    uptime: Math.floor(process.uptime()),
    config: ANTI_AFK_CONFIG
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Anti-AFK Server running on port ${PORT}`);
});

let bot;
let spawnPosition = null;
let currentActivity = 'idle';
let activityIntervals = [];

function createBot() {
  console.log('🔄 Creating Anti-AFK bot...');
  
  bot = mineflayer.createBot({
    host: 'og_players11-G2lV.aternos.me',
    port: 41642,
    username: 'player' + Math.floor(Math.random() * 10000),
    version: '1.21.1',
    auth: 'offline',
    hideErrors: false,
    keepAlive: true,
    checkTimeoutInterval: 30000
  });

  setupBotEvents();
}

function setupBotEvents() {
  bot.once('spawn', () => {
    console.log('✅ Bot spawned! Starting intensive Anti-AFK...');
    spawnPosition = bot.entity.position.clone();
    systemStatus.botStatus = 'active';
    
    bot.chat('Anti-AFK system activated!');
    
    // بدء نظام Anti-AFK المكثف
    startIntensiveAntiAFK();
    
    // مراقبة رسائل التحذير
    monitorAFKWarnings();
  });

  // مراقبة الرسائل للتحذيرات
  bot.on('chat', (username, message) => {
    const lowerMessage = message.toLowerCase();
    
    // كشف تحذيرات AFK
    if (lowerMessage.includes('idle') || 
        lowerMessage.includes('afk') || 
        lowerMessage.includes('inactive')) {
      console.log('⚠️ AFK Warning detected! Intensifying activity...');
      systemStatus.afkWarnings++;
      performEmergencyActivity();
    }
    
    // تسجيل الرسائل
    if (username !== bot.username) {
      console.log(`💬 ${username}: ${message}`);
    }
  });

  bot.on('error', (err) => {
    console.log('❌ Error:', err.message);
    systemStatus.botStatus = 'error';
    cleanup();
  });

  bot.on('end', () => {
    console.log('🔌 Disconnected! Reconnecting...');
    systemStatus.botStatus = 'reconnecting';
    cleanup();
    setTimeout(createBot, 5000);
  });

  bot.on('kicked', (reason) => {
    console.log('👢 Kicked:', reason);
    if (reason.includes('idle') || reason.includes('afk')) {
      console.log('💥 KICKED FOR BEING AFK! Need to intensify anti-AFK!');
      systemStatus.afkWarnings++;
    }
    systemStatus.botStatus = 'kicked';
    cleanup();
    setTimeout(createBot, 10000);
  });

  // Resource pack handling
  bot._client.on('resource_pack_send', (packet) => {
    bot._client.write('resource_pack_receive', { result: 0 });
  });

  bot.on('resourcePack', (url, hash) => {
    if (bot.acceptResourcePack) {
      bot.acceptResourcePack();
    }
  });
}

function startIntensiveAntiAFK() {
  console.log('🤖 Starting INTENSIVE Anti-AFK system...');
  
  // حركات مايكرو مستمرة - كل 3 ثواني
  const microInterval = setInterval(() => {
    if (bot && bot.entity) {
      performMicroMovement();
    }
  }, ANTI_AFK_CONFIG.microMovementInterval);
  
  // نشاط كبير - كل 15 ثانية
  const majorInterval = setInterval(() => {
    if (bot && bot.entity) {
      performMajorActivity();
    }
  }, ANTI_AFK_CONFIG.majorActivityInterval);
  
  // تفاعل مع البيئة - كل 45 ثانية
  const interactionInterval = setInterval(() => {
    if (bot && bot.entity) {
      performEnvironmentInteraction();
    }
  }, ANTI_AFK_CONFIG.interactionInterval);
  
  // رسائل دورية - كل 2-5 دقائق
  const chatInterval = setInterval(() => {
    if (bot && bot.entity && Math.random() < 0.7) {
      sendAntiAFKMessage();
    }
  }, (2 + Math.random() * 3) * 60 * 1000);
  
  activityIntervals = [microInterval, majorInterval, interactionInterval, chatInterval];
  
  console.log('✅ All Anti-AFK systems running!');
}

function performMicroMovement() {
  if (!bot || !bot.entity) return;
  
  // حركات صغيرة مستمرة
  const microActions = [
    () => {
      // نظرة عشوائية
      const yaw = bot.entity.yaw + (Math.random() - 0.5) * 0.8;
      const pitch = bot.entity.pitch + (Math.random() - 0.5) * 0.4;
      bot.look(yaw, pitch);
    },
    () => {
      // حركة يسار/يمين سريعة
      const direction = Math.random() < 0.5 ? 'left' : 'right';
      bot.setControlState(direction, true);
      setTimeout(() => bot.setControlState(direction, false), 50 + Math.random() * 100);
    },
    () => {
      // حركة أمام/خلف سريعة
      const direction = Math.random() < 0.5 ? 'forward' : 'back';
      bot.setControlState(direction, true);
      setTimeout(() => bot.setControlState(direction, false), 50 + Math.random() * 100);
    },
    () => {
      // قفزة سريعة
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 100);
    }
  ];
  
  // تنفيذ 1-2 حركات عشوائية
  const actionCount = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < actionCount; i++) {
    const action = microActions[Math.floor(Math.random() * microActions.length)];
    setTimeout(() => action(), i * 200);
  }
  
  systemStatus.lastActivity = 'micro_movement';
  systemStatus.activitiesPerformed++;
}

function performMajorActivity() {
  if (!bot || !bot.entity) return;
  
  const activities = Object.keys(ANTI_AFK_CONFIG.activities);
  const weights = Object.values(ANTI_AFK_CONFIG.activities);
  
  // اختيار نشاط بناءً على الأوزان
  const activity = selectWeightedActivity(activities, weights);
  currentActivity = activity;
  
  console.log(`🎯 Performing: ${activity}`);
  
  switch (activity) {
    case 'micro_look':
      performLookingSequence();
      break;
    case 'walk_around':
      performWalkAround();
      break;
    case 'jump_sequence':
      performJumpSequence();
      break;
    case 'crouch_walk':
      performCrouchWalk();
      break;
    case 'circle_walk':
      performCircleWalk();
      break;
  }
  
  systemStatus.lastActivity = activity;
  systemStatus.activitiesPerformed++;
}

function performLookingSequence() {
  // تسلسل نظرات طبيعي
  const lookCount = 3 + Math.floor(Math.random() * 4);
  
  for (let i = 0; i < lookCount; i++) {
    setTimeout(() => {
      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * Math.PI * 0.6;
      bot.look(yaw, pitch);
    }, i * (400 + Math.random() * 600));
  }
}

function performWalkAround() {
  if (!spawnPosition) return;
  
  // مشي عشوائي حول نقطة الانطلاق
  const distance = 1 + Math.random() * ANTI_AFK_CONFIG.walkDistance;
  const angle = Math.random() * Math.PI * 2;
  
  const targetX = spawnPosition.x + Math.cos(angle) * distance;
  const targetZ = spawnPosition.z + Math.sin(angle) * distance;
  
  walkToPosition(targetX, targetZ, 3000 + Math.random() * 4000);
}

function performJumpSequence() {
  // تسلسل قفزات
  const jumpCount = 2 + Math.floor(Math.random() * 4);
  
  for (let i = 0; i < jumpCount; i++) {
    setTimeout(() => {
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 100 + Math.random() * 100);
    }, i * (300 + Math.random() * 400));
  }
}

function performCrouchWalk() {
  // مشي منحني
  const duration = 1000 + Math.random() * 2000;
  const direction = ['forward', 'back', 'left', 'right'][Math.floor(Math.random() * 4)];
  
  bot.setControlState('sneak', true);
  bot.setControlState(direction, true);
  
  setTimeout(() => {
    bot.setControlState('sneak', false);
    bot.setControlState(direction, false);
  }, duration);
}

function performCircleWalk() {
  // مشي دائري
  const radius = 2 + Math.random() * 3;
  const steps = 8 + Math.floor(Math.random() * 8);
  
  for (let i = 0; i < steps; i++) {
    setTimeout(() => {
      const angle = (i / steps) * Math.PI * 2;
      const targetX = spawnPosition.x + Math.cos(angle) * radius;
      const targetZ = spawnPosition.z + Math.sin(angle) * radius;
      
      const targetYaw = Math.atan2(-(targetX - bot.entity.position.x), targetZ - bot.entity.position.z);
      bot.look(targetYaw, 0);
      
      bot.setControlState('forward', true);
      setTimeout(() => bot.setControlState('forward', false), 200);
    }, i * 300);
  }
}

function performEnvironmentInteraction() {
  console.log('🔧 Performing environment interaction...');
  
  // تفاعلات مختلفة
  const interactions = [
    () => {
      // فتح/إغلاق الانفنتري (محاكاة)
      console.log('📦 Checking inventory...');
    },
    () => {
      // تغيير الـ hotbar slot
      if (bot.quickBarSlot !== undefined) {
        const newSlot = Math.floor(Math.random() * 9);
        bot.setQuickBarSlot(newSlot);
        console.log(`🎯 Changed hotbar to slot ${newSlot}`);
      }
    },
    () => {
      // النقر بالماوس (محاكاة تفاعل)
      console.log('👆 Simulating mouse interaction...');
    },
    () => {
      // رسالة تفاعلية
      bot.chat('/help');
      console.log('❓ Sent command for interaction');
    }
  ];
  
  const interaction = interactions[Math.floor(Math.random() * interactions.length)];
  interaction();
}

function performEmergencyActivity() {
  console.log('🚨 EMERGENCY ANTI-AFK ACTIVITY!');
  
  // نشاط مكثف فوري
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      // قفزة + حركة + نظرة
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 100);
      
      const direction = ['forward', 'back', 'left', 'right'][Math.floor(Math.random() * 4)];
      bot.setControlState(direction, true);
      setTimeout(() => bot.setControlState(direction, false), 200);
      
      bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * Math.PI * 0.5);
    }, i * 200);
  }
  
  // رسالة طوارئ
  setTimeout(() => {
    bot.chat('System check - all active!');
  }, 1000);
}

function walkToPosition(targetX, targetZ, maxDuration) {
  const startTime = Date.now();
  
  const walkInterval = setInterval(() => {
    if (!bot || !bot.entity || Date.now() - startTime > maxDuration) {
      clearInterval(walkInterval);
      stopAllMovement();
      return;
    }
    
    const dx = targetX - bot.entity.position.x;
    const dz = targetZ - bot.entity.position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    
    if (distance < 0.5) {
      clearInterval(walkInterval);
      stopAllMovement();
      return;
    }
    
    const targetYaw = Math.atan2(-dx, dz);
    bot.look(targetYaw, 0);
    bot.setControlState('forward', true);
    
  }, 100);
}

function stopAllMovement() {
  ['forward', 'back', 'left', 'right', 'jump', 'sneak'].forEach(control => {
    bot.setControlState(control, false);
  });
}

function sendAntiAFKMessage() {
  const messages = [
    'System running smoothly',
    'All systems operational',
    'Connection stable',
    'Activity logged',
    'Server performance good',
    'Status: Active',
    'Monitoring continues',
    'Functions normal'
  ];
  
  const message = messages[Math.floor(Math.random() * messages.length)];
  bot.chat(message);
  console.log(`💬 Sent: ${message}`);
}

function selectWeightedActivity(activities, weights) {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;
  
  for (let i = 0; i < activities.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return activities[i];
    }
  }
  
  return activities[0];
}

function monitorAFKWarnings() {
  // مراقبة دورية للـ ping والاستجابة
  setInterval(() => {
    if (bot && bot.entity) {
      // إرسال حزمة keep-alive إضافية
      try {
        bot._client.write('keep_alive', {
          keepAliveId: Date.now()
        });
      } catch (e) {
        // تجاهل الأخطاء
      }
    }
  }, 15000); // كل 15 ثانية
}

function cleanup() {
  activityIntervals.forEach(interval => {
    if (interval) clearInterval(interval);
  });
  activityIntervals = [];
  currentActivity = 'idle';
}

// بدء النظام
createBot();
console.log('🚀 INTENSIVE Anti-AFK Bot System Started!');
console.log('⚡ Activity every 3 seconds');
console.log('🔄 Major activity every 15 seconds');
console.log('🎯 Environment interaction every 45 seconds');

// Self-ping
if (process.env.RENDER) {
  const url = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  setInterval(() => {
    fetch(url)
      .then(() => console.log('Self-ping successful'))
      .catch(() => console.log('Self-ping failed'));
  }, 4 * 60 * 1000);
}
