const mineflayer = require('mineflayer');
const express = require('express');
const app = express();

// إعدادات البوت الذكي
const CONFIG = {
  username: 'SmartMendingBot',
  host: 'og_players11-G2lV.aternos.me',
  port: 41642,
  version: '1.21.1'
};

let bot = null;
let isSearching = false;
let mendingFound = false;
let currentAttempt = 0;
let targetVillager = null;
let targetLectern = null;

const status = {
  state: 'offline',
  attempts: 0,
  villagersFound: 0,
  lastAction: 'none',
  mendingLocation: null,
  errors: []
};

// Web interface للمراقبة
app.get('/', (req, res) => {
  res.json({
    botStatus: status.state,
    isSearching: isSearching,
    mendingFound: mendingFound,
    attempts: status.attempts,
    villagersFound: status.villagersFound,
    lastAction: status.lastAction,
    mendingLocation: status.mendingLocation,
    errors: status.errors.slice(-5),
    uptime: process.uptime()
  });
});

app.get('/start', (req, res) => {
  if (!mendingFound) {
    startSmartSearch();
    res.json({ message: 'Smart search started!' });
  } else {
    res.json({ message: 'Mending already found!', location: status.mendingLocation });
  }
});

app.get('/stop', (req, res) => {
  stopSearch();
  res.json({ message: 'Search stopped' });
});

app.listen(3000, () => console.log('🌐 Smart Bot running on port 3000'));

function createBot() {
  console.log('🤖 Creating SMART Mending Bot...');
  
  bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    version: CONFIG.version,
    auth: 'offline'
  });

  bot.on('login', () => {
    console.log('✅ Smart bot logged in!');
    status.state = 'online';
  });

  bot.on('spawn', () => {
    console.log('🎯 Smart bot spawned and ready!');
    status.state = 'ready';
    
    setTimeout(() => {
      bot.chat('🧠 Smart Mending Bot online!');
      bot.chat('💬 Say "start" to begin smart search');
      bot.chat('💬 Say "stop" to stop search');
    }, 2000);
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    
    const msg = message.toLowerCase();
    console.log(`💬 ${username}: ${message}`);
    
    if (msg.includes('start') && !mendingFound) {
      bot.chat('🧠 Starting SMART mending search...');
      startSmartSearch();
    }
    
    if (msg.includes('stop')) {
      bot.chat('⏹️ Stopping search');
      stopSearch();
    }
    
    if (msg.includes('status')) {
      if (mendingFound) {
        bot.chat(`✅ MENDING FOUND! Location: ${status.mendingLocation}`);
      } else if (isSearching) {
        bot.chat(`🔍 Searching... Attempt: ${status.attempts}`);
      } else {
        bot.chat('💤 Ready to search - say "start"');
      }
    }
  });

  bot.on('error', (err) => {
    console.log('❌ Bot error:', err.message);
    status.errors.push(`${new Date().toLocaleTimeString()}: ${err.message}`);
  });

  bot.on('end', () => {
    console.log('🔌 Bot disconnected');
    status.state = 'offline';
  });
}

async function startSmartSearch() {
  if (isSearching || mendingFound) return;
  
  isSearching = true;
  status.state = 'searching';
  status.lastAction = 'search_started';
  
  console.log('🧠 SMART SEARCH ACTIVATED');
  
  try {
    await smartMendingLoop();
  } catch (error) {
    console.log('❌ Search error:', error.message);
    bot.chat(`❌ Error: ${error.message}`);
    stopSearch();
  }
}

