import { redirect } from 'next/navigation';

export default function FactoryFloorRedirect() {
  redirect('/production?view=floor');
}
