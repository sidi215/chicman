import '../../../core/network/api_client.dart';
import '../../auth/domain/phone_number.dart';

/// Customer delivery addresses (spec 05). Same rules as `@chicman/shared`.

const maxAddressesPerCustomer = 10;

/// Default map view (Nouakchott) when no position is known.
const defaultMapLatitude = 18.0858;
const defaultMapLongitude = -15.9785;
const defaultMapZoom = 12.0;

/// Map style: OpenFreeMap vector tiles unless `MAP_STYLE_URL` is defined.
const mapStyleUrl = String.fromEnvironment(
  'MAP_STYLE_URL',
  defaultValue: 'https://tiles.openfreemap.org/styles/liberty',
);

/// Service area: Mauritania's bounding box (with a small margin).
bool isInServiceArea(double latitude, double longitude) =>
    latitude >= 14.6 &&
    latitude <= 27.4 &&
    longitude >= -17.2 &&
    longitude <= -4.7;

enum LocationSource { gps, manual }

String _sourceName(LocationSource source) =>
    source == LocationSource.gps ? 'GPS' : 'MANUAL';

/// The pin. `gps` only while it is exactly where the device position put it.
class PinLocation {
  const PinLocation({
    required this.latitude,
    required this.longitude,
    required this.source,
    this.accuracyMeters,
  });

  /// A pin the customer placed or moved by hand.
  const PinLocation.manual(this.latitude, this.longitude)
    : source = LocationSource.manual,
      accuracyMeters = null;

  final double latitude;
  final double longitude;
  final LocationSource source;
  final int? accuracyMeters;

  static double round6(double value) => (value * 1e6).round() / 1e6;

  bool sameAs(PinLocation other) =>
      round6(latitude) == round6(other.latitude) &&
      round6(longitude) == round6(other.longitude) &&
      source == other.source;
}

/// A saved address (owner response).
class CustomerAddress {
  const CustomerAddress({
    required this.id,
    required this.city,
    required this.district,
    required this.landmark,
    required this.pin,
    required this.isDefault,
    this.label,
    this.deliveryPhone,
  });

  factory CustomerAddress.fromJson(Object? json) {
    final map = json! as Map<String, Object?>;
    return CustomerAddress(
      id: map['id']! as String,
      label: map['label'] as String?,
      city: map['city']! as String,
      district: map['district']! as String,
      landmark: map['landmark']! as String,
      deliveryPhone: map['deliveryPhone'] as String?,
      pin: PinLocation(
        latitude: (map['latitude']! as num).toDouble(),
        longitude: (map['longitude']! as num).toDouble(),
        source: map['locationSource'] == 'GPS'
            ? LocationSource.gps
            : LocationSource.manual,
        accuracyMeters: (map['accuracyMeters'] as num?)?.toInt(),
      ),
      isDefault: map['isDefault'] == true,
    );
  }

  final String id;
  final String? label;
  final String city;
  final String district;
  final String landmark;
  final String? deliveryPhone;
  final PinLocation pin;
  final bool isDefault;
}

List<CustomerAddress> addressListFromJson(Object? json) => [
  for (final item in (json! as Map<String, Object?>)['addresses']! as List)
    CustomerAddress.fromJson(item),
];

enum AddressField { label, city, district, landmark, deliveryPhone }

enum AddressFieldError { required, tooLong, invalid, invalidPhone }

enum LocationError { missing, outsideServiceArea }

const addressFieldLimits = {
  AddressField.label: 50,
  AddressField.city: 100,
  AddressField.district: 100,
  AddressField.landmark: 300,
};

final _control = RegExp('[\u0000-\u001f\u007f-\u009f]');

typedef AddressFormValues = Map<AddressField, String>;

AddressFormValues addressFormValues(CustomerAddress address) => {
  AddressField.label: address.label ?? '',
  AddressField.city: address.city,
  AddressField.district: address.district,
  AddressField.landmark: address.landmark,
  AddressField.deliveryPhone: address.deliveryPhone ?? '',
};

class AddressFormResult {
  const AddressFormResult._(this.body, this.errors, this.locationError);

  /// Allowlisted request body (only when valid).
  final Map<String, Object?> body;
  final Map<AddressField, AddressFieldError> errors;
  final LocationError? locationError;

  bool get isValid => errors.isEmpty && locationError == null;
}

