const mineflayer = require('mineflayer');
const express = require('express');
const app = express();

// إعدادات البوت المبسط
const CONFIG = {
  username: 'MendingHunter',
  host: 'og_players11-G2lV.aternos.me',
  port: 41642,
  version: '1.21.1',
  
  // إعدادات البحث
  villagerRange: 10,        // نطاق البحث عن القرويين
  resetDelay: 3000,         // تأخير بعد كسر ووضع lectern
  checkDelay: 2000          // تأخير قبل فحص التداول
};

let bot = null;
let isSearching = false;
let mendingFound = false;
let attempts = 0;
let myLectern = null;
let targetVillager = null;

const status = {
  state: 'offline',
  attempts: 0,
  hasLectern: false,
  villagerPos: null,
  lecternPos: null,
  lastAction: 'none'
};

// Web interface
app.get('/', (req, res) => {
  res.json({
    status: status.state,
    searching: isSearching,
    found: mendingFound,
    attempts: status.attempts,
    hasLectern: status.hasLectern,
    villagerPos: status.villagerPos,
    lecternPos: status.lecternPos,
    lastAction: status.lastAction
  });
});

app.listen(3000, () => console.log('🌐 Simple Mending Bot on port 3000'));

function createBot() {
  console.log('🤖 Creating Simple Mending Bot...');
  
  bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    version: CONFIG.version,
    auth: 'offline'
  });

  bot.on('login', () => {
    console.log('✅ Bot connected!');
    status.state = 'online';
  });

  bot.on('spawn', () => {
    console.log('🎯 Bot ready!');
    status.state = 'ready';
    
    // رسالة واحدة فقط عند البدء
    setTimeout(() => {
      bot.chat('🔍 Mending Hunter ready. Say "hunt" to start.');
      checkInventory();
    }, 2000);
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    
    const msg = message.toLowerCase();
    
    if (msg.includes('hunt') || msg.includes('start') || msg.includes('go')) {
      if (!checkInventory()) {
        bot.chat('❌ Need 1 lectern!');
        return;
      }
      
      if (!mendingFound) {
        bot.chat('🔍 Hunting...');
        startSimpleHunt();
      } else {
        bot.chat('✅ Already found!');
      }
    }
    
    if (msg.includes('stop')) {
      stopHunt();
    }
    
    if (msg.includes('check') || msg.includes('inv')) {
      checkInventory();
    }
    
    if (msg.includes('status')) {
      if (mendingFound) {
        bot.chat('🎉 MENDING FOUND!');
      } else if (isSearching) {
        bot.chat(`🔍 Attempt: ${attempts}`);
      } else {
        bot.chat('💤 Ready');
      }
    }
  });

  bot.on('error', (err) => {
    console.log('❌ Error:', err.message);
  });
}

function checkInventory() {
  const lecternItem = bot.inventory.items().find(item => item.name === 'lectern');
  status.hasLectern = !!lecternItem;
  
  if (lecternItem) {
    console.log(`📚 Lecterns in inventory: ${lecternItem.count}`);
    return true;
  } else {
    bot.chat('❌ No lectern!');
    console.log('❌ No lectern found in inventory');
    return false;
  }
}

async function startSimpleHunt() {
  if (isSearching || mendingFound) return;
  
  if (!checkInventory()) {
    return;
  }
  
  isSearching = true;
  attempts = 0;
  status.state = 'hunting';
  
  console.log('🔍 SIMPLE MENDING HUNT STARTED!');
  
  try {
    await simpleHuntLoop();
  } catch (error) {
    console.log('❌ Hunt error:', error.message);
    bot.chat(`❌ Error: ${error.message}`);
    stopHunt();
  }
}

async function simpleHuntLoop() {
  // Find a villager first
  const villager = await findVillager();
  if (!villager) {
    bot.chat('❌ No villagers!');
    stopHunt();
    return;
  }
  
  targetVillager = villager;
  status.villagerPos = posString(villager.position);
  console.log(`👤 Found villager at ${status.villagerPos}`);
  
  // Move closer to villager first
  const distance = bot.entity.position.distanceTo(villager.position);
  if (distance > 5) {
    console.log('🚶 Moving closer to villager...');
    try {
      const goal = new bot.pathfinder.goals.GoalNear(villager.position.x, villager.position.y, villager.position.z, 3);
      await bot.pathfinder.goto(goal);
      console.log('✅ Moved closer to villager');
    } catch (e) {
      console.log('❌ Could not move to villager, trying from current position');
    }
  }
  
  // Place lectern near villager
  const lecternPlaced = await placeLecternNearVillager(villager);
  if (!lecternPlaced) {
    bot.chat('❌ Cannot place lectern!');
    console.log('❌ All lectern placement strategies failed!');
    
    // Last resort: look for existing lectern in area
    const existingLectern = bot.findBlock({
      matching: 'lectern',
      maxDistance: 20
    });
    
    if (existingLectern) {
      console.log('🔄 Using existing lectern for hunt...');
      myLectern = existingLectern;
      status.lecternPos = posString(existingLectern.position);
    } else {
      stopHunt();
      return;
    }
  }
  
  // Start the hunt loop
  while (isSearching && !mendingFound) {
    attempts++;
    status.attempts = attempts;
    
    console.log(`\n🎯 ATTEMPT ${attempts}`);
    status.lastAction = `attempt_${attempts}`;
    
    // Wait for villager to get job
    await sleep(CONFIG.checkDelay);
    
    // Check if villager has mending
    const hasMending = await checkVillagerForMending(targetVillager);
    if (hasMending) {
      // FOUND MENDING!
      console.log('🎉🎉🎉 MENDING FOUND! 🎉🎉🎉');
      bot.chat('🎉 MENDING FOUND!');
      bot.chat(`📍 ${status.villagerPos} (${attempts} attempts)`);
      
      mendingFound = true;
      status.state = 'mending_found';
      stopHunt();
      return;
    }
    
    // No mending, reset villager
    console.log('❌ No mending, resetting villager...');
    const resetSuccess = await resetVillagerWithLectern();
    if (!resetSuccess) {
      bot.chat('❌ Reset failed!');
      break;
    }
    
    // Progress report every 50 attempts only
    if (attempts % 50 === 0) {
      bot.chat(`🔍 ${attempts} attempts...`);
    }
    
    await sleep(1000); // Small delay between attempts
  }
}

