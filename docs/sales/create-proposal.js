const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
        PageNumber, PageBreak, HeadingLevel, LevelFormat } = require('docx');
const fs = require('fs');

// Colors
const PRIMARY_BLUE = "1E3A5F";
const ACCENT_BLUE = "D5E8F0";
const LIGHT_GRAY = "F5F5F5";
const BORDER_GRAY = "CCCCCC";

// Table border helper
const border = { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorders = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
                    left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } };

// Today's date
const today = new Date();
const dateStr = today.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
const validUntil = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
const validUntilStr = validUntil.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: PRIMARY_BLUE },
        paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: PRIMARY_BLUE },
        paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ]
  },
  numbering: {
    config: [
      { reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "checkmarks",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "✓", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: "Unity ERP", bold: true, size: 20, color: PRIMARY_BLUE }),
              new TextRun({ text: "  |  Module Proposal", size: 20, color: "666666" })
            ]
          })
        ]
      })
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Page ", size: 18, color: "666666" }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "666666" }),
              new TextRun({ text: " of ", size: 18, color: "666666" }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: "666666" })
            ]
          })
        ]
      })
    },
    children: [
      // TITLE SECTION
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({ text: "PROPOSAL", size: 48, bold: true, color: PRIMARY_BLUE })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [new TextRun({ text: "Quoting & Proposals Module", size: 32, color: "333333" })]
      }),

      // Client info table
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [4680, 4680],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: noBorders,
                width: { size: 4680, type: WidthType.DXA },
                children: [
                  new Paragraph({ children: [new TextRun({ text: "Prepared For:", bold: true, size: 20, color: "666666" })] }),
                  new Paragraph({ spacing: { before: 100 }, children: [new TextRun({ text: "QButton", bold: true, size: 24 })] }),
                ]
              }),
              new TableCell({
                borders: noBorders,
                width: { size: 4680, type: WidthType.DXA },
                children: [
                  new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Date:", bold: true, size: 20, color: "666666" })] }),
                  new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 100 }, children: [new TextRun({ text: dateStr, size: 22 })] }),
                  new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 100 }, children: [new TextRun({ text: "Valid Until:", bold: true, size: 20, color: "666666" })] }),
                  new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 50 }, children: [new TextRun({ text: validUntilStr, size: 22 })] }),
                ]
              }),
            ]
          })
        ]
      }),

      new Paragraph({ spacing: { before: 400, after: 200 }, children: [] }),

      // EXECUTIVE SUMMARY
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Executive Summary")] }),
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun("This proposal outlines the Quoting & Proposals Module for Unity ERP, designed to streamline your quote creation, customer communication, and sales workflow.")]
      }),
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun("Building on your existing investment in Staff Time Analysis and Inventory modules, the Quoting module will enable professional quote generation with PDF output, email delivery, and seamless conversion to sales orders.")]
      }),

      // YOUR CURRENT INVESTMENT
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Your Current Investment")] }),
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun("QButton has already implemented the following Unity ERP modules:")]
      }),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [6000, 3360],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 6000, type: WidthType.DXA },
                shading: { fill: PRIMARY_BLUE, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Module", bold: true, color: "FFFFFF" })] })]
              }),
              new TableCell({
                borders,
                width: { size: 3360, type: WidthType.DXA },
                shading: { fill: PRIMARY_BLUE, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Investment", bold: true, color: "FFFFFF" })] })]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 6000, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Staff Time Analysis")] })]
              }),
              new TableCell({
                borders,
                width: { size: 3360, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("R1,750")] })]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 6000, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Inventory Management")] })]
              }),
              new TableCell({
                borders,
                width: { size: 3360, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("R1,750")] })]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 6000, type: WidthType.DXA },
                shading: { fill: LIGHT_GRAY, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Total Invested", bold: true })] })]
              }),
              new TableCell({
                borders,
                width: { size: 3360, type: WidthType.DXA },
                shading: { fill: LIGHT_GRAY, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "R3,500", bold: true })] })]
              }),
            ]
          }),
        ]
      }),

      // PAGE BREAK
      new Paragraph({ children: [new PageBreak()] }),

      // PROPOSED MODULE
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Proposed Module: Quoting & Proposals")] }),
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun("The Quoting & Proposals Module enables professional quote creation, pricing management, and customer communication. It supports complex multi-line quotes, automatic costing, PDF generation, email delivery, and seamless conversion to sales orders.")]
      }),

      // KEY FEATURES
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Key Features")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("Quote Management")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Create, edit, and manage quotes with full status tracking")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Customer selection with auto-population of details")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Quote validity periods and terms & conditions")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Internal notes (hidden) and customer-facing notes")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200 }, children: [new TextRun("Line Items & Pricing")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Add products from catalog with automatic pricing")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Manual line items with custom descriptions")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Discount percentages or fixed amounts per line")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Markup calculations and line totals")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Drag-and-drop reordering")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200 }, children: [new TextRun("Quote Clustering (Complex Quotes)")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Group line items into logical clusters (e.g., Kitchen Cabinets, Bathroom Vanity)")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Labor lines: hours × rate with descriptions")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Material lines: components with quantity and cost")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Cluster-level markup applied to subtotals")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200 }, children: [new TextRun("Cutlist Integration")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Board optimization for sheet materials")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Visual cut layout preview")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Material waste calculation")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Automatic cost calculation from cutlist")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200 }, children: [new TextRun("PDF & Email")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Professional PDF generation with company branding")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Email delivery with PDF attachment")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Customizable email templates")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Email tracking (sent date/time)")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200 }, children: [new TextRun("Quote-to-Order Conversion")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("One-click conversion to sales order")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("All line items and attachments transferred")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Quote marked as Converted with link to order")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200 }, children: [new TextRun("Additional Features")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("File attachments at quote and item level")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Quote versioning and history")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Activity tracking and audit trail")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Mobile-responsive design")] }),

      // PAGE BREAK
      new Paragraph({ children: [new PageBreak()] }),

      // INVESTMENT
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Investment")] }),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [6000, 3360],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 6000, type: WidthType.DXA },
                shading: { fill: PRIMARY_BLUE, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Item", bold: true, color: "FFFFFF" })] })]
              }),
              new TableCell({
                borders,
                width: { size: 3360, type: WidthType.DXA },
                shading: { fill: PRIMARY_BLUE, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Amount", bold: true, color: "FFFFFF" })] })]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 6000, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Quoting & Proposals Module")] })]
              }),
              new TableCell({
                borders,
                width: { size: 3360, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("R3,000")] })]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 6000, type: WidthType.DXA },
                shading: { fill: ACCENT_BLUE, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Total Investment", bold: true })] })]
              }),
              new TableCell({
                borders,
                width: { size: 3360, type: WidthType.DXA },
                shading: { fill: ACCENT_BLUE, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "R3,000", bold: true, size: 26 })] })]
              }),
            ]
          }),
        ]
      }),

      new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: "This is a one-time purchase. You own the module outright with no recurring software fees.", italics: true })] }),

      // ONGOING COSTS
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Ongoing Infrastructure Costs (Client Responsibility)")] }),
      new Paragraph({
        spacing: { after: 150 },
        children: [new TextRun("The following hosting costs are paid directly to the service providers:")]
      }),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [3500, 3000, 2860],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 3500, type: WidthType.DXA },
                shading: { fill: LIGHT_GRAY, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Service", bold: true })] })]
              }),
              new TableCell({
                borders,
                width: { size: 3000, type: WidthType.DXA },
                shading: { fill: LIGHT_GRAY, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Plan", bold: true })] })]
              }),
              new TableCell({
                borders,
                width: { size: 2860, type: WidthType.DXA },
                shading: { fill: LIGHT_GRAY, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Cost", bold: true })] })]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 3500, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Supabase (Database)")] })]
              }),
              new TableCell({
                borders,
                width: { size: 3000, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Pro")] })]
              }),
              new TableCell({
                borders,
                width: { size: 2860, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("~$25/month")] })]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 3500, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Netlify (Hosting)")] })]
              }),
              new TableCell({
                borders,
                width: { size: 3000, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Free")] })]
              }),
              new TableCell({
                borders,
                width: { size: 2860, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("$0")] })]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 3500, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Resend (Email)")] })]
              }),
              new TableCell({
                borders,
                width: { size: 3000, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Free (3,000/month)")] })]
              }),
              new TableCell({
                borders,
                width: { size: 2860, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("$0")] })]
              }),
            ]
          }),
        ]
      }),

      // PROFESSIONAL SERVICES
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Professional Services")] }),
      new Paragraph({
        spacing: { after: 150 },
        children: [new TextRun("Additional services are available on an as-needed basis:")]
      }),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [6000, 3360],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 6000, type: WidthType.DXA },
                shading: { fill: LIGHT_GRAY, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Service", bold: true })] })]
              }),
              new TableCell({
                borders,
                width: { size: 3360, type: WidthType.DXA },
                shading: { fill: LIGHT_GRAY, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Rate", bold: true })] })]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 6000, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Updates & New Features")] })]
              }),
              new TableCell({
                borders,
                width: { size: 3360, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("R600/hour")] })]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 6000, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Bug Fixes & Support")] })]
              }),
              new TableCell({
                borders,
                width: { size: 3360, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("R600/hour")] })]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 6000, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Training")] })]
              }),
              new TableCell({
                borders,
                width: { size: 3360, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("R600/hour")] })]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 6000, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Custom Development")] })]
              }),
              new TableCell({
                borders,
                width: { size: 3360, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("R600/hour")] })]
              }),
            ]
          }),
        ]
      }),

      // PAGE BREAK
      new Paragraph({ children: [new PageBreak()] }),

      // TIMELINE
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Implementation Timeline")] }),
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun("Estimated delivery: 2-3 weeks from acceptance")]
      }),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [2500, 2000, 4860],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 2500, type: WidthType.DXA },
                shading: { fill: PRIMARY_BLUE, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Phase", bold: true, color: "FFFFFF" })] })]
              }),
              new TableCell({
                borders,
                width: { size: 2000, type: WidthType.DXA },
                shading: { fill: PRIMARY_BLUE, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Duration", bold: true, color: "FFFFFF" })] })]
              }),
              new TableCell({
                borders,
                width: { size: 4860, type: WidthType.DXA },
                shading: { fill: PRIMARY_BLUE, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Activities", bold: true, color: "FFFFFF" })] })]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders, width: { size: 2500, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Setup")] })] }),
              new TableCell({ borders, width: { size: 2000, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("1-2 days")] })] }),
              new TableCell({ borders, width: { size: 4860, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Database migrations, basic structure")] })] }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders, width: { size: 2500, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Core Features")] })] }),
              new TableCell({ borders, width: { size: 2000, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("3-5 days")] })] }),
              new TableCell({ borders, width: { size: 4860, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Quote CRUD, line items, totals")] })] }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders, width: { size: 2500, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Advanced")] })] }),
              new TableCell({ borders, width: { size: 2000, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("3-5 days")] })] }),
              new TableCell({ borders, width: { size: 4860, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Clustering, cutlist, attachments")] })] }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders, width: { size: 2500, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("PDF & Email")] })] }),
              new TableCell({ borders, width: { size: 2000, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("2-3 days")] })] }),
              new TableCell({ borders, width: { size: 4860, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("PDF generation, email delivery")] })] }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders, width: { size: 2500, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Testing")] })] }),
              new TableCell({ borders, width: { size: 2000, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("2-3 days")] })] }),
              new TableCell({ borders, width: { size: 4860, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Bug fixes, UI polish, documentation")] })] }),
            ]
          }),
        ]
      }),

      // NEXT STEPS
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Next Steps")] }),
      new Paragraph({
        spacing: { after: 100 },
        children: [new TextRun("To proceed with this proposal:")]
      }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Review and approve this proposal")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Confirm payment of R3,000")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Schedule kickoff meeting")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Development begins within 2 business days of payment")] }),

      // ACCEPTANCE
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Acceptance")] }),
      new Paragraph({
        spacing: { after: 300 },
        children: [new TextRun("By signing below, you accept this proposal and agree to the terms outlined above.")]
      }),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [4680, 4680],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: noBorders,
                width: { size: 4680, type: WidthType.DXA },
                children: [
                  new Paragraph({ spacing: { after: 600 }, children: [new TextRun("_________________________________")] }),
                  new Paragraph({ children: [new TextRun({ text: "Signature", size: 20 })] }),
                ]
              }),
              new TableCell({
                borders: noBorders,
                width: { size: 4680, type: WidthType.DXA },
                children: [
                  new Paragraph({ spacing: { after: 600 }, children: [new TextRun("_________________________________")] }),
                  new Paragraph({ children: [new TextRun({ text: "Date", size: 20 })] }),
                ]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                borders: noBorders,
                width: { size: 4680, type: WidthType.DXA },
                children: [
                  new Paragraph({ spacing: { before: 300, after: 600 }, children: [new TextRun("_________________________________")] }),
                  new Paragraph({ children: [new TextRun({ text: "Print Name", size: 20 })] }),
                ]
              }),
              new TableCell({
                borders: noBorders,
                width: { size: 4680, type: WidthType.DXA },
                children: [
                  new Paragraph({ spacing: { before: 300, after: 600 }, children: [new TextRun("_________________________________")] }),
                  new Paragraph({ children: [new TextRun({ text: "Company", size: 20 })] }),
                ]
              }),
            ]
          }),
        ]
      }),

      // FOOTER
      new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: "Thank you for your continued partnership with Unity ERP.", italics: true, color: "666666" })
      ]}),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/sessions/gallant-wonderful-noether/mnt/unity-erp/docs/sales/PROPOSAL_QButton_Quoting_Module.docx", buffer);
  console.log("Proposal created: PROPOSAL_QButton_Quoting_Module.docx");
});
