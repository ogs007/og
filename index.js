const mineflayer = require('mineflayer');
const express = require('express');
const app = express();

// إعدادات البوت
const BOT_CONFIG = {
  username: 'MendingFinder',  // اسم ثابت
  host: 'og_players11-G2lV.aternos.me',
  port: 41642,
  version: '1.21.1',
  
  // إعدادات البحث عن المندنق
  searchRadius: 10,           // نطاق البحث عن القرويين
  breakDelay: 2000,          // تأخير بين كسر ووضع الـ lectern
  maxAttempts: 1000,         // عدد أقصى من المحاولات
  checkDelay: 1000,          // تأخير فحص العروض
  
  // إعدادات مكافحة الخمول
  antiIdleInterval: 30000,   // حركة كل 30 ثانية
  keepAliveInterval: 10000   // keep-alive كل 10 ثواني
};

let systemStatus = {
  botStatus: 'initializing',
  searchingForMending: false,
  mendingFound: false,
  currentVillager: null,
  attempts: 0,
  lastActivity: 'none',
  foundMendingTrade: null,
  totalVillagersChecked: 0,
  sessionStartTime: null
};

let bot = null;
let searchInterval = null;
let antiIdleInterval = null;
let keepAliveInterval = null;

// Web server للمراقبة
app.get('/', (req, res) => {
  const uptime = systemStatus.sessionStartTime ? Math.floor((Date.now() - systemStatus.sessionStartTime) / 1000) : 0;
  res.json({
    status: systemStatus.botStatus,
    searchingForMending: systemStatus.searchingForMending,
    mendingFound: systemStatus.mendingFound,
    attempts: systemStatus.attempts,
    villagersChecked: systemStatus.totalVillagersChecked,
    currentVillager: systemStatus.currentVillager ? 'Found' : 'None',
    uptime: uptime,
    foundTrade: systemStatus.foundMendingTrade,
    lastActivity: systemStatus.lastActivity,
    timestamp: new Date().toLocaleString()
  });
});

app.get('/start-search', (req, res) => {
  if (!systemStatus.mendingFound) {
    startMendingSearch();
    res.json({ message: 'بدء البحث عن المندنق', status: 'started' });
  } else {
    res.json({ message: 'تم العثور على المندنق مسبقاً!', status: 'already_found' });
  }
});

app.get('/stop-search', (req, res) => {
  stopMendingSearch();
  res.json({ message: 'توقف البحث', status: 'stopped' });
});

