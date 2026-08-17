import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import React from 'react';

export interface GameDisplayState {
  cannabis: number;
  cannabisAtFactory: number;
  courierCarrying: number;
  joints: number;
  sats: number;
  rawGameState?: any;
  eligible?: boolean;
  upgradesNeeded?: number;
  /** Why a ticket cannot be bought, in one sentence. Empty when it can. */
  ticketHint?: string;
  /** Tickets already held in the current lottery draw. */
  ticketsHeld?: number;
}

interface GameDisplayContextValue extends GameDisplayState {
  update: (state: Partial<GameDisplayState>) => void;
}

const defaultState: GameDisplayState = {
  cannabis: 0, cannabisAtFactory: 0, courierCarrying: 0, joints: 0, sats: 0,
};

const GameDisplayContext = createContext<GameDisplayContextValue>({
  ...defaultState,
  update: () => {},
});

export function GameDisplayProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GameDisplayState>(defaultState);
  const update = useCallback((s: Partial<GameDisplayState>) => setState(prev => ({ ...prev, ...s })), []);
  return React.createElement(GameDisplayContext.Provider, { value: { ...state, update } }, children);
}

export function useGameDisplay() {
  return useContext(GameDisplayContext);
}
