export const DERIVED_SURCHARGE_FIELDS = ['surcharge_total', 'cutlist_surcharge_resolved'] as const;

type DerivedSurchargeField = (typeof DERIVED_SURCHARGE_FIELDS)[number];

export function getPresentDerivedSurchargeFields(payload: Record<string, unknown>): DerivedSurchargeField[] {
  return DERIVED_SURCHARGE_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(payload, field)
  );
}

export function warnOnDerivedSurchargeFieldWrite(params: {
  route: string;
  payload: Record<string, unknown>;
  callerInfo?: Record<string, unknown>;
}) {
  for (const field of getPresentDerivedSurchargeFields(params.payload)) {
    console.warn('[PATCH] derived field write detected', {
      route: params.route,
      field,
      value: params.payload[field],
      callerInfo: params.callerInfo ?? {},
    });
  }
}
