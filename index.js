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
    console.log('📚 TRYING DIFFERENT METHOD...');
    status.lastAction = 'placing_lectern';
    
    const lecternItem = bot.inventory.items().find(item => item.name === 'lectern');
    if (!lecternItem) {
      console.log('❌ No lectern in inventory!');
      return false;
    }
    
    console.log(`🎯 Villager at: ${posString(villager.position)}`);
    
    // Move closer to villager first
    const distance = bot.entity.position.distanceTo(villager.position);
    if (distance > 3) {
      console.log('🚶 Moving closer to villager...');
      try {
        await bot.pathfinder.goto(new bot.pathfinder.goals.GoalNear(villager.position.x, villager.position.y, villager.position.z, 2));
        console.log('✅ Moved closer');
      } catch (e) {
        console.log('❌ Could not move closer');
      }
    }
    
    await bot.equip(lecternItem, 'hand');
    await sleep(1000);
    console.log('✅ Lectern equipped');
    
    // Simple approach: Find any block to place on
    const villagerPos = villager.position;
    const attempts = [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
      { x: 2, y: 0, z: 0 },
      { x: -2, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
      { x: 0, y: 0, z: -2 }
    ];
    
    for (const attempt of attempts) {
      const targetX = Math.floor(villagerPos.x + attempt.x);
      const targetY = Math.floor(villagerPos.y + attempt.y);
      const targetZ = Math.floor(villagerPos.z + attempt.z);
      
      console.log(`🔍 Checking position: ${targetX}, ${targetY}, ${targetZ}`);
      
      // Check the block below target position
      const blockBelow = bot.blockAt(new bot.vec3.Vec3(targetX, targetY - 1, targetZ));
      const blockAt = bot.blockAt(new bot.vec3.Vec3(targetX, targetY, targetZ));
      
      console.log(`  - Block below: ${blockBelow ? blockBelow.name : 'null'}`);
      console.log(`  - Block at: ${blockAt ? blockAt.name : 'null'}`);
      
      if (blockBelow && 
          blockBelow.name !== 'air' && 
          blockAt && 
          blockAt.name === 'air') {
        
        console.log(`✅ GOOD SPOT! Trying to place lectern...`);
        
        try {
          // Method 1: Basic placement
          await bot.placeBlock(blockBelow, new bot.vec3.Vec3(targetX, targetY, targetZ));
          await sleep(2000);
          
          // Check if it worked
          const placedBlock = bot.blockAt(new bot.vec3.Vec3(targetX, targetY, targetZ));
          console.log(`  - After placement: ${placedBlock ? placedBlock.name : 'null'}`);
          
          if (placedBlock && placedBlock.name === 'lectern') {
            myLectern = placedBlock;
            status.lecternPos = `${targetX}, ${targetY}, ${targetZ}`;
            console.log(`🎉 LECTERN PLACED! At: ${status.lecternPos}`);
            return true;
          } else {
            console.log(`❌ Placement failed - got: ${placedBlock ? placedBlock.name : 'nothing'}`);
          }
          
        } catch (error1) {
          console.log(`❌ Method 1 failed: ${error1.message}`);
          
          // Method 2: Try different approach
          try {
            console.log('🔄 Trying method 2...');
            
            const referenceBlock = blockBelow;
            const faceVector = new bot.vec3.Vec3(0, 1, 0);
            
            await bot.placeBlock(referenceBlock, faceVector);
            await sleep(2000);
            
            const placedBlock2 = bot.blockAt(new bot.vec3.Vec3(targetX, targetY, targetZ));
            if (placedBlock2 && placedBlock2.name === 'lectern') {
              myLectern = placedBlock2;
              status.lecternPos = `${targetX}, ${targetY}, ${targetZ}`;
              console.log(`🎉 LECTERN PLACED WITH METHOD 2! At: ${status.lecternPos}`);
              return true;
            }
            
          } catch (error2) {
            console.log(`❌ Method 2 also failed: ${error2.message}`);
            continue;
          }
        }
      } else {
        console.log(`❌ Bad position - no solid ground or space occupied`);
      }
    }
    
    console.log('❌ ALL PLACEMENT ATTEMPTS FAILED!');
    
    // Last resort: just find ANY lectern nearby and use it
    console.log('🔍 Looking for existing lectern to use...');
    const existingLectern = bot.findBlock({
      matching: 'lectern',
      maxDistance: 15
    });
    
    if (existingLectern) {
      console.log(`✅ Found existing lectern at ${posString(existingLectern.position)}`);
      myLectern = existingLectern;
      status.lecternPos = posString(existingLectern.position);
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.log('❌ MAJOR ERROR:', error.message);
    console.log('❌ ERROR STACK:', error.stack);
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
