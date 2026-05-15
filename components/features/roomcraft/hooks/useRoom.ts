import { useContext } from 'react';
import { RoomContext } from '../context/RoomContext';

export function useRoom() {
  return useContext(RoomContext);
}
