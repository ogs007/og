const mineflayer = require('mineflayer');
const express = require('express');
const app = express();

// إعدادات متقدمة لتجنب الكشف
const STEALTH_CONFIG = {
  // أوقات عشوائية أكثر
  minActivityInterval: 20000, // 20 ثانية
  maxActivityInterval: 180000, // 3 دقائق
  
  // أوقات الراحة
  minRestTime: 300000, // 5 دقائق
  maxRestTime: 900000, // 15 دقيقة
  
  // احتمالية عدم فعل شيء
  idleChance: 0.15, // 15% احتمال عدم فعل شيء
  
  // تنويع الرسائل
  chatChance: 0.05, // 5% احتمال الدردشة فقط
  maxChatPerHour: 8,
  
  // تنويع الأنشطة
  activityWeights: {
    'micro_movement': 0.4,
    'looking': 0.25,
    'walking': 0.15,
    'jumping': 0.1,
    'crouching': 0.05,
    'exploring': 0.05
  }
};

// Web server with minimal info
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    uptime: Math.floor(process.uptime())
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});

let bot;
let currentActivity = 'initializing';
let activityInterval;
let chatInterval;
let spawnPosition = null;
let isResting = false;
let lastChatTime = 0;
let chatCount = 0;
let sessionStartTime = Date.now();

// رسائل أكثر طبيعية وتنوعاً
const naturalMessages = [
  'hey there',
  'how\'s it going?',
  'nice build!',
  'anyone online?',
  'good morning',
  'good evening',
  'what\'s new?',
  'having fun?',
  'love this server',
  'great community here',
  'been busy lately',
  'nice weather today',
  'how was your day?',
  'working on anything cool?',
  'this place is awesome',
  'good to see everyone',
  'hope you\'re all well',
  'thanks for the great server'
];

// أسماء مستخدمين طبيعية للتنويع
const naturalUsernames = [
  'alex_player',
  'minecraft_fan',
  'builder123',
  'gamer_pro',
  'casual_player',
  'block_master'
];

function createBot() {
  console.log('🔄 Creating bot...');
  
  // استخدام اسم مستخدم عشوائي أكثر طبيعية
  const username = naturalUsernames[Math.floor(Math.random() * naturalUsernames.length)] + 
                   Math.floor(Math.random() * 1000);
  
  bot = mineflayer.createBot({
    host: 'og_players11-G2lV.aternos.me',
    port: 41642,
    username: username,
    version: '1.21.1',
    auth: 'offline',
    // إعدادات إضافية لتجنب الكشف
    hideErrors: true,
    checkTimeoutInterval: 30000,
    keepAlive: true
  });

  // تأخير التحميل لمحاكاة التحميل الطبيعي
  setTimeout(() => {
    setupBotEvents();
  }, 2000 + Math.random() * 3000);
}

function setupBotEvents() {
  // قبول Resource Pack بشكل طبيعي
  bot._client.on('resource_pack_send', (packet) => {
    // تأخير عشوائي لمحاكاة التفكير
    setTimeout(() => {
      console.log('📦 Resource Pack detected!');
      bot._client.write('resource_pack_receive', {
        result: 0
      });
      console.log('✅ Resource Pack accepted!');
    }, 1000 + Math.random() * 2000);
  });

  bot.on('resourcePack', (url, hash) => {
    setTimeout(() => {
      console.log('📦 Accepting resource pack...');
      if (bot.acceptResourcePack) {
        bot.acceptResourcePack();
      }
    }, 500 + Math.random() * 1500);
  });

  bot.once('spawn', () => {
    console.log('✅ Bot spawned!');
    spawnPosition = bot.entity.position.clone();
    
    // تأخير قبل بدء النشاط
    setTimeout(() => {
      // رسالة ترحيب طبيعية
      const welcomeMessages = [
        'hello everyone!',
        'hey there!',
        'good to be here',
        'hi all',
        'what\'s up?'
      ];
      
      const welcomeMsg = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
      bot.chat(welcomeMsg);
      
      startStealthActivity();
      startNaturalChat();
    }, 5000 + Math.random() * 10000);
  });

  // رد طبيعي على الرسائل
  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    
    // احتمالية الرد - ليس دائماً
    if (Math.random() < 0.3) { // 30% احتمالية الرد
      setTimeout(() => {
        handleChatResponse(username, message);
      }, 2000 + Math.random() * 8000); // تأخير طبيعي
    }
  });

  // التعامل مع الأخطاء بهدوء
  bot.on('error', (err) => {
    console.log('❌ Connection issue, retrying...');
    cleanup();
  });

  bot.on('end', () => {
    console.log('🔌 Disconnected, reconnecting...');
    cleanup();
    // تأخير أطول قبل إعادة الاتصال
    setTimeout(createBot, 10000 + Math.random() * 20000);
  });

  // مراقبة الأحداث للتفاعل الطبيعي
  bot.on('playerJoined', (player) => {
    if (Math.random() < 0.2) { // 20% احتمالية الترحيب
      setTimeout(() => {
        const greetings = [`welcome ${player.username}!`, `hi ${player.username}`, `hey ${player.username}`];
        const greeting = greetings[Math.floor(Math.random() * greetings.length)];
        bot.chat(greeting);
      }, 3000 + Math.random() * 10000);
    }
  });
}