async function smartMendingLoop() {
  while (isSearching && !mendingFound) {
    currentAttempt++;
    status.attempts = currentAttempt;
    
    console.log(`\n🎯 === ATTEMPT ${currentAttempt} ===`);
    status.lastAction = `attempt_${currentAttempt}`;
    
    // Step 1: Find villager
    const villager = await findBestVillager();
    if (!villager) {
      console.log('❌ No villagers found!');
      bot.chat('❌ No villagers nearby! Move closer to village');
      await sleep(5000);
      continue;
    }
    
    targetVillager = villager;
    console.log(`👤 Found villager at ${posToString(villager.position)}`);
    status.lastAction = 'villager_found';
    
    // Step 2: Handle lectern
    const success = await handleLecternCycle(villager);
    if (!success) {
      console.log('⚠️ Lectern handling failed, trying next villager');
      await sleep(2000);
      continue;
    }
    
    // Step 3: Check trades
    const foundMending = await checkForMending(villager);
    if (foundMending) {
      console.log('🎉 MENDING FOUND! STOPPING SEARCH!');
      bot.chat('🎉 MENDING FOUND! SEARCH COMPLETE!');
      bot.chat(`📍 Location: ${posToString(villager.position)}`);
      
      mendingFound = true;
      status.mendingLocation = posToString(villager.position);
      status.state = 'mending_found';
      stopSearch();
      return;
    }
    
    console.log('❌ No mending this time, continuing...');
    status.lastAction = 'no_mending_continue';
    
    // Anti-spam delay
    await sleep(3000);
    
    if (currentAttempt % 10 === 0) {
      bot.chat(`🔍 Still searching... Attempt ${currentAttempt}`);
    }
  }
}

async function findBestVillager() {
  console.log('🔍 Scanning for villagers...');
  
  const villagers = Object.values(bot.entities).filter(entity => {
    return entity.name === 'villager' && 
           entity.position && 
           bot.entity.position.distanceTo(entity.position) <= 20;
  });
  
  status.villagersFound = villagers.length;
  console.log(`👥 Found ${villagers.length} villagers in range`);
  
  if (villagers.length === 0) return null;
  
  // Prefer librarians, then unemployed, then any
  let target = villagers.find(v => v.profession === 'librarian');
  if (!target) target = villagers.find(v => !v.profession || v.profession === 'none');
  if (!target) target = villagers[0];
  
  return target;
}

async function handleLecternCycle(villager) {
  console.log('📚 Starting lectern cycle...');
  
  try {
    // Find existing lectern near villager
    let lectern = bot.findBlock({
      matching: 'lectern',
      maxDistance: 8,
      point: villager.position
    });
    
    if (lectern) {
      console.log('🔨 Breaking existing lectern...');
      status.lastAction = 'breaking_lectern';
      
      try {
        await bot.dig(lectern);
        console.log('✅ Lectern broken!');
      } catch (err) {
        console.log('❌ Failed to break lectern:', err.message);
        return false;
      }
      
      // Wait for villager to lose profession
      await sleep(2000);
      console.log('⏳ Waiting for villager reset...');
    }
    
    // Place lectern back
    console.log('📚 Placing lectern...');
    status.lastAction = 'placing_lectern';
    
    const success = await placeLecternNearVillager(villager);
    if (!success) {
      console.log('❌ Failed to place lectern');
      return false;
    }
    
    // Wait for villager to become librarian
    await sleep(3000);
    console.log('⏳ Waiting for villager to become librarian...');
    
    return true;
    
  } catch (error) {
    console.log('❌ Lectern cycle error:', error.message);
    return false;
  }
}

