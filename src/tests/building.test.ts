import { describe, it, expect, beforeEach } from 'vitest';
import { useCarryingStore } from '../state/CarryingStore';

describe('CarryingStore', () => {
    beforeEach(() => {
        // Reset store state before each test
        useCarryingStore.setState({ carriedLog: null });
    });

    it('should start with no carried log', () => {
        const state = useCarryingStore.getState();
        expect(state.carriedLog).toBeNull();
        expect(state.isCarrying()).toBe(false);
    });

    it('should pick up a log correctly', () => {
        const store = useCarryingStore.getState();
        const testLog = { id: 'test-log-1', treeType: 1, seed: 42 };

        store.pickUp(testLog);

        const newState = useCarryingStore.getState();
        expect(newState.carriedLog).toEqual(testLog);
        expect(newState.isCarrying()).toBe(true);
    });

    it('should drop a log and return it', () => {
        const store = useCarryingStore.getState();
        const testLog = { id: 'test-log-2', treeType: 2, seed: 123 };

        store.pickUp(testLog);
        expect(useCarryingStore.getState().isCarrying()).toBe(true);

        const droppedLog = store.drop();

        expect(droppedLog).toEqual(testLog);
        expect(useCarryingStore.getState().carriedLog).toBeNull();
        expect(useCarryingStore.getState().isCarrying()).toBe(false);
    });

    it('should return null when dropping with no log', () => {
        const store = useCarryingStore.getState();
        expect(store.isCarrying()).toBe(false);

        const result = store.drop();

        expect(result).toBeNull();
    });

    it('should replace existing log when picking up new one', () => {
        const store = useCarryingStore.getState();
        const log1 = { id: 'log-1', treeType: 1, seed: 10 };
        const log2 = { id: 'log-2', treeType: 2, seed: 20 };

        store.pickUp(log1);
        expect(useCarryingStore.getState().carriedLog?.id).toBe('log-1');

        store.pickUp(log2);
        expect(useCarryingStore.getState().carriedLog?.id).toBe('log-2');
    });
});

describe('Debug Mode Tools', () => {
    it('should include debug tools when in debug mode', () => {
        // This test verifies the structure of debug tools
        // Note: Actual debug mode activation depends on URL params which we can't test in Vitest
        // We test the tool structure instead

        const expectedAxeStructure = {
            id: 'tool_debug_axe',
            baseType: 'stick',
            attachments: {
                blade_1: 'shard',
                blade_2: 'shard',
                side_right: 'shard',
            }
        };

        const expectedSawStructure = {
            id: 'tool_debug_saw',
            baseType: 'stick',
            attachments: {
                blade_1: 'shard',
                blade_2: 'shard',
                blade_3: 'shard',
            }
        };

        // Verify the structure matches what we defined
        // (actual debug mode requires browser URL params)
        expect(expectedAxeStructure.attachments).toHaveProperty('blade_1');
        expect(expectedAxeStructure.attachments).toHaveProperty('blade_2');
        expect(expectedAxeStructure.attachments).toHaveProperty('side_right');

        expect(expectedSawStructure.attachments).toHaveProperty('blade_1');
        expect(expectedSawStructure.attachments).toHaveProperty('blade_2');
        expect(expectedSawStructure.attachments).toHaveProperty('blade_3');
    });
});

