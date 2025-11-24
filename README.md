# VoxelCraft

A voxel-based terrain engine built with React Three Fiber, featuring procedurally generated organic terrain, real-time physics, and dynamic environmental simulation.

## Features

- **Procedural Terrain Generation**: Infinite voxel terrain using 3D Simplex noise with multiple material types (Bedrock, Stone, Dirt, Grass, Sand, Snow, Clay, Water, Mossy Stone)
- **Smooth Meshing**: Surface Nets algorithm (Dual Contouring variant) for seamless, organic-looking terrain
- **Physics Simulation**: Rapier physics engine for realistic player movement and terrain collision
- **Environmental Simulation**: Dynamic wetness and moss growth system that responds to water and time
- **Custom Shaders**: Triplanar texturing with projected noise for natural material transitions
- **Post-Processing**: Ambient occlusion, bloom, and tone mapping for enhanced visuals
- **Web Workers**: Heavy computation offloaded to workers for smooth performance

## Tech Stack

- **Frontend**: React 19 + TypeScript
- **3D Engine**: Three.js + React Three Fiber
- **Physics**: Rapier (via @react-three/rapier)
- **Build Tool**: Vite
- **Styling**: Tailwind CSS

## Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd VoxelCraft
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. (Optional) Set up environment variables:
   Create a `.env.local` file if you need to configure any API keys or environment-specific settings.

## Running the Application

Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:3000` (or the next available port).

## Controls

### Movement
- **WASD** or **Arrow Keys**: Move forward/backward/left/right
- **Mouse**: Look around (click to lock pointer)
- **Space**: Jump (when grounded)
- **Double-tap Space**: Toggle flying mode
  - In flying mode: **Space** to fly up, **Shift** to fly down, hover when neither is pressed
  - Double-tap Space again to exit flying mode

### Interaction
- **Left Click**: Dig/remove terrain
- **Right Click**: Build/add terrain

## Project Structure

```
VoxelCraft/
├── components/          # React components (Terrain, Player, UI, Materials)
├── services/           # Core logic (Terrain generation, Simulation, Metadata)
├── workers/            # Web Workers for heavy computation
├── utils/              # Helper functions (Noise, Meshing, Textures)
├── constants.ts        # Game constants and configuration
└── types.ts           # TypeScript type definitions
```

## Development

- The terrain system uses chunk-based loading with a configurable render distance
- Terrain generation and simulation run in Web Workers to keep the main thread responsive
- Custom shaders handle material blending and visual effects
- See `AGENTS.md` for detailed architecture and development guidelines

## Building for Production

```bash
npm run build
```

The production build will be output to the `dist/` directory.

## License

[Add your license here]
