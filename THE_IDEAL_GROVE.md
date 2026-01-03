# The Ideal Grove

*A Vision Document for VoxelCraft*

---

## Part I: Reality (Current State)

Before we dream, we must understand what we've built. VoxelCraft today is a solid foundation—a voxel terrain engine with smooth Surface Nets meshing, procedural generation, and real-time physics. Here's where we stand:

### What Exists Today

**World Generation**
- 11 distinct biomes with climate-based distribution (temperature, humidity, erosion)
- Procedural cave systems with biome-specific settings
- Water bodies with shoreline detection and wave simulation
- Chunk-based streaming with worker-threaded generation
- 5 world types: Default, Frozen, Lush, Chaos, Sky Islands

**Player Experience**
- First-person movement with jumping, sprinting, and flying mode
- Swimming with realistic buoyancy and drag
- 9-slot inventory with item stacking
- Basic tools: Pickaxe and Axe (craftable)
- Torch placement for lighting

**The Lumina System**
- Cyan-glowing flora scattered throughout the world
- Collectible and placeable light sources
- Special "Lumina tools" when flora is attached to crafted items
- Lumina Dash ability (teleportation to exits)
- RootHollow—a mysterious stump that charges and spawns particle swarms

**Crafting**
- 3D spatial crafting interface
- Attach items (shards, stones, sticks) to a base stick
- Dynamic damage calculation based on attachments
- Custom tool persistence

**Ambient Life**
- Fog Deer—distant silhouettes that flee when approached
- Fireflies with procedural blinking and drift
- Fractal trees with growth animation
- Biome-specific vegetation density

**Environment**
- Day/night cycle with orbiting sun and moon
- Height-based fog and atmospheric scattering
- Underwater visual effects (bubbles, vignette, color grading)
- Cave exposure compensation
- Post-processing: bloom, AO, chromatic aberration

**What's Missing**

The engine hums. The world renders. But the *game* whispers: "What am I *for*?"

There's no progression. No narrative thread. No reason to explore beyond curiosity. The Lumina system hints at magic but doesn't deliver on its promise. Creatures exist but don't *live*. The world is beautiful but lonely.

---

## Part II: The Vision (The Ideal Grove)

### The Core Fantasy

**You are the Keeper of the Grove.**

Once, this world thrummed with the light of the Lumina—a living network of bioluminescent flora that connected all ecosystems. The Grove was its heart. But something fractured the network. The light retreated. Creatures forgot their paths. Biomes fell into isolation.

You awaken in the last flickering grove, a single RootHollow pulsing faintly beside you. Your purpose emerges not from text boxes, but from the world itself: *Restore the light. Reconnect the world. Become the Keeper.*

---

### The Three Pillars

#### 1. CULTIVATE (Building & Growing)

**The Lumina Network**

Forget placing blocks. You're growing a *living infrastructure*.

- **Lumina Seeds** drop from mature flora. Plant them, and they grow—but only if the conditions are right (moisture, nearby light sources, soil quality)
- **Lumina Channels** form naturally between flora within range, creating visible threads of light connecting them
- **Network Effects**: Connected flora share energy. A robust network accelerates growth, attracts creatures, and unlocks new flora mutations
- **RootHollows** are ancient network nodes. Reactivating one extends your network's reach dramatically and triggers a biome restoration event

**Terraforming Through Biology**

- Flora isn't decoration—it *transforms* the land
- Lumina growth increases local moisture, encouraging moss spread
- Dense networks purify corrupted terrain (a late-game mechanic)
- Certain flora types attract specific creatures, creating ecosystems you design

**Vertical Structures**

- Grow **Lumina Towers**—spiraling organic structures that serve as waypoints and network amplifiers
- Cultivate **Sky Bridges**—vine networks between floating islands
- Nurture **Deep Roots**—flora that extends into cave systems, illuminating the underground

---

#### 2. DWELL (Shelter & Woodworking)

**The Need for Home**

A world worth saving is a world worth living in. The Keeper doesn't just pass through—they *settle*. They build not monuments, but sanctuaries. Places where the network pulses strongest. Where companions rest. Where the night feels safe.

But this isn't Minecraft's block-stacking. This is *woodcraft*.

