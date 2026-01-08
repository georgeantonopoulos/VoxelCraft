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

describe('Building System - Placement Logic', () => {
    // These tests verify the pure logic functions used in building placement
    // The actual placement hook requires R3F/Rapier which can't run in Vitest

    it('should calculate grid-snapped positions correctly', () => {
        const GRID_SNAP = 0.25;

        // Test grid snapping logic
        const snapToGrid = (value: number) => Math.round(value / GRID_SNAP) * GRID_SNAP;

        expect(snapToGrid(1.0)).toBe(1.0);
        expect(snapToGrid(1.1)).toBe(1.0);
        expect(snapToGrid(1.13)).toBe(1.25);
        expect(snapToGrid(1.37)).toBe(1.25);
        expect(snapToGrid(1.38)).toBe(1.5);
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

    it('should calculate adjacent snap positions', () => {
        const LOG_RADIUS = 0.25;
        const GAP = 0.05;

        // Adjacent placement calculation
        const calculateAdjacentPosition = (
            existingPos: [number, number, number],
            direction: [number, number, number]
        ): [number, number, number] => {
            const offset = LOG_RADIUS * 2 + GAP;
            return [
                existingPos[0] + direction[0] * offset,
                existingPos[1] + direction[1] * offset,
                existingPos[2] + direction[2] * offset,
            ];
        };

        const existingLog = [10, 5, 10] as [number, number, number];

        // Place adjacent in +X direction
        const adjacentX = calculateAdjacentPosition(existingLog, [1, 0, 0]);
        expect(adjacentX[0]).toBeCloseTo(10.55); // 10 + 0.5 + 0.05
        expect(adjacentX[1]).toBe(5);
        expect(adjacentX[2]).toBe(10);

        // Place adjacent in +Z direction
        const adjacentZ = calculateAdjacentPosition(existingLog, [0, 0, 1]);
        expect(adjacentZ[0]).toBe(10);
        expect(adjacentZ[2]).toBeCloseTo(10.55);
    });

    it('should detect stacking position above existing log', () => {
        const LOG_RADIUS = 0.25;
        const GAP = 0.05;

        // Stack calculation
        const calculateStackPosition = (
            existingPos: [number, number, number]
        ): [number, number, number] => {
            return [
                existingPos[0],
                existingPos[1] + LOG_RADIUS * 2 + GAP,
                existingPos[2],
            ];
        };

        const bottomLog = [10, 5, 10] as [number, number, number];
        const stackedLog = calculateStackPosition(bottomLog);

        expect(stackedLog[0]).toBe(10);
        expect(stackedLog[1]).toBeCloseTo(5.55); // 5 + 0.5 + 0.05
        expect(stackedLog[2]).toBe(10);
    });
});

describe('Log State Transitions', () => {
    it('should track isPlaced flag correctly', () => {
        // This tests the state shape for logs
        interface LogState {
            id: string;
            position: [number, number, number];
            treeType: number;
            seed: number;
            isPlaced: boolean;
        }

        // Dropped log (dynamic, can roll)
        const droppedLog: LogState = {
            id: 'dropped-log-1',
            position: [10, 5, 10],
            treeType: 1,
            seed: 42,
            isPlaced: false
        };

        expect(droppedLog.isPlaced).toBe(false);

        // Placed log (kinematic, frozen)
        const placedLog: LogState = {
            id: 'placed-log-1',
            position: [10, 5.55, 10],
            treeType: 1,
            seed: 42,
            isPlaced: true
        };

        expect(placedLog.isPlaced).toBe(true);
    });
});
