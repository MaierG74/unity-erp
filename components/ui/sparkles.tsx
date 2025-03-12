"use client";
import React, { useId } from "react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { motion, useAnimation } from "framer-motion";

type ParticlesProps = {
  id?: string;
  className?: string;
  background?: string;
  particleSize?: number;
  minSize?: number;
  maxSize?: number;
  speed?: number;
  particleColor?: string;
  particleDensity?: number;
};

// Sparkle animation keyframes defined as CSS string
const sparkleAnimation = `
@keyframes sparkle {
  0% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.2); }
  100% { opacity: 0.3; transform: scale(1); }
}
`;

// Create a simpler version without tsparticles for better compatibility
export const SparklesCore = (props: ParticlesProps) => {
  const {
    id,
    className,
    background = "#0d47a1",
    particleColor = "#ffffff",
    particleDensity = 50,
    minSize = 0.6,
    maxSize = 1.4
  } = props;
  const [init, setInit] = useState(false);
  const controls = useAnimation();
  const generatedId = useId();

  useEffect(() => {
    // Add the keyframes to the document head
    const styleElement = document.createElement('style');
    styleElement.innerHTML = sparkleAnimation;
    document.head.appendChild(styleElement);
    
    // Simple timeout to simulate initialization
    const timer = setTimeout(() => {
      setInit(true);
    }, 100);
    
    return () => {
      clearTimeout(timer);
      document.head.removeChild(styleElement);
    };
  }, []);

  useEffect(() => {
    if (init) {
      controls.start({
        opacity: 1,
        transition: {
          duration: 1
        }
      }).catch(err => {
        console.error("Animation error:", err);
      });
    }
  }, [init, controls]);

  // Generate static sparkles
  const sparkles = [];
  const numSparkles = particleDensity || 50;
  
  for (let i = 0; i < numSparkles; i++) {
    const sizeRange = maxSize - minSize;
    const size = (Math.random() * sizeRange + minSize) * 2;
    const top = Math.random() * 100;
    const left = Math.random() * 100;
    const animationDuration = Math.random() * 2 + 1;
    const delay = Math.random() * 1;
    
    sparkles.push(
      <div
        key={i}
        className="sparkle absolute rounded-full"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          top: `${top}%`,
          left: `${left}%`,
          backgroundColor: particleColor,
          opacity: Math.random() * 0.7 + 0.3,
          animation: `sparkle ${animationDuration}s ease-in-out infinite`,
          animationDelay: `${delay}s`,
        }}
      />
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={controls} 
      className={cn("opacity-0 relative", className)}
      style={{ background }}
    >
      {init && (
        <div 
          id={id || generatedId}
          className={cn("h-full w-full absolute inset-0 overflow-hidden")}
        >
          {/* Static sparkles effect */}
          <div className="sparkles-container">
            {sparkles}
          </div>
        </div>
      )}
    </motion.div>
  );
};