---

**The Tool Progression**

Building shelter requires the right tools, crafted in sequence:

**Stage 1: The Axe** (Already exists)
- Chops down trees, yielding the trunk as a fallen object
- Trees topple with physics, landing where gravity takes them
- Produces: Fallen Tree (a physics object you can push, roll, position)

**Stage 2: The Saw**
- *Recipe*: Stick + 3 Shards aligned on one side (like teeth)
- Creates a serrated edge tool
- *Function*: Converts Fallen Trees into Logs
- *Interaction*: Hold saw, approach fallen tree, hold action button
- Visual: Sawing animation with particle dust, satisfying audio
- Produces: 3-5 Logs per tree (depending on tree size)

**Stage 3: The Planer** (Mid-game refinement)
- *Recipe*: Stick + Shard (blade) + Stone (weight)
- *Function*: Converts rough Logs into smooth Planks
- Planks stack flatter, look cleaner, unlock advanced structures
- Produces: 2 Planks per Log

**Stage 4: The Adze** (Late-game precision)
- *Recipe*: Stick + curved Shard + binding (vine or sinew)
- *Function*: Carves notches, joints, and decorative details
- Enables interlocking construction without visible supports
- Unlocks: Carved posts, arched doorways, furniture

---

**Log Construction System**

Logs aren't blocks. They're *logs*—cylindrical, wooden, physical.

**Placement Modes**

*Vertical Posts*
- Plant a log upright into the ground
- Digs slightly into terrain for stability
- Can be placed in rows to form walls
- Height: Full log (~3 meters) or half-log (cut with saw)

*Horizontal Beams*
- Logs placed between two vertical posts
- Snap to post tops, creating frames
- Multiple beams can stack for solid walls
- Gaps between logs let light through (intentional aesthetic)

*Angled Rafters*
- Logs placed at angles for roofing
- Connect post-top to ridge beam
- Creates that satisfying A-frame silhouette

*Stacked Walls*
- Logs laid horizontally, Lincoln-log style
- Each layer rotates 90° at corners (interlocking)
- Classic cabin construction

**The Snap System**

Logs want to connect. When you hold a log near a valid attachment point:
- Ghost preview shows placement
- Green glow = valid connection
- Subtle magnetic pull guides alignment
- Connection points: Post tops, beam ends, corner notches

No grid. No blocks. Just wood finding wood.

---

**Structure Types**

**The Lean-To** (First shelter)
- 2 vertical posts + 1 horizontal beam + angled logs for roof
- Open front, basic rain protection
- Buildable in first 10 minutes with 1 tree
- *Feels like*: Survival. Scrappy. "I made it through the night."

**The Cabin** (Proper home)
- 4+ corner posts, horizontal log walls, peaked roof
- Door frame (2 posts + 1 beam, logs placed around it)
- Window gaps (simply leave space between logs)
- *Feels like*: Accomplishment. "This is mine."

**The Lodge** (Expanded living)
- Multiple rooms, varying ceiling heights
- Interior walls dividing space
- Loft construction (floor beams supporting upper level)
- *Feels like*: Permanence. "I'm staying."

**The Watchtower** (Vertical ambition)
- Stacked post-and-beam frames
- Ascending platforms
- Observation deck at top
- *Feels like*: Mastery. "I can see my whole network from here."

**The Grove Sanctuary** (Lumina integration)
- Logs woven *with* living flora
- Lumina vines growing through wall gaps
- RootHollow at the center, pulsing
- Structure *grows* as network strengthens
- *Feels like*: Harmony. "The Grove and I built this together."

---

**Living Spaces**

Shelter isn't just walls—it's *home*.

**Functional Elements**

*The Hearth*
- Stone circle + kindling (sticks) + spark (shard struck on stone)
- Provides warmth radius, cooking capability, light
- Fire crackles, embers drift, shadows dance
- Companions gather near hearths at night

*The Workbench*
- Horizontal log + support posts
- Enables advanced crafting (Planer, Adze, complex tools)
- Visual: Tools you've crafted hang on nearby posts

