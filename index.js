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
    console.log('📚 Placing lectern SUPER SIMPLE...');
    status.lastAction = 'placing_lectern';
    
    const lecternItem = bot.inventory.items().find(item => item.name === 'lectern');
    if (!lecternItem) {
      console.log('❌ No lectern in inventory!');
      return false;
    }
    
    await bot.equip(lecternItem, 'hand');
    await sleep(500);
    
    // Find ANY solid block around villager
    const villagerPos = villager.position;
    
    console.log('🔍 Looking for ANY solid ground...');
    
    // Search in a 5x5 area around villager
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        for (let y = -1; y <= 1; y++) {
          if (x === 0 && z === 0 && y === 0) continue; // Skip villager position
          
          const checkPos = villagerPos.offset(x, y, z);
          const block = bot.blockAt(checkPos);
          
          // Is this a solid block we can place on?
          if (block && block.name !== 'air') {
            console.log(`🎯 Found solid block: ${block.name} at ${posString(checkPos)}`);
            
            // Try to place lectern ON TOP of this block
            const targetPos = checkPos.offset(0, 1, 0);
            const spaceAbove = bot.blockAt(targetPos);
            
            if (spaceAbove && spaceAbove.name === 'air') {
              console.log(`✅ Trying to place lectern at ${posString(targetPos)}`);
              
              try {
                // SIMPLEST WAY: Use referenceBlock and let mineflayer handle it
                await bot.placeBlock(block, targetPos);
                
                await sleep(1000);
                
                // Check if lectern was placed
                const placedBlock = bot.blockAt(targetPos);
                if (placedBlock && placedBlock.name === 'lectern') {
                  myLectern = placedBlock;
                  status.lecternPos = posString(targetPos);
                  console.log(`✅ SUCCESS! Lectern placed at ${status.lecternPos}`);
                  return true;
                }
                
              } catch (err) {
                console.log(`❌ Failed: ${err.message}`);
                continue;
              }
            }
          }
        }
      }
    }
    
    console.log('❌ No place found for lectern');
    return false;
    
  } catch (error) {
    console.log('❌ Place lectern error:', error.message);
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
    console.log('🔄 Resetting villager by breaking lectern...');
    status.lastAction = 'resetting_villager';
    
    if (!myLectern) {
      console.log('❌ No lectern reference! Searching for nearby lectern...');
      
      // Find any lectern near the villager
      myLectern = bot.findBlock({
        matching: 'lectern',
        maxDistance: 15,
        point: targetVillager.position
      });
      
      if (!myLectern) {
        console.log('❌ No lectern found anywhere!');
        return false;
      }
      
      console.log(`🔍 Found lectern at ${posString(myLectern.position)}`);
    }
    
    // Break the lectern
    console.log('🔨 Breaking lectern...');
    try {
      await bot.dig(myLectern);
      console.log('✅ Lectern broken!');
    } catch (breakError) {
      console.log('❌ Failed to break lectern:', breakError.message);
      
      // Try to find the lectern again
      myLectern = bot.findBlock({
        matching: 'lectern',
        maxDistance: 15
      });
      
      if (myLectern) {
        console.log('🔄 Retrying lectern break...');
        await bot.dig(myLectern);
        console.log('✅ Lectern broken on retry!');
      } else {
        console.log('❌ Cannot find lectern to break!');
        return false;
      }
    }
    
    // Wait for villager to lose job
    await sleep(CONFIG.resetDelay);
    
    // Place lectern back PROPERLY
    console.log('📚 Placing lectern back...');
    const lecternItem = bot.inventory.items().find(item => item.name === 'lectern');
    
    if (!lecternItem) {
      console.log('❌ No lectern to place back!');
      bot.chat('❌ Need more lecterns!');
      return false;
    }
    
    try {
      await bot.equip(lecternItem, 'hand');
      const blockBelow = bot.blockAt(myLectern.position.offset(0, -1, 0));
      
      // Make sure we have solid ground
      if (blockBelow && blockBelow.name !== 'air' && blockBelow.boundingBox === 'block') {
        // Place ON TOP of the solid block using face vector
        await bot.placeBlock(blockBelow, new bot.vec3.Vec3(0, 1, 0));
        await sleep(500);
        
        myLectern = bot.blockAt(myLectern.position);
        console.log('✅ Lectern placed back correctly!');
        return true;
      } else {
        console.log('❌ No solid floor to place lectern back!');
        
        // Try to place it in a new location
        console.log('🔄 Trying new location for lectern...');
        const newPlacement = await placeLecternNearVillager(targetVillager);
        return newPlacement;
      }
    } catch (placeError) {
      console.log('❌ Failed to place lectern back:', placeError.message);
      
      // Try alternative placement
      console.log('🔄 Trying alternative placement...');
      const newPlacement = await placeLecternNearVillager(targetVillager);
      return newPlacement;
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
