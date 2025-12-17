import React from 'react';
import { usePhysicsItemStore } from '@state/PhysicsItemStore';
import { PhysicsItem } from './PhysicsItem';

export const PhysicsItemRenderer: React.FC = () => {
  const items = usePhysicsItemStore((state) => state.items);

  return (
    <>
      {items.map((item) => (
        <PhysicsItem key={item.id} item={item} />
      ))}
    </>
  );
};
