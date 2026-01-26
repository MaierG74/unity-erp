// Parts Input
export { PartsInputTable, type PartsInputTableProps, type MaterialOption, type PartWithLabel } from './PartsInputTable';
export { PartCard } from './PartCard';
export { GroupCard } from './GroupCard';

// Compact Parts Table
export {
  CompactPartsTable,
  type CompactPartsTableProps,
  type CompactPartsTableRef,
  type CompactPart,
  type LaminationType,
  type MaterialOption as CompactMaterialOption,
} from './CompactPartsTable';

// Grouped Parts Panel (drag-and-drop grouping UI)
export {
  GroupedPartsPanel,
  type GroupedPartsPanelProps,
  type MaterialOption as GroupedPartsMaterialOption,
} from './GroupedPartsPanel';

// Costing Panel
export {
  CostingPanel,
  CostingSectionCard,
  type CostingPanelProps,
  type CostingPickerTarget,
} from './CostingPanel';

// Materials Panel (unified Stock + Materials tab)
export {
  MaterialsPanel,
  type MaterialsPanelProps,
  type BoardMaterial,
  type EdgingMaterial,
} from './MaterialsPanel';

// Results & Preview
export { ResultsSummary, type ResultsSummaryProps } from './ResultsSummary';
export { SheetLayoutGrid, type SheetLayoutGridProps } from './SheetLayoutGrid';

// CSV Import
export { CSVDropzone, type CSVDropzoneProps } from './CSVDropzone';

// Edge Indicator
export { EdgeIndicator, type EdgeIndicatorProps } from './EdgeIndicator';

// Edge Banding Popover
export {
  EdgeBandingPopover,
  type EdgeBandingPopoverProps,
  type EdgeBandingEdges,
  type EdgeBandingOption,
} from './EdgeBandingPopover';

// Custom Lamination Modal
export {
  CustomLaminationModal,
  type CustomLaminationModalProps,
  type LaminationLayer,
  type LaminationConfig,
  type BoardOption,
} from './CustomLaminationModal';

// Workspace (composable wrapper)
export {
  CutlistWorkspace,
  type CutlistWorkspaceProps,
  type CutlistWorkspaceMode,
  type CutlistSnapshot,
  type CutlistPersistenceAdapter,
  type CutlistExportAdapter,
} from '../CutlistWorkspace';
