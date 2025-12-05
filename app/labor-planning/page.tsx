import type { Metadata } from 'next';
import { LaborPlanningBoard } from './labor-planning-board';

export const metadata: Metadata = {
  title: 'Labor Planning',
  description: 'Plan labor across orders with time-scaled staff swimlanes.',
};

export default function LaborPlanningPage() {
  return <LaborPlanningBoard />;
}
