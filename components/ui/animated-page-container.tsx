import React from 'react';
// Remove framer-motion import
// import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

// Define CSS class names instead of motion variants
const ANIMATION_CLASSES = {
  pageContainer: 'animate-fade-in',
  header: 'animate-slide-down',
  section: 'animate-slide-up',
  content: 'animate-fade-in-up'
};

// Add this to your global CSS file or define it here
const animationStyles = `
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.animate-fade-in {
  animation: fadeIn 0.3s ease forwards;
}

.animate-slide-down {
  animation: slideDown 0.4s ease forwards;
  animation-delay: 0.1s;
  opacity: 0;
}

.animate-slide-up {
  animation: slideUp 0.4s ease forwards;
  animation-delay: 0.2s;
  opacity: 0;
}

.animate-fade-in-up {
  animation: fadeInUp 0.4s ease forwards;
  opacity: 0;
}
`;

// Add the styles when the component is first imported
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.innerHTML = animationStyles;
  document.head.appendChild(style);
}

interface AnimatedPageContainerProps {
  children: React.ReactNode;
}

export function AnimatedPageContainer({ children }: AnimatedPageContainerProps) {
  return (
    <div className={cn("space-y-6", ANIMATION_CLASSES.pageContainer)}>
      {children}
    </div>
  );
}

interface AnimatedHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function AnimatedHeader({ children, className = '' }: AnimatedHeaderProps) {
  return (
    <div className={cn(className, ANIMATION_CLASSES.header)}>
      {children}
    </div>
  );
}

interface AnimatedSectionProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export function AnimatedSection({ 
  children, 
  className = 'space-y-4', 
  delay = 0.2 
}: AnimatedSectionProps) {
  return (
    <div
      className={cn(className, ANIMATION_CLASSES.section)}
      style={{ animationDelay: `${delay}s` }}
    >
      {children}
    </div>
  );
}

interface AnimatedContentProps {
  children: React.ReactNode;
  className?: string;
}

export function AnimatedContent({ children, className = 'space-y-4' }: AnimatedContentProps) {
  return (
    <div
      className={cn(className, ANIMATION_CLASSES.content)}
    >
      {children}
    </div>
  );
} 