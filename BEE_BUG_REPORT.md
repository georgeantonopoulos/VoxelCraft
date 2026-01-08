## 🐛 Bug Report: Lumabee Character System

### Critical Issues Found (14 total)

---

### 🔴 **CRITICAL - Will Break in Production**

#### 1. **Model Path Incorrect** ✅ FIXED
**Location**: `LumabeeCharacter.tsx:7`
**Problem**:
```typescript
const lumabeeUrl = "/src/assets/models/lumabee.glb";  // ❌ Won't load!
```
- File is in `src/assets/` but path references it as if in `public/`
- Vite won't serve this - 404 error, no bees will appear

**Fix Applied**:
```typescript
import lumabeeUrl from '@/assets/models/lumabee.glb?url';  // ✅ Vite handles bundling
```

---

#### 2. **Bees Spawn Too Close - No Dramatic Entrance** ⚠️ NEEDS FIX
**Location**: `BeeManager.tsx:spawnBee()`
**Problem**:
```typescript
const distance = 2.0 + random() * 3.0;  // Only 2-5 units from tree!
const newBee: BeeInstance = {
  position: new THREE.Vector3(
    tree.x + Math.cos(angle) * distance,  // Right next to tree
    config.spawnHeight,
    tree.z + Math.sin(angle) * distance
  ),
  state: BeeState.IDLE  // Starts idle, no approach flight
};
```

**Impact**:
- ❌ Player sees bees pop in suddenly
- ❌ No off-screen spawning
- ❌ No dramatic "discovery" moment
- ❌ Breaks immersion

**Recommended Fix**:
```typescript
// Spawn 40-80 units away (beyond render distance edge)
const distance = 40.0 + random() * 40.0;
const newBee: BeeInstance = {
  position: new THREE.Vector3(
    tree.x + Math.cos(angle) * distance,
    config.spawnHeight + random() * 10.0,  // Vary height
    tree.z + Math.sin(angle) * distance
  ),
  state: BeeState.APPROACH  // Fly toward tree from far away
};
```

---

#### 3. **Missing APPROACH State** ✅ FIXED
**Problem**: No state for bees flying from spawn to tree
**Fix Applied**: Added `APPROACH = 'APPROACH'` to BeeState enum

---

#### 4. **Tree Height Not Considered**
**Location**: Multiple places
**Problem**:
```typescript
// In RootHollow.tsx - tree stored at ground level:
position: posVec.clone(),  // y = terrain surface

// In LumabeeCharacter.tsx - targets ground:
case BeeState.HARVEST:
  targetRef.current.copy(treePosition).setY(treePosition.y + 8.0);  // Hardcoded +8
```

**Impact**:
- Bees target tree BASE, not canopy
- FractalTrees can be 15-20+ units tall
- Harvest check uses 3D distance to ground - won't trigger if bee is at canopy
- Looks unnatural (bees should work at flower/fruit level)

**Recommended Fix**:
- Store tree height in WorldStore:
  ```typescript
  { id, type: 'GROWN_TREE', position, grownAt, treeHeight: 15.0 }
  ```
- Target canopy:
  ```typescript
  targetRef.current.copy(treePosition).setY(treePosition.y + treeHeight * 0.7);
  ```

---

#### 5. **Harvest Distance Check Broken**
**Location**: `LumabeeCharacter.tsx` HARVEST state
**Problem**:
```typescript
const distToTree = position.distanceTo(treePosition);  // 3D distance to ground
if (distToTree < flightParams.harvestDistance) {  // 1.5 units
```

**Impact**:
- If bee is at tree canopy (y=15), distance to ground (y=0) = 15+ units
- Never triggers harvest!
- Bees will approach forever but never extract nectar

**Recommended Fix**:
```typescript
// Check horizontal (XZ) distance only:
const dx = position.x - treePosition.x;
const dz = position.z - treePosition.z;
const horizDist = Math.sqrt(dx * dx + dz * dz);
if (horizDist < flightParams.harvestDistance) {
```

---

### 🟡 **HIGH PRIORITY - Performance/Memory Issues**

#### 6. **Material Memory Leak**
**Location**: `LumabeeCharacter.tsx:92-116`
**Problem**:
```typescript
const modelClone = useMemo(() => {
  const clone = scene.clone();
  clone.traverse((child) => {
    mesh.material = mat.clone();  // Clones materials
  });
  return clone;
}, [scene]);
// NO CLEANUP!
```

**Impact**:
- With 30 bees × materials per bee = memory leak
- Materials never disposed when bees despawn
- GPU memory grows over time

**Recommended Fix**:
```typescript
useEffect(() => {
  return () => {
    modelClone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(mat => mat.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    });
  };
}, [modelClone]);
```

---

#### 7. **Random() Called Every Frame**
**Location**: `LumabeeCharacter.tsx` AI update loop
**Problem**:
```typescript
case BeeState.IDLE:
  if (stateTimeRef.current > 2.0 + random() * 2.0) {  // Different value each frame!
    transitionState(BeeState.PATROL);
  }
```

