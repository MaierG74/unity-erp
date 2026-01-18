const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
  PageNumber, PageBreak, HeadingLevel, LevelFormat } = require('docx');
const fs = require('fs');

// Colors
const PRIMARY_BLUE = "1E3A5F";
const ACCENT_BLUE = "D5E8F0";
const LIGHT_GRAY = "F5F5F5";
const BORDER_GRAY = "CCCCCC";
const SUCCESS_GREEN = "2E7D32";

// Table border helper
const border = { style: BorderStyle.SINGLE, size: 1, color: BORDER_GRAY };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorders = {
  top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }
};

// Today's date
const today = new Date();
const dateStr = today.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
const validUntil = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
const validUntilStr = validUntil.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: PRIMARY_BLUE },
        paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0 }
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: PRIMARY_BLUE },
        paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 1 }
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 }
      },
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
              new TextRun({ text: "  |  Master Proposal", size: 20, color: "666666" })
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
        children: [new TextRun({ text: "Unity ERP Complete Module Overview", size: 32, color: "333333" })]
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
        children: [new TextRun("Unity ERP provides a comprehensive, modular solution tailored for manufacturing and industrial operations. By centralizing data from the shop floor to the front office, Unity ERP enables real-time visibility, improved efficiency, and data-driven decision making.")]
      }),
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun("This master overview outlines the full ecosystem of available modules. QButton has already successfully implemented core modules for staff time analysis and inventory management, establishing a solid foundation for further digital transformation.")]
      }),

      // YOUR CURRENT INVESTMENT
      new Paragraph({ heading: HeadingLevel.HEADING_1, keepWithNext: true, children: [new TextRun("Your Current Investment")] }),
      new Paragraph({
        spacing: { after: 200 },
        keepWithNext: true,
        children: [new TextRun("QButton has already implemented the following Unity ERP modules:")]
      }),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [6000, 3360],
        rows: [
          new TableRow({
            cantSplit: true,
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
            cantSplit: true,
            children: [
              new TableCell({
                borders,
                width: { size: 6000, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Staff Activity Analytics")] })]
              }),
              new TableCell({
                borders,
                width: { size: 3360, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("R1,250")] })]
              }),
            ]
          }),
          new TableRow({
            cantSplit: true,
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
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("R2,250")] })]
              }),
            ]
          }),
          new TableRow({
            cantSplit: true,
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

      // FULL ECOSYSTEM
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({ heading: HeadingLevel.HEADING_1, keepWithNext: true, children: [new TextRun("The Full Unity ERP Ecosystem")] }),
      new Paragraph({
        spacing: { after: 200 },
        keepWithNext: true,
        children: [new TextRun("The following table provides an overview of all available modules, their current development status, and the investment required for implementation.")]
      }),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [4500, 2500, 2860],
        rows: [
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                borders,
                width: { size: 4500, type: WidthType.DXA },
                shading: { fill: PRIMARY_BLUE, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Module", bold: true, color: "FFFFFF" })] })]
              }),
              new TableCell({
                borders,
                width: { size: 2500, type: WidthType.DXA },
                shading: { fill: PRIMARY_BLUE, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Status", bold: true, color: "FFFFFF" })] })]
              }),
              new TableCell({
                borders,
                width: { size: 2860, type: WidthType.DXA },
                shading: { fill: PRIMARY_BLUE, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Investment", bold: true, color: "FFFFFF" })] })]
              }),
            ]
          }),
          // Modules
          ...[
            { name: "Staff Activity Analytics", status: "IMPLEMENTED", price: "R1,250", highlight: true },
            { name: "Inventory Management", status: "IMPLEMENTED", price: "R2,250", highlight: true },
            { name: "Quoting & Proposals", status: "SPEC READY", price: "R3,000" },
            { name: "Orders", status: "Available", price: "R3,000" },
            { name: "Purchasing", status: "Available", price: "R3,000" },
            { name: "Products", status: "Available", price: "R3,000" },
            { name: "Customers", status: "Available", price: "R3,000" },
            { name: "Labor Planning", status: "Available", price: "R3,000" },
            { name: "Cutlist", status: "Available", price: "R3,000" },
            { name: "To-Dos", status: "Available", price: "R3,000" },
            { name: "Reports", status: "Available", price: "R3,000" },
            { name: "User Control & Access", status: "SPEC READY", price: "R3,000" },
            { name: "Auditing", status: "Available", price: "R3,000" },
          ].map(m => new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                borders,
                width: { size: 4500, type: WidthType.DXA },
                shading: m.highlight ? { fill: ACCENT_BLUE, type: ShadingType.CLEAR } : undefined,
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun(m.name)] })]
              }),
              new TableCell({
                borders,
                width: { size: 2500, type: WidthType.DXA },
                shading: m.highlight ? { fill: ACCENT_BLUE, type: ShadingType.CLEAR } : undefined,
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: m.status, color: m.status === "IMPLEMENTED" ? SUCCESS_GREEN : "333333", bold: m.status === "IMPLEMENTED" })] })]
              }),
              new TableCell({
                borders,
                width: { size: 2860, type: WidthType.DXA },
                shading: m.highlight ? { fill: ACCENT_BLUE, type: ShadingType.CLEAR } : undefined,
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun(m.price)] })]
              }),
            ]
          }))
        ]
      }),

      new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: "Modules marked as IMPLEMENTED are currently active in your environment. All other modules are available for implementation based on your business priorities.", italics: true, size: 18 })] }),

      // PRICING SUMMARY
      new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 400 }, keepWithNext: true, children: [new TextRun("Pricing Summary")] }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({ borders: noBorders, children: [new Paragraph({ children: [new TextRun("Modules Already Purchased (2 modules):")] })] }),
              new TableCell({ borders: noBorders, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("R3,500")] })] }),
            ]
          }),
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({ borders: noBorders, children: [new Paragraph({ children: [new TextRun("Remaining Modules (11 modules):")] })] }),
              new TableCell({ borders: noBorders, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun("R33,000")] })] }),
            ]
          }),
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({ borders: noBorders, children: [new Paragraph({ children: [new TextRun({ text: "Complete System Total:", bold: true })] })] }),
              new TableCell({ borders: noBorders, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "R36,500", bold: true })] })] }),
            ]
          }),
        ]
      }),
      new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: "Individual Module Pricing: R3,000 per module (one-time purchase)", italics: true, size: 18 })] }),

      // PROFESSIONAL SERVICES
      new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 400 }, keepWithNext: true, children: [new TextRun("Professional Services")] }),
      new Paragraph({
        children: [new TextRun("All implementation support, customization, and training services are billed at: "), new TextRun({ text: "R600/hour", bold: true })]
      }),

      // PAGE BREAK
      new Paragraph({ children: [new PageBreak()] }),

      // ACCEPTANCE
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Acceptance")] }),
      new Paragraph({
        spacing: { after: 300 },
        children: [new TextRun("By signing below, you acknowledge receipt of this master overview and express interest in the modular expansion of your Unity ERP environment.")]
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
      new Paragraph({
        spacing: { before: 600 }, alignment: AlignmentType.CENTER, children: [
          new TextRun({ text: "Thank you for choosing Unity ERP as your business management partner.", italics: true, color: "666666" })
        ]
      }),
    ]
  }]
});

const outputPath = "/Users/gregmaier/Documents/Projects/unity-erp/docs/sales/PROPOSAL_Master_Overview_QButton.docx";
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outputPath, buffer);
  console.log("Master Proposal created: " + outputPath);
});
