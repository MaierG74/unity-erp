'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useRoomContext } from '@/components/features/roomcraft/context/RoomContext';
import type { RoomItem } from '@/components/features/roomcraft/types/room';
import type { ProjectPiece } from '@/lib/roomcraft/types';

interface BlockListItem {
  item: RoomItem;
  roomId: string;
  roomName: string;
  piece: ProjectPiece | undefined;
}

interface BlockListProps {
  pieces: ProjectPiece[];
  selectedBlockId: string | null;
  onSelectBlock: (item: RoomItem, roomId: string) => void;
}

export function BlockList({ pieces, selectedBlockId, onSelectBlock }: BlockListProps) {
  const { state } = useRoomContext();
  const pieceByBlockId = new Map(pieces.map((piece) => [piece.blockId, piece]));

  const allBlocks: BlockListItem[] = (state.floorPlan?.rooms ?? []).flatMap(({ room }) =>
    room.items.map((item) => ({
      item,
      roomId: room.id,
      roomName: room.name,
      piece: pieceByBlockId.get(item.id),
    })),
  );

  if (allBlocks.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        No blocks in this project. Add blocks on the canvas first.
      </div>
    );
  }

  return (
    <div className="divide-y text-sm">
      {allBlocks.map(({ item, roomId, roomName, piece }) => (
        <button
          key={item.id}
          className={cn(
            'flex w-full items-start justify-between px-4 py-3 text-left transition-colors hover:bg-muted/50',
            selectedBlockId === item.id && 'bg-muted',
          )}
          onClick={() => onSelectBlock(item, roomId)}
          type="button"
        >
          <div className="min-w-0 space-y-0.5">
            <p className="truncate font-medium">{item.label || 'Block'}</p>
            <p className="text-xs text-muted-foreground">{roomName}</p>
          </div>
          <Badge
            variant={piece ? 'default' : 'secondary'}
            className="ml-2 shrink-0 text-[10px]"
          >
            {piece ? piece.furnitureType : 'unconfigured'}
          </Badge>
        </button>
      ))}
    </div>
  );
}
