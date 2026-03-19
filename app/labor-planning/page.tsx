import { redirect } from 'next/navigation';

export default function LaborPlanningRedirect() {
  redirect('/production?view=schedule');
}