app.get('/reset', (req, res) => {
  resetSearch();
  res.json({ message: 'إعادة تعيين البحث', status: 'reset' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Mending Bot Server running on port ${PORT}`);
});

function createBot() {
  console.log(`🤖 إنشاء بوت البحث عن المندنق...`);
  console.log(`👤 اسم البوت: ${BOT_CONFIG.username}`);
  
  try {
    bot = mineflayer.createBot({
      host: BOT_CONFIG.host,
      port: BOT_CONFIG.port,
      username: BOT_CONFIG.username,
      version: BOT_CONFIG.version,
      auth: 'offline',
      hideErrors: false,
      keepAlive: true,
      checkTimeoutInterval: 30000,
      closeTimeout: 40000
    });

    setupBotEvents();
    
  } catch (error) {
    console.log('❌ فشل في إنشاء البوت:', error.message);
    systemStatus.botStatus = 'error';
  }
}

function setupBotEvents() {
  bot.on('login', () => {
    console.log(`🔐 ${BOT_CONFIG.username} دخل إلى الخادم`);
    systemStatus.botStatus = 'logged_in';
  });

  bot.on('spawn', () => {
    console.log(`✅ ${BOT_CONFIG.username} ظهر في اللعبة`);
    systemStatus.botStatus = 'active';
    systemStatus.sessionStartTime = Date.now();
    
    // بدء أنظمة مكافحة الخمول
    startAntiIdleSystems();
    
    // رسالة ترحيب
    setTimeout(() => {
      if (bot) {
        bot.chat('مرحباً! أنا بوت البحث عن تطويرة المندنق 📚');
        bot.chat('💬 اكتب في الشات: start-search لبدء البحث');
        bot.chat('💬 أو اكتب: help لعرض جميع الأوامر');
      }
    }, 3000);
    
    console.log('🔍 جاهز للبحث عن المندنق!');
    console.log('💬 أوامر الشات: start-search, stop-search, status, help');
  });

  bot.on('chat', (username, message) => {
    if (username !== bot.username) {
      console.log(`💬 ${username}: ${message}`);
      
      // أوامر الشات - تعامل مع أشكال مختلفة من الأوامر
      const msg = message.toLowerCase();
      
      if (msg.includes('start-search') || msg.includes('start search') || 
          msg.includes('ابدأ البحث') || msg.includes('بدء البحث')) {
        if (!systemStatus.mendingFound) {
          startMendingSearch();
          bot.chat('🔍 بدء البحث عن المندنق...');
          bot.chat(`📍 البحث في نطاق ${BOT_CONFIG.searchRadius} بلوك`);
        } else {
          bot.chat('✅ تم العثور على المندنق مسبقاً!');
          bot.chat(`📍 الموقع: ${systemStatus.foundMendingTrade?.villagerPosition || 'غير محدد'}`);
        }
      }
      
      if (msg.includes('stop-search') || msg.includes('stop search') || 
          msg.includes('أوقف البحث') || msg.includes('إيقاف البحث')) {
        stopMendingSearch();
        bot.chat('⏹️ تم إيقاف البحث');
      }
      
      if (msg.includes('status') || msg.includes('الحالة') || msg.includes('info')) {
        if (systemStatus.mendingFound) {
          bot.chat(`✅ تم العثور على المندنق!`);
          bot.chat(`🔄 المحاولات: ${systemStatus.attempts}`);
          bot.chat(`👥 قرويين مفحوصين: ${systemStatus.totalVillagersChecked}`);
          bot.chat(`📍 موقع القروي: ${systemStatus.foundMendingTrade?.villagerPosition || 'غير محدد'}`);
        } else if (systemStatus.searchingForMending) {
          bot.chat(`🔍 البحث جاري... المحاولات: ${systemStatus.attempts}`);
          bot.chat(`👥 قرويين مفحوصين: ${systemStatus.totalVillagersChecked}`);
        } else {
          bot.chat('⏸️ البحث متوقف - استخدم start-search للبدء');
        }
      }
      
      if (msg.includes('reset') || msg.includes('إعادة تعيين') || msg.includes('restart')) {
        resetSearch();
        bot.chat('🔄 تم إعادة تعيين البحث');
      }
      
      if (msg.includes('help') || msg.includes('مساعدة') || msg.includes('commands')) {
        bot.chat('📚 أوامر البوت:');
        bot.chat('• start-search - بدء البحث عن المندنق');
        bot.chat('• stop-search - إيقاف البحث');
        bot.chat('• status - عرض الحالة');
        bot.chat('• reset - إعادة تعيين البحث');
      }
    }
  });

  bot.on('error', (err) => {
    console.log(`❌ خطأ في البوت:`, err.message);
    systemStatus.botStatus = 'error';
  });

  bot.on('death', () => {
    console.log(`💀 ${BOT_CONFIG.username} مات! إعادة الإحياء...`);
    systemStatus.botStatus = 'dead';
    
    setTimeout(() => {
      if (bot) {
        bot.respawn();
      }
    }, 2000);
  });

  bot.on('respawn', () => {
    console.log(`✅ ${BOT_CONFIG.username} عاد للحياة!`);
    systemStatus.botStatus = 'active';
    
    if (systemStatus.searchingForMending && !systemStatus.mendingFound) {
      console.log('🔍 استكمال البحث عن المندنق...');
      setTimeout(() => startMendingSearch(), 5000);
    }
  });

  // التعامل مع resource packs
  bot._client.on('resource_pack_send', () => {
    setTimeout(() => {
      if (bot) {
        try {
          bot._client.write('resource_pack_receive', { result: 0 });
        } catch (e) {
          console.log('❌ فشل في الرد على resource pack');
        }
      }
    }, 1000);
  });
}

function startAntiIdleSystems() {
  console.log('🤖 بدء أنظمة مكافحة الخمول...');
  
  // نظام keep-alive
  keepAliveInterval = setInterval(() => {
    if (bot && bot._client && bot._client.state === 'play') {
      try {
        if (bot.entity) {
          const pos = bot.entity.position;
          bot._client.write('position', {
            x: pos.x,
            y: pos.y,
            z: pos.z,
            onGround: bot.entity.onGround
          });
          systemStatus.lastActivity = 'keep_alive';
        }
      } catch (e) {
        console.log('❌ فشل في إرسال keep-alive:', e.message);
      }
    }
  }, BOT_CONFIG.keepAliveInterval);
  
  // حركات مكافحة الخمول
  antiIdleInterval = setInterval(() => {
    if (bot && bot.entity && systemStatus.botStatus === 'active') {
      performAntiIdleMovement();
    }
  }, BOT_CONFIG.antiIdleInterval);
}

function performAntiIdleMovement() {
  if (!bot || !bot.entity) return;
  
  try {
    // نظرة عشوائية
    const randomYaw = bot.entity.yaw + (Math.random() - 0.5) * 0.5;
    const randomPitch = (Math.random() - 0.5) * 0.3;
    bot.look(randomYaw, randomPitch);
    
    // قفزة أحياناً
    if (Math.random() < 0.3) {
      bot.setControlState('jump', true);
      setTimeout(() => {
        if (bot) bot.setControlState('jump', false);
      }, 100);
    }
    
    systemStatus.lastActivity = 'anti_idle_movement';
    console.log('🎯 حركة مكافحة خمول');
    
  } catch (e) {
    console.log('❌ فشل في حركة مكافحة الخمول:', e.message);
  }
}

function startMendingSearch() {
  if (systemStatus.mendingFound) {
    console.log('✅ تم العثور على المندنق مسبقاً!');
    return;
  }
  
  console.log('🔍 بدء البحث عن تطويرة المندنق...');
  systemStatus.searchingForMending = true;
  systemStatus.attempts = 0;
  
  if (bot) {
    bot.chat('🔍 بدء البحث عن المندنق من القرويين...');
  }
  
  // البحث عن قروي مكتبي
  searchInterval = setInterval(() => {
    if (systemStatus.mendingFound) {
      stopMendingSearch();
      return;
    }
    
    if (systemStatus.attempts >= BOT_CONFIG.maxAttempts) {
      console.log(`⏹️ وصل للحد الأقصى من المحاولات: ${BOT_CONFIG.maxAttempts}`);
      stopMendingSearch();
      if (bot) bot.chat(`⏹️ توقف البحث بعد ${BOT_CONFIG.maxAttempts} محاولة`);
      return;
    }
    
    searchForMendingVillager();
    
  }, BOT_CONFIG.checkDelay);
}

function searchForMendingVillager() {
  if (!bot || !bot.entity) return;
  
  try {
    // البحث عن قرويين في النطاق
    const villagers = Object.values(bot.entities)
      .filter(entity => entity.name === 'villager')
      .filter(villager => bot.entity.position.distanceTo(villager.position) <= BOT_CONFIG.searchRadius);
    
    if (villagers.length === 0) {
      console.log('❌ لم يتم العثور على قرويين في النطاق');
      systemStatus.lastActivity = 'no_villagers_found';
      return;
    }
    
    console.log(`👥 تم العثور على ${villagers.length} قروي`);
    
    // البحث عن مكتبي أو قروي بدون مهنة
    const librarian = villagers.find(v => v.profession === 'librarian');
    const unemployed = villagers.find(v => !v.profession || v.profession === 'none');
    
    const targetVillager = librarian || unemployed || villagers[0];
    
    if (targetVillager) {
      console.log(`🎯 فحص القروي في المكان: ${targetVillager.position.toString()}`);
      systemStatus.currentVillager = targetVillager;
      attemptMendingReset(targetVillager);
    }
    
  } catch (e) {
    console.log('❌ خطأ في البحث عن القرويين:', e.message);
  }
}

function attemptMendingReset(villager) {
  if (!bot || !villager) return;
  
  systemStatus.attempts++;
  console.log(`🔄 المحاولة #${systemStatus.attempts}: فحص القروي`);
  
  try {
    // البحث عن lectern قريب من القروي
    const lectern = bot.findBlock({
      matching: block => block.name === 'lectern',
      maxDistance: 5,
      point: villager.position
    });
    
    if (lectern) {
      console.log('📚 تم العثور على lectern، كسره...');
      
      // كسر الـ lectern
      bot.dig(lectern).then(() => {
        console.log('✅ تم كسر lectern');
        
        // انتظار ثم إعادة الوضع
        setTimeout(() => {
          placeLectern(lectern.position, villager);
        }, BOT_CONFIG.breakDelay);
        
      }).catch(err => {
        console.log('❌ فشل في كسر lectern:', err.message);
        
        // إذا لم نستطع كسره، نحاول فحص العروض مباشرة
        setTimeout(() => {
          checkVillagerTrades(villager);
        }, 1000);
      });
      
    } else {
      // إذا لم نجد lectern، نحاول وضع واحد جديد
      console.log('❌ لم يتم العثور على lectern، محاولة وضع واحد...');
      
      // البحث عن مكان مناسب لوضع lectern
      const placePosition = villager.position.offset(1, 0, 0);
      placeLectern(placePosition, villager);
    }
    
  } catch (e) {
    console.log('❌ خطأ في محاولة إعادة تعيين القروي:', e.message);
  }
}

function placeLectern(position, villager) {
  try {
    // البحث عن lectern في الـ inventory
    const lecternItem = bot.inventory.items().find(item => item.name === 'lectern');
    
    if (lecternItem) {
      console.log('📚 وضع lectern...');
      
      bot.equip(lecternItem, 'hand').then(() => {
        return bot.placeBlock(bot.blockAt(position), position);
      }).then(() => {
        console.log('✅ تم وضع lectern بنجاح');
        
        // انتظار ثم فحص العروض
        setTimeout(() => {
          checkVillagerTrades(villager);
        }, BOT_CONFIG.checkDelay);
        
      }).catch(err => {
        console.log('❌ فشل في وضع lectern:', err.message);
        
        // فحص العروض بدون lectern
        setTimeout(() => {
          checkVillagerTrades(villager);
        }, 1000);
      });
      
    } else {
      console.log('❌ لا يوجد lectern في الـ inventory');
      
      // فحص العروض الحالية
      setTimeout(() => {
        checkVillagerTrades(villager);
      }, 1000);
    }
    
  } catch (e) {
    console.log('❌ خطأ في وضع lectern:', e.message);
  }
}

function checkVillagerTrades(villager) {
  if (!bot || !villager) return;
  
  try {
    console.log('🔍 فحص عروض القروي للبحث عن المندنق...');
    systemStatus.totalVillagersChecked++;
    
    // محاولة فتح واجهة التداول
    bot.trade(villager).then(trade => {
      if (!trade || !trade.trades) {
        console.log('❌ لا توجد عروض متاحة');
        return;
      }
      
      console.log(`💰 فحص ${trade.trades.length} عرض...`);
      
      // فحص كل عرض للبحث عن المندنق
      for (let i = 0; i < trade.trades.length; i++) {
        const tradeOffer = trade.trades[i];
        
        if (tradeOffer.outputItem && tradeOffer.outputItem.name === 'enchanted_book') {
          console.log('📖 تم العثور على كتاب مطور، فحص التطويرات...');
          
          // فحص إذا كان يحتوي على mending
          if (hasEnchantment(tradeOffer.outputItem, 'mending')) {
            console.log('🎉 تم العثور على المندنق!');
            foundMending(tradeOffer, villager);
            return;
          }
        }
      }
      
      console.log('❌ لم يتم العثور على المندنق في هذا القروي');
      systemStatus.lastActivity = 'checked_villager_no_mending';
      
    }).catch(err => {
      console.log('❌ فشل في فتح واجهة التداول:', err.message);
    });
    
  } catch (e) {
    console.log('❌ خطأ في فحص عروض القروي:', e.message);
  }
}

function hasEnchantment(item, enchantmentName) {
  if (!item || !item.nbt) return false;
  
  try {
    // فحص الـ NBT للبحث عن التطويرات
    const nbt = item.nbt;
    
    if (nbt.value && nbt.value.StoredEnchantments) {
      const enchantments = nbt.value.StoredEnchantments.value.value;
      
      for (const ench of enchantments) {
        const enchId = ench.id ? ench.id.value : '';
        if (enchId.includes(enchantmentName)) {
          return true;
        }
      }
    }
    
    return false;
    
  } catch (e) {
    console.log('❌ خطأ في فحص التطويرات:', e.message);
    return false;
  }
}

function foundMending(trade, villager) {
  console.log('🎉🎉🎉 تم العثور على تطويرة المندنق! 🎉🎉🎉');
  
  systemStatus.mendingFound = true;
  systemStatus.searchingForMending = false;
  systemStatus.foundMendingTrade = {
    villagerPosition: villager.position.toString(),
    attempts: systemStatus.attempts,
    foundAt: new Date().toLocaleString()
  };
  
  // إيقاف البحث
  stopMendingSearch();
  
  // إعلان النجاح
  if (bot) {
    bot.chat('🎉 تم العثور على تطويرة المندنق!');
    bot.chat(`📍 موقع القروي: ${villager.position.toString()}`);
    bot.chat(`🔄 بعد ${systemStatus.attempts} محاولة`);
  }
  
  console.log(`📍 موقع القروي: ${villager.position.toString()}`);
  console.log(`🔄 عدد المحاولات: ${systemStatus.attempts}`);
  console.log(`👥 قرويين تم فحصهم: ${systemStatus.totalVillagersChecked}`);
  
  systemStatus.lastActivity = 'mending_found';
  systemStatus.botStatus = 'mending_found';
}

function stopMendingSearch() {
  console.log('⏹️ إيقاف البحث عن المندنق');
  
  systemStatus.searchingForMending = false;
  
  if (searchInterval) {
    clearInterval(searchInterval);
    searchInterval = null;
  }
  
  systemStatus.lastActivity = 'search_stopped';
}

function resetSearch() {
  console.log('🔄 إعادة تعيين البحث');
  
  stopMendingSearch();
  
  systemStatus.mendingFound = false;
  systemStatus.attempts = 0;
  systemStatus.totalVillagersChecked = 0;
  systemStatus.foundMendingTrade = null;
  systemStatus.currentVillager = null;
  systemStatus.botStatus = 'active';
  
  if (bot) {
    bot.chat('🔄 تم إعادة تعيين البحث');
  }
}

// تنظيف عند إغلاق البرنامج
process.on('SIGINT', () => {
  console.log('🛑 إغلاق البوت...');
  
  if (searchInterval) clearInterval(searchInterval);
  if (antiIdleInterval) clearInterval(antiIdleInterval);
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  
  if (bot) {
    bot.chat('👋 إلى اللقاء!');
    setTimeout(() => process.exit(0), 1000);
  } else {
    process.exit(0);
  }
});

// بدء البوت
console.log('🚀 بدء بوت البحث عن المندنق...');
console.log(`👤 اسم البوت: ${BOT_CONFIG.username}`);
console.log(`🎯 البحث في نطاق: ${BOT_CONFIG.searchRadius} بلوك`);
console.log(`🔄 حد المحاولات: ${BOT_CONFIG.maxAttempts}`);
createBot();
