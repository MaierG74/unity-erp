import type { Config } from "tailwindcss";

/**
 * Tailwind CSS Configuration for Unity ERP
 *
 * COLOR SYSTEM:
 * All colors are defined as CSS custom properties in globals.css
 * and referenced here using hsl(var(--color-name)).
 *
 * This enables:
 * - Centralized color management
 * - Easy theme switching (light/dark)
 * - Simple rollback if needed
 *
 * SEMANTIC COLORS:
 * - primary: Main brand color (teal) for CTAs and active states
 * - secondary: Slate for secondary actions
 * - accent: Highlights and icons
 * - success: Green for positive actions/metrics
 * - warning: Amber for caution states
 * - info: Blue for informational elements
 * - destructive: Red for errors/deletions
 */

const config: Config = {
    darkMode: "class",
    content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px'
      }
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'monospace'],
      },
      colors: {
        /* Surface colors */
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',

        /* Primary: Teal - Main CTAs, active navigation, links */
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },

        /* Secondary: Slate - Secondary actions, muted buttons */
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },

        /* Accent: For highlights and icons */
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },

        /* Muted: Disabled states, placeholders */
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },

        /* Popover/Card surfaces */
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },

        /* Semantic colors - new additions for unified palette */

        /* Success: Green for positive actions, growth indicators */
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))'
        },

        /* Warning: Amber for caution states, pending items */
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))'
        },

        /* Info: Blue for informational messages */
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))'
        },

        /* Destructive: Red for errors, deletions */
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },

        /* Chart colors for data visualization */
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))'
        }
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      boxShadow: {
        /* Card shadow using CSS variable */
        'card': '0 1px 3px hsl(var(--card-shadow))',
      }
    }
  },
  plugins: [require("tailwindcss-animate")],
}
export default config;
