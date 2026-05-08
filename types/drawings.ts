export type DrawingSource = 'none' | 'manual' | 'product';

export interface OrderDetailDrawing {
  id: number;
  order_detail_id: number;
  bol_id: number;
  drawing_url: string;
  org_id: string;
  uploaded_by: string | null;
  uploaded_at: string;
}

export type ResolvedDrawingSource =
  | { source: 'override'; url: string }
  | { source: 'bol'; url: string }
  | { source: 'product'; url: string }
  | null;
