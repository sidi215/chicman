import { z } from "zod";

import { plainText, shopPhoneSchema } from "../shops/schemas.js";

/** Customer delivery addresses (spec 05). */

export const ADDRESS_FIELD_LIMITS = { label: 50, city: 100, district: 100, landmark: 300 } as const;

/** At most this many saved addresses per customer. */
export const MAX_ADDRESSES_PER_CUSTOMER = 10;

/** How the pin was obtained. Every address has a confirmed map location. */
export const ADDRESS_LOCATION_SOURCES = ["GPS", "MANUAL"] as const;
export type AddressLocationSource = (typeof ADDRESS_LOCATION_SOURCES)[number];

/** Service area: Mauritania's bounding box (with a small margin). */
export const SERVICE_AREA = { minLatitude: 14.6, maxLatitude: 27.4, minLongitude: -17.2, maxLongitude: -4.7 } as const;

/** Default map view (Nouakchott) when no position is known. */
export const DEFAULT_MAP_CENTER = { latitude: 18.0858, longitude: -15.9785, zoom: 12 } as const;

export function isInServiceArea(latitude: number, longitude: number): boolean {
  return (
    latitude >= SERVICE_AREA.minLatitude &&
    latitude <= SERVICE_AREA.maxLatitude &&
    longitude >= SERVICE_AREA.minLongitude &&
    longitude <= SERVICE_AREA.maxLongitude
  );
}

/**
 * Error codes of the address endpoints.
 * - `ADDRESS_NOT_FOUND` (404): no such address for this customer (another
 *   customer's address is not disclosed).
 * - `ADDRESS_LIMIT_REACHED` (409): the customer already has the maximum.
 * - `ADDRESS_OUTSIDE_SERVICE_AREA` (400): the pin is outside Mauritania.
 * - `ADDRESS_LOCATION_NOT_CONFIRMED` (400): a new or moved location was sent
 *   without `locationConfirmed: true`.
 */
export const ADDRESS_ERROR_CODES = {
  notFound: "ADDRESS_NOT_FOUND",
  limitReached: "ADDRESS_LIMIT_REACHED",
  outsideServiceArea: "ADDRESS_OUTSIDE_SERVICE_AREA",
  locationNotConfirmed: "ADDRESS_LOCATION_NOT_CONFIRMED",
} as const;

/** Coordinates rounded to 6 decimals (about 0.1 m), as stored. */
const coordinate = (min: number, max: number) =>
  z
    .number()
    .finite()
    .min(min)
    .max(max)
    .transform((value) => Math.round(value * 1e6) / 1e6);

const latitude = coordinate(-90, 90);
const longitude = coordinate(-180, 180);
const accuracyMeters = z.number().finite().min(0).max(100_000).transform((value) => Math.round(value));

const label = plainText(1, ADDRESS_FIELD_LIMITS.label);
const city = plainText(1, ADDRESS_FIELD_LIMITS.city);
const district = plainText(1, ADDRESS_FIELD_LIMITS.district);
const landmark = plainText(1, ADDRESS_FIELD_LIMITS.landmark);

/**
 * `POST /api/v1/customers/me/addresses`. Strict: unknown or protected
 * fields fail. `locationConfirmed` must be `true` (the customer confirmed
 * the pin and details); it is not stored as sent.
 */
export const addressCreateSchema = z.strictObject({
  label: label.nullable().optional(),
  city,
  district,
  landmark,
  deliveryPhone: shopPhoneSchema.nullable().optional(),
  latitude,
  longitude,
  locationSource: z.enum(ADDRESS_LOCATION_SOURCES),
  accuracyMeters: accuracyMeters.nullable().optional(),
  locationConfirmed: z.literal(true),
});
export type AddressCreateInput = z.output<typeof addressCreateSchema>;

/**
 * `PATCH …/addresses/:addressId`: any non-empty subset. Changing the
 * location needs `latitude`, `longitude`, and `locationSource` together and
 * `locationConfirmed: true` (checked by the API). `null` clears `label`,
 * `deliveryPhone`, or `accuracyMeters`.
 */
export const addressUpdateSchema = z
  .strictObject({
    label: label.nullable().optional(),
    city: city.optional(),
    district: district.optional(),
    landmark: landmark.optional(),
    deliveryPhone: shopPhoneSchema.nullable().optional(),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    locationSource: z.enum(ADDRESS_LOCATION_SOURCES).optional(),
    accuracyMeters: accuracyMeters.nullable().optional(),
    locationConfirmed: z.literal(true).optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== "locationConfirmed"), { message: "at least one field is required" })
  .refine(
    (value) => {
      const parts = [value.latitude, value.longitude, value.locationSource].filter((part) => part !== undefined).length;
      return parts === 0 || parts === 3;
    },
    { message: "latitude, longitude, and locationSource change together" },
  );
export type AddressUpdateInput = z.output<typeof addressUpdateSchema>;

/** A saved address, as returned to its owner (allowlisted fields). */
export interface CustomerAddress {
  id: string;
  label: string | null;
  city: string;
  district: string;
  landmark: string;
  deliveryPhone: string | null;
  latitude: number;
  longitude: number;
  locationSource: AddressLocationSource;
  accuracyMeters: number | null;
  locationConfirmedAt: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/v1/customers/me/addresses`: default first, then most recently updated. */
export interface CustomerAddressListResponse {
  addresses: CustomerAddress[];
}
