export type EmploymentType = 'monthly' | 'weekly' | 'hourly' | 'piecework' | 'casual';

export const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'monthly', label: 'Monthly (salaried)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'piecework', label: 'Piecework' },
  { value: 'casual', label: 'Casual' },
];

export const isEmploymentType = (value: unknown): value is EmploymentType =>
  typeof value === 'string' && EMPLOYMENT_TYPES.some((type) => type.value === value);