*The Rest Spot*
- Log frame + soft material (moss, leaves, flora fronds)
- Sleeping advances time, triggers creature activity nearby
- Companions curl up near your rest spot
- Wake to: Dawn light through log gaps, companion at door

*Storage Hollows*
- Carved into thick logs using Adze
- Visual: Items placed inside visible through carved opening
- Natural, organic storage that fits the aesthetic

*The Lumina Cradle*
- Carved log designed to hold and nurture Lumina flora
- Accelerates growth of placed flora
- Creates indoor light source
- Multiple cradles = indoor mini-network

---

**Construction Feel**

This isn't menu-driven building. It's *physical*.

**The Act of Building**
1. Chop tree (axe swings, tree groans, timber falls)
2. Saw logs (rhythmic motion, sawdust particles)
3. Carry log (player moves slower, log physics responds)
4. Place log (thunk of wood settling, dust rises)
5. Step back (see your work, feel the progress)

**Audio Design**
- Axe: Sharp crack of splitting wood
- Saw: Rhythmic rasp, pitch changing with speed
- Log placement: Deep, satisfying *thock*
- Structure completion: Subtle musical chord (the Grove approves)

**Visual Feedback**
- Fresh-cut wood is pale, darkens over time (weathering)
- Moss slowly grows on exterior logs (living material)
- Lumina vines creep toward structures connected to the network
- Snow accumulates on roofs in cold biomes
- Rain drips from roof edges

---

**Why Logs, Not Blocks**

Blocks are abstract. Logs are *trees*.

When you place a log, you remember cutting that tree. You remember dragging it across the meadow. You remember the grove where it stood.

Every wall tells a story. Every beam is a journey.

This is the Keeper's way: Not imposing order on nature, but shaping nature's gifts into shelter. The forest gave you these logs. You honor them by building well.

---

**Multiplayer Implications**

- Shared structures: Both players can add logs to the same frame
- Division of labor: One chops, one saws, one builds
- Communal lodges: Larger structures require cooperation
- Each log tracks who placed it (subtle, for ownership/history)

---

#### 3. EXPLORE (Discovery & Mystery)

**Biomes as Chapters**

Each biome isn't just scenery—it's a story waiting to be uncovered.

- **The Grove** (Tutorial Biome): Your origin. A small, struggling network teaches the basics
- **The Jungle Depths**: Ancient RootHollows overgrown and dormant. Reactivation reveals temple ruins and the first hints of what caused the fracture
- **The Frozen North**: Lumina here is crystallized, frozen mid-pulse. Thawing them requires heat sources and patience
- **The Desert Wastes**: Underground oases hold the only surviving flora. Surface restoration is the ultimate challenge
- **Sky Islands**: The original Keepers lived here. Their abandoned observatories contain knowledge—and warnings
- **The Corruption** (Late-game): A spreading darkness that consumes unconnected networks. The source of the fracture. Must be contained, then cleansed

**Emergent Lore**

No quest logs. No waypoint markers. Discovery is literal.

- **Keeper Stones**: Scattered monoliths with glowing glyphs. Touch one, and you see a vision—a memory from the last Keeper
- **Echo Flowers**: Rare flora that replay sounds from the past when approached
- **Creature Behaviors**: Watch long enough, and creatures reveal secrets. A deer that visits the same spot at dusk. Fireflies that spell patterns. A bird that only lands on restored ground

**The Underground**

Caves aren't just resource nodes—they're the world's memory.

- **Fossil Formations**: Ancient creatures preserved in stone, scannable for lore
- **Crystal Caverns**: Lumina that evolved differently underground, with unique properties
- **The Deep Root**: A single, massive root system connecting all caves. Finding its origin is a late-game revelation

---

#### 4. CONNECT (Creatures & Companions)

**The Creature Spectrum**

Creatures aren't just ambiance—they're the heartbeat of a restored world.

**Tier 1: Observers**
- *Fog Deer*: Currently flee from players. In the Ideal Grove, they observe. Help them enough, and they lead you to hidden groves
- *Fireflies*: Swarm near healthy flora. Their patterns encode messages for those who learn to read them
- *Glowmoths*: Night creatures that pollinate Lumina, accelerating growth