async function findVillager() {
  const villagers = Object.values(bot.entities).filter(entity => {
    return entity.name === 'villager' && 
           entity.position && 
           bot.entity.position.distanceTo(entity.position) <= CONFIG.villagerRange;
  });
  
  console.log(`👥 Found ${villagers.length} villagers in range`);
  
  if (villagers.length === 0) return null;
  
  // Get closest villager
  return villagers.reduce((closest, villager) => {
    const distA = bot.entity.position.distanceTo(closest.position);
    const distB = bot.entity.position.distanceTo(villager.position);
    return distB < distA ? villager : closest;
  });
}

async function placeLecternNearVillager(villager) {
  try {
    console.log('📚 Placing lectern - ULTRA SIMPLE METHOD...');
    status.lastAction = 'placing_lectern';
    
    const lecternItem = bot.inventory.items().find(item => item.name === 'lectern');
    if (!lecternItem) {
      console.log('❌ No lectern in inventory!');
      return false;
    }
    
    await bot.equip(lecternItem, 'hand');
    await sleep(500);
    
    const villagerPos = villager.position;
    console.log(`👤 Villager at: ${posString(villagerPos)}`);
    
    // Simple positions to try around villager
    const tryPositions = [
      { x: 1, z: 0 },   // East
      { x: -1, z: 0 },  // West  
      { x: 0, z: 1 },   // South
      { x: 0, z: -1 },  // North
      { x: 2, z: 0 },   // Far East
      { x: -2, z: 0 },  // Far West
      { x: 0, z: 2 },   // Far South
      { x: 0, z: -2 }   // Far North
    ];
    
    for (const offset of tryPositions) {
      const targetX = Math.floor(villagerPos.x) + offset.x;
      const targetY = Math.floor(villagerPos.y);
      const targetZ = Math.floor(villagerPos.z) + offset.z;
      
      console.log(`🔍 Trying position: ${targetX}, ${targetY}, ${targetZ}`);
      
      // Find the ground block
      const groundBlock = bot.blockAt(new bot.vec3.Vec3(targetX, targetY - 1, targetZ));
      const airBlock = bot.blockAt(new bot.vec3.Vec3(targetX, targetY, targetZ));
      
      if (groundBlock && groundBlock.name !== 'air' && 
          airBlock && airBlock.name === 'air') {
        
        console.log(`✅ Good spot! Ground: ${groundBlock.name}`);
        
        try {
          // SUPER SIMPLE: Use the mineflayer built-in method
          const vec3 = bot.vec3;
          await bot.placeBlock(groundBlock, vec3(0, 1, 0));
          
          await sleep(1000);
          
          // Check if lectern was placed
          const lecternBlock = bot.blockAt(new bot.vec3.Vec3(targetX, targetY, targetZ));
          if (lecternBlock && lecternBlock.name === 'lectern') {
            myLectern = lecternBlock;
            status.lecternPos = `${targetX}, ${targetY}, ${targetZ}`;
            console.log(`🎉 SUCCESS! Lectern placed at ${status.lecternPos}`);
            return true;
          } else {
            console.log(`❌ Placement failed - found: ${lecternBlock ? lecternBlock.name : 'nothing'}`);
          }
          
        } catch (err) {
          console.log(`❌ Error placing at ${targetX}, ${targetY}, ${targetZ}: ${err.message}`);
          continue;
        }
      } else {
        console.log(`❌ Bad spot - Ground: ${groundBlock ? groundBlock.name : 'null'}, Air: ${airBlock ? airBlock.name : 'null'}`);
      }
    }
    
    console.log('❌ ALL POSITIONS FAILED!');
    return false;
    
  } catch (error) {
    console.log('❌ Major error:', error.message);
    return false;
  }
}

// Remove the complex functions and keep it SUPER SIMPLE
async function tryPlaceLectern(position) {
  // This function is now unused - we use the simple method above
  return false;
}

