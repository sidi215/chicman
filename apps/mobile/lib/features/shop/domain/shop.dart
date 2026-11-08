import 'dart:typed_data';

import '../../../core/network/api_client.dart';
import '../../auth/domain/phone_number.dart';

/// Shop status (`Shop.status`, authoritative on the server).
enum ShopStatus { pending, approved, rejected, suspended }

ShopStatus _status(String value) => switch (value) {
  'APPROVED' => ShopStatus.approved,
  'REJECTED' => ShopStatus.rejected,
  'SUSPENDED' => ShopStatus.suspended,
  _ => ShopStatus.pending,
};

/// Latest administrative shop decision (no reason).
enum ShopDecisionType {
  applicationApproved,
  applicationRejected,
  suspended,
  reinstated,
}

ShopDecisionType? _decision(String? value) => switch (value) {
  'APPLICATION_APPROVED' => ShopDecisionType.applicationApproved,
  'APPLICATION_REJECTED' => ShopDecisionType.applicationRejected,
  'SUSPENDED' => ShopDecisionType.suspended,
  'REINSTATED' => ShopDecisionType.reinstated,
  _ => null,
};

enum ChangeRequestStatus { pending, approved, rejected }

class ShopChangeRequest {
  const ShopChangeRequest({
    required this.id,
    required this.status,
    required this.submittedAt,
    this.proposedShopName,
    this.proposedCity,
    this.decidedAt,
  });

  final String id;
  final String? proposedShopName;
  final String? proposedCity;
  final ChangeRequestStatus status;
  final DateTime submittedAt;
  final DateTime? decidedAt;
}

/// The owner's shop (`GET /sellers/me/shop`). The response never carries
/// internal reasons, internal notes, or administrator identities.
class OwnerShop {
  const OwnerShop({
    required this.id,
    required this.status,
    required this.shopName,
    required this.description,
    required this.contactPhone,
    required this.city,
    required this.address,
    required this.updatedAt,
    this.whatsappPhone,
    this.logoUrl,
    this.latestDecision,
    this.latestDecisionAt,
    this.rejectionReason,
    this.rejectedAt,
    this.changeRequest,
  });

  factory OwnerShop.fromJson(Object? json) {
    final map = json! as Map<String, Object?>;
    final decision = map['latestDecision'] as Map<String, Object?>?;
    final rejection = map['rejection'] as Map<String, Object?>?;
    final request = map['changeRequest'] as Map<String, Object?>?;
    return OwnerShop(
      id: map['id']! as String,
      status: _status(map['status']! as String),
      shopName: map['shopName']! as String,
      description: map['description']! as String,
      contactPhone: map['contactPhone']! as String,
      whatsappPhone: map['whatsappPhone'] as String?,
      city: map['city']! as String,
      address: map['address']! as String,
      logoUrl: map['logoUrl'] as String?,
      updatedAt: DateTime.parse(map['updatedAt']! as String),
      latestDecision: _decision(decision?['type'] as String?),
      latestDecisionAt: decision == null
          ? null
          : DateTime.parse(decision['decidedAt']! as String),
      rejectionReason: rejection?['applicantReason'] as String?,
      rejectedAt: rejection == null
          ? null
          : DateTime.parse(rejection['rejectedAt']! as String),
      changeRequest: request == null
          ? null
          : ShopChangeRequest(
              id: request['id']! as String,
              proposedShopName: request['proposedShopName'] as String?,
              proposedCity: request['proposedCity'] as String?,
              status: switch (request['status']) {
                'APPROVED' => ChangeRequestStatus.approved,
                'REJECTED' => ChangeRequestStatus.rejected,
                _ => ChangeRequestStatus.pending,
              },
              submittedAt: DateTime.parse(request['submittedAt']! as String),
              decidedAt: request['decidedAt'] == null
                  ? null
                  : DateTime.parse(request['decidedAt']! as String),
            ),
    );
  }

  final String id;
  final ShopStatus status;
  final String shopName;
  final String description;
  final String contactPhone;
  final String? whatsappPhone;
  final String city;
  final String address;
  final String? logoUrl;
  final DateTime updatedAt;
  final ShopDecisionType? latestDecision;
  final DateTime? latestDecisionAt;