**Tier 2: Helpers**
- *Rootlings*: Small creatures that emerge from healthy RootHollows. They tend nearby flora when you're away
- *Terravoles*: Burrowing creatures that aerate soil, improving growth conditions
- *Lightweavers*: Spider-like entities that spin Lumina threads between distant flora

**Tier 3: Companions**
- *Grove Stag*: A majestic deer that bonds with Keepers who've restored significant territory. Rideable. Senses corruption
- *Luminox*: A fox-like creature drawn to Lumina tools. Helps locate seeds and hidden flora
- *Elder Owl*: Perches on Lumina Towers. Provides aerial vision of your network

**Tier 4: Guardians**
- *The Hollow Walker*: A massive creature that emerges from fully-charged RootHollows. Protects the network, fights corruption
- *Sky Serpent*: Patrols between Sky Islands. Can be befriended, becomes a flying mount
- *The Root Mother*: End-game revelation. The original source of all Lumina. Not a creature to tame—a being to understand

**Creature Ecosystems**

Creatures don't exist in isolation—they form food chains and symbioses.

- Fireflies attract Glowmoths, which attract Lightweaver spiders
- Terravoles dig tunnels that Rootlings use for travel
- Corrupted areas spawn shadow versions of creatures—twisted, hostile, pitiable

---

### Progression Without Levels

**The Keeper's Growth**

No XP bars. No skill trees. Growth is tangible.

**Tools Evolve**
- Your first Lumina tool glows faintly. As your network expands, *all* your Lumina tools grow brighter
- Discover new attachment materials in each biome: Frost Shards, Ember Stones, Void Fragments
- Legendary tools require components from multiple biomes—incentivizing exploration before the endgame

**Abilities Unlock Through Action**
- *Lumina Sense*: After connecting your first 50 flora, you begin seeing the network's pulse. Hidden flora becomes visible
- *Root Walk*: After restoring a RootHollow in each starter biome, you can fast-travel between them
- *Grove Blessing*: After befriending your first companion, nearby flora grows 50% faster
- *Keeper's Light*: After restoring the Deep Root, you glow faintly. Creatures no longer flee. Corruption recoils

**The World Changes**

Your network's health is reflected globally.

- At 10% restoration: Night becomes less dark
- At 25%: Creatures appear in previously barren biomes
- At 50%: Weather patterns shift—more rain, less harsh storms
- At 75%: Corrupted zones stop spreading
- At 100%: The Fracture heals. A final revelation about the previous Keeper

---

### Moment-to-Moment Magic

**First Night**
You have nothing. The sun sets. You find two sturdy trees, chop a third, drag it between them. Lean branches against it. Huddle underneath. It's not much. But when dawn comes, you're still here. You built something. It held.

**Dawn**
You wake in your cabin—logs you cut, carried, placed. Sunlight streams through the gaps in the western wall. The hearth still glows faintly. Outside, Rootlings have tended the Lumina vines creeping up your corner posts. A Luminox stretches near the door, eager to explore.

**Morning**
You need more logs for the watchtower. You've spotted a grove of tall pines on the ridge. But first—fireflies last night were strange. Patterned. You follow their remembered path to a cave entrance you'd missed. Inside: an ancient Keeper Stone. A vision shows you a mountain peak where a dormant RootHollow waits.

**Midday**
On your way to the pines, you cross the plains. Fog Deer watch from the mist—the same ones you've seen before, following your network's edge. You plant a Lumina seed. They approach, curious. One stays.

**Afternoon**
You reach the mountain. The RootHollow is frozen. You craft a Lumina tool with Ember Stone attachments and channel warmth into the root. It takes time. (Real minutes, felt like hours.) The ice cracks. The root pulses. Awakens. The mountain *blooms*.

**Dusk**
Riding your Grove Stag home, you watch as the new network connection lights up—a visible thread across the sky connecting the mountain to your cabin. The Lumina vines on your walls pulse brighter in response. New creatures emerge at the mountain's base.

**Night**
You climb to the unfinished watchtower platform—just a frame of logs, but high enough. From here you see your cabin below, hearth glowing. The network beyond, growing. The mountain you awakened. Vast dark spaces remain.

But this is home now. And tomorrow, you build higher.

You are the Keeper of the Grove.

---

