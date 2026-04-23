import { cn } from '@/lib/utils';

type DisabledStampProps = {
  size?: 'sm' | 'md';
  className?: string;
};

export function DisabledStamp({ size = 'md', className }: DisabledStampProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border-2 border-destructive/70 font-bold uppercase text-destructive/80',
        size === 'md' && 'px-2 py-0.5 text-xs tracking-[0.2em]',
        size === 'sm' && 'px-1.5 py-0 text-[10px] tracking-[0.15em]',
        className
      )}
    >
      Disabled
    </span>
  );
}
