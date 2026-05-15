import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useRoom } from '../../hooks/useRoom';
import { getActiveRoom } from '../../context/RoomContext';
import { isRoomLocked } from '../../utils/floorPlan';
import { countBlocksOnLayer } from '../../utils/layers';
import { usePlacement } from '../../context/PlacementContext';
import { RoomForm } from './RoomForm';
import { RoomList } from './RoomList';
import { AddRoomForm } from './AddRoomForm';
import { OpeningButtons } from './OpeningButtons';
import { OpeningForm } from './OpeningForm';
import { OpeningProperties } from './OpeningProperties';
import { SharedOpeningProperties } from './SharedOpeningProperties';
import { DimensionsForm } from './DimensionsForm';
import { ShiftRoomField } from './ShiftRoomField';
import { LockedRoomPanel } from './LockedRoomPanel';
import { LayerPanel } from './LayerPanel';
import { LayerModals } from './LayerModals';
import { BlockProperties } from './BlockProperties';
import { AddBlockPicker } from './AddBlockPicker';
import type { OpeningType } from '../../types/room';

type SectionKey = 'rooms' | 'openings' | 'objects';

function CollapsibleSection({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: SectionKey;
  title: string;
  open: boolean;
  onToggle: (id: SectionKey) => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border bg-background">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <span>{title}</span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && <div className="space-y-4 border-t p-3">{children}</div>}
    </section>
  );
}

