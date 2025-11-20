
// Grid Settings
export const CHUNK_SIZE = 32;
// We use 2 padding to ensure we have enough data for neighbors (-1) and normal calculations
export const PAD = 2; 
export const TOTAL_SIZE = CHUNK_SIZE + PAD * 2;
export const ISO_LEVEL = 0.5; 
export const VOXEL_SCALE = 1.0;

// World Generation
export const RENDER_DISTANCE = 2; 
export const CHUNK_HEIGHT = 64;
export const WATER_LEVEL = 4.5;

// Physics
export const GRAVITY = -15.0; 
export const PLAYER_SPEED = 6;
export const JUMP_FORCE = 9;

// Tool Settings
export const DIG_RADIUS = 3.0; 
export const DIG_STRENGTH = 1.5; 