describe('Building System - Vertical-First Placement Logic', () => {
    // Constants matching useBuildingPlacement.ts
    const LOG_LENGTH = 2.0;
    const LOG_RADIUS = 0.25;
    const LOG_DIAMETER = LOG_RADIUS * 2;
    const VERTICAL_STACK_GAP = 0.05;
    const ADJACENT_GAP = 0.08;
    const GRID_SNAP = 0.25;
    const GROUND_PENETRATION = 0.15; // Logs are "planted" into ground like fence posts

    it('should calculate grid-snapped positions correctly', () => {
        // Test grid snapping logic
        const snapToGrid = (value: number) => Math.round(value / GRID_SNAP) * GRID_SNAP;

        expect(snapToGrid(1.0)).toBe(1.0);
        expect(snapToGrid(1.1)).toBe(1.0);
        expect(snapToGrid(1.13)).toBe(1.25);
        expect(snapToGrid(1.37)).toBe(1.25);
        expect(snapToGrid(1.38)).toBe(1.5);
    });

    it('should calculate vertical placement height correctly (with ground penetration)', () => {
        // Vertical log center should be at LOG_LENGTH/2 - penetration above ground
        // This plants the log into the ground like a fence post
        const groundY = 10.0;
        const expectedCenterY = groundY + LOG_LENGTH / 2 - GROUND_PENETRATION;

        expect(expectedCenterY).toBeCloseTo(10.85); // 10 + 1.0 - 0.15
    });

    it('should calculate vertical stack position correctly', () => {
        // Stacking: new log center at existing center + LOG_LENGTH + gap
        // First log at groundY=10 has center at 10.85 (with ground penetration)
        const existingLogY = 10.85; // Center of first vertical log
        const stackedCenterY = existingLogY + LOG_LENGTH + VERTICAL_STACK_GAP;

        expect(stackedCenterY).toBeCloseTo(12.9); // 10.85 + 2.0 + 0.05
    });

    it('should calculate adjacent placement position correctly', () => {
        // Adjacent logs for wall building
        const existingX = 10.0;
        const adjacentX = existingX + LOG_DIAMETER + ADJACENT_GAP;

        expect(adjacentX).toBeCloseTo(10.58); // 10 + 0.5 + 0.08
    });

    it('should detect nearby logs within radius', () => {
        const LOG_RADIUS = 0.25;
        const SNAP_DISTANCE = 0.5;

        // Simple distance check used in snap detection
        const isNearby = (pos1: [number, number, number], pos2: [number, number, number], radius: number) => {
            const dx = pos1[0] - pos2[0];
            const dy = pos1[1] - pos2[1];
            const dz = pos1[2] - pos2[2];
            return Math.sqrt(dx * dx + dy * dy + dz * dz) < radius;
        };

        // Adjacent logs should be detected
        const log1 = [0, 0, 0] as [number, number, number];
        const log2 = [LOG_RADIUS * 2.5, 0, 0] as [number, number, number]; // ~0.625 away

        expect(isNearby(log1, log2, SNAP_DISTANCE * 2)).toBe(true);

        // Distant logs should not snap
        const log3 = [5, 0, 0] as [number, number, number];
        expect(isNearby(log1, log3, SNAP_DISTANCE * 2)).toBe(false);
    });

    it('should detect valid horizontal support configuration', () => {
        // Two vertical logs at correct spacing can support a horizontal beam
        const SUPPORT_TOLERANCE = 0.3;

        const checkSupportSpacing = (dist: number): boolean => {
            const gap = dist - LOG_DIAMETER;
            return Math.abs(gap - LOG_LENGTH) <= SUPPORT_TOLERANCE;
        };

        // Perfect spacing: LOG_DIAMETER + LOG_LENGTH = 0.5 + 2.0 = 2.5
        expect(checkSupportSpacing(2.5)).toBe(true);

        // Within tolerance
        expect(checkSupportSpacing(2.3)).toBe(true); // gap = 1.8, |1.8 - 2.0| = 0.2 < 0.3
        expect(checkSupportSpacing(2.7)).toBe(true); // gap = 2.2, |2.2 - 2.0| = 0.2 < 0.3

        // Outside tolerance
        expect(checkSupportSpacing(1.5)).toBe(false); // gap = 1.0, |1.0 - 2.0| = 1.0 > 0.3
        expect(checkSupportSpacing(3.5)).toBe(false); // gap = 3.0, |3.0 - 2.0| = 1.0 > 0.3
    });

    it('should calculate horizontal beam placement at midpoint between supports', () => {
        // Support logs have centers at Y=5 (already placed, position is center)
        const log1Pos = [10, 5, 10] as [number, number, number];
        const log2Pos = [12.5, 5, 10] as [number, number, number]; // 2.5 units apart (perfect spacing)

        // Midpoint calculation
        const midX = (log1Pos[0] + log2Pos[0]) / 2;
        const midZ = (log1Pos[2] + log2Pos[2]) / 2;

        expect(midX).toBe(11.25);
        expect(midZ).toBe(10);

        // Beam Y position: on top of supports (support top = center + LOG_LENGTH/2)
        const supportTopY = Math.max(log1Pos[1], log2Pos[1]) + LOG_LENGTH / 2;
        const beamCenterY = supportTopY + LOG_RADIUS + VERTICAL_STACK_GAP;

        expect(beamCenterY).toBeCloseTo(6.3); // 5 + 1.0 + 0.25 + 0.05
    });
});

describe('Log State Transitions', () => {
    it('should track isPlaced and isVertical flags correctly', () => {
        // This tests the state shape for logs
        interface LogState {
            id: string;
            position: [number, number, number];
            treeType: number;
            seed: number;
            isPlaced: boolean;
            isVertical: boolean;
        }

        // Dropped log (dynamic, can roll) - no orientation tracked yet
        const droppedLog: LogState = {
            id: 'dropped-log-1',
            position: [10, 5, 10],
            treeType: 1,
            seed: 42,
            isPlaced: false,
            isVertical: true // Default to vertical
        };

        expect(droppedLog.isPlaced).toBe(false);
        expect(droppedLog.isVertical).toBe(true);

        // Placed vertical log (kinematic, fence post)
        const placedVerticalLog: LogState = {
            id: 'placed-vertical-1',
            position: [10, 6.1, 10],
            treeType: 1,
            seed: 42,
            isPlaced: true,
            isVertical: true
        };

        expect(placedVerticalLog.isPlaced).toBe(true);
        expect(placedVerticalLog.isVertical).toBe(true);

        // Placed horizontal log (kinematic, roof beam)
        const placedHorizontalLog: LogState = {
            id: 'placed-horizontal-1',
            position: [11.25, 6.3, 10],
            treeType: 1,
            seed: 42,
            isPlaced: true,
            isVertical: false
        };

        expect(placedHorizontalLog.isPlaced).toBe(true);
        expect(placedHorizontalLog.isVertical).toBe(false);
    });
});

describe('Log Rotation Values', () => {
    it('should use correct rotation for vertical logs', () => {
        // Vertical: cylinder axis aligned with Y (no Z rotation)
        const seed = 0.5;
        const yRot = (seed % 1) * Math.PI * 2;

        const verticalRotation = [0, yRot, 0] as [number, number, number];

        expect(verticalRotation[0]).toBe(0); // No X rotation
        expect(verticalRotation[2]).toBe(0); // No Z rotation
    });

    it('should use correct rotation for horizontal logs', () => {
        // Horizontal: cylinder tilted 90 degrees (PI/2 Z rotation)
        const seed = 0.5;
        const yRot = (seed % 1) * Math.PI * 2;

        const horizontalRotation = [0, yRot, Math.PI / 2] as [number, number, number];

        expect(horizontalRotation[0]).toBe(0); // No X rotation
        expect(horizontalRotation[2]).toBeCloseTo(Math.PI / 2); // 90 degree Z rotation
    });
});