/// Normalized fields (`null` for an empty optional field), or errors.
(Map<AddressField, String?>, Map<AddressField, AddressFieldError>) _normalize(
  AddressFormValues values,
) {
  final out = <AddressField, String?>{};
  final errors = <AddressField, AddressFieldError>{};
  for (final field in AddressField.values) {
    final raw = (values[field] ?? '').trim();
    final optional =
        field == AddressField.label || field == AddressField.deliveryPhone;
    if (raw.isEmpty) {
      if (optional) {
        out[field] = null;
      } else {
        errors[field] = AddressFieldError.required;
      }
      continue;
    }
    if (field == AddressField.deliveryPhone) {
      final phone = normalizePhoneNumber(raw);
      if (phone == null) {
        errors[field] = AddressFieldError.invalidPhone;
      } else {
        out[field] = phone;
      }
      continue;
    }
    // Dart has no built-in NFC normalization: the API normalizes to NFC.
    if (raw.length > addressFieldLimits[field]!) {
      errors[field] = AddressFieldError.tooLong;
    } else if (_control.hasMatch(raw)) {
      errors[field] = AddressFieldError.invalid;
    } else {
      out[field] = raw;
    }
  }
  return (out, errors);
}

LocationError? _locationError(PinLocation? pin) {
  if (pin == null) return LocationError.missing;
  if (!isInServiceArea(pin.latitude, pin.longitude)) {
    return LocationError.outsideServiceArea;
  }
  return null;
}

void _putPin(Map<String, Object?> body, PinLocation pin) {
  body['latitude'] = PinLocation.round6(pin.latitude);
  body['longitude'] = PinLocation.round6(pin.longitude);
  body['locationSource'] = _sourceName(pin.source);
  if (pin.source == LocationSource.gps && pin.accuracyMeters != null) {
    body['accuracyMeters'] = pin.accuracyMeters;
  }
  body['locationConfirmed'] = true;
}

/// `POST /customers/me/addresses`, sent after the customer confirmed.
AddressFormResult buildAddressCreate(
  AddressFormValues values,
  PinLocation? pin,
) {
  final (fields, errors) = _normalize(values);
  final locationError = _locationError(pin);
  if (errors.isNotEmpty || locationError != null) {
    return AddressFormResult._(const {}, errors, locationError);
  }
  final body = <String, Object?>{
    if (fields[AddressField.label] != null) 'label': fields[AddressField.label],
    'city': fields[AddressField.city],
    'district': fields[AddressField.district],
    'landmark': fields[AddressField.landmark],
    if (fields[AddressField.deliveryPhone] != null)
      'deliveryPhone': fields[AddressField.deliveryPhone],
  };
  _putPin(body, pin!);
  return AddressFormResult._(body, const {}, null);
}

/// `PATCH …/:addressId`: changed fields; a moved pin is re-confirmed.
AddressFormResult buildAddressUpdate(
  AddressFormValues values,
  PinLocation pin,
  CustomerAddress current,
) {
  final (fields, errors) = _normalize(values);
  final locationError = _locationError(pin);
  if (errors.isNotEmpty || locationError != null) {
    return AddressFormResult._(const {}, errors, locationError);
  }
  final before = <AddressField, String?>{
    AddressField.label: current.label,
    AddressField.city: current.city,
    AddressField.district: current.district,
    AddressField.landmark: current.landmark,
    AddressField.deliveryPhone: current.deliveryPhone,
  };
  final body = <String, Object?>{
    for (final field in AddressField.values)
      if (fields[field] != before[field]) field.name: fields[field],
  };
  if (!pin.sameAs(current.pin)) _putPin(body, pin);
  return AddressFormResult._(body, const {}, null);
}

enum AddressOutcomeKind {
  ok,
  notFound,
  limitReached,
  outsideServiceArea,
  invalid,
  notBootstrapped,
  signedOut,
  unavailable,
  rateLimited,
  error,
}

class AddressOutcome<T> {
  const AddressOutcome(this.kind, [this.data]);
  final AddressOutcomeKind kind;
  final T? data;
}

AddressOutcome<T> interpretAddressResult<T>(
  ApiResult<T> result,
) => switch (result) {
  ApiOk(:final data) => AddressOutcome(AddressOutcomeKind.ok, data),
  ApiUnauthorized() => const AddressOutcome(AddressOutcomeKind.signedOut),
  ApiForbidden() => const AddressOutcome(AddressOutcomeKind.notBootstrapped),
  ApiAuthUnavailable() ||
  ApiNetworkError() => const AddressOutcome(AddressOutcomeKind.unavailable),
  ApiError(statusCode: 404) => const AddressOutcome(
    AddressOutcomeKind.notFound,
  ),
  ApiError(statusCode: 409, code: 'ADDRESS_LIMIT_REACHED') =>
    const AddressOutcome(AddressOutcomeKind.limitReached),
  ApiError(statusCode: 400, code: 'ADDRESS_OUTSIDE_SERVICE_AREA') =>
    const AddressOutcome(AddressOutcomeKind.outsideServiceArea),
  ApiError(statusCode: 400) => const AddressOutcome(AddressOutcomeKind.invalid),
  ApiError(statusCode: 429) => const AddressOutcome(
    AddressOutcomeKind.rateLimited,
  ),
  ApiError(statusCode: 503) => const AddressOutcome(
    AddressOutcomeKind.unavailable,
  ),
  ApiError() => const AddressOutcome(AddressOutcomeKind.error),
};
