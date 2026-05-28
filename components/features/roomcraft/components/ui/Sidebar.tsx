import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { DoorOpen, Eye, Layers3, LayoutPanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import type { OpeningType, WallSide } from '../../types/room';

type SectionKey = 'rooms' | 'openings' | 'objects' | 'views';

const WALL_VISIBILITY_OPTIONS: { side: WallSide; label: string }[] = [
  { side: 'north', label: 'North' },
  { side: 'south', label: 'South' },
  { side: 'east', label: 'East' },
  { side: 'west', label: 'West' },
];

function SidebarTab({
  id,
  title,
  active,
  onSelect,
  icon,
}: {
  id: SectionKey;
  title: string;
  active: boolean;
  onSelect: (id: SectionKey) => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-label={title}
      aria-pressed={active}
      title={title}
      className={`flex h-10 w-10 items-center justify-center rounded-r-md border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground ${
        active ? 'border-primary bg-card text-primary' : 'border-transparent bg-card'
      }`}
    >
      {icon}
    </button>
  );
}

function TabPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border bg-background">
      <div className="border-b px-3 py-2 text-sm font-semibold text-foreground">{title}</div>
      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-3 pb-16">{children}</div>
    </section>
  );
}

export function Sidebar({ projectId }: { projectId?: string }) {
  const router = useRouter();
  const { state, dispatch } = useRoom();
  const { placement, startPicking, setValues, startPlacing, cancel } = usePlacement();
  const [addingType, setAddingType] = useState<OpeningType | null>(null);
  const [addingRoom, setAddingRoom] = useState(false);
  const [showAddLayerDialog, setShowAddLayerDialog] = useState(false);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [deletingLayerId, setDeletingLayerId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>('rooms');

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

  const canShowActiveSection = activeSection === 'rooms' || showRoomTools;
  const currentSection = canShowActiveSection ? activeSection : 'rooms';
  const visible3DWalls = state.visible3DWalls ?? {
    north: true,
    south: false,
    east: true,
    west: true,
  };

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-visible">
      <div className="absolute -right-4 top-4 z-10 flex translate-x-full flex-col gap-2">
        <SidebarTab
          id="rooms"
          title="Rooms"
          active={currentSection === 'rooms'}
          onSelect={setActiveSection}
          icon={<LayoutPanelLeft className="h-4 w-4" />}
        />
        {showRoomTools && (
          <SidebarTab
            id="openings"
            title="Openings"
            active={currentSection === 'openings'}
            onSelect={setActiveSection}
            icon={<DoorOpen className="h-4 w-4" />}
          />
        )}
        {showRoomTools && (
          <SidebarTab
            id="objects"
            title="Objects & Layers"
            active={currentSection === 'objects'}
            onSelect={setActiveSection}
            icon={<Layers3 className="h-4 w-4" />}
          />
        )}
        {showRoomTools && (
          <SidebarTab
            id="views"
            title="Views"
            active={currentSection === 'views'}
            onSelect={setActiveSection}
            icon={<Eye className="h-4 w-4" />}
          />
        )}
      </div>

      {currentSection === 'rooms' && (
        <TabPanel title="Rooms">
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
        </TabPanel>
      )}

      {currentSection === 'openings' && showRoomTools && (
        <TabPanel title="Openings">
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
        </TabPanel>
      )}

      {currentSection === 'objects' && showRoomTools && (
        <TabPanel title="Objects & Layers">
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
                      rotation: 0,
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
                <button
                  onClick={() => dispatch({ type: 'RESET_FLOOR_PLAN' })}
                  className="text-xs font-medium text-destructive/80 transition-colors hover:text-destructive"
                >
                  Reset Floor Plan
                </button>
              </div>
            </>
          )}
        </TabPanel>
      )}

      {currentSection === 'views' && showRoomTools && (
        <TabPanel title="Views">
          <div className="space-y-3">
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

            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Measurements</span>
              <button
                onClick={() => dispatch({ type: 'TOGGLE_MEASUREMENTS' })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  state.showMeasurements ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span className="sr-only">{state.showMeasurements ? 'On' : 'Off'}</span>
                <span
                  className={`${
                    state.showMeasurements ? 'translate-x-6' : 'translate-x-1'
                  } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                />
              </button>
            </div>

            <div className="space-y-2 border-t pt-3">
              <div className="text-sm font-semibold text-foreground">3D walls</div>
              <div className="grid grid-cols-2 gap-2">
                {WALL_VISIBILITY_OPTIONS.map(({ side, label }) => (
                  <label
                    key={side}
                    className={`flex items-center justify-between rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                      visible3DWalls[side]
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground'
                    }`}
                  >
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={visible3DWalls[side]}
                      onChange={() => dispatch({ type: 'TOGGLE_3D_WALL', payload: { side } })}
                      className="h-3.5 w-3.5 accent-current"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </TabPanel>
      )}

      <div className="pointer-events-none absolute bottom-0 left-0 right-0">
        {projectId && (
          <Button
            variant="outline"
            size="sm"
            className="pointer-events-auto w-full bg-background"
            onClick={() => router.push(`/roomcraft/${projectId}/configure`)}
          >
            Configure furniture
          </Button>
        )}
      </div>

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