async function placeLecternNearVillager(villager) {
  // Check if we have lectern in inventory
  const lecternItem = bot.inventory.items().find(item => item.name === 'lectern');
  
  if (!lecternItem) {
    console.log('❌ No lectern in inventory!');
    bot.chat('❌ Need lectern in inventory!');
    return false;
  }
  
  try {
    await bot.equip(lecternItem, 'hand');
    
    // Find good spot near villager
    const villagerPos = villager.position;
    const positions = [
      villagerPos.offset(1, 0, 0),
      villagerPos.offset(-1, 0, 0),
      villagerPos.offset(0, 0, 1),
      villagerPos.offset(0, 0, -1),
      villagerPos.offset(1, 1, 0),
      villagerPos.offset(-1, 1, 0)
    ];
    
    for (const pos of positions) {
      try {
        const blockBelow = bot.blockAt(pos.offset(0, -1, 0));
        const blockAt = bot.blockAt(pos);
        
        if (blockBelow && blockBelow.name !== 'air' && 
            blockAt && blockAt.name === 'air') {
          
          await bot.placeBlock(blockBelow, pos);
          console.log(`✅ Placed lectern at ${posToString(pos)}`);
          return true;
        }
      } catch (err) {
        // Try next position
        continue;
      }
    }
    
    console.log('❌ Could not find suitable place for lectern');
    return false;
    
  } catch (error) {
    console.log('❌ Place lectern error:', error.message);
    return false;
  }
}

async function checkForMending(villager) {
  console.log('🔍 Checking villager trades for mending...');
  status.lastAction = 'checking_trades';
  
  try {
    // Move closer to villager if needed
    const distance = bot.entity.position.distanceTo(villager.position);
    if (distance > 3) {
      console.log('🚶 Moving closer to villager...');
      await bot.pathfinder.goto(new bot.pathfinder.goals.GoalNear(villager.position.x, villager.position.y, villager.position.z, 2));
    }
    
    // Open trade window
    const window = await bot.openVillager(villager);
    if (!window) {
      console.log('❌ Could not open trade window');
      return false;
    }
    
    console.log(`💰 Opened trade window, checking ${window.trades ? window.trades.length : 0} trades...`);
    
    if (!window.trades || window.trades.length === 0) {
      console.log('❌ No trades available');
      bot.closeWindow(window);
      return false;
    }
    
    // Check each trade for mending book
    for (let i = 0; i < window.trades.length; i++) {
      const trade = window.trades[i];
      
      if (!trade.outputItem) continue;
      
      console.log(`📖 Checking trade ${i + 1}: ${trade.outputItem.name}`);
      
      if (trade.outputItem.name === 'enchanted_book') {
        const hasMending = checkItemForMending(trade.outputItem);
        if (hasMending) {
          console.log('🎉 FOUND MENDING BOOK!');
          bot.closeWindow(window);
          return true;
        }
      }
    }
    
    console.log('❌ No mending found in trades');
    bot.closeWindow(window);
    return false;
    
  } catch (error) {
    console.log('❌ Trade check error:', error.message);
    return false;
  }
}

function checkItemForMending(item) {
  if (!item || !item.nbt) return false;
  
  try {
    const nbt = item.nbt;
    
    // Check for stored enchantments
    if (nbt.value && nbt.value.StoredEnchantments) {
      const enchantments = nbt.value.StoredEnchantments.value.value;
      
      for (const ench of enchantments) {
        const enchId = ench.id ? ench.id.value : '';
        if (enchId.includes('mending')) {
          console.log('✅ Found mending enchantment!');
          return true;
        }
      }
    }
    
    return false;
  } catch (error) {
    console.log('❌ NBT check error:', error.message);
    return false;
  }
}

function stopSearch() {
  console.log('⏹️ Stopping search');
  isSearching = false;
  status.state = mendingFound ? 'mending_found' : 'ready';
  status.lastAction = 'search_stopped';
}

function posToString(pos) {
  return `${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Anti-idle system
setInterval(() => {
  if (bot && bot.entity && status.state === 'ready') {
    // Small random look movement
    const yaw = bot.entity.yaw + (Math.random() - 0.5) * 0.3;
    bot.look(yaw, bot.entity.pitch);
  }
}, 30000);

// Startup
console.log('🚀 Starting SMART Mending Bot...');
console.log('🧠 This bot is much smarter and more efficient!');
console.log('🎯 Features:');
console.log('  • Smart villager detection');
console.log('  • Efficient lectern cycling');
console.log('  • Accurate mending detection');
console.log('  • Auto-stop when found');
console.log('  • Better error handling');

createBot();