  /// Only while `REJECTED`: the owner-facing rejection reason.
  final String? rejectionReason;
  final DateTime? rejectedAt;
  final ShopChangeRequest? changeRequest;
}

/// The text fields of a shop application.
enum ShopField {
  shopName,
  description,
  contactPhone,
  whatsappPhone,
  city,
  address,
}

enum ShopFieldError { required, tooLong, invalid, invalidPhone }

/// Bounds after trimming (spec 06; same as `@chicman/shared`).
const shopFieldLimits = {
  ShopField.shopName: 100,
  ShopField.description: 2000,
  ShopField.city: 100,
  ShopField.address: 300,
};

const _reviewFields = {ShopField.shopName, ShopField.city};

// Same rules as the API: control characters are refused (line feeds are
// allowed in the description only).
final _control = RegExp('[\u0000-\u001f\u007f-\u009f]');
final _controlExceptLineFeed = RegExp(
  '[\u0000-\u0009\u000b-\u001f\u007f-\u009f]',
);

/// Fields the owner may edit directly in a status (rules 3, 4, 8).
List<ShopField> directlyEditableFields(ShopStatus status) => switch (status) {
  ShopStatus.pending || ShopStatus.rejected => ShopField.values,
  ShopStatus.approved =>
    ShopField.values.where((f) => !_reviewFields.contains(f)).toList(),
  ShopStatus.suspended => const [],
};

/// Field values as typed in the form.
typedef ShopFormValues = Map<ShopField, String>;

ShopFormValues shopFormValues(OwnerShop shop) => {
  ShopField.shopName: shop.shopName,
  ShopField.description: shop.description,
  ShopField.contactPhone: shop.contactPhone,
  ShopField.whatsappPhone: shop.whatsappPhone ?? '',
  ShopField.city: shop.city,
  ShopField.address: shop.address,
};

/// New values for a form: fields still equal to [baseline] take [next]; other
/// fields are unsaved edits and stay.
ShopFormValues mergeShopFormValues(
  ShopFormValues current,
  ShopFormValues baseline,
  ShopFormValues next,
) => {
  for (final field in ShopField.values)
    field:
        (current[field] == baseline[field] ? next[field] : current[field]) ??
        '',
};

/// A validated request body (allowlisted keys only), or field errors.
class ShopFormResult {
  const ShopFormResult._(this.body, this.errors);

  final Map<String, Object?> body;
  final Map<ShopField, ShopFieldError> errors;

  bool get isValid => errors.isEmpty;
}

/// Normalizes one field; returns the value (`null` clears WhatsApp) or an error.
(Object?, ShopFieldError?) _normalize(ShopField field, String raw) {
  if (field == ShopField.contactPhone || field == ShopField.whatsappPhone) {
    if (field == ShopField.whatsappPhone && raw.trim().isEmpty) {
      return (null, null);
    }
    final phone = normalizePhoneNumber(raw);
    return phone == null ? (null, ShopFieldError.invalidPhone) : (phone, null);
  }
  // Dart has no built-in NFC normalization: the API normalizes to NFC.
  var value = raw;
  if (field == ShopField.description) {
    value = value.replaceAll(RegExp('\r\n?'), '\n');
  }
  value = value.trim();
  if (value.isEmpty) return (null, ShopFieldError.required);
  if (value.length > shopFieldLimits[field]!) {
    return (null, ShopFieldError.tooLong);
  }
  final forbidden = field == ShopField.description
      ? _controlExceptLineFeed
      : _control;
  if (forbidden.hasMatch(value)) return (null, ShopFieldError.invalid);
  return (value, null);
}

/// `POST /sellers/me/shop` (the initial application).
ShopFormResult buildShopCreate(ShopFormValues values) {
  final body = <String, Object?>{};
  final errors = <ShopField, ShopFieldError>{};
  for (final field in ShopField.values) {
    final (value, error) = _normalize(field, values[field] ?? '');
    if (error != null) {
      errors[field] = error;
    } else if (value != null) {
      body[field.name] = value;
    }
  }
  return ShopFormResult._(errors.isEmpty ? body : const {}, errors);
}

