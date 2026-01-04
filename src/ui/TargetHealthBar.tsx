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
            const timer = setTimeout(() => {
                setVisible(false);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [entity?.health, entity?.id]);

    if (!entity || !visible) return null;

    const percent = Math.max(0, Math.min(100, (entity.health / entity.maxHealth) * 100));

    return (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 w-64 pointer-events-none select-none animate-in fade-in duration-300">
            <div className="text-white text-xs font-bold mb-1 drop-shadow-md text-center uppercase tracking-widest bg-black/40 px-2 py-0.5 rounded-full backdrop-blur-sm self-center mx-auto inline-block">
                {entity.label}
            </div>
            <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-white/20 backdrop-blur-sm shadow-xl">
                <div
                    className="h-full bg-gradient-to-r from-red-600 to-orange-400 transition-all duration-300 ease-out shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                    style={{ width: `${percent}%` }}
                />
            </div>
            <div className="text-[10px] text-white/70 font-mono mt-1 text-center font-bold">
                {Math.ceil(entity.health)} / {entity.maxHealth}
            </div>
        </div>
    );
};
