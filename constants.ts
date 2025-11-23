
// Grid Dimensions
export const CHUNK_SIZE_XZ = 32;
export const CHUNK_SIZE_Y = 80;
export const PAD = 1;

export const TOTAL_SIZE_XZ = CHUNK_SIZE_XZ + PAD * 2;
export const TOTAL_SIZE_Y = CHUNK_SIZE_Y + PAD * 2;

export const BEDROCK_LEVEL = -35;
export const WATER_LEVEL = 4.5;
export const VOXEL_SCALE = 1.0;

// World Generation
export const RENDER_DISTANCE = 4; // Increased for blocks

// Physics & Player
export const GRAVITY = -20.0; // Snappier
export const PLAYER_SPEED = 8;
export const JUMP_FORCE = 12;

// Tool Settings
export const DIG_RADIUS = 3.0;
export const DIG_STRENGTH = 1.5;