### Technical Aspirations

**To Make This Real**

1. **Flora Simulation System**: Each plant as a stateful entity with growth, health, connections
2. **Network Visualization**: Real-time thread rendering between connected flora
3. **Log Construction Engine**: Cylindrical mesh placement with snap points, physics-based fallen trees, structural integrity
4. **Tool Crafting Expansion**: Saw, Planer, Adze recipes with visual attachment system
5. **Creature AI 2.0**: Behavior trees with memory, relationships, territories
6. **Biome Events**: Restoration triggers environmental changes
7. **Companion System**: Bond tracking, command interface, mount mechanics
8. **Corruption Mechanics**: Spreading threat, containment, cleansing rituals
9. **Lore Delivery**: Keeper Stones with vision sequences, Echo Flowers with audio
10. **Weather System**: Dynamic weather responding to network health
11. **Vertical World**: Sky Islands as late-game content, underground as mid-game mystery
12. **Multiplayer Foundation**: Shared networks, cooperative building, territory

---

### Why This Beats Minecraft

Minecraft is about *construction*. You impose your will on the world. Blocks obey.

**The Ideal Grove is about *cultivation*.** You work *with* the world. The world responds.

- Where Minecraft gives you infinite identical blocks, we give you living flora with personalities and needs
- Where Minecraft populates with random hostile mobs, we create ecosystems that evolve with your choices
- Where Minecraft's story is optional and external, our narrative emerges from the world itself
- Where Minecraft's endgame is building bigger, our endgame is understanding deeper
- Where Minecraft asks "what can I build?", we ask "what can I grow?"

The difference isn't technical—it's philosophical. Minecraft is a tool. The Ideal Grove is a relationship.

---

## Part III: The First Steps

*From here to there*

### Phase 1: The Living Network
- [ ] Flora state system (health, growth stage, connections)
- [ ] Visual network threads between nearby flora
- [ ] Network effects (shared energy, growth acceleration)
- [ ] Flora placement rules (soil quality, moisture, light requirements)

### Phase 2: Woodworking & Shelter
- [ ] Tree felling physics (axe chops, tree topples, becomes physics object)
- [ ] Saw tool crafting (Stick + 3 Shards aligned)
- [ ] Sawing interaction (fallen tree → logs)
- [ ] Log item type with carrying mechanics (slower movement, physics response)
- [ ] Vertical post placement (log plants into terrain)
- [ ] Horizontal beam snapping (log connects between posts)
- [ ] Ghost preview system for valid placements
- [ ] Angled rafter placement for roofing
- [ ] Hearth construction (stone circle + kindling + spark)
- [ ] Planer and Adze tools for advanced construction
- [ ] Structure weathering (fresh wood darkens, moss grows)

### Phase 3: The Responsive World
- [ ] Creature memory and relationship tracking
- [ ] Fog Deer behavior evolution (observer → guide)
- [ ] Rootling emergence from healthy RootHollows
- [ ] Biome restoration events when RootHollows activate

### Phase 4: The Keeper's Journey
- [ ] Keeper Stones with vision sequences
- [ ] Ability unlock system tied to world state
- [ ] Companion bonding mechanics
- [ ] Tool evolution tied to network health

### Phase 5: The Growing Threat
- [ ] Corruption biome implementation
- [ ] Shadow creature variants
- [ ] Containment and cleansing mechanics
- [ ] Network vulnerability when disconnected

### Phase 6: The Full World
- [ ] Sky Islands as explorable late-game content
- [ ] Deep Root underground mystery
- [ ] Elder creatures (Hollow Walker, Sky Serpent)
- [ ] Endgame revelation and world transformation

---

## Closing

The engine exists. The foundation is solid. The systems are ready for purpose.

What's needed now isn't more technology—it's more *meaning*. Every feature we add should answer: "Does this make the world feel more alive? Does this give the player a reason to care?"

The Ideal Grove isn't a game about survival. It's not about domination. It's about stewardship. About patience. About the quiet joy of watching something you nurtured *flourish*.

The Grove is waiting.

Let's grow it together.

---

*"The best time to plant a tree was twenty years ago. The second best time is now."*
*— Proverb, applicable to both groves and game development*