async function forcePlaceLectern(position) {
  // This function is now unused - we use the simple method above  
  return false;
}

async function checkVillagerForMending(villager) {
  try {
    console.log('🔍 Checking villager for mending...');
    status.lastAction = 'checking_trades';
    
    // Move closer to villager
    const distance = bot.entity.position.distanceTo(villager.position);
    if (distance > 4) {
      const goal = new bot.pathfinder.goals.GoalNear(villager.position.x, villager.position.y, villager.position.z, 2);
      await bot.pathfinder.goto(goal);
    }
    
    // Open trade window
    const window = await bot.openVillager(villager);
    if (!window || !window.trades) {
      console.log('❌ No trades available');
      if (window) bot.closeWindow(window);
      return false;
    }
    
    console.log(`💰 Checking ${window.trades.length} trades...`);
    
    // Check each trade for mending book
    for (let i = 0; i < window.trades.length; i++) {
      const trade = window.trades[i];
      if (!trade.outputItem) continue;
      
      if (trade.outputItem.name === 'enchanted_book') {
        console.log(`📖 Found enchanted book in trade ${i + 1}`);
        
        const isMending = checkForMending(trade.outputItem);
        if (isMending) {
          bot.closeWindow(window);
          return true; // MENDING FOUND!
        }
      }
    }
    
    console.log('❌ No mending in this villager');
    bot.closeWindow(window);
    return false;
    
  } catch (error) {
    console.log('❌ Check trades error:', error.message);
    return false;
  }
}

async function resetVillagerWithLectern() {
  try {
    console.log('🔄 SIMPLE reset - breaking and placing lectern...');
    status.lastAction = 'resetting_villager';
    
    if (!myLectern) {
      console.log('🔍 No lectern reference, searching...');
      myLectern = bot.findBlock({
        matching: 'lectern',
        maxDistance: 10
      });
      
      if (!myLectern) {
        console.log('❌ No lectern found anywhere!');
        return false;
      }
    }
    
    const lecternPos = myLectern.position;
    console.log(`🔨 Breaking lectern at: ${posString(lecternPos)}`);
    
    // Break the lectern
    try {
      await bot.dig(myLectern);
      console.log('✅ Lectern broken!');
    } catch (breakError) {
      console.log('❌ Failed to break lectern:', breakError.message);
      return false;
    }
    
    // Wait for villager to lose job
    await sleep(CONFIG.resetDelay);
    
    // Place it back SIMPLY
    console.log('📚 Placing lectern back...');
    const lecternItem = bot.inventory.items().find(item => item.name === 'lectern');
    
    if (!lecternItem) {
      console.log('❌ No lectern to place back!');
      return false;
    }
    
    await bot.equip(lecternItem, 'hand');
    await sleep(500);
    
    // Get the ground block below where lectern was
    const groundBlock = bot.blockAt(lecternPos.offset(0, -1, 0));
    
    if (groundBlock && groundBlock.name !== 'air') {
      console.log(`📚 Placing lectern back on: ${groundBlock.name}`);
      
      try {
        const vec3 = bot.vec3;
        await bot.placeBlock(groundBlock, vec3(0, 1, 0));
        
        await sleep(1000);
        
        // Check if lectern was placed back
        const newLectern = bot.blockAt(lecternPos);
        if (newLectern && newLectern.name === 'lectern') {
          myLectern = newLectern;
          console.log('✅ Lectern placed back successfully!');
          return true;
        } else {
          console.log('❌ Failed to place lectern back');
          return false;
        }
        
      } catch (placeError) {
        console.log('❌ Error placing lectern back:', placeError.message);
        return false;
      }
    } else {
      console.log('❌ No ground to place lectern back on!');
      return false;
    }
    
  } catch (error) {
    console.log('❌ Reset error:', error.message);
    return false;
  }
}

function checkForMending(item) {
  if (!item || !item.nbt) return false;
  
  try {
    const nbt = item.nbt;
    
    if (nbt.value && nbt.value.StoredEnchantments) {
      const enchantments = nbt.value.StoredEnchantments.value.value;
      
      for (const ench of enchantments) {
        const enchId = ench.id ? ench.id.value : '';
        if (enchId.includes('mending')) {
          console.log('🎉 MENDING ENCHANTMENT FOUND!');
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

function stopHunt() {
  console.log('⏹️ Stopping hunt');
  isSearching = false;
  status.state = mendingFound ? 'mending_found' : 'ready';
  status.lastAction = 'hunt_stopped';
}

function posString(pos) {
  return `${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Anti-idle
setInterval(() => {
  if (bot && bot.entity && !isSearching) {
    const yaw = bot.entity.yaw + (Math.random() - 0.5) * 0.1;
    bot.look(yaw, bot.entity.pitch);
  }
}, 30000);

// Startup
console.log('🚀 SIMPLE MENDING BOT STARTING...');
console.log('📚 Uses only 1 lectern - breaks and replaces it');
console.log('🎯 No emeralds needed - just checks trades');
console.log('⚡ Super simple and efficient!');

createBot();
