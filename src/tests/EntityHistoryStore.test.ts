import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEAD_ENTITY_RETENTION_MS,
    useEntityHistoryStore,
} from '../state/EntityHistoryStore';

describe('EntityHistoryStore lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        useEntityHistoryStore.setState({ entities: {}, targetEntityId: null });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('retains a defeated entity for feedback, then clears it and its target', () => {
        useEntityHistoryStore.getState().damageEntity('tree-1', 10, 10, 'Tree');

        vi.advanceTimersByTime(DEAD_ENTITY_RETENTION_MS - 1);
        useEntityHistoryStore.getState().clearDeadEntities();
        expect(useEntityHistoryStore.getState().entities['tree-1']).toBeDefined();
        expect(useEntityHistoryStore.getState().targetEntityId).toBe('tree-1');

        vi.advanceTimersByTime(1);
        useEntityHistoryStore.getState().clearDeadEntities();
        expect(useEntityHistoryStore.getState().entities['tree-1']).toBeUndefined();
        expect(useEntityHistoryStore.getState().targetEntityId).toBeNull();
    });

    it('preserves living entities while removing expired defeated entities', () => {
        const store = useEntityHistoryStore.getState();
        store.damageEntity('living-rock', 2, 10, 'Rock');
        store.damageEntity('dead-tree', 10, 10, 'Tree');

        vi.advanceTimersByTime(DEAD_ENTITY_RETENTION_MS);
        useEntityHistoryStore.getState().clearDeadEntities();

        expect(useEntityHistoryStore.getState().entities['living-rock']?.health).toBe(8);
        expect(useEntityHistoryStore.getState().entities['dead-tree']).toBeUndefined();
    });

    it('does not publish a new entities object when no cleanup is needed', () => {
        useEntityHistoryStore.getState().damageEntity('living-tree', 1, 10, 'Tree');
        const before = useEntityHistoryStore.getState().entities;

        useEntityHistoryStore.getState().clearDeadEntities();

        expect(useEntityHistoryStore.getState().entities).toBe(before);
    });

    it('clears living damage and targeting when a new world starts', () => {
        useEntityHistoryStore.getState().damageEntity('stable-tree-id', 4, 10, 'Tree');

        useEntityHistoryStore.getState().reset();

        expect(useEntityHistoryStore.getState().entities).toEqual({});
        expect(useEntityHistoryStore.getState().targetEntityId).toBeNull();
    });
});
