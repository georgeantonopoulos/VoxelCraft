import React, { useEffect, useState } from 'react';
import { useEntityHistoryStore } from '@/state/EntityHistoryStore';

export const TargetHealthBar: React.FC = () => {
    const targetEntityId = useEntityHistoryStore(state => state.targetEntityId);
    const entities = useEntityHistoryStore(state => state.entities);

    const [visible, setVisible] = useState(false);

    const entity = targetEntityId ? entities[targetEntityId] : null;

    useEffect(() => {
        if (entity) {
            setVisible(true);
            // Broken or felled: let the empty bar register, then go.
            const timer = setTimeout(() => {
                setVisible(false);
            }, entity.health <= 0 ? 500 : 3000);
            return () => clearTimeout(timer);
        }
    }, [entity?.health, entity?.id]);

    if (!entity || !visible) return null;

    const percent = Math.max(0, Math.min(100, (entity.health / entity.maxHealth) * 100));

    return (
        <div className="grove-text-shadow absolute left-1/2 top-[58%] w-48 -translate-x-1/2 pointer-events-none select-none text-center grove-fade-in" style={{ animationDuration: '250ms' }}>
            <div className="font-display text-[16px] font-semibold text-parchment">{entity.label}</div>
            <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-lichen/20">
                <div
                    className="h-full rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${percent}%`, background: 'linear-gradient(90deg, #b4745f, #f2cf7c)' }}
                />
            </div>
        </div>
    );
};
