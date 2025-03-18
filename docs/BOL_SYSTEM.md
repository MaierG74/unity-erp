# Bill of Labor (BOL) System

This document provides an overview of the Bill of Labor (BOL) system, which allows tracking labor costs for products with versioned hourly rates.

## Overview

The Bill of Labor system consists of:

1. **Job Categories** - Categories of labor with hourly rates
2. **Job Category Rates** - Historical versions of hourly rates for each category
3. **Jobs** - Specific labor operations assigned to categories
4. **Bill of Labor Items** - Association of jobs with products, including time required and quantity

## Database Schema

The system uses the following tables:

- `job_categories` - Stores labor categories with current hourly rates
- `job_category_rates` - Stores historical rate versions for each category
- `jobs` - Stores labor operations, each assigned to a category
- `billoflabour` - Stores BOL items for products

## Features

- **Versioned Rates**: Track historical changes to labor rates
- **Time Units**: Specify time in hours, minutes, or seconds
- **Quantity**: Specify how many times a job is performed
- **Total Cost Calculation**: Automatically calculate labor costs based on time, quantity, and rates

## Management Interfaces

### Labor Management Page (`/labor`)

This page provides interfaces to manage job categories and jobs:

1. **Job Categories Tab**:
   - Create, edit, and delete job categories
   - Set hourly rates for categories
   - View and manage historical rate versions

2. **Jobs Tab**:
   - Create, edit, and delete jobs
   - Assign jobs to categories

### Product BOL Component

The `ProductBOL` component on the product detail page allows:

- Adding jobs to a product's bill of labor
- Specifying time required, time unit, and quantity
- Viewing total labor time and cost
- Editing or removing BOL items

## How to Use

### Setting Up Labor Categories and Rates

1. Navigate to `/labor` and select the "Job Categories" tab
2. Create categories for different types of labor (e.g., Assembly, Machining, Finishing)
3. Set the current hourly rate for each category
4. To add historical rate versions, select a category and click "Add New Rate Version"

### Creating Jobs

1. Navigate to `/labor` and select the "Jobs" tab
2. Create jobs and assign them to appropriate categories
3. Add descriptive information for each job

### Adding BOL Items to Products

1. Navigate to a product detail page
2. Select the "Bill of Labor" tab
3. Use the form to add jobs to the product:
   - Select a job category
   - Select a job from that category
   - Specify time required and time unit (hours, minutes, seconds)
   - Specify quantity (how many times the job is performed)
4. The system will automatically calculate the total cost based on the current rate

### Updating Rates

When labor rates change:

1. Navigate to `/labor` and select the "Job Categories" tab
2. Select the category that needs a rate update
3. Click "Add New Rate Version"
4. Enter the new hourly rate and effective date
5. The system will automatically use the appropriate rate based on the effective date

## Running Database Migrations

To update your database schema for the BOL system:

```bash
# Run the migration script
node scripts/run-migrations.js db/migrations/bol_schema_update.sql
```

## Implementation Details

The BOL system is implemented using:

- React components with TypeScript
- Supabase for database storage
- React Query for data fetching and mutations
- React Hook Form with Zod validation for forms
- Tailwind CSS with shadcn/ui components for UI 