function cleanup() {
  if (activityInterval) {
    clearInterval(activityInterval);
    activityInterval = null;
  }
  if (chatInterval) {
    clearInterval(chatInterval);
    chatInterval = null;
  }
  currentActivity = 'disconnected';
  isResting = false;
}

function startStealthActivity() {
  console.log('🤖 Starting stealth activity system...');
  
  function scheduleNextActivity() {
    const interval = STEALTH_CONFIG.minActivityInterval + 
                    Math.random() * (STEALTH_CONFIG.maxActivityInterval - STEALTH_CONFIG.minActivityInterval);
    
    activityInterval = setTimeout(() => {
      if (bot && bot.entity) {
        // احتمالية عدم فعل شيء
        if (Math.random() < STEALTH_CONFIG.idleChance) {
          console.log('😴 Taking a moment to rest...');
          currentActivity = 'resting';
          scheduleNextActivity();
          return;
        }
        
        // احتمالية أخذ راحة طويلة
        if (Math.random() < 0.05) { // 5% احتمالية
          takeRestBreak();
          return;
        }
        
        performStealthActivity();
      }
      scheduleNextActivity();
    }, interval);
  }
  
  scheduleNextActivity();
}

function performStealthActivity() {
  if (!bot || !bot.entity || isResting) return;
  
  // اختيار نشاط بناءً على الأوزان
  const activity = selectWeightedActivity();
  currentActivity = activity;
  
  console.log(`🎯 Performing: ${activity}`);
  
  switch (activity) {
    case 'micro_movement':
      performMicroMovement();
      break;
    case 'looking':
      performNaturalLooking();
      break;
    case 'walking':
      performNaturalWalking();
      break;
    case 'jumping':
      performNaturalJumping();
      break;
    case 'crouching':
      performNaturalCrouching();
      break;
    case 'exploring':
      performNaturalExploring();
      break;
  }
}

function selectWeightedActivity() {
  const weights = STEALTH_CONFIG.activityWeights;
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;
  
  for (const [activity, weight] of Object.entries(weights)) {
    random -= weight;
    if (random <= 0) {
      return activity;
    }
  }
  
  return 'micro_movement'; // fallback
}

function performMicroMovement() {
  // حركات صغيرة جداً - الأكثر شيوعاً
  const movements = [
    () => {
      const yaw = bot.entity.yaw + (Math.random() - 0.5) * 0.3;
      const pitch = bot.entity.pitch + (Math.random() - 0.5) * 0.2;
      bot.look(yaw, pitch);
    },
    () => {
      bot.setControlState('left', true);
      setTimeout(() => bot.setControlState('left', false), 50 + Math.random() * 100);
    },
    () => {
      bot.setControlState('right', true);
      setTimeout(() => bot.setControlState('right', false), 50 + Math.random() * 100);
    }
  ];
  
  const movement = movements[Math.floor(Math.random() * movements.length)];
  movement();
  
  setTimeout(() => {
    currentActivity = 'idle';
  }, 200 + Math.random() * 300);
}

function performNaturalLooking() {
  // نظرات طبيعية - ليس مثالية
  const lookDuration = 1000 + Math.random() * 3000;
  const lookCount = 1 + Math.floor(Math.random() * 3);
  
  let currentLook = 0;
  const lookInterval = setInterval(() => {
    if (currentLook >= lookCount) {
      clearInterval(lookInterval);
      currentActivity = 'idle';
      return;
    }
    
    // حركات رأس غير مثالية
    const yawChange = (Math.random() - 0.5) * Math.PI * 0.8;
    const pitchChange = (Math.random() - 0.5) * Math.PI * 0.4;
    
    bot.look(bot.entity.yaw + yawChange, bot.entity.pitch + pitchChange);
    currentLook++;
  }, 800 + Math.random() * 1200);
}

function performNaturalWalking() {
  // مشي طبيعي مع توقفات
  const directions = ['forward', 'back', 'left', 'right'];
  const direction = directions[Math.floor(Math.random() * directions.length)];
  const walkDuration = 1000 + Math.random() * 4000;
  
  bot.setControlState(direction, true);
  
  // توقف عشوائي في المنتصف أحياناً
  if (Math.random() < 0.3) {
    setTimeout(() => {
      bot.setControlState(direction, false);
      setTimeout(() => {
        bot.setControlState(direction, true);
      }, 300 + Math.random() * 800);
    }, walkDuration * 0.5);
  }
  
  setTimeout(() => {
    bot.setControlState(direction, false);
    currentActivity = 'idle';
  }, walkDuration);
}