**Impact**:
- Transition threshold changes every frame
- Unpredictable behavior
- May never transition (if random() keeps giving high values)

**Recommended Fix**:
```typescript
// Store threshold when entering state:
const stateThresholdRef = useRef(0);

const transitionState = (newState: BeeState) => {
  setState(newState);
  stateTimeRef.current = 0;
  // Set new threshold
  switch (newState) {
    case BeeState.IDLE:
      stateThresholdRef.current = 2.0 + random() * 2.0;
      break;
  }
};

// Check stored threshold:
if (stateTimeRef.current > stateThresholdRef.current) {
```

---

#### 8. **No Terrain Height Bounds**
**Problem**: Bees can fly infinitely high or clip through terrain
**Impact**: Visual glitches, bees disappearing underground

**Recommended Fix**:
```typescript
// Clamp to reasonable height above terrain:
position.y = THREE.MathUtils.clamp(
  position.y,
  TerrainService.getHeightAt(position.x, position.z) + 1.0,  // Min: 1m above ground
  50.0  // Max height
);
```

---

### 🟢 **MEDIUM PRIORITY - Polish Issues**

#### 9. **Animation Fallback Missing**
**Location**: `LumabeeCharacter.tsx:transitionState()`
**Problem**:
```typescript
const animMap: Record<BeeState, string> = {
  [BeeState.IDLE]: 'Idle',
  [BeeState.APPROACH]: 'Fly',  // But does this animation exist in GLB?
  // ...
};
const action = Object.entries(actions).find(([name]) =>
  name.toLowerCase().includes(animName.toLowerCase())
)?.[1];

if (action) {
  action.reset().fadeIn(0.2).play();  // What if action is undefined?
}
```

**Impact**:
- If GLB has different animation names, bees won't animate
- Silent failure - hard to debug

**Recommended Fix**:
```typescript
if (action) {
  action.reset().fadeIn(0.2).play();
} else {
  console.warn(`[Lumabee ${id}] Animation "${animName}" not found in model`);
  // Fallback to first available animation
  const fallback = Object.values(actions)[0];
  if (fallback) fallback.reset().fadeIn(0.2).play();
}
```

---

#### 10. **Initial State Wrong**
**Location**: `LumabeeCharacter.tsx:61`
**Problem**:
```typescript
const [state, setState] = useState<BeeState>(BeeState.IDLE);
```
Should start in `APPROACH` for bees spawning far away.

---

#### 11. **No Error Handling for Missing Model**
**Problem**: If lumabee.glb fails to load, component crashes
**Recommended Fix**: Add Suspense boundary and error fallback

---

#### 12. **Tree Position in PATROL State**
**Location**: `LumabeeCharacter.tsx` PATROL case
**Problem**:
```typescript
targetRef.current.set(
  treePosition.x + Math.cos(angle) * radius,
  treePosition.y + 5.0 + Math.sin(stateTimeRef.current * 1.5) * 2.0,  // Hardcoded 5.0
  treePosition.z + Math.sin(angle) * radius
);
```
Should use tree height, not hardcoded 5.0

---

#### 13. **Spawn Radius Too Small**
**Location**: `BeeManager.tsx:30`
**Problem**:
```typescript
spawnRadius = 60.0  // Only 60 units
```
With render distance of 3 chunks (96 units), bees spawn within visible range!

**Recommended**: Increase to `spawnRadius = 100.0` (beyond player view)

---

#### 14. **State Transition Logging**
**Location**: BeeManager harvest handler
**Problem**:
```typescript
console.log(`[BeeManager] Bee ${beeId} harvested nectar at`, position);
```
Should only log in dev mode (or remove for production)

---

## 📊 Priority Fix Order

### **Immediate (Blocks Functionality)**:
1. ✅ Model path (FIXED)
2. ⚠️ Spawn distance (40-80 units, not 2-5)
3. ✅ APPROACH state (FIXED)
4. ⚠️ Harvest distance check (use horizontal distance)
5. ⚠️ Tree height targeting

### **High Priority (Memory/Performance)**:
6. Material disposal
7. Random() caching
8. Terrain bounds

### **Polish (Can Wait)**:
9-14. Animation fallback, error handling, logging

---

## 🎯 Recommended Implementation Plan

### Phase 1: Critical Fixes (30 min)
- Fix spawn distance to 40-80 units
- Add APPROACH state logic
- Fix harvest distance to horizontal
- Add tree height to WorldStore

### Phase 2: Performance (20 min)
- Add material disposal
- Cache random transition thresholds
- Add terrain height clamping

### Phase 3: Polish (15 min)
- Animation fallback
- Error boundaries
- Remove debug logs

---

**Total Estimated Fix Time**: ~65 minutes

Would you like me to implement all these fixes now?