/// `PATCH /sellers/me/shop`: changed fields the status allows.
ShopFormResult buildShopUpdate(ShopFormValues values, OwnerShop shop) {
  final current = shopFormValues(shop);
  final body = <String, Object?>{};
  final errors = <ShopField, ShopFieldError>{};
  for (final field in directlyEditableFields(shop.status)) {
    final (value, error) = _normalize(field, values[field] ?? '');
    if (error != null) {
      errors[field] = error;
      continue;
    }
    final before = field == ShopField.whatsappPhone
        ? shop.whatsappPhone
        : current[field];
    if (value != before) body[field.name] = value;
  }
  return ShopFormResult._(errors.isEmpty ? body : const {}, errors);
}

/// `POST /sellers/me/shop/change-requests`: proposed values that differ.
ShopFormResult buildChangeRequest(
  String shopName,
  String city,
  OwnerShop shop,
) {
  final body = <String, Object?>{};
  final errors = <ShopField, ShopFieldError>{};
  for (final (field, raw, current) in [
    (ShopField.shopName, shopName, shop.shopName),
    (ShopField.city, city, shop.city),
  ]) {
    final (value, error) = _normalize(field, raw);
    if (error != null) {
      errors[field] = error;
    } else if (value != current) {
      body[field.name] = value;
    }
  }
  return ShopFormResult._(errors.isEmpty ? body : const {}, errors);
}

/// What the screen does with a shop API response.
enum ShopOutcomeKind {
  ok,
  noShop,
  alreadyExists,
  conflict,
  changeRequestOpen,
  reviewField,
  forbidden,
  invalid,
  signedOut,
  unavailable,
  rateLimited,
  error,
}

class ShopOutcome {
  const ShopOutcome(this.kind, [this.shop]);
  final ShopOutcomeKind kind;
  final OwnerShop? shop;
}

ShopOutcome interpretShopResult(
  ApiResult<OwnerShop> result,
) => switch (result) {
  ApiOk(:final data) => ShopOutcome(ShopOutcomeKind.ok, data),
  ApiUnauthorized() => const ShopOutcome(ShopOutcomeKind.signedOut),
  ApiAuthUnavailable() ||
  ApiNetworkError() => const ShopOutcome(ShopOutcomeKind.unavailable),
  ApiForbidden() => const ShopOutcome(ShopOutcomeKind.forbidden),
  ApiError(statusCode: 404) => const ShopOutcome(ShopOutcomeKind.noShop),
  ApiError(statusCode: 400, code: 'REVIEW_FIELD_NOT_EDITABLE') =>
    const ShopOutcome(ShopOutcomeKind.reviewField),
  ApiError(statusCode: 400) => const ShopOutcome(ShopOutcomeKind.invalid),
  ApiError(statusCode: 409, code: 'SHOP_ALREADY_EXISTS') => const ShopOutcome(
    ShopOutcomeKind.alreadyExists,
  ),
  ApiError(statusCode: 409, code: 'CHANGE_REQUEST_OPEN') => const ShopOutcome(
    ShopOutcomeKind.changeRequestOpen,
  ),
  ApiError(statusCode: 409) => const ShopOutcome(ShopOutcomeKind.conflict),
  ApiError(statusCode: 429) => const ShopOutcome(ShopOutcomeKind.rateLimited),
  ApiError(statusCode: 503) => const ShopOutcome(ShopOutcomeKind.unavailable),
  ApiError() => const ShopOutcome(ShopOutcomeKind.error),
};

/// Largest logo upload (spec 06). The server verifies the real content and
/// produces the published image, so this only saves a useless upload.
const logoMaxBytes = 15728640;

/// The logo type from the file signature, or `null` if not JPEG/PNG/WebP.
String? detectLogoType(Uint8List bytes) {
  if (bytes.length >= 3 &&
      bytes[0] == 0xff &&
      bytes[1] == 0xd8 &&
      bytes[2] == 0xff) {
    return 'image/jpeg';
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length) {
    var match = true;
    for (var i = 0; i < png.length; i++) {
      if (bytes[i] != png[i]) match = false;
    }
    if (match) return 'image/png';
  }
  if (bytes.length >= 12 &&
      String.fromCharCodes(bytes.sublist(0, 4)) == 'RIFF' &&
      String.fromCharCodes(bytes.sublist(8, 12)) == 'WEBP') {
    return 'image/webp';
  }
  return null;
}