function performNaturalJumping() {
  // قفزات طبيعية - ليس منتظمة
  const jumpCount = 1 + Math.floor(Math.random() * 3);
  let currentJump = 0;
  
  const jumpInterval = setInterval(() => {
    if (currentJump >= jumpCount) {
      clearInterval(jumpInterval);
      currentActivity = 'idle';
      return;
    }
    
    bot.setControlState('jump', true);
    setTimeout(() => bot.setControlState('jump', false), 100 + Math.random() * 100);
    currentJump++;
  }, 500 + Math.random() * 1000);
}

function performNaturalCrouching() {
  const crouchDuration = 800 + Math.random() * 2000;
  
  bot.setControlState('sneak', true);
  
  setTimeout(() => {
    bot.setControlState('sneak', false);
    currentActivity = 'idle';
  }, crouchDuration);
}

function performNaturalExploring() {
  if (!spawnPosition) return;
  
  // استكشاف طبيعي مع تردد
  const distance = 2 + Math.random() * 5;
  const angle = Math.random() * Math.PI * 2;
  
  const targetX = spawnPosition.x + Math.cos(angle) * distance;
  const targetZ = spawnPosition.z + Math.sin(angle) * distance;
  
  // حركة مع توقفات طبيعية
  const moveInterval = setInterval(() => {
    if (!bot || !bot.entity) {
      clearInterval(moveInterval);
      return;
    }
    
    const dx = targetX - bot.entity.position.x;
    const dz = targetZ - bot.entity.position.z;
    const distanceToTarget = Math.sqrt(dx * dx + dz * dz);
    
    if (distanceToTarget < 0.5) {
      clearInterval(moveInterval);
      stopAllMovement();
      currentActivity = 'idle';
      return;
    }
    
    // توقف عشوائي
    if (Math.random() < 0.1) {
      stopAllMovement();
      setTimeout(() => {
        const targetYaw = Math.atan2(-dx, dz);
        bot.look(targetYaw, 0);
        bot.setControlState('forward', true);
      }, 500 + Math.random() * 1500);
      return;
    }
    
    const targetYaw = Math.atan2(-dx, dz);
    bot.look(targetYaw, 0);
    bot.setControlState('forward', true);
    
  }, 200 + Math.random() * 300);
  
  setTimeout(() => {
    clearInterval(moveInterval);
    stopAllMovement();
    currentActivity = 'idle';
  }, 8000);
}

function stopAllMovement() {
  ['forward', 'back', 'left', 'right', 'jump', 'sneak'].forEach(control => {
    bot.setControlState(control, false);
  });
}

function takeRestBreak() {
  console.log('😴 Taking a rest break...');
  isResting = true;
  currentActivity = 'resting';
  
  const restDuration = STEALTH_CONFIG.minRestTime + 
                      Math.random() * (STEALTH_CONFIG.maxRestTime - STEALTH_CONFIG.minRestTime);
  
  setTimeout(() => {
    isResting = false;
    currentActivity = 'idle';
    console.log('😊 Rest break over, resuming activity...');
  }, restDuration);
}

function startNaturalChat() {
  chatInterval = setInterval(() => {
    if (bot && bot.entity && !isResting) {
      // قيود على عدد الرسائل
      const hoursPassed = (Date.now() - sessionStartTime) / (1000 * 60 * 60);
      const maxChats = Math.floor(hoursPassed * STEALTH_CONFIG.maxChatPerHour);
      
      if (chatCount >= maxChats) return;
      
      if (Math.random() < STEALTH_CONFIG.chatChance) {
        sendNaturalMessage();
      }
    }
  }, (8 + Math.random() * 22) * 60 * 1000); // 8-30 دقيقة
}

function sendNaturalMessage() {
  const message = naturalMessages[Math.floor(Math.random() * naturalMessages.length)];
  bot.chat(message);
  chatCount++;
  lastChatTime = Date.now();
  console.log(`💬 Sent: ${message}`);
}

function handleChatResponse(username, message) {
  const lowerMessage = message.toLowerCase();
  
  // ردود طبيعية ومتنوعة
  const responses = {
    'hello': ['hey!', 'hi there!', 'hello!', 'hey there'],
    'hi': ['hello!', 'hey!', 'hi!', 'what\'s up?'],
    'how are you': ['good thanks!', 'doing well!', 'not bad!', 'pretty good'],
    'thanks': ['no problem!', 'you\'re welcome!', 'anytime!', 'sure thing!']
  };
  
  for (const [trigger, replies] of Object.entries(responses)) {
    if (lowerMessage.includes(trigger)) {
      const reply = replies[Math.floor(Math.random() * replies.length)];
      bot.chat(reply);
      chatCount++;
      break;
    }
  }
}

// بدء النظام
createBot();
console.log('🚀 Stealth bot system started!');

// Self-ping محدود
if (process.env.RENDER) {
  const url = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  setInterval(() => {
    fetch(url)
      .then(() => console.log('Self-ping successful'))
      .catch(() => console.log('Self-ping failed'));
  }, 5 * 60 * 1000); // كل 5 دقائق بدلاً من 4
}