export function Sidebar() {
  const { state, dispatch } = useRoom();
  const { placement, startPicking, setValues, startPlacing, cancel } = usePlacement();
  const [addingType, setAddingType] = useState<OpeningType | null>(null);
  const [addingRoom, setAddingRoom] = useState(false);
  const [showAddLayerDialog, setShowAddLayerDialog] = useState(false);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [deletingLayerId, setDeletingLayerId] = useState<string | null>(null);
  const [sectionsOpen, setSectionsOpen] = useState<Record<SectionKey, boolean>>({
    rooms: true,
    openings: false,
    objects: false,
  });

  const toggleSection = (id: SectionKey) => {
    setSectionsOpen((current) => ({ ...current, [id]: !current[id] }));
  };

  const activeRoom = getActiveRoom(state);
  const selectedOpening = activeRoom?.openings.find(
    (opening) => opening.id === state.selectedOpeningId,
  );
  const selectedShared =
    state.floorPlan?.sharedOpenings.find(
      (shared) => shared.id === state.selectedSharedOpeningId,
    ) ?? null;
  const selectedBlock =
    state.selectedBlockId && activeRoom
      ? (activeRoom.items.find((item) => item.id === state.selectedBlockId) ?? null)
      : null;

  if (!state.floorPlan) {
    return (
      <div className="space-y-5">
        <RoomForm />
      </div>
    );
  }

  const activeRoomLocked =
    Boolean(state.activeRoomId) && isRoomLocked(state.floorPlan, state.activeRoomId!);
  const showRoomTools = activeRoom && !addingRoom;
  const showEditableTools = showRoomTools && !activeRoomLocked;

  return (
    <div className="space-y-3">
      <CollapsibleSection
        id="rooms"
        title="Rooms"
        open={sectionsOpen.rooms}
        onToggle={toggleSection}
      >
        <RoomList onAddClick={() => setAddingRoom(true)} />

        {addingRoom && (
          <div className="border-t pt-4">
            <AddRoomForm
              onCancel={() => setAddingRoom(false)}
              onAdded={() => setAddingRoom(false)}
            />
          </div>
        )}

        {showRoomTools && !activeRoomLocked && !selectedOpening && !selectedShared && (
          <div className="border-t pt-4">
            <DimensionsForm />
            {state.activeRoomId && (
              <div className="mt-4">
                <ShiftRoomField key={state.activeRoomId} roomId={state.activeRoomId} />
              </div>
            )}
          </div>
        )}
      </CollapsibleSection>

      {showRoomTools && (
        <CollapsibleSection
          id="openings"
          title="Openings"
          open={sectionsOpen.openings}
          onToggle={toggleSection}
        >
          {activeRoomLocked ? (
            <LockedRoomPanel roomId={state.activeRoomId!} />
          ) : (
            <>
              {addingType ? (
                <OpeningForm
                  type={addingType}
                  onCancel={() => setAddingType(null)}
                  onPlaced={() => setAddingType(null)}
                />
              ) : (
                <OpeningButtons onAdd={setAddingType} />
              )}

              {selectedOpening && (
                <div className="border-t pt-4">
                  <OpeningProperties opening={selectedOpening} />
                </div>
              )}

              {selectedShared && (
                <div className="border-t pt-4">
                  <SharedOpeningProperties opening={selectedShared} />
                </div>
              )}
            </>
          )}
        </CollapsibleSection>
      )}

      {showRoomTools && (
        <CollapsibleSection
          id="objects"
          title="Objects & Layers"
          open={sectionsOpen.objects}
          onToggle={toggleSection}
        >
          {activeRoomLocked ? (
            <LockedRoomPanel roomId={state.activeRoomId!} />
          ) : placement.mode !== 'idle' ? (
            <AddBlockPicker
              layers={state.floorPlan.layers}
              mode={placement.mode}
              values={placement.values}
              onChange={setValues}
              onStartPlacing={startPlacing}
              onCancel={cancel}
            />
          ) : (
            <>
              {selectedBlock && activeRoom && (
                <BlockProperties
                  block={selectedBlock}
                  room={activeRoom}
                  layers={state.floorPlan.layers}
                  floorPlan={state.floorPlan}
                  dispatch={dispatch}
                />
              )}

              <div className="border-t pt-4">
                <LayerPanel
                  layers={state.floorPlan.layers}
                  activeLayerId={state.activeLayerId}
                  onAdd={() => setShowAddLayerDialog(true)}
                  onAddBlock={() => {
                    startPicking({
                      label: '',
                      layerId: state.activeLayerId ?? state.floorPlan!.layers[0]?.id ?? '',
                      length: 600,
                      depth: 600,
                      height: 900,
                    });
                  }}
                  onSelect={(id) => dispatch({ type: 'SET_ACTIVE_LAYER', payload: { id } })}
                  onToggleVisible={(id) => dispatch({ type: 'TOGGLE_LAYER_VISIBLE', payload: { id } })}
                  onEdit={(id) => setEditingLayerId(id)}
                  onRemove={(id) => {
                    const blockCount = countBlocksOnLayer(state.floorPlan!, id);
                    if (blockCount > 0) {
                      setDeletingLayerId(id);
                    } else {
                      dispatch({ type: 'REMOVE_LAYER', payload: { id } });
                    }
                  }}
                />
              </div>

              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Clearance</span>
                  <button
                    onClick={() => dispatch({ type: 'TOGGLE_HEATMAP' })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                      state.showHeatmap ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <span className="sr-only">{state.showHeatmap ? 'On' : 'Off'}</span>
                    <span
                      className={`${
                        state.showHeatmap ? 'translate-x-6' : 'translate-x-1'
                      } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">3D View</span>
                  <button
                    onClick={() => dispatch({ type: 'TOGGLE_ISOMETRIC' })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                      state.showIsometric ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <span className="sr-only">{state.showIsometric ? 'On' : 'Off'}</span>
                    <span
                      className={`${
                        state.showIsometric ? 'translate-x-6' : 'translate-x-1'
                      } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                    />
                  </button>
                </div>

                <button
                  onClick={() => dispatch({ type: 'RESET_FLOOR_PLAN' })}
                  className="text-xs font-medium text-destructive/80 transition-colors hover:text-destructive"
                >
                  Reset Floor Plan
                </button>
              </div>
            </>
          )}
        </CollapsibleSection>
      )}

      {showEditableTools && (
        <LayerModals
          floorPlan={state.floorPlan}
          showAdd={showAddLayerDialog}
          editingLayerId={editingLayerId}
          deletingLayerId={deletingLayerId}
          dispatch={dispatch}
          onCloseAdd={() => setShowAddLayerDialog(false)}
          onCloseEdit={() => setEditingLayerId(null)}
          onCloseDelete={() => setDeletingLayerId(null)}
        />
      )}
    </div>
  );
}